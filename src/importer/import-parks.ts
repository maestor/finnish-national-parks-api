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
  items: z.array(z.unknown())
});

type ImportParksOptions = {
  database: Database;
  expectedActiveCount?: number;
  fetchSource?: (sourceUrl: string) => Promise<unknown>;
  now?: () => string;
  sourceUrl: string;
};

const RESPONSE_SHAPE_VERSION = 'catalog-v2';

async function defaultFetchSource(sourceUrl: string) {
  const response = await fetch(sourceUrl);

  if (!response.ok) {
    throw new Error(`LIPAS import failed with status ${response.status}.`);
  }

  return response.json();
}

function ensureUniqueSlug(baseSlug: string, lipasId: number, takenSlugs: Set<string>) {
  if (!takenSlugs.has(baseSlug)) {
    takenSlugs.add(baseSlug);
    return baseSlug;
  }

  const candidate = `${baseSlug}-${lipasId}`;
  takenSlugs.add(candidate);
  return candidate;
}

export async function importParks({
  database,
  expectedActiveCount = 137,
  fetchSource = defaultFetchSource,
  now = () => new Date().toISOString(),
  sourceUrl
}: ImportParksOptions) {
  const payload = lipasResponseSchema.parse(await fetchSource(sourceUrl));
  const activeItems = payload.items.filter((item) => {
    const candidate = item as { status?: string };
    return candidate.status === 'active';
  });

  if (activeItems.length !== expectedActiveCount) {
    throw new Error(`Expected ${expectedActiveCount} active parks but received ${activeItems.length}.`);
  }

  const lipasIds = activeItems.map((item) => (item as { 'lipas-id': number })['lipas-id']);
  const existingParks = await listExistingParksByLipasIds(database, lipasIds);
  const existingSlugByLipasId = new Map(existingParks.map((park) => [park.lipasId, park.slug]));
  const takenSlugs = new Set(existingParks.map((park) => park.slug));
  const importedAt = now();

  await syncParkTypes(database);

  const importRunId = await createImportRun(database, {
    activeCount: activeItems.length,
    importedAt,
    responseShapeVersion: RESPONSE_SHAPE_VERSION,
    sourceUrl
  });

  for (const item of activeItems) {
    const lipasId = (item as { 'lipas-id': number })['lipas-id'];
    const mapped = mapLipasPark(item, existingSlugByLipasId.get(lipasId));
    const slug = existingSlugByLipasId.get(lipasId) ?? ensureUniqueSlug(mapped.slug, lipasId, takenSlugs);

    await upsertImportedPark(database, {
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

  await markMissingParksInactive(database, lipasIds, importRunId, importedAt);

  return {
    activeCount: activeItems.length,
    importRunId,
    importedAt
  };
}
