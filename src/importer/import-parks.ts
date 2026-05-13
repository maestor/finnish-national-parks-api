import { z } from 'zod';

import type { Database } from '../db/database.js';
import {
  createImportRun,
  listExistingParksByLipasIds,
  markMissingParksInactive,
  syncParkTypes,
  upsertImportedPark
} from '../db/repositories.js';
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
  fetchSource?: (sourceUrl: string) => Promise<unknown>;
  now?: () => string;
  sourceUrl: string;
};

const RESPONSE_SHAPE_VERSION = 'catalog-v2';

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
  expectedActiveCount = 137,
  beforeEachUpsert,
  fetchSource = defaultFetchSource,
  now = () => new Date().toISOString(),
  sourceUrl
}: ImportParksOptions) => {
  const payload = lipasResponseSchema.parse(await fetchSource(sourceUrl));
  const activeItems = payload.items.filter((item) => {
    const candidate = item as { status?: string };
    return candidate.status === 'active';
  });

  if (activeItems.length !== expectedActiveCount) {
    throw new Error(
      `Expected ${expectedActiveCount} active parks but received ${activeItems.length}.`
    );
  }

  const lipasIds = activeItems.map((item) => (item as { 'lipas-id': number })['lipas-id']);
  const existingParks = await listExistingParksByLipasIds(database, lipasIds);
  const existingSlugByLipasId = new Map(existingParks.map((park) => [park.lipasId, park.slug]));
  const takenSlugs = new Set(existingParks.map((park) => park.slug));
  const importedAt = now();

  await syncParkTypes(database);

  let importRunId: number;

  await database.transaction(async (tx) => {
    importRunId = await createImportRun(tx, {
      activeCount: activeItems.length,
      importedAt,
      responseShapeVersion: RESPONSE_SHAPE_VERSION,
      sourceUrl
    });

    for (let index = 0; index < activeItems.length; index += 1) {
      const item = activeItems[index];
      const lipasId = (item as { 'lipas-id': number })['lipas-id'];

      if (beforeEachUpsert) {
        await beforeEachUpsert(index, lipasId);
      }

      const mapped = mapLipasPark(item, existingSlugByLipasId.get(lipasId));
      const slug =
        existingSlugByLipasId.get(lipasId) ?? ensureUniqueSlug(mapped.slug, lipasId, takenSlugs);

      await upsertImportedPark(tx, {
        areaKm2: mapped.areaKm2,
        bboxMaxLat: mapped.boundingBox.maxLat,
        bboxMaxLon: mapped.boundingBox.maxLon,
        bboxMinLat: mapped.boundingBox.minLat,
        bboxMinLon: mapped.boundingBox.minLon,
        boundaryGeojson: JSON.stringify(mapped.boundaryGeoJson),
        catalogStatus: 'active',
        createdAt: importedAt,
        establishmentYear: mapped.establishmentYear,
        lastImportRunId: importRunId,
        lipasId: mapped.lipasId,
        locationLabel: mapped.locationLabel,
        luontoonUrl: mapped.luontoonUrl,
        markerLat: mapped.markerPoint.lat,
        markerLon: mapped.markerPoint.lon,
        municipalityCode: mapped.municipalityCode,
        name: mapped.name,
        postalOffice: mapped.postalOffice,
        slug,
        sourceEventDate: mapped.sourceEventDate,
        typeId: mapped.type.id,
        updatedAt: importedAt
      });
    }

    await markMissingParksInactive(tx, lipasIds, importRunId, importedAt);
  });

  return {
    activeCount: activeItems.length,
    importRunId: importRunId!,
    importedAt
  };
};
