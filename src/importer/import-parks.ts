import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import type { Database } from '../db/database.js';
import {
  createImportRun,
  listExistingParksByLipasIds,
  listParkRecordsIncludingRemoved,
  markMissingParksInactive,
  syncParkTypes,
  upsertImportedPark
} from '../db/repositories.js';
import { parkImportNotifications, parks } from '../db/schema.js';
import {
  getSupportedParkTypeByCode,
  hikingAreaDisplayTypeName,
  hikingAreaTypeCode,
  isTrailTypeCode
} from '../parks/park-types.js';
import { createLuontoonUrlResolver } from './luontoon-sitemap.js';
import { mapLipasPark } from './map-lipas-park.js';
import { reconcileTrailAreas } from './reconcile-trail-areas.js';

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
const LUONTOON_SITEMAP_URL = 'https://www.luontoon.fi/resources/sitemap/fi.xml';
const SUPPORTED_LIPAS_TYPE_CODES = [103, 109, 110, 111, 112, 4403, 4404, 4405] as const;

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
  const importedParks = mappedActiveParks;
  const importedLipasIds = importedParks.map((park) => park.lipasId);
  const existingParks = await listExistingParksByLipasIds(database, importedLipasIds);
  const existingLipasIds = new Set(existingParks.map((park) => park.lipasId));
  const existingByLipasId = new Map(existingParks.map((park) => [park.lipasId, park]));
  const existingImportedSlugByLipasId = new Map(
    existingParks.map((park) => [park.lipasId, park.importedSlug ?? park.slug])
  );
  const newParks = importedParks
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
  const importableItems = activeItems.filter((item) =>
    parksByLipasId.has((item as { 'lipas-id': number })['lipas-id'])
  );

  let importRunId: number | null = null;
  const trailAreaResult: { value: Awaited<ReturnType<typeof reconcileTrailAreas>> | null } = {
    value: null
  };
  const deactivatedParks: { lipasId: number; slug: string }[] = [];

  try {
    await database.transaction(async (tx) => {
      await syncParkTypes(tx);

      importRunId = await createImportRun(tx, {
        activeCount: importedParks.length,
        importedAt,
        responseShapeVersion: RESPONSE_SHAPE_VERSION,
        sourceUrl
      });

      for (let index = 0; index < importableItems.length; index += 1) {
        const item = importableItems[index];
        const lipasId = (item as { 'lipas-id': number })['lipas-id'];

        if (beforeEachUpsert) {
          await beforeEachUpsert(index, lipasId);
        }

        const mapped = mapLipasPark(item, existingImportedSlugByLipasId.get(lipasId));
        const resolvedParkUrl = resolveParkUrl(mapped) ?? mapped.parkUrl;
        const slug =
          existingImportedSlugByLipasId.get(lipasId) ??
          ensureUniqueSlug(mapped.slug, lipasId, takenSlugs);
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
        await upsertImportedPark(tx, {
          areaKm2: mapped.areaKm2,
          bboxMaxLat: bounds.maxLat,
          bboxMaxLon: bounds.maxLon,
          bboxMinLat: bounds.minLat,
          bboxMinLon: bounds.minLon,
          boundaryGeojson: JSON.stringify(mapped.boundaryGeoJson),
          catalogStatus: 'active',
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
      }

      const activeIds = new Set(importedLipasIds);
      const previouslyActive = await tx
        .select({ lipasId: parks.lipasId, slug: parks.slug })
        .from(parks)
        .where(and(eq(parks.managedByLipasImport, true), eq(parks.catalogStatus, 'active')));
      deactivatedParks.push(...previouslyActive.filter((park) => !activeIds.has(park.lipasId)));
      await markMissingParksInactive(tx, importedLipasIds, importRunId!, importedAt);
      trailAreaResult.value = await reconcileTrailAreas(tx, importedAt);
      if (
        requireNoPublicTrailConversions &&
        trailAreaResult.value.newlyHiddenPublicSlugs.length > 0
      ) {
        throw new Error(
          `Public trail conversion requires immediate frontend cache expiry: ${trailAreaResult.value.newlyHiddenPublicSlugs.join(', ')}`
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
    activeCount: importedParks.length,
    trailAreaResult: trailAreaResult.value,
    deactivatedParks,
    dryRun,
    newParks,
    sourceActiveCount: activeItems.length,
    importRunId,
    importedAt
  };
};
