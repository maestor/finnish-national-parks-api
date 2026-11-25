import { and, eq, inArray, or } from 'drizzle-orm';
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
import { importRuns, parkImportNotifications, parks } from '../db/schema.js';
import { listTrailAreas } from '../db/trail-areas.js';
import { mergedTrailSlugs } from '../db/trail-merges.js';
import {
  fitnessTrailLipasTypeCode,
  getSupportedParkTypeByCode,
  hikingAreaDisplayTypeName,
  hikingAreaTypeCode,
  isTrailTypeCode
} from '../parks/park-types.js';
import {
  listAreaLinkOnlyParentSlugs,
  qualifiesForVisibleParent,
  selectVisibleTrailParents
} from './area-link-only-trails.js';
import {
  createLipasTrailDuplicateCheck,
  describeTrailMatchSource
} from './find-lipas-trail-duplicates.js';
import { createLuontoonUrlResolver } from './luontoon-sitemap.js';
import { mapLipasPark, multiUseAreaLipasTypeCode } from './map-lipas-park.js';
import {
  applyLipasTrailMerge,
  getLipasTrailMergeState,
  prepareLipasTrailMerge
} from './merge-lipas-trail.js';
import type { DuplicateTrailReview } from './park-review-notifications.js';
import { reconcileTrailAreas } from './reconcile-trail-areas.js';
import { seitsemansVeljestaTrail as mergedTrail } from './seitsemans-veljesta-trail.js';
import { createTransactionKeepalive } from './transaction-keepalive.js';

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
  scope?: 'catalog' | 'area-link-only';
  fetchSource?: (sourceUrl: string) => Promise<unknown>;
  fetchLuontoonSitemap?: ((sourceUrl: string) => Promise<string>) | undefined;
  queueNewParkNotification?: boolean;
  skipDuplicateTrails?: boolean;
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
  fitnessTrailLipasTypeCode,
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

export const fitnessTrailSourceUrl = `https://api.lipas.fi/v2/sports-sites?type-codes=${fitnessTrailLipasTypeCode}&page-size=100&page=1`;

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
  scope = 'catalog',
  fetchSource = defaultFetchSource,
  fetchLuontoonSitemap,
  queueNewParkNotification = false,
  skipDuplicateTrails = false,
  requireNoPublicTrailConversions = false,
  now = () => new Date().toISOString(),
  sourceUrl
}: ImportParksOptions) => {
  const payload = lipasResponseSchema.parse(await fetchSource(sourceUrl));
  const areaLinkOnlyImport = scope === 'area-link-only';
  const effectiveFetchLuontoonSitemap =
    fetchLuontoonSitemap ??
    (fetchSource === defaultFetchSource && !areaLinkOnlyImport
      ? defaultFetchLuontoonSitemap
      : emptyLuontoonSitemap);
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
  const mappedActiveParks = activeItems.map(mapLipasPark);
  const fitnessTrailLipasIds = new Set(
    mappedActiveParks
      .filter((park) => park.sourceTypeCode === fitnessTrailLipasTypeCode)
      .map((park) => park.lipasId)
  );
  if (areaLinkOnlyImport && fitnessTrailLipasIds.size !== mappedActiveParks.length) {
    throw new Error('This import requires a link-only trail source.');
  }
  const existingParks = await listExistingParksByLipasIds(
    database,
    mappedActiveParks.map((park) => park.lipasId)
  );
  const existingByLipasId = new Map(existingParks.map((park) => [park.lipasId, park]));
  const existingLipasIds = new Set(existingParks.map((park) => park.lipasId));
  const existingImportedSlugByLipasId = new Map(
    existingParks.map((park) => [park.lipasId, park.importedSlug ?? park.slug])
  );
  let newParks = mappedActiveParks
    .filter((park) => !existingLipasIds.has(park.lipasId))
    .map((park) => ({
      lipasId: park.lipasId,
      name: park.name,
      removed: true,
      slug: park.slug,
      typeCode: fitnessTrailLipasIds.has(park.lipasId) ? fitnessTrailLipasTypeCode : park.type.code,
      typeName: fitnessTrailLipasIds.has(park.lipasId)
        ? 'Fitness trail'
        : getSupportedParkTypeByCode(park.type.code).name
    }));
  const takenSlugs = new Set(
    (await listParkRecordsIncludingRemoved(database)).map((park) => park.slug)
  );
  const importedAt = now();
  const parksByLipasId = new Map(mappedActiveParks.map((park) => [park.lipasId, park]));
  const mergePlan = areaLinkOnlyImport ? undefined : prepareLipasTrailMerge(parksByLipasId);
  const readyMerge = mergePlan && 'combined' in mergePlan ? mergePlan : undefined;
  const mergeWarnings: string[] = [];
  if (mergePlan && 'error' in mergePlan)
    mergeWarnings.push(`${mergedTrail.slug}: ${mergePlan.error}`);

  let importRunId: number | null = null;
  const trailAreaResult: { value: Awaited<ReturnType<typeof reconcileTrailAreas>> | null } = {
    value: null
  };
  const adoptedParks: { lipasId: number; slug: string }[] = [];
  const duplicateTrails: DuplicateTrailReview[] = [];
  const deactivatedParks: { lipasId: number; slug: string }[] = [];
  let affectedMergedTrailSlugs: string[] = [];
  let activeCount = 0;
  let affectedAreaLinkOnlySlugs: string[] = [];

  try {
    await database.transaction(async (tx) => {
      await syncParkTypes(tx);
      const priorAreaLinkOnlySlugs = await listAreaLinkOnlyParentSlugs(tx);
      const hasFitnessTrailSourceId = inArray(parks.lipasId, [...fitnessTrailLipasIds]);
      const scopedCatalog = areaLinkOnlyImport
        ? or(eq(parks.areaLinkOnly, true), hasFitnessTrailSourceId)
        : undefined;
      const formerStandaloneFitnessTrails = fitnessTrailLipasIds.size
        ? await tx
            .select({ slug: parks.slug })
            .from(parks)
            .where(
              and(
                eq(parks.managedByLipasImport, true),
                eq(parks.catalogStatus, 'active'),
                eq(parks.removed, false),
                eq(parks.trailPublicationRole, 'independent'),
                eq(parks.areaLinkOnly, false),
                hasFitnessTrailSourceId
              )
            )
        : [];
      const formerStandaloneSlugs = formerStandaloneFitnessTrails.map(({ slug }) => slug);

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

      const previousMerge = areaLinkOnlyImport ? undefined : await getLipasTrailMergeState(tx);
      const maintainMerge = Boolean(readyMerge || previousMerge?.group);
      if (previousMerge?.group && !readyMerge)
        mergeWarnings.push(
          `${mergedTrail.slug}: retaining the previous route until all six components are usable.`
        );
      const activeLipasIds = maintainMerge
        ? [
            ...mappedActiveParks
              .filter((park) => !mergedTrail.componentIds.includes(park.lipasId))
              .map((park) => park.lipasId),
            mergedTrail.canonicalId
          ]
        : mappedActiveParks.map((park) => park.lipasId);
      const importableParks =
        maintainMerge && !readyMerge
          ? mappedActiveParks.filter((park) => !mergedTrail.componentIds.includes(park.lipasId))
          : mappedActiveParks;
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

      const activeIds = new Set(activeLipasIds);
      const keepTransactionActive = createTransactionKeepalive(tx);
      const incomingTrails = skipDuplicateTrails
        ? importableParks.filter(
            (park) =>
              isTrailTypeCode(park.type.code) &&
              !existingImportedSlugByLipasId.has(park.lipasId) &&
              !(maintainMerge && mergedTrail.componentIds.includes(park.lipasId))
          )
        : [];
      const findDuplicate = incomingTrails.length
        ? await createLipasTrailDuplicateCheck(tx, incomingTrails, activeIds)
        : undefined;
      activeCount = activeIds.size;
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

      const regularParks = importableParks.filter(
        (park) => !fitnessTrailLipasIds.has(park.lipasId)
      );
      const fitnessTrails = importableParks.filter((park) =>
        fitnessTrailLipasIds.has(park.lipasId)
      );
      const orderedParks = [...regularParks, ...fitnessTrails];
      let visibleParents: Awaited<ReturnType<typeof selectVisibleTrailParents>> = [];
      for (const [index, park] of orderedParks.entries()) {
        const { lipasId } = park;

        const areaLinkOnly = fitnessTrailLipasIds.has(lipasId);
        if (index === regularParks.length) {
          if (batch.length) await flushBatch();
          visibleParents = await selectVisibleTrailParents(
            tx,
            (id) => areaLinkOnlyImport || activeIds.has(id)
          );
        }
        if (areaLinkOnly) {
          await keepTransactionActive();
          if (!qualifiesForVisibleParent(park, visibleParents)) {
            activeIds.delete(lipasId);
            continue;
          }
        }
        const duplicate = findDuplicate?.(park);
        if (findDuplicate) await keepTransactionActive();
        if (duplicate) {
          activeIds.delete(lipasId);
          const areas = (await listTrailAreas(tx, duplicate.slug))!;
          duplicateTrails.push({
            lipasId,
            trailName: park.name,
            matchedName: duplicate.name,
            matchedSlug: duplicate.slug,
            source: describeTrailMatchSource(duplicate),
            areaNames: areas.map(({ name }) => name)
          });
          continue;
        }
        if (beforeEachUpsert) {
          await beforeEachUpsert(index, lipasId);
        }
        const combined = lipasId === mergedTrail.canonicalId ? readyMerge?.combined : undefined;
        const raw = { ...park, slug: existingImportedSlugByLipasId.get(lipasId) ?? park.slug };
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
          areaLinkOnly,
          ...(areaLinkOnly ? { trailPublicationRole: 'area_member' as const } : {}),
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
      newParks = newParks.filter(({ lipasId }) => activeIds.has(lipasId));
      if (activeCount !== activeIds.size) {
        activeCount = activeIds.size;
        await tx.update(importRuns).set({ activeCount }).where(eq(importRuns.id, importRunId!));
      }
      const previouslyActive = await tx
        .select({ lipasId: parks.lipasId, slug: parks.slug })
        .from(parks)
        .where(
          and(
            eq(parks.managedByLipasImport, true),
            eq(parks.catalogStatus, 'active'),
            scopedCatalog
          )
        );
      deactivatedParks.push(...previouslyActive.filter((park) => !activeIds.has(park.lipasId)));
      const retiredFitnessTrailLipasIds = deactivatedParks
        .filter(({ lipasId }) => fitnessTrailLipasIds.has(lipasId))
        .map(({ lipasId }) => lipasId);
      if (retiredFitnessTrailLipasIds.length) {
        await tx
          .update(parks)
          .set({ areaLinkOnly: true })
          .where(inArray(parks.lipasId, retiredFitnessTrailLipasIds));
      }
      await markMissingParksInactive(tx, [...activeIds], importRunId!, importedAt, scopedCatalog);
      trailAreaResult.value = await reconcileTrailAreas(tx, importedAt, scope);
      affectedAreaLinkOnlySlugs = [
        ...new Set([
          ...priorAreaLinkOnlySlugs,
          ...formerStandaloneSlugs,
          ...(await listAreaLinkOnlyParentSlugs(tx))
        ])
      ].sort();
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
        ...formerStandaloneSlugs
      ];
      if (requireNoPublicTrailConversions && manualExpirySlugs.length) {
        throw new Error(
          `Public trail conversion requires immediate frontend cache expiry: ${[...new Set(manualExpirySlugs)].join(', ')}`
        );
      }

      const newStandaloneParks = newParks.filter(
        ({ lipasId }) => !fitnessTrailLipasIds.has(lipasId)
      );
      const newAreaOnlyLinks = trailAreaResult.value.newAreaOnlyLinks;
      if (
        queueNewParkNotification &&
        (newStandaloneParks.length || newAreaOnlyLinks.length || duplicateTrails.length)
      ) {
        await tx.insert(parkImportNotifications).values({
          importRunId: importRunId!,
          parksJson: JSON.stringify({
            parks: newStandaloneParks.map(({ lipasId, name, typeName }) => ({
              lipasId,
              name,
              typeName
            })),
            areaLinks: newAreaOnlyLinks,
            duplicateTrails: duplicateTrails.length ? duplicateTrails : undefined
          })
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
    affectedAreaLinkOnlySlugs,
    affectedMergedTrailSlugs,
    mergeWarnings,
    trailAreaResult: trailAreaResult.value,
    deactivatedParks,
    dryRun,
    newParks,
    adoptedParks,
    sourceActiveCount: activeItems.length,
    importRunId,
    importedAt
  };
};
