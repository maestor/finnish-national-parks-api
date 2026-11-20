import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

import type { Database } from '../db/database.js';
import {
  createImportRun,
  listExistingParksByLipasIds,
  listParkRecordsIncludingRemoved,
  markMissingParksInactive,
  syncParkTypes,
  type UpsertCatalogParkInput,
  upsertCatalogParks
} from '../db/repositories.js';
import { parkImportNotifications, parks, trailAreaLinks } from '../db/schema.js';
import { mergedTrailSlugs } from '../db/trail-merges.js';
import {
  getSupportedParkTypeByCode,
  hikingAreaDisplayTypeName,
  hikingAreaTypeCode,
  isTrailTypeCode
} from '../parks/park-types.js';
import { createLuontoonUrlResolver } from './luontoon-sitemap.js';
import { mapLipasPark, multiUseAreaLipasTypeCode } from './map-lipas-park.js';
import {
  applyLipasTrailMerge,
  getLipasTrailMergeState,
  prepareLipasTrailMerge
} from './merge-lipas-trail.js';
import { reconcileTrailAreas } from './reconcile-trail-areas.js';
import { seitsemansVeljestaTrail as mergedTrail } from './seitsemans-veljesta-trail.js';
import { exceedsTrailLengthLimit, measureTrailLengthKm } from './trail-area-geometry.js';

const lipasResponseSchema = z.object({
  items: z.array(z.unknown()),
  pagination: z
    .object({
      'current-page': z.number().int().positive(),
      'page-size': z.number().int().positive(),
      'total-items': z.number().int().nonnegative(),
      'total-pages': z.number().int().positive()
    })
    .optional()
});

type ImportParksOptions = {
  database: Database;
  expectedActiveCount?: number;
  beforeEachUpsert?: (index: number, lipasId: number) => void | Promise<void>;
  dryRun?: boolean;
  fetchSource?: (sourceUrl: string) => Promise<unknown>;
  fetchLuontoonSitemap?: ((sourceUrl: string) => Promise<string>) | undefined;
  queueNewParkNotification?: boolean;
  requireNoPublicTrailConversions?: boolean;
  now?: () => string;
  sourceUrl: string;
};

const RESPONSE_SHAPE_VERSION = 'catalog-v2';
const IMPORT_BATCH_SIZE = 10;
const IMPORT_BATCH_GEOMETRY_BYTES = 1024 * 1024;
const LUONTOON_SITEMAP_URL = 'https://www.luontoon.fi/resources/sitemap/fi.xml';
const SUPPORTED_LIPAS_TYPE_CODES = [
  103,
  multiUseAreaLipasTypeCode,
  109,
  110,
  111,
  112,
  4403,
  4404,
  4405
] as const;

const formerSpecialParks = new Map([
  [606696, { legacyLipasId: 9001051, parkUrl: 'https://www.luontoon.fi/fi/kohteet/pukala' }],
  [606731, { legacyLipasId: 9001057, parkUrl: 'https://www.luontoon.fi/fi/kohteet/unarinkongas' }]
]);

class ImportDryRunRollbackError extends Error {
  constructor() {
    super('Import dry run rollback.');
  }
}

export const defaultLipasCatalogSourceUrl = `https://api.lipas.fi/v2/sports-sites?type-codes=${SUPPORTED_LIPAS_TYPE_CODES.join(',')}&page-size=100&page=1`;

const defaultFetchSource = async (sourceUrl: string) => {
  const firstResponse = await fetch(sourceUrl);

  if (!firstResponse.ok) {
    throw new Error(`LIPAS import failed with status ${firstResponse.status}.`);
  }

  const firstPayload = lipasResponseSchema.parse(await firstResponse.json());
  if (firstPayload.pagination && firstPayload.pagination['current-page'] !== 1) {
    throw new Error('LIPAS import did not return the first catalog page.');
  }
  const totalPages = firstPayload.pagination?.['total-pages'] ?? 1;

  if (totalPages === 1) {
    if (
      firstPayload.pagination &&
      firstPayload.items.length !== firstPayload.pagination['total-items']
    ) {
      throw new Error('LIPAS import returned an incomplete catalog.');
    }
    return firstPayload;
  }

  const firstPagination = firstPayload.pagination!;
  const combinedItems = [...firstPayload.items];

  for (let page = 2; page <= totalPages; page += 1) {
    const pageUrl = new URL(sourceUrl);
    pageUrl.searchParams.set('page', String(page));

    const response = await fetch(pageUrl);

    if (!response.ok) {
      throw new Error(`LIPAS import failed with status ${response.status} on page ${page}.`);
    }

    const payload = lipasResponseSchema.parse(await response.json());
    if (
      payload.pagination &&
      (payload.pagination['current-page'] !== page ||
        payload.pagination['total-pages'] !== totalPages ||
        payload.pagination['total-items'] !== firstPagination['total-items'])
    ) {
      throw new Error(`LIPAS import returned inconsistent pagination on page ${page}.`);
    }
    combinedItems.push(...payload.items);
  }

  if (combinedItems.length !== firstPagination['total-items']) {
    throw new Error('LIPAS import returned an incomplete catalog.');
  }

  return {
    items: combinedItems,
    pagination: {
      'current-page': 1,
      'page-size': firstPagination['page-size'],
      'total-items': firstPagination['total-items'],
      'total-pages': totalPages
    }
  };
};

const defaultFetchLuontoonSitemap = async (sourceUrl: string) => {
  const response = await fetch(sourceUrl);

  if (!response.ok) {
    throw new Error(`Luontoon sitemap fetch failed with status ${response.status}.`);
  }

  return response.text();
};

const emptyLuontoonSitemap = async () => {
  return '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>';
};

const ensureUniqueSlug = (baseSlug: string, lipasId: number, takenSlugs: Set<string>) => {
  if (!takenSlugs.has(baseSlug)) {
    takenSlugs.add(baseSlug);
    return baseSlug;
  }

  const candidate = `${baseSlug}-${lipasId}`;
  takenSlugs.add(candidate);
  return candidate;
};

export const importParks = async ({
  database,
  expectedActiveCount: _expectedActiveCount,
  beforeEachUpsert,
  dryRun = false,
  fetchSource = defaultFetchSource,
  fetchLuontoonSitemap,
  queueNewParkNotification = false,
  requireNoPublicTrailConversions = false,
  now = () => new Date().toISOString(),
  sourceUrl
}: ImportParksOptions) => {
  const payload = lipasResponseSchema.parse(await fetchSource(sourceUrl));
  const effectiveFetchLuontoonSitemap =
    fetchLuontoonSitemap ??
    (fetchSource === defaultFetchSource ? defaultFetchLuontoonSitemap : emptyLuontoonSitemap);
  const resolveParkUrl = createLuontoonUrlResolver(
    await effectiveFetchLuontoonSitemap(LUONTOON_SITEMAP_URL)
  );
  const sourceIds = payload.items.map(
    (item) => z.object({ 'lipas-id': z.number().int() }).parse(item)['lipas-id']
  );
  if (new Set(sourceIds).size !== sourceIds.length) {
    throw new Error('LIPAS import returned duplicate source IDs.');
  }
  const activeItems = payload.items.filter((item) => {
    const candidate = item as { status?: string };
    return candidate.status === 'active';
  });
  const mappedActiveParks = activeItems.map((item) => mapLipasPark(item));
  const existingParks = await listExistingParksByLipasIds(
    database,
    mappedActiveParks.map((park) => park.lipasId)
  );
  const existingByLipasId = new Map(existingParks.map((park) => [park.lipasId, park]));
  const excludedLongTrails: Array<{
    lipasId: number;
    name: string;
    reportedLengthKm: number | null;
    measuredLengthKm: number | null;
  }> = [];
  const importedParks = mappedActiveParks.filter((park) => {
    if (!isTrailTypeCode(park.type.code)) return true;
    const measuredLengthKm = measureTrailLengthKm(park.boundaryGeoJson);
    const previous = existingByLipasId.get(park.lipasId);
    const reportedLengthKm =
      park.lipasId !== mergedTrail.canonicalId &&
      previous &&
      previous.lengthKm !== previous.importedLengthKm
        ? previous.lengthKm
        : park.lengthKm;
    if (exceedsTrailLengthLimit(measuredLengthKm, reportedLengthKm)) {
      excludedLongTrails.push({
        lipasId: park.lipasId,
        name: park.name,
        reportedLengthKm,
        measuredLengthKm
      });
      return false;
    }
    return true;
  });
  const existingLipasIds = new Set(existingParks.map((park) => park.lipasId));
  const existingImportedSlugByLipasId = new Map(
    existingParks.map((park) => [park.lipasId, park.importedSlug ?? park.slug])
  );
  let newParks = importedParks
    .filter((park) => !existingLipasIds.has(park.lipasId))
    .map((park) => ({
      lipasId: park.lipasId,
      name: park.name,
      removed: true,
      slug: park.slug,
      typeCode: park.type.code,
      typeName: getSupportedParkTypeByCode(park.type.code).name
    }));
  const takenSlugs = new Set(
    (await listParkRecordsIncludingRemoved(database)).map((park) => park.slug)
  );
  const importedAt = now();
  const parksByLipasId = new Map(importedParks.map((park) => [park.lipasId, park]));
  const mergePlan = prepareLipasTrailMerge(parksByLipasId);
  const readyMerge = mergePlan && 'combined' in mergePlan ? mergePlan : undefined;
  const mergeWarnings: string[] = [];
  if (mergePlan && 'error' in mergePlan)
    mergeWarnings.push(`${mergedTrail.slug}: ${mergePlan.error}`);

  let importRunId: number | null = null;
  const trailAreaResult: { value: Awaited<ReturnType<typeof reconcileTrailAreas>> | null } = {
    value: null
  };
  const adoptedParks: { lipasId: number; slug: string }[] = [];
  const deactivatedParks: { lipasId: number; slug: string }[] = [];
  const affectedLongTrailSlugs = new Set<string>();
  let affectedMergedTrailSlugs: string[] = [];
  let activeCount = 0;

  try {
    await database.transaction(async (tx) => {
      await syncParkTypes(tx);

      for (const [lipasId, { legacyLipasId }] of formerSpecialParks) {
        const incoming = parksByLipasId.get(lipasId);
        if (!incoming) continue;

        // Changing the source ID in place preserves foreign keys. Keep the existing
        // public name and marker as local edits if they differ from the LIPAS values.
        const [adopted] = await tx
          .update(parks)
          .set({
            lipasId,
            importedName: incoming.name,
            importedMarkerLat: incoming.markerPoint.lat,
            importedMarkerLon: incoming.markerPoint.lon
          })
          .where(eq(parks.lipasId, legacyLipasId))
          .returning({
            slug: parks.slug,
            importedSlug: parks.importedSlug
          });

        if (adopted) {
          existingImportedSlugByLipasId.set(lipasId, adopted.importedSlug ?? adopted.slug);
          adoptedParks.push({ lipasId, slug: adopted.slug });
        }
      }
      newParks = newParks.filter(({ lipasId }) => !existingImportedSlugByLipasId.has(lipasId));

      const previousMerge = await getLipasTrailMergeState(tx);
      const maintainMerge = Boolean(readyMerge || previousMerge?.group);
      if (previousMerge?.group && !readyMerge)
        mergeWarnings.push(
          `${mergedTrail.slug}: retaining the previous route until all six components are usable.`
        );
      const activeLipasIds = maintainMerge
        ? [
            ...importedParks
              .filter((park) => !mergedTrail.componentIds.includes(park.lipasId))
              .map((park) => park.lipasId),
            mergedTrail.canonicalId
          ]
        : importedParks.map((park) => park.lipasId);
      const importableItems = activeItems.filter((item) => {
        const id = (item as { 'lipas-id': number })['lipas-id'];
        return (
          parksByLipasId.has(id) &&
          (readyMerge || !maintainMerge || !mergedTrail.componentIds.includes(id))
        );
      });
      const canonicalSlug = readyMerge
        ? (existingImportedSlugByLipasId.get(mergedTrail.canonicalId) ??
          ensureUniqueSlug(mergedTrail.slug, mergedTrail.canonicalId, takenSlugs))
        : undefined;
      if (maintainMerge) {
        newParks = newParks.flatMap((park) =>
          !mergedTrail.componentIds.includes(park.lipasId)
            ? [park]
            : park.lipasId === mergedTrail.canonicalId && canonicalSlug
              ? [{ ...park, name: mergedTrail.name, slug: canonicalSlug }]
              : []
        );
      }

      activeCount = activeLipasIds.length;
      importRunId = await createImportRun(tx, {
        activeCount,
        importedAt,
        responseShapeVersion: RESPONSE_SHAPE_VERSION,
        sourceUrl
      });

      let batch: UpsertCatalogParkInput[] = [];
      let batchGeometryBytes = 0;
      const flushBatch = async () => {
        await upsertCatalogParks(tx, batch);
        batch = [];
        batchGeometryBytes = 0;
      };

      for (let index = 0; index < importableItems.length; index += 1) {
        const item = importableItems[index];
        const lipasId = (item as { 'lipas-id': number })['lipas-id'];

        if (beforeEachUpsert) {
          await beforeEachUpsert(index, lipasId);
        }

        const raw = mapLipasPark(item, existingImportedSlugByLipasId.get(lipasId));
        const combined = lipasId === mergedTrail.canonicalId ? readyMerge?.combined : undefined;
        const mapped = combined
          ? {
              ...raw,
              name: mergedTrail.name,
              slug: canonicalSlug!,
              lengthKm: combined.lengthKm,
              boundaryGeoJson: combined.geometry,
              boundingBox: {
                minLon: combined.bboxMinLon,
                minLat: combined.bboxMinLat,
                maxLon: combined.bboxMaxLon,
                maxLat: combined.bboxMaxLat
              },
              markerPoint: { lat: combined.markerLat, lon: combined.markerLon }
            }
          : raw;
        const resolvedParkUrl =
          resolveParkUrl(mapped) ?? formerSpecialParks.get(lipasId)?.parkUrl ?? mapped.parkUrl;
        const slug = combined
          ? canonicalSlug!
          : (existingImportedSlugByLipasId.get(lipasId) ??
            ensureUniqueSlug(mapped.slug, lipasId, takenSlugs));
        const hasBounds =
          Object.values(mapped.boundingBox).every(Number.isFinite) &&
          mapped.boundingBox.minLon >= -180 &&
          mapped.boundingBox.maxLon <= 180 &&
          mapped.boundingBox.minLat >= -90 &&
          mapped.boundingBox.maxLat <= 90;
        if (!hasBounds && !isTrailTypeCode(mapped.type.code)) {
          throw new Error(`Area ${mapped.lipasId} has no usable coordinates.`);
        }
        const previous = existingByLipasId.get(mapped.lipasId);
        const bounds = hasBounds
          ? mapped.boundingBox
          : {
              minLon: previous?.bboxMinLon ?? 0,
              minLat: previous?.bboxMinLat ?? 0,
              maxLon: previous?.bboxMaxLon ?? 0,
              maxLat: previous?.bboxMaxLat ?? 0
            };
        const marker = hasBounds
          ? mapped.markerPoint
          : {
              lon: previous?.importedMarkerLon ?? previous?.markerLon ?? 0,
              lat: previous?.importedMarkerLat ?? previous?.markerLat ?? 0
            };
        const boundaryGeojson = JSON.stringify(mapped.boundaryGeoJson);
        const geometryBytes = Buffer.byteLength(boundaryGeojson);
        if (batch.length > 0 && batchGeometryBytes + geometryBytes > IMPORT_BATCH_GEOMETRY_BYTES) {
          await flushBatch();
        }
        batch.push({
          areaKm2: mapped.areaKm2,
          lengthKm: mapped.lengthKm,
          bboxMaxLat: bounds.maxLat,
          bboxMaxLon: bounds.maxLon,
          bboxMinLat: bounds.minLat,
          bboxMinLon: bounds.minLon,
          boundaryGeojson,
          catalogStatus:
            readyMerge &&
            mergedTrail.componentIds.includes(lipasId) &&
            lipasId !== mergedTrail.canonicalId
              ? 'inactive'
              : 'active',
          createdAt: importedAt,
          displayTypeName:
            mapped.sourceTypeCode === hikingAreaTypeCode ? hikingAreaDisplayTypeName : null,
          establishmentYear: mapped.establishmentYear,
          hasMagnet: mapped.hasMagnet,
          lastImportRunId: importRunId!,
          lipasId: mapped.lipasId,
          locationLabel: mapped.locationLabel,
          parkUrl: resolvedParkUrl,
          managedByLipasImport: true,
          markerLat: marker.lat,
          removed: true,
          markerLon: marker.lon,
          municipalityCode: mapped.municipalityCode,
          name: mapped.name,
          postalCode: mapped.postalCode,
          postalOffice: mapped.postalOffice,
          slug,
          sourceEventDate: mapped.sourceEventDate,
          typeId: mapped.type.id,
          updatedAt: importedAt
        });
        batchGeometryBytes += geometryBytes;
        if (batch.length === IMPORT_BATCH_SIZE) await flushBatch();
      }

      if (batch.length > 0) await flushBatch();

      const appliedMerge = readyMerge
        ? await applyLipasTrailMerge(tx, readyMerge, previousMerge, importedAt)
        : undefined;
      const newlyHiddenLongTrailSlugs: string[] = [];
      if (excludedLongTrails.length) {
        const excludedIds = excludedLongTrails
          .map((trail) => trail.lipasId)
          .filter((id) => !maintainMerge || !mergedTrail.componentIds.includes(id));
        const excludedExisting = await tx
          .select({ id: parks.id, slug: parks.slug, removed: parks.removed })
          .from(parks)
          .where(inArray(parks.lipasId, excludedIds));
        for (const trail of excludedExisting) {
          affectedLongTrailSlugs.add(trail.slug);
          if (!trail.removed) newlyHiddenLongTrailSlugs.push(trail.slug);
        }
        if (excludedExisting.length) {
          const linkedAreas = await tx
            .select({ slug: parks.slug })
            .from(trailAreaLinks)
            .innerJoin(parks, eq(parks.id, trailAreaLinks.areaId))
            .where(
              inArray(
                trailAreaLinks.trailId,
                excludedExisting.map((trail) => trail.id)
              )
            );
          for (const area of linkedAreas) affectedLongTrailSlugs.add(area.slug);
        }
        await tx.update(parks).set({ removed: true }).where(inArray(parks.lipasId, excludedIds));
      }

      const activeIds = new Set(activeLipasIds);
      const previouslyActive = await tx
        .select({ lipasId: parks.lipasId, slug: parks.slug })
        .from(parks)
        .where(and(eq(parks.managedByLipasImport, true), eq(parks.catalogStatus, 'active')));
      deactivatedParks.push(...previouslyActive.filter((park) => !activeIds.has(park.lipasId)));
      await markMissingParksInactive(tx, activeLipasIds, importRunId!, importedAt);
      trailAreaResult.value = await reconcileTrailAreas(tx, importedAt);
      if (appliedMerge?.affectedSlugs.length) {
        affectedMergedTrailSlugs = [
          ...new Set([
            ...appliedMerge.affectedSlugs,
            ...(await mergedTrailSlugs(tx, [appliedMerge.canonicalId]))
          ])
        ];
      }
      const manualExpirySlugs = [
        ...(appliedMerge?.needsImmediateExpiry ? affectedMergedTrailSlugs : []),
        ...trailAreaResult.value.newlyHiddenPublicSlugs,
        ...newlyHiddenLongTrailSlugs
      ];
      if (requireNoPublicTrailConversions && manualExpirySlugs.length) {
        throw new Error(
          `Public trail conversion requires immediate frontend cache expiry: ${manualExpirySlugs.join(', ')}`
        );
      }

      if (queueNewParkNotification && newParks.length > 0) {
        await tx.insert(parkImportNotifications).values({
          importRunId: importRunId!,
          parksJson: JSON.stringify(
            newParks.map(({ lipasId, name, typeName }) => ({
              lipasId,
              name,
              typeName
            }))
          )
        });
      }

      if (dryRun) {
        throw new ImportDryRunRollbackError();
      }
    });
  } catch (error) {
    if (!(error instanceof ImportDryRunRollbackError)) {
      throw error;
    }

    importRunId = null;
  }

  return {
    activeCount,
    affectedMergedTrailSlugs,
    mergeWarnings,
    trailAreaResult: trailAreaResult.value,
    deactivatedParks,
    dryRun,
    newParks,
    adoptedParks,
    sourceActiveCount: activeItems.length,
    excludedLongTrails,
    affectedLongTrailSlugs: [...affectedLongTrailSlugs],
    importRunId,
    importedAt
  };
};
