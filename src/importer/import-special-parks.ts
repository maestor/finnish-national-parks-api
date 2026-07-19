import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import type { Database } from '../db/database.js';
import { createImportRun, syncParkTypes, upsertCatalogPark } from '../db/repositories.js';
import { getSupportedParkTypeBySlug } from '../parks/park-types.js';
import type { GeoJsonFeatureCollection, LineStringGeometry, PolygonGeometry } from './geometry.js';
import { deriveBoundingBox } from './geometry.js';
import { extractHikingAreaMetadata } from './special-parks/builders.js';
import { specialParkConfigs } from './special-parks/index.js';

const coordinateSchema = z.tuple([z.number(), z.number()]).rest(z.number());

const polygonGeometrySchema = z.object({
  coordinates: z.array(z.array(coordinateSchema)),
  type: z.literal('Polygon')
});

const multiPolygonGeometrySchema = z.object({
  coordinates: z.array(z.array(z.array(coordinateSchema))),
  type: z.literal('MultiPolygon')
});

const lineStringGeometrySchema = z.object({
  coordinates: z.array(coordinateSchema),
  type: z.literal('LineString')
});

const multiLineStringGeometrySchema = z.object({
  coordinates: z.array(z.array(coordinateSchema)),
  type: z.literal('MultiLineString')
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

const sykeGeometrySchema = z.union([
  z.object({
    coordinates: z.array(z.array(z.array(z.array(z.number())))),
    type: z.literal('MultiPolygon')
  }),
  z.object({
    coordinates: z.array(z.array(z.array(z.number()))),
    type: z.literal('Polygon')
  })
]);

const sykeFeatureSchema = z.object({
  geometry: sykeGeometrySchema,
  properties: z.object({
    ely: z.string().optional(),
    nimi: z.string(),
    paatpvm: z.string().optional(),
    shape_area: z.number().optional()
  }),
  type: z.literal('Feature')
});

const sykeResponseSchema = z.object({
  features: z.array(sykeFeatureSchema),
  type: z.literal('FeatureCollection')
});

const geoJsonFeatureCollectionSchema = z.object({
  features: z.array(
    z.object({
      geometry: z.object({
        coordinates: z.unknown(),
        type: z.string()
      }),
      properties: z.record(z.string(), z.unknown()).optional(),
      type: z.literal('Feature')
    })
  ),
  type: z.literal('FeatureCollection')
});

const defaultFetchSource = async (sourceUrl: string) => {
  if (sourceUrl.startsWith('special://')) {
    const slug = sourceUrl.slice('special://'.length);
    const fileUrl = new URL(`./special-parks/data/${slug}.json`, import.meta.url);
    const content = await readFile(fileURLToPath(fileUrl), 'utf-8');
    return JSON.parse(content);
  }

  const response = await fetch(sourceUrl);

  if (!response.ok) {
    throw new Error(`Special parks import failed with status ${response.status} for ${sourceUrl}.`);
  }

  return response.json();
};

const normalizeGeometry = (geometry: {
  coordinates: unknown;
  type: string;
}): Array<PolygonGeometry | LineStringGeometry> => {
  if (geometry.type === 'MultiPolygon') {
    return multiPolygonGeometrySchema.parse(geometry).coordinates.map((coords) => ({
      coordinates: coords,
      type: 'Polygon' as const
    }));
  }

  if (geometry.type === 'Polygon') {
    return [polygonGeometrySchema.parse(geometry)];
  }

  if (geometry.type === 'LineString') {
    return [lineStringGeometrySchema.parse(geometry)];
  }

  if (geometry.type === 'MultiLineString') {
    return multiLineStringGeometrySchema.parse(geometry).coordinates.map((coordinates) => ({
      coordinates,
      type: 'LineString' as const
    }));
  }

  throw new Error(`Unsupported geometry type "${geometry.type}" in special parks source.`);
};

const toBoundaryGeoJson = (
  features: Array<{
    geometry: PolygonGeometry | LineStringGeometry;
    sortKey?: string | null;
  }>
): GeoJsonFeatureCollection => ({
  features: features
    .slice()
    .sort((a, b) => (a.sortKey ?? '').localeCompare(b.sortKey ?? ''))
    .map((feature) => ({
      geometry: feature.geometry,
      type: 'Feature' as const
    })),
  type: 'FeatureCollection'
});

const parseGeoJsonFeatures = (payload: unknown) => {
  const parsed = geoJsonFeatureCollectionSchema.parse(payload);
  return parsed.features;
};

const parseSykeFeatures = (payload: unknown) => {
  const parsed = sykeResponseSchema.parse(payload);
  return parsed.features;
};

const parseWorldHeritageAreaFeatures = (payload: unknown, sourceFeatureId?: number) => {
  const parsed = worldHeritageAreaResponseSchema.parse(payload);
  return parsed.features.filter(
    (feature) =>
      feature.properties.aluetyyppi === 'Kohde' &&
      (sourceFeatureId === undefined || feature.properties.ID === sourceFeatureId)
  );
};

const extractSykeMetadata = (
  features: Array<{
    properties: { paatpvm?: string | undefined; shape_area?: number | undefined };
  }>
) => {
  const totalAreaM2 = features.reduce((sum, f) => sum + (f.properties.shape_area ?? 0), 0);
  const earliestDate = features
    .map((f) => f.properties.paatpvm)
    .filter(Boolean)
    .sort()[0];

  return {
    areaKm2: totalAreaM2 > 0 ? Math.round((totalAreaM2 / 1_000_000) * 100) / 100 : null,
    establishmentYear: earliestDate ? new Date(earliestDate).getFullYear() : null
  };
};

type ImportSpecialParksOptions = {
  database: Database;
  fetchSource?: (sourceUrl: string) => Promise<unknown>;
  includeSlugs?: string[];
  now?: () => string;
};

export const importSpecialParks = async ({
  database,
  fetchSource = defaultFetchSource,
  includeSlugs,
  now = () => new Date().toISOString()
}: ImportSpecialParksOptions) => {
  const importedAt = now();
  await syncParkTypes(database);
  const selectedConfigs =
    includeSlugs && includeSlugs.length > 0
      ? (() => {
          const requestedSlugs = new Set(includeSlugs);
          const matchingConfigs = specialParkConfigs.filter((config) =>
            requestedSlugs.has(config.slug)
          );
          const missingSlugs = includeSlugs.filter(
            (slug) => !matchingConfigs.some((config) => config.slug === slug)
          );

          if (missingSlugs.length > 0) {
            throw new Error(`Unknown special park slug(s): ${missingSlugs.join(', ')}.`);
          }

          return matchingConfigs;
        })()
      : specialParkConfigs;

  const results: Array<{
    featureCount: number;
    importRunId: number;
    name: string;
    slug: string;
  }> = [];

  for (const config of selectedConfigs) {
    const payload = await fetchSource(config.sourceUrl);

    let sourceFeatures: Array<{
      geometry: { coordinates: unknown; type: string };
      properties?: Record<string, unknown> | undefined;
      type: string;
    }>;
    let metadata: { areaKm2: number | null; establishmentYear: number | null };

    if (config.sourceParser === 'world-heritage-area') {
      const features = parseWorldHeritageAreaFeatures(payload, config.sourceFeatureId);
      if (features.length === 0) {
        if (config.slug === 'merenkurkun-maailmanperintoalue') {
          throw new Error('No Merenkurkku world heritage area features were found in the source.');
        }

        throw new Error(
          `No world heritage area features were found for ${config.name} in the source.`
        );
      }
      sourceFeatures = features;
      metadata = { areaKm2: null, establishmentYear: null };
    } else if (config.sourceParser === 'geojson' || config.sourceUrl.startsWith('special://')) {
      const features = parseGeoJsonFeatures(payload);
      if (features.length === 0) {
        throw new Error(`No features found for ${config.name} in the source.`);
      }
      sourceFeatures = features;
      metadata = config.extractMetadata
        ? config.extractMetadata(features)
        : { areaKm2: null, establishmentYear: null };
    } else {
      const features = parseSykeFeatures(payload);
      const filteredFeatures = config.filterFeatures
        ? features.filter(config.filterFeatures)
        : features;
      if (filteredFeatures.length === 0) {
        throw new Error(`No features found for ${config.name} in the SYKE source.`);
      }
      sourceFeatures = filteredFeatures;
      metadata = extractSykeMetadata(filteredFeatures);
    }

    const geometries = sourceFeatures.flatMap((feature) => normalizeGeometry(feature.geometry));

    const boundaryGeoJson = toBoundaryGeoJson(
      geometries.map((geom) => ({
        geometry: geom,
        sortKey: config.slug === 'merenkurkun-maailmanperintoalue' ? null : config.name
      }))
    );

    const boundingBox = deriveBoundingBox(boundaryGeoJson);
    const parkType = getSupportedParkTypeBySlug(config.parkTypeSlug);

    let importRunId: number;

    await database.transaction(async (tx) => {
      importRunId = await createImportRun(tx, {
        activeCount: 1,
        importedAt,
        responseShapeVersion: config.responseShapeVersion,
        sourceUrl: config.sourceUrl
      });

      await upsertCatalogPark(tx, {
        areaKm2: metadata.areaKm2,
        bboxMaxLat: boundingBox.maxLat,
        bboxMaxLon: boundingBox.maxLon,
        bboxMinLat: boundingBox.minLat,
        bboxMinLon: boundingBox.minLon,
        boundaryGeojson: JSON.stringify(boundaryGeoJson),
        catalogStatus: 'active',
        createdAt: importedAt,
        displayTypeName: config.displayTypeName,
        establishmentYear: metadata.establishmentYear,
        lastImportRunId: importRunId,
        lipasId: config.syntheticLipasId,
        locationLabel: config.locationLabel,
        parkUrl: config.parkUrl,
        managedByLipasImport: false,
        markerLat: config.markerPoint?.lat ?? (boundingBox.minLat + boundingBox.maxLat) / 2,
        markerLon: config.markerPoint?.lon ?? (boundingBox.minLon + boundingBox.maxLon) / 2,
        municipalityCode: null,
        name: config.name,
        postalCode: config.postalCode,
        postalOffice: config.postalOffice,
        slug: config.slug,
        sourceEventDate: null,
        typeId: parkType.id,
        updatedAt: importedAt
      });
    });

    results.push({
      featureCount: sourceFeatures.length,
      importRunId: importRunId!,
      name: config.name,
      slug: config.slug
    });
  }

  return { importedAt, results };
};

export { extractHikingAreaMetadata };
