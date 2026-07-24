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
import {
  getSupportedParkTypeByCode,
  hikingAreaDisplayTypeName,
  hikingAreaTypeCode,
  isHikingTrailTypeCode,
  isTrailTypeCode,
  isWalkingTrailTypeCode
} from '../parks/park-types.js';
import { hasAnyPointInsideArea, isFullyInsideArea } from './geometry.js';
import { createLuontoonUrlResolver } from './luontoon-sitemap.js';
import type { MappedPark } from './map-lipas-park.js';
import { mapLipasPark } from './map-lipas-park.js';

const lipasResponseSchema = z.object({
  items: z.array(z.unknown()),
  pagination: z
    .object({
      'current-page': z.number().int(),
      'page-size': z.number().int(),
      'total-items': z.number().int(),
      'total-pages': z.number().int()
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
  markNewParksRemoved?: boolean;
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
  const totalPages = firstPayload.pagination?.['total-pages'] ?? 1;

  if (totalPages === 1) {
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
    combinedItems.push(...payload.items);
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

const normalizeLocationPart = (value: string | null) => value?.trim().toLowerCase() ?? '';

const hasMatchingAreaLocationMetadata = (park: MappedPark, areas: MappedPark[]) => {
  const parkLocationLabel = normalizeLocationPart(park.locationLabel);
  const parkPostalCode = normalizeLocationPart(park.postalCode);
  const parkPostalOffice = normalizeLocationPart(park.postalOffice);

  if (!parkLocationLabel || !parkPostalCode || !parkPostalOffice) {
    return false;
  }

  return areas.some(
    (area) =>
      normalizeLocationPart(area.locationLabel) === parkLocationLabel &&
      normalizeLocationPart(area.postalCode) === parkPostalCode &&
      normalizeLocationPart(area.postalOffice) === parkPostalOffice
  );
};

const shouldSkipTrailImport = (park: MappedPark, areas: MappedPark[]) => {
  if (!isTrailTypeCode(park.type.code)) {
    return false;
  }

  const overlapsArea = areas.some((area) =>
    isWalkingTrailTypeCode(park.type.code)
      ? hasAnyPointInsideArea(park.boundaryGeoJson, area.boundaryGeoJson)
      : isFullyInsideArea(park.boundaryGeoJson, area.boundaryGeoJson)
  );

  return overlapsArea || hasMatchingAreaLocationMetadata(park, areas);
};

export const importParks = async ({
  database,
  expectedActiveCount: _expectedActiveCount,
  beforeEachUpsert,
  dryRun = false,
  fetchSource = defaultFetchSource,
  fetchLuontoonSitemap,
  markNewParksRemoved = false,
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
  const activeItems = payload.items.filter((item) => {
    const candidate = item as { status?: string };
    return candidate.status === 'active';
  });
  const mappedActiveParks = activeItems.map((item) => mapLipasPark(item));
  const importedAreas = mappedActiveParks.filter((park) => !isTrailTypeCode(park.type.code));
  const importedParks = mappedActiveParks.filter(
    (park) => !shouldSkipTrailImport(park, importedAreas)
  );
  const importedLipasIds = importedParks.map((park) => park.lipasId);
  const existingParks = await listExistingParksByLipasIds(database, importedLipasIds);
  const existingLipasIds = new Set(existingParks.map((park) => park.lipasId));
  const existingImportedSlugByLipasId = new Map(
    existingParks.map((park) => [park.lipasId, park.importedSlug ?? park.slug])
  );
  const newParks = importedParks
    .filter((park) => !existingLipasIds.has(park.lipasId))
    .map((park) => ({
      lipasId: park.lipasId,
      name: park.name,
      removed:
        markNewParksRemoved ||
        isHikingTrailTypeCode(park.type.code) ||
        isWalkingTrailTypeCode(park.type.code),
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
        const insertAsRemoved =
          (!existingLipasIds.has(mapped.lipasId) && markNewParksRemoved) ||
          isHikingTrailTypeCode(mapped.type.code) ||
          isWalkingTrailTypeCode(mapped.type.code);

        await upsertImportedPark(tx, {
          areaKm2: mapped.areaKm2,
          bboxMaxLat: mapped.boundingBox.maxLat,
          bboxMaxLon: mapped.boundingBox.maxLon,
          bboxMinLat: mapped.boundingBox.minLat,
          bboxMinLon: mapped.boundingBox.minLon,
          boundaryGeojson: JSON.stringify(mapped.boundaryGeoJson),
          catalogStatus: 'active',
          createdAt: importedAt,
          displayTypeName:
            mapped.sourceTypeCode === hikingAreaTypeCode ? hikingAreaDisplayTypeName : null,
          establishmentYear: mapped.establishmentYear,
          lastImportRunId: importRunId!,
          lipasId: mapped.lipasId,
          locationLabel: mapped.locationLabel,
          parkUrl: resolvedParkUrl,
          managedByLipasImport: true,
          markerLat: mapped.markerPoint.lat,
          removed: insertAsRemoved,
          markerLon: mapped.markerPoint.lon,
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

      await markMissingParksInactive(tx, importedLipasIds, importRunId!, importedAt);

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
    dryRun,
    newParks,
    skippedTrailCount: activeItems.length - importedParks.length,
    sourceActiveCount: activeItems.length,
    importRunId,
    importedAt
  };
};
