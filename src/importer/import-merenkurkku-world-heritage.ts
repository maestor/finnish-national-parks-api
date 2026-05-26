import { z } from 'zod';

import type { Database } from '../db/database.js';
import { createImportRun, syncParkTypes, upsertCatalogPark } from '../db/repositories.js';
import { getSupportedParkTypeBySlug } from '../parks/park-types.js';
import type { GeoJsonFeatureCollection, PolygonGeometry } from './geometry.js';
import { deriveBoundingBox } from './geometry.js';

const RESPONSE_SHAPE_VERSION = 'manual-merenkurkku-v1';
const MERENKURKKU_SOURCE_URL =
  'https://geoserver.museovirasto.fi/geoserver/rajapinta_suojellut/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=rajapinta_suojellut:maailmanperinto_alue&outputFormat=application/json&srsName=EPSG:4326';
const MERENKURKKU_HERITAGE_ID = 898;
const MERENKURKKU_SYNTHETIC_LIPAS_ID = 9_000_898;
const MERENKURKKU_SLUG = 'merenkurkun-maailmanperintoalue';
const MERENKURKKU_LUONTOON_URL =
  'https://www.luontoon.fi/fi/kohteet/merenkurkun-maailmanperintoalue';

const coordinateSchema = z.tuple([z.number(), z.number()]).rest(z.number());

const polygonGeometrySchema = z.object({
  coordinates: z.array(z.array(coordinateSchema)),
  type: z.literal('Polygon')
});

const worldHeritageAreaFeatureSchema = z.object({
  geometry: polygonGeometrySchema,
  properties: z.object({
    ID: z.number().int(),
    Nimi: z.string().nullable().optional(),
    URL: z.string().nullable().optional(),
    aluetyyppi: z.string().nullable().optional()
  }),
  type: z.literal('Feature')
});

const worldHeritageAreaResponseSchema = z.object({
  features: z.array(worldHeritageAreaFeatureSchema)
});

type ImportMerenkurkkuWorldHeritageOptions = {
  database: Database;
  fetchSource?: (sourceUrl: string) => Promise<unknown>;
  now?: () => string;
  sourceUrl?: string;
};

const defaultFetchSource = async (sourceUrl: string) => {
  const response = await fetch(sourceUrl);

  if (!response.ok) {
    throw new Error(`Merenkurkku world heritage import failed with status ${response.status}.`);
  }

  return response.json();
};

const toBoundaryGeoJson = (
  features: Array<{
    geometry: PolygonGeometry;
    properties: { Nimi?: string | null | undefined };
  }>
): GeoJsonFeatureCollection => ({
  features: features
    .slice()
    .sort((a, b) => (a.properties.Nimi ?? '').localeCompare(b.properties.Nimi ?? ''))
    .map((feature) => ({
      geometry: feature.geometry,
      type: 'Feature' as const
    })),
  type: 'FeatureCollection'
});

export const importMerenkurkkuWorldHeritage = async ({
  database,
  fetchSource = defaultFetchSource,
  now = () => new Date().toISOString(),
  sourceUrl = MERENKURKKU_SOURCE_URL
}: ImportMerenkurkkuWorldHeritageOptions) => {
  const payload = worldHeritageAreaResponseSchema.parse(await fetchSource(sourceUrl));
  const merenkurkkuFeatures = payload.features.filter(
    (feature) =>
      feature.properties.ID === MERENKURKKU_HERITAGE_ID && feature.properties.aluetyyppi === 'Kohde'
  );

  if (merenkurkkuFeatures.length === 0) {
    throw new Error('No Merenkurkku world heritage area features were found in the source.');
  }

  const boundaryGeoJson = toBoundaryGeoJson(merenkurkkuFeatures);
  const boundingBox = deriveBoundingBox(boundaryGeoJson);
  const parkType = getSupportedParkTypeBySlug('other-nature-reserve');
  const importedAt = now();

  await syncParkTypes(database);

  let importRunId: number;

  await database.transaction(async (tx) => {
    importRunId = await createImportRun(tx, {
      activeCount: 1,
      importedAt,
      responseShapeVersion: RESPONSE_SHAPE_VERSION,
      sourceUrl
    });

    await upsertCatalogPark(tx, {
      areaKm2: null,
      bboxMaxLat: boundingBox.maxLat,
      bboxMaxLon: boundingBox.maxLon,
      bboxMinLat: boundingBox.minLat,
      bboxMinLon: boundingBox.minLon,
      boundaryGeojson: JSON.stringify(boundaryGeoJson),
      catalogStatus: 'active',
      createdAt: importedAt,
      displayTypeName: 'Maailmanperintökohde',
      establishmentYear: null,
      lastImportRunId: importRunId,
      lipasId: MERENKURKKU_SYNTHETIC_LIPAS_ID,
      locationLabel: 'Raippaluodontie 2',
      luontoonUrl: MERENKURKKU_LUONTOON_URL,
      managedByLipasImport: false,
      markerLat: (boundingBox.minLat + boundingBox.maxLat) / 2,
      markerLon: (boundingBox.minLon + boundingBox.maxLon) / 2,
      municipalityCode: null,
      name: 'Merenkurkun maailmanperintöalue',
      postalCode: '65800',
      postalOffice: 'Raippaluoto',
      slug: MERENKURKKU_SLUG,
      sourceEventDate: null,
      typeId: parkType.id,
      updatedAt: importedAt
    });
  });

  return {
    featureCount: merenkurkkuFeatures.length,
    importRunId: importRunId!,
    importedAt
  };
};
