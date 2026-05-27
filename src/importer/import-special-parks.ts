import { z } from 'zod';

import type { Database } from '../db/database.js';
import { createImportRun, syncParkTypes, upsertCatalogPark } from '../db/repositories.js';
import { getSupportedParkTypeBySlug } from '../parks/park-types.js';
import type { GeoJsonFeatureCollection, PolygonGeometry } from './geometry.js';
import { deriveBoundingBox } from './geometry.js';

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

type SpecialParkConfig = {
  displayTypeName: string | null;
  extractMetadata?: (
    features: Array<{ properties: { paatpvm?: string; shape_area?: number } }>
  ) => {
    areaKm2: number | null;
    establishmentYear: number | null;
  };
  filterFeatures?: (feature: { properties: { ely?: string | undefined; nimi: string } }) => boolean;
  locationLabel: string;
  luontoonUrl: string;
  name: string;
  parkTypeSlug: 'other-nature-reserve';
  postalCode: string | null;
  postalOffice: string | null;
  responseShapeVersion: string;
  slug: string;
  sourceUrl: string;
  syntheticLipasId: number;
};

const defaultFetchSource = async (sourceUrl: string) => {
  const response = await fetch(sourceUrl);

  if (!response.ok) {
    throw new Error(`Special parks import failed with status ${response.status} for ${sourceUrl}.`);
  }

  return response.json();
};

const flattenGeometry = (geometry: {
  coordinates: unknown;
  type: string;
}): Array<{ coordinates: number[][][]; type: 'Polygon' }> => {
  if (geometry.type === 'MultiPolygon') {
    return (geometry.coordinates as number[][][][]).map((coords) => ({
      coordinates: coords,
      type: 'Polygon' as const
    }));
  }

  return [{ coordinates: geometry.coordinates as number[][][], type: 'Polygon' }];
};

const toBoundaryGeoJson = (
  features: Array<{
    geometry: PolygonGeometry;
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

const specialParkConfigs: SpecialParkConfig[] = [
  {
    displayTypeName: 'Maailmanperintökohde',
    locationLabel: 'Raippaluodontie 2',
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/merenkurkun-maailmanperintoalue',
    name: 'Merenkurkun maailmanperintöalue',
    parkTypeSlug: 'other-nature-reserve',
    postalCode: '65800',
    postalOffice: 'Raippaluoto',
    responseShapeVersion: 'manual-merenkurkku-v1',
    slug: 'merenkurkun-maailmanperintoalue',
    sourceUrl:
      'https://geoserver.museovirasto.fi/geoserver/rajapinta_suojellut/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=rajapinta_suojellut:maailmanperinto_alue&outputFormat=application/json&srsName=EPSG:4326',
    syntheticLipasId: 9_000_898
  },
  {
    displayTypeName: 'Luonnonpuisto',
    locationLabel: 'Kevon luonnonpuisto',
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/kevon-luonnonpuisto',
    name: 'Kevon luonnonpuisto',
    parkTypeSlug: 'other-nature-reserve',
    postalCode: null,
    postalOffice: null,
    responseShapeVersion: 'syke-protected-sites-v1',
    slug: 'kevon-luonnonpuisto',
    sourceUrl:
      "https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=inspire_ps:PS.ProtectedSitesValtionOmistamaLuonnonsuojelualue&outputFormat=application/json&srsName=EPSG:4326&cql_filter=nimi='Kevon luonnonpuisto'",
    syntheticLipasId: 9_000_915
  },
  {
    displayTypeName: null,
    filterFeatures: (feature) => feature.properties.ely === 'Uudenmaan ELY-keskus',
    locationLabel: 'Laajalahden luonnonsuojelualue',
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/laajalahden-luonnonsuojelualue',
    name: 'Laajalahden luonnonsuojelualue',
    parkTypeSlug: 'other-nature-reserve',
    postalCode: null,
    postalOffice: null,
    responseShapeVersion: 'syke-protected-sites-v1',
    slug: 'laajalahden-luonnonsuojelualue',
    sourceUrl:
      "https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=inspire_ps:PS.ProtectedSitesValtionOmistamaLuonnonsuojelualue&outputFormat=application/json&srsName=EPSG:4326&cql_filter=nimi='Laajalahden luonnonsuojelualue'",
    syntheticLipasId: 9_000_824
  },
  {
    displayTypeName: 'Lintuvesi',
    locationLabel: 'Liminganlahti',
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/liminganlahti',
    name: 'Liminganlahti',
    parkTypeSlug: 'other-nature-reserve',
    postalCode: null,
    postalOffice: null,
    responseShapeVersion: 'syke-protected-sites-v1',
    slug: 'liminganlahti',
    sourceUrl:
      "https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=inspire_ps:PS.ProtectedSitesYksityistenMaillaOlevaLuonnonsuojelualue&outputFormat=application/json&srsName=EPSG:4326&cql_filter=nimi='Liminganlahden luonnonsuojelualue'",
    syntheticLipasId: 9_000_70433
  },
  {
    displayTypeName: 'Luonnonpuisto',
    locationLabel: 'Mallan luonnonpuisto',
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/mallan-luonnonpuisto',
    name: 'Mallan luonnonpuisto',
    parkTypeSlug: 'other-nature-reserve',
    postalCode: null,
    postalOffice: null,
    responseShapeVersion: 'syke-protected-sites-v1',
    slug: 'mallan-luonnonpuisto',
    sourceUrl:
      "https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=inspire_ps:PS.ProtectedSitesValtionOmistamaLuonnonsuojelualue&outputFormat=application/json&srsName=EPSG:4326&cql_filter=nimi='Mallan luonnonpuisto'",
    syntheticLipasId: 9_000_42160
  },
  {
    displayTypeName: null,
    locationLabel: 'Siikalahden luonnonsuojelualue',
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/siikalahden-luonnonsuojelualue',
    name: 'Siikalahden luonnonsuojelualue',
    parkTypeSlug: 'other-nature-reserve',
    postalCode: null,
    postalOffice: null,
    responseShapeVersion: 'syke-protected-sites-v1',
    slug: 'siikalahden-luonnonsuojelualue',
    sourceUrl:
      "https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=inspire_ps:PS.ProtectedSitesValtionOmistamaLuonnonsuojelualue&outputFormat=application/json&srsName=EPSG:4326&cql_filter=nimi='Siikalahden luonnonsuojelualue'",
    syntheticLipasId: 9_000_102829
  }
];

type ImportSpecialParksOptions = {
  database: Database;
  fetchSource?: (sourceUrl: string) => Promise<unknown>;
  now?: () => string;
};

const parseSykeFeatures = (payload: unknown) => {
  const parsed = sykeResponseSchema.parse(payload);
  return parsed.features;
};

const parseMerenkurkkuFeatures = (payload: unknown) => {
  const parsed = worldHeritageAreaResponseSchema.parse(payload);
  return parsed.features.filter(
    (feature) => feature.properties.ID === 898 && feature.properties.aluetyyppi === 'Kohde'
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

export const importSpecialParks = async ({
  database,
  fetchSource = defaultFetchSource,
  now = () => new Date().toISOString()
}: ImportSpecialParksOptions) => {
  const importedAt = now();
  await syncParkTypes(database);

  const results: Array<{
    featureCount: number;
    importRunId: number;
    name: string;
    slug: string;
  }> = [];

  for (const config of specialParkConfigs) {
    const payload = await fetchSource(config.sourceUrl);

    let sourceFeatures: Array<{
      geometry: { coordinates: unknown; type: string };
      properties: Record<string, unknown>;
      type: string;
    }>;
    let metadata: { areaKm2: number | null; establishmentYear: number | null };

    if (config.slug === 'merenkurkun-maailmanperintoalue') {
      const features = parseMerenkurkkuFeatures(payload);
      if (features.length === 0) {
        throw new Error('No Merenkurkku world heritage area features were found in the source.');
      }
      sourceFeatures = features;
      metadata = { areaKm2: null, establishmentYear: null };
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

    const polygonGeometries = sourceFeatures.flatMap((feature) =>
      flattenGeometry(feature.geometry)
    );

    const boundaryGeoJson = toBoundaryGeoJson(
      polygonGeometries.map((geom) => ({
        geometry: geom as PolygonGeometry,
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
        luontoonUrl: config.luontoonUrl,
        managedByLipasImport: false,
        markerLat: (boundingBox.minLat + boundingBox.maxLat) / 2,
        markerLon: (boundingBox.minLon + boundingBox.maxLon) / 2,
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
