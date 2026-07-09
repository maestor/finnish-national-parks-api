import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import type { Database } from '../db/database.js';
import { createImportRun, syncParkTypes, upsertCatalogPark } from '../db/repositories.js';
import type { SupportedParkTypeSlug } from '../parks/park-types.js';
import { getSupportedParkTypeBySlug } from '../parks/park-types.js';
import type { GeoJsonFeatureCollection, LineStringGeometry, PolygonGeometry } from './geometry.js';
import { deriveBoundingBox } from './geometry.js';

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

type SpecialParkConfig = {
  displayTypeName: string | null;
  extractMetadata?: (features: Array<{ properties?: Record<string, unknown> | undefined }>) => {
    areaKm2: number | null;
    establishmentYear: number | null;
  };
  filterFeatures?: (feature: { properties: { ely?: string | undefined; nimi: string } }) => boolean;
  locationLabel: string;
  parkUrl: string | null;
  name: string;
  parkTypeSlug: SupportedParkTypeSlug;
  postalCode: string | null;
  postalOffice: string | null;
  responseShapeVersion: string;
  slug: string;
  sourceFeatureId?: number;
  sourceParser?: 'geojson' | 'syke' | 'world-heritage-area';
  sourceUrl: string;
  syntheticLipasId: number;
};

type SykeProtectedSitesSourceType = 'private' | 'state';

type SykeSpecialParkSeed = {
  displayTypeName: string | null;
  locationLabel?: string;
  parkUrl: string | null;
  name: string;
  parkTypeSlug: SupportedParkTypeSlug;
  postalCode?: string | null;
  postalOffice?: string | null;
  slug: string;
  sourceName: string;
  sourceType?: SykeProtectedSitesSourceType;
  syntheticLipasId: number;
};

type LuontoonDestinationAreaSeed = {
  displayTypeName: string | null;
  locationLabel?: string;
  parkUrl: string | null;
  name: string;
  parkTypeSlug: SupportedParkTypeSlug;
  postalCode?: string | null;
  postalOffice?: string | null;
  slug: string;
  syntheticLipasId: number;
};

type MuseovirastoRkyAreaSeed = {
  displayTypeName: string | null;
  excludedSourceNames?: string[];
  locationLabel?: string;
  parkUrl: string | null;
  name: string;
  parkTypeSlug: SupportedParkTypeSlug;
  postalCode?: string | null;
  postalOffice?: string | null;
  slug: string;
  sourceFeatureName?: string;
  sourceName: string;
  syntheticLipasId: number;
};

const defaultFetchSource = async (sourceUrl: string) => {
  if (sourceUrl.startsWith('special://')) {
    const slug = sourceUrl.slice('special://'.length);
    const fileUrl = new URL(`./data/${slug}.json`, import.meta.url);
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

export const extractHikingAreaMetadata = (
  features: Array<{
    properties?: Record<string, unknown> | undefined;
  }>
) => {
  const totalAreaM2 = features.reduce(
    (sum, f) => sum + ((f.properties?.shape_area as number | undefined) ?? 0),
    0
  );

  return {
    areaKm2: totalAreaM2 > 0 ? Math.round((totalAreaM2 / 1_000_000) * 100) / 100 : null,
    establishmentYear: null
  };
};

const extractLuontoonDestinationMetadata = (
  features: Array<{
    properties?: Record<string, unknown> | undefined;
  }>
) => {
  const totalAreaM2 = features.reduce(
    (sum, f) => sum + ((f.properties?.surfaceArea as number | undefined) ?? 0),
    0
  );

  return {
    areaKm2: totalAreaM2 > 0 ? Math.round((totalAreaM2 / 1_000_000) * 100) / 100 : null,
    establishmentYear: null
  };
};

const extractGeoJsonAreaM2Metadata = (
  features: Array<{
    properties?: Record<string, unknown> | undefined;
  }>
) => {
  const totalAreaM2 = features.reduce(
    (sum, f) => sum + ((f.properties?.area_m2 as number | undefined) ?? 0),
    0
  );

  return {
    areaKm2: totalAreaM2 > 0 ? Math.round((totalAreaM2 / 1_000_000) * 100) / 100 : null,
    establishmentYear: null
  };
};

const buildSykeProtectedSitesSourceUrl = (
  sourceName: string,
  sourceType: SykeProtectedSitesSourceType = 'state'
) => {
  const typeName =
    sourceType === 'state'
      ? 'inspire_ps:PS.ProtectedSitesValtionOmistamaLuonnonsuojelualue'
      : 'inspire_ps:PS.ProtectedSitesYksityistenMaillaOlevaLuonnonsuojelualue';

  return `https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=${typeName}&outputFormat=application/json&srsName=EPSG:4326&cql_filter=nimi='${sourceName}'`;
};

const buildSykePrivateProtectedSitesCompositeSourceUrl = (sourceNames: string[]) => {
  const cqlFilter = encodeURIComponent(
    sourceNames.map((sourceName) => `nimi='${sourceName}'`).join(' OR ')
  );

  return `https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=inspire_ps:PS.ProtectedSitesYksityistenMaillaOlevaLuonnonsuojelualue&outputFormat=application/json&srsName=EPSG:4326&cql_filter=${cqlFilter}`;
};

const createSykeSpecialParkConfig = ({
  displayTypeName,
  locationLabel,
  parkUrl,
  name,
  parkTypeSlug,
  postalCode,
  postalOffice,
  slug,
  sourceName,
  sourceType,
  syntheticLipasId
}: SykeSpecialParkSeed): SpecialParkConfig => ({
  displayTypeName: normalizeSpecialParkDisplayTypeName(name, displayTypeName),
  locationLabel: locationLabel ?? name,
  parkUrl,
  name,
  parkTypeSlug,
  postalCode: postalCode ?? null,
  postalOffice: postalOffice ?? null,
  responseShapeVersion: 'syke-protected-sites-v1',
  slug,
  sourceUrl: buildSykeProtectedSitesSourceUrl(sourceName, sourceType),
  syntheticLipasId
});

const normalizeSpecialParkDisplayTypeName = (name: string, displayTypeName: string | null) => {
  if (name.toLocaleLowerCase('fi-FI').endsWith('soidensuojelualue')) {
    return 'Soidensuojelualue';
  }

  return displayTypeName;
};

const buildMuseovirastoProtectedSitesSourceUrl = (sourceName: string) => {
  return `https://geoserver.museovirasto.fi/geoserver/rajapinta_suojellut/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=rajapinta_suojellut:muinaisjaannos_alue&outputFormat=application/json&srsName=EPSG:4326&cql_filter=kohdenimi='${sourceName}'`;
};

const buildSykeGeologicalRockAreaSourceUrl = (sourceName: string) => {
  return `https://paikkatiedot.ymparisto.fi/geoserver/syke_geologisetmuodostumat/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=syke_geologisetmuodostumat:Arvokkaat_kallioalueet&outputFormat=application/json&srsName=EPSG:4326&cql_filter=nimi='${sourceName}'`;
};

const buildArcGisGeoJsonQuerySourceUrl = ({
  geometry,
  outFields,
  serviceUrl
}: {
  geometry?: [number, number, number, number];
  outFields: string[];
  serviceUrl: string;
}) => {
  const params = new URLSearchParams({
    f: 'geojson',
    outFields: outFields.join(','),
    returnGeometry: 'true',
    where: '1=1'
  });

  if (geometry) {
    params.set('geometry', geometry.join(','));
    params.set('geometryType', 'esriGeometryEnvelope');
    params.set('inSR', '4326');
    params.set('spatialRel', 'esriSpatialRelIntersects');
  }

  return `${serviceUrl}/query?${params.toString()}`;
};

const buildLuontoonGeoJsonCollectionSourceUrl = ({
  collectionId,
  filter,
  limit = 1000
}: {
  collectionId: string;
  filter: string;
  limit?: number;
}) => {
  const params = new URLSearchParams({
    filter,
    'filter-lang': 'cql-text',
    limit: String(limit)
  });

  return `https://www.luontoon.fi/geo/features/collections/${collectionId}/items?${params.toString()}`;
};

const buildMuseovirastoRkyAreaSourceUrl = ({
  excludedSourceNames = [],
  sourceFeatureName,
  sourceName
}: {
  excludedSourceNames?: string[];
  sourceFeatureName?: string;
  sourceName: string;
}) => {
  const filters = [`kohdenimi='${sourceName}'`];

  if (sourceFeatureName) {
    filters.push(`nimi='${sourceFeatureName}'`);
  }

  for (const excludedSourceName of excludedSourceNames) {
    filters.push(`nimi<>'${excludedSourceName}'`);
  }

  return `https://geoserver.museovirasto.fi/geoserver/rajapinta_suojellut/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=rajapinta_suojellut:rky_alue&outputFormat=application/json&srsName=EPSG:4326&cql_filter=${encodeURIComponent(filters.join(' AND '))}`;
};

const createMuseovirastoSpecialParkConfig = ({
  displayTypeName,
  locationLabel,
  parkUrl,
  name,
  parkTypeSlug,
  postalCode,
  postalOffice,
  slug,
  sourceName,
  syntheticLipasId
}: SykeSpecialParkSeed): SpecialParkConfig => ({
  displayTypeName: normalizeSpecialParkDisplayTypeName(name, displayTypeName),
  locationLabel: locationLabel ?? name,
  parkUrl,
  name,
  parkTypeSlug,
  postalCode: postalCode ?? null,
  postalOffice: postalOffice ?? null,
  responseShapeVersion: 'museovirasto-protected-sites-v1',
  slug,
  sourceParser: 'geojson',
  sourceUrl: buildMuseovirastoProtectedSitesSourceUrl(sourceName),
  syntheticLipasId
});

const createLuontoonDestinationAreaConfig = ({
  displayTypeName,
  locationLabel,
  parkUrl,
  name,
  parkTypeSlug,
  postalCode,
  postalOffice,
  slug,
  syntheticLipasId
}: LuontoonDestinationAreaSeed): SpecialParkConfig => ({
  displayTypeName: normalizeSpecialParkDisplayTypeName(name, displayTypeName),
  extractMetadata: extractLuontoonDestinationMetadata,
  locationLabel: locationLabel ?? name,
  parkUrl,
  name,
  parkTypeSlug,
  postalCode: postalCode ?? null,
  postalOffice: postalOffice ?? null,
  responseShapeVersion: 'luontoon-destination-area-v1',
  slug,
  sourceParser: 'geojson',
  sourceUrl: buildLuontoonGeoJsonCollectionSourceUrl({
    collectionId: 'public.destinations_details_view',
    filter: `slug='${slug}'`
  }),
  syntheticLipasId
});

const createMuseovirastoRkyAreaConfig = ({
  displayTypeName,
  excludedSourceNames,
  locationLabel,
  parkUrl,
  name,
  parkTypeSlug,
  postalCode,
  postalOffice,
  slug,
  sourceFeatureName,
  sourceName,
  syntheticLipasId
}: MuseovirastoRkyAreaSeed): SpecialParkConfig => ({
  displayTypeName: normalizeSpecialParkDisplayTypeName(name, displayTypeName),
  locationLabel: locationLabel ?? name,
  parkUrl,
  name,
  parkTypeSlug,
  postalCode: postalCode ?? null,
  postalOffice: postalOffice ?? null,
  responseShapeVersion: 'museovirasto-rky-areas-v1',
  slug,
  sourceParser: 'geojson',
  sourceUrl: buildMuseovirastoRkyAreaSourceUrl({
    ...(excludedSourceNames ? { excludedSourceNames } : {}),
    ...(sourceFeatureName ? { sourceFeatureName } : {}),
    sourceName
  }),
  syntheticLipasId
});

const baseSpecialParkConfigs: SpecialParkConfig[] = [
  {
    displayTypeName: 'Maailmanperintökohde',
    locationLabel: 'Raippaluodontie 2',
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/merenkurkun-maailmanperintoalue',
    name: 'Merenkurkun maailmanperintöalue',
    parkTypeSlug: 'nature-reserve-area',
    postalCode: '65800',
    postalOffice: 'Raippaluoto',
    responseShapeVersion: 'museovirasto-world-heritage-areas-v1',
    slug: 'merenkurkun-maailmanperintoalue',
    sourceFeatureId: 898,
    sourceParser: 'world-heritage-area',
    sourceUrl:
      'https://geoserver.museovirasto.fi/geoserver/rajapinta_suojellut/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=rajapinta_suojellut:maailmanperinto_alue&outputFormat=application/json&srsName=EPSG:4326',
    syntheticLipasId: 9_000_898
  },
  {
    displayTypeName: 'Maailmanperintökohde',
    locationLabel: 'Sammallahdentie',
    parkUrl: null,
    name: 'Sammallahdenmäki',
    parkTypeSlug: 'cultural-history-area',
    postalCode: '27230',
    postalOffice: 'Rauma',
    responseShapeVersion: 'museovirasto-world-heritage-areas-v1',
    slug: 'sammallahdenmaki',
    sourceFeatureId: 579,
    sourceParser: 'world-heritage-area',
    sourceUrl:
      'https://geoserver.museovirasto.fi/geoserver/rajapinta_suojellut/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=rajapinta_suojellut:maailmanperinto_alue&outputFormat=application/json&srsName=EPSG:4326',
    syntheticLipasId: 9_000_899
  },
  {
    displayTypeName: 'Maailmanperintökohde',
    locationLabel: 'Suomenlinna',
    parkUrl: null,
    name: 'Suomenlinna',
    parkTypeSlug: 'cultural-history-area',
    postalCode: '00190',
    postalOffice: 'Helsinki',
    responseShapeVersion: 'museovirasto-world-heritage-areas-v1',
    slug: 'suomenlinna',
    sourceFeatureId: 583,
    sourceParser: 'world-heritage-area',
    sourceUrl:
      'https://geoserver.museovirasto.fi/geoserver/rajapinta_suojellut/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=rajapinta_suojellut:maailmanperinto_alue&outputFormat=application/json&srsName=EPSG:4326',
    syntheticLipasId: 9_000_900
  },
  {
    displayTypeName: 'Maailmanperintökohde',
    locationLabel: 'Vanha Rauma',
    parkUrl: null,
    name: 'Vanha Rauma',
    parkTypeSlug: 'cultural-history-area',
    postalCode: '26100',
    postalOffice: 'Rauma',
    responseShapeVersion: 'museovirasto-world-heritage-areas-v1',
    slug: 'vanha-rauma',
    sourceFeatureId: 582,
    sourceParser: 'world-heritage-area',
    sourceUrl:
      'https://geoserver.museovirasto.fi/geoserver/rajapinta_suojellut/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=rajapinta_suojellut:maailmanperinto_alue&outputFormat=application/json&srsName=EPSG:4326',
    syntheticLipasId: 9_000_901
  },
  {
    displayTypeName: 'Luonnonpuisto',
    locationLabel: 'Kevon luonnonpuisto',
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/kevon-luonnonpuisto',
    name: 'Kevon luonnonpuisto',
    parkTypeSlug: 'nature-reserve-area',
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
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/laajalahden-luonnonsuojelualue',
    name: 'Laajalahden luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
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
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/liminganlahti',
    name: 'Liminganlahti',
    parkTypeSlug: 'nature-reserve-area',
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
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/mallan-luonnonpuisto',
    name: 'Mallan luonnonpuisto',
    parkTypeSlug: 'nature-reserve-area',
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
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/siikalahden-luonnonsuojelualue',
    name: 'Siikalahden luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    postalCode: null,
    postalOffice: null,
    responseShapeVersion: 'syke-protected-sites-v1',
    slug: 'siikalahden-luonnonsuojelualue',
    sourceUrl:
      "https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=inspire_ps:PS.ProtectedSitesValtionOmistamaLuonnonsuojelualue&outputFormat=application/json&srsName=EPSG:4326&cql_filter=nimi='Siikalahden luonnonsuojelualue'",
    syntheticLipasId: 9_000_102829
  },
  {
    displayTypeName: 'Valtion retkeilyalue',
    extractMetadata: extractHikingAreaMetadata,
    locationLabel: 'Vaattunkikönkääntie',
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/napapiirin-retkeilyalue',
    name: 'Napapiirin retkeilyalue',
    parkTypeSlug: 'hiking-area',
    postalCode: '96930',
    postalOffice: 'Rovaniemi',
    responseShapeVersion: 'syke-hiking-areas-v1',
    slug: 'napapiirin-retkeilyalue',
    sourceUrl: 'special://napapiirin-retkeilyalue',
    syntheticLipasId: 9_000_126_313
  },
  {
    displayTypeName: 'Valtion retkeilyalue',
    locationLabel: 'Inarintie 46',
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/inarin-retkeilyalue',
    name: 'Inarin retkeilyalue',
    parkTypeSlug: 'hiking-area',
    postalCode: '99870',
    postalOffice: 'Inari',
    responseShapeVersion: 'lipas-hiking-area-v1',
    slug: 'inarin-retkeilyalue',
    sourceUrl: 'special://inarin-retkeilyalue',
    syntheticLipasId: 606_689
  },
  {
    displayTypeName: null,
    locationLabel: 'Pietiläntie 23',
    parkUrl: null,
    name: 'Paavolan luontopolku',
    parkTypeSlug: 'nature-trail',
    postalCode: '08800',
    postalOffice: 'Lohja',
    responseShapeVersion: 'lohja-paavolan-arcgis-route-v1',
    slug: 'paavolan-luontopolku',
    sourceParser: 'geojson',
    sourceUrl: buildArcGisGeoJsonQuerySourceUrl({
      geometry: [23.882, 60.225, 23.891, 60.228],
      outFields: ['FID', 'REITTI', 'LISATIETO'],
      serviceUrl:
        'https://services2.arcgis.com/RrgTAfcgVcTLi0XF/arcgis/rest/services/Paavolan_reitti/FeatureServer/0'
    }),
    syntheticLipasId: 9_004_404
  },
  {
    displayTypeName: null,
    locationLabel: 'Kipparitie 4',
    parkUrl: null,
    name: 'Santalahden luontopolku',
    parkTypeSlug: 'nature-trail',
    postalCode: '48310',
    postalOffice: 'Kotka',
    responseShapeVersion: 'kotka-santalahden-arcgis-route-v1',
    slug: 'santalahden-luontopolku',
    sourceParser: 'geojson',
    sourceUrl: buildArcGisGeoJsonQuerySourceUrl({
      outFields: ['FID', 'Layer', 'Nimi', 'Linkki'],
      serviceUrl:
        'https://services-eu1.arcgis.com/zIF5LKWARhpLFEt3/arcgis/rest/services/Santalahden_reitti/FeatureServer/0'
    }),
    syntheticLipasId: 9_004_405
  },
  {
    displayTypeName: null,
    locationLabel: 'Torholan luola',
    parkUrl: 'https://www.luontoon.fi/fi/reitit/torholan-luolan-polku-lohja-194240',
    name: 'Torholan luola',
    parkTypeSlug: 'nature-trail',
    postalCode: null,
    postalOffice: 'Lohja',
    responseShapeVersion: 'luontoon-torholan-route-v1',
    slug: 'torholan-luola',
    sourceParser: 'geojson',
    sourceUrl: buildLuontoonGeoJsonCollectionSourceUrl({
      collectionId: 'public.all_lines_details_view',
      filter: "slug='torholan-luolan-polku-lohja-194240'"
    }),
    syntheticLipasId: 9_004_406
  },
  {
    displayTypeName: null,
    extractMetadata: extractLuontoonDestinationMetadata,
    locationLabel: 'Sonnasentie 948',
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/paistjarvi',
    name: 'Paistjärvi',
    parkTypeSlug: 'outdoor-recreation-area',
    postalCode: '18300',
    postalOffice: 'Heinola',
    responseShapeVersion: 'luontoon-destination-area-v1',
    slug: 'paistjarvi',
    sourceParser: 'geojson',
    sourceUrl: buildLuontoonGeoJsonCollectionSourceUrl({
      collectionId: 'public.destinations_details_view',
      filter: "slug='paistjarvi'"
    }),
    syntheticLipasId: 9_001_044
  },
  {
    displayTypeName: null,
    locationLabel: 'Kalajoen hiekkasärkät',
    parkUrl: null,
    name: 'Kalajoen hiekkasärkät',
    parkTypeSlug: 'outdoor-recreation-area',
    postalCode: null,
    postalOffice: 'Kalajoki',
    responseShapeVersion: 'manual-kalajoen-hiekkasarkat-osm-beach-v2',
    slug: 'kalajoen-hiekkasarkat',
    sourceUrl: 'special://kalajoen-hiekkasarkat',
    syntheticLipasId: 9_002_032
  },
  {
    displayTypeName: null,
    locationLabel: 'Uutelantie 1',
    parkUrl:
      'https://www.hel.fi/fi/kulttuuri-ja-vapaa-aika/ulkoilu-puistot-ja-luontokohteet/ulkoilualueet/uutelan-ulkoilualue',
    name: 'Uutelan ulkoilualue',
    parkTypeSlug: 'outdoor-recreation-area',
    postalCode: '00990',
    postalOffice: 'Helsinki',
    responseShapeVersion: 'manual-helsinki-admin-division-v1',
    slug: 'uutelan-ulkoilualue',
    sourceUrl: 'special://uutelan-ulkoilualue',
    syntheticLipasId: 9_001_070
  },
  {
    displayTypeName: null,
    locationLabel: 'Rantapaadentie 7',
    parkUrl:
      'https://www.hel.fi/fi/kulttuuri-ja-vapaa-aika/ulkoilu-puistot-ja-luontokohteet/ulkoilualueet/kallahden-ulkoilualue',
    name: 'Kallahden ulkoilualue',
    parkTypeSlug: 'outdoor-recreation-area',
    postalCode: '00980',
    postalOffice: 'Helsinki',
    responseShapeVersion: 'manual-helsinki-admin-division-v1',
    slug: 'kallahden-ulkoilualue',
    sourceUrl: 'special://kallahden-ulkoilualue',
    syntheticLipasId: 9_001_071
  },
  {
    displayTypeName: null,
    locationLabel: 'Seurasaarentie 15',
    parkUrl:
      'https://www.hel.fi/fi/kulttuuri-ja-vapaa-aika/ulkoilu-puistot-ja-luontokohteet/ulkoilualueet/seurasaari',
    name: 'Seurasaari',
    parkTypeSlug: 'outdoor-recreation-area',
    postalCode: '00250',
    postalOffice: 'Helsinki',
    responseShapeVersion: 'manual-osm-island-boundary-v1',
    slug: 'seurasaari',
    sourceUrl: 'special://seurasaari',
    syntheticLipasId: 9_001_072
  },
  {
    displayTypeName: null,
    locationLabel: 'Mustikkamaantie 10',
    parkUrl:
      'https://www.hel.fi/fi/kulttuuri-ja-vapaa-aika/ulkoilu-puistot-ja-luontokohteet/ulkoilualueet/mustikkamaa',
    name: 'Mustikkamaa',
    parkTypeSlug: 'outdoor-recreation-area',
    postalCode: '00570',
    postalOffice: 'Helsinki',
    responseShapeVersion: 'manual-osm-island-boundary-v1',
    slug: 'mustikkamaa',
    sourceUrl: 'special://mustikkamaa',
    syntheticLipasId: 9_001_073
  },
  {
    displayTypeName: null,
    locationLabel: 'Seili',
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/seili',
    name: 'Seili',
    parkTypeSlug: 'cultural-history-area',
    postalCode: null,
    postalOffice: null,
    responseShapeVersion: 'manual-mml-landwaterboundary-v1',
    slug: 'seili',
    sourceUrl: 'special://seili',
    syntheticLipasId: 9_001_034
  },
  {
    displayTypeName: null,
    locationLabel: 'Valkjärventie 604',
    parkUrl:
      'https://www.suomenvesiputoukset.fi/vesiputoukset/suomen-vesiputoukset-luettelossa/kuhakoski/',
    name: 'Kuhakoski',
    parkTypeSlug: 'cultural-history-area',
    postalCode: null,
    postalOffice: 'Nurmijärvi',
    responseShapeVersion: 'manual-nurmijarvi-map-point-proxy-v1',
    slug: 'kuhakoski',
    sourceUrl: 'special://kuhakoski',
    syntheticLipasId: 9_001_076
  },
  {
    displayTypeName: null,
    locationLabel: 'Vallisaari',
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/vallisaari',
    name: 'Vallisaari',
    parkTypeSlug: 'outdoor-recreation-area',
    postalCode: null,
    postalOffice: null,
    responseShapeVersion: 'manual-mml-landwaterboundary-v1',
    slug: 'vallisaari',
    sourceUrl: 'special://vallisaari',
    syntheticLipasId: 9_001_035
  },
  {
    displayTypeName: null,
    locationLabel: 'Hailuoto',
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/hailuoto',
    name: 'Hailuoto',
    parkTypeSlug: 'outdoor-recreation-area',
    postalCode: null,
    postalOffice: null,
    responseShapeVersion: 'museovirasto-rky-areas-v1',
    slug: 'hailuoto',
    sourceParser: 'geojson',
    sourceUrl: buildMuseovirastoRkyAreaSourceUrl({
      sourceName: 'Hailuoto'
    }),
    syntheticLipasId: 9_001_036
  },
  {
    displayTypeName: null,
    extractMetadata: extractGeoJsonAreaM2Metadata,
    locationLabel: 'Rokokallio',
    parkUrl: null,
    name: 'Rokokallio',
    parkTypeSlug: 'outdoor-recreation-area',
    postalCode: '03790',
    postalOffice: 'Vihti',
    responseShapeVersion: 'syke-geological-rock-areas-v1',
    slug: 'rokokallio',
    sourceParser: 'geojson',
    sourceUrl: buildSykeGeologicalRockAreaSourceUrl('Rokokallio'),
    syntheticLipasId: 9_001_080
  },
  {
    displayTypeName: null,
    locationLabel: 'Loppula',
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/sanginjoki',
    name: 'Sanginjoki',
    parkTypeSlug: 'nature-reserve-area',
    postalCode: null,
    postalOffice: null,
    responseShapeVersion: 'syke-protected-sites-composite-v1',
    slug: 'sanginjoki',
    sourceUrl: buildSykePrivateProtectedSitesCompositeSourceUrl([
      'Asmonkorven luonnonsuojelualue',
      'Isokankaan luonnonsuojelualue'
    ]),
    syntheticLipasId: 9_001_041
  }
];

const sourceReadyReserveParkSeeds: SykeSpecialParkSeed[] = [
  {
    displayTypeName: 'Ystävyyden puisto',
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/elimyssalon-luonnonsuojelualue-ystavyyden-puisto',
    name: 'Elimyssalon luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'elimyssalon-luonnonsuojelualue-ystavyyden-puisto',
    sourceName: 'Elimyssalon luonnonsuojelualue (Ystävyyden puisto)',
    syntheticLipasId: 9_001_001
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/hiidenvaaran-luonnonsuojelualue',
    name: 'Hiidenvaaran luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'hiidenvaaran-luonnonsuojelualue',
    sourceName: 'Hiidenvaaran luonnonsuojelualue',
    syntheticLipasId: 9_001_002
  },
  {
    displayTypeName: 'Ystävyyden puisto',
    parkUrl:
      'https://www.luontoon.fi/fi/kohteet/ison-palosen-ja-maariansarkkien-luonnonsuojelualue-ystavyyden-puisto',
    name: 'Ison-Palosen ja Maariansarkkien luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'ison-palosen-ja-maariansarkkien-luonnonsuojelualue-ystavyyden-puisto',
    sourceName: 'Ison-Palosen ja Maariansärkkien luonnonsuojelualue (Ystävyyden puisto)',
    syntheticLipasId: 9_001_003
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/jouhtenisen-luonnonsuojelualue',
    name: 'Jouhtenisen luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'jouhtenisen-luonnonsuojelualue',
    sourceName: 'Jouhtenisen luonnonsuojelualue',
    syntheticLipasId: 9_001_004
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/kermajarven-luonnonsuojelualue',
    name: 'Kermajärven luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'kermajarven-luonnonsuojelualue',
    sourceName: 'Kermajärven luonnonsuojelualue',
    syntheticLipasId: 9_001_005
  },
  {
    displayTypeName: 'Ystävyyden puisto',
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/lentuan-luonnonsuojelualue-ystavyyden-puisto',
    name: 'Lentuan luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'lentuan-luonnonsuojelualue-ystavyyden-puisto',
    sourceName: 'Lentuan luonnonsuojelualue (Ystävyyden puisto)',
    syntheticLipasId: 9_001_006
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/levanevan-luonnonsuojelualue',
    name: 'Levänevan luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'levanevan-luonnonsuojelualue',
    sourceName: 'Levanevan luonnonsuojelualue',
    syntheticLipasId: 9_001_007
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/medvaston-ja-stormossenin-luonnonsuojelualue',
    name: 'Medvastön ja Stormossenin luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'medvaston-ja-stormossenin-luonnonsuojelualue',
    sourceName: 'Medvastön ja Stormossenin luonnonsuojelualue',
    syntheticLipasId: 9_001_008
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/mietoistenlahden-luonnonsuojelualue',
    name: 'Mietoistenlahden luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'mietoistenlahden-luonnonsuojelualue',
    sourceName: 'Mietoistenlahden luonnonsuojelualue',
    syntheticLipasId: 9_001_009
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/mujejarven-luonnonsuojelualue',
    name: 'Mujejärven luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'mujejarven-luonnonsuojelualue',
    sourceName: 'Mujejärven luonnonsuojelualue',
    syntheticLipasId: 9_001_010
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/otajarven-luonnonsuojelualue',
    name: 'Otajärven luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'otajarven-luonnonsuojelualue',
    sourceName: 'Otajärven luonnonsuojelualue',
    syntheticLipasId: 9_001_011
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/pihlajaveden-luonnonsuojelualue',
    name: 'Pihlajaveden luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'pihlajaveden-luonnonsuojelualue',
    sourceName: 'Pihlajaveden luonnonsuojelualue',
    syntheticLipasId: 9_001_012
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/punkaharjun-luonnonsuojelualue',
    name: 'Punkaharjun luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'punkaharjun-luonnonsuojelualue',
    sourceName: 'Punkaharjun luonnonsuojelualue',
    syntheticLipasId: 9_001_013
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/saltfjardenin-luonnonsuojelualue',
    name: 'Saltfjärdenin luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'saltfjardenin-luonnonsuojelualue',
    sourceName: 'Saltfjärdenin luonnonsuojelualue',
    syntheticLipasId: 9_001_014
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/taktominlahden-ja-svanvikenin-luonnonsuojelualue',
    name: 'Täktominlahden ja Svanvikenin luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'taktominlahden-ja-svanvikenin-luonnonsuojelualue',
    sourceName: 'Täktominlahden ja Svanvikenin luonnonsuojelualue',
    syntheticLipasId: 9_001_015
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/vaisakon-luonnonsuojelualue',
    name: 'Vaisakon luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'vaisakon-luonnonsuojelualue',
    sourceName: 'Vaisakon luonnonsuojelualue',
    syntheticLipasId: 9_001_016
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/valtavaaran-ja-pyhavaaran-luonnonsuojelualue',
    name: 'Valtavaaran ja Pyhävaaran luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'valtavaaran-ja-pyhavaaran-luonnonsuojelualue',
    sourceName: 'Valtavaaran ja Pyhävaaran luonnonsuojelualue',
    syntheticLipasId: 9_001_017
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/ilmakkiaavan-soidensuojelualue',
    name: 'Ilmakkiaavan soidensuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'ilmakkiaavan-soidensuojelualue',
    sourceName: 'Ilmakkiaavan soidensuojelualue',
    syntheticLipasId: 9_001_018
  },
  {
    displayTypeName: 'Ystävyyden puisto',
    parkUrl:
      'https://www.luontoon.fi/fi/kohteet/juortanansalon-lapinsuon-soidensuojelualue-ystavyyden-puisto',
    name: 'Juortanansalon-Lapinsuon soidensuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'juortanansalon-lapinsuon-soidensuojelualue-ystavyyden-puisto',
    sourceName: 'Juortanansalon-Lapinsuon soidensuojelualue (Ystävyyden p.)',
    syntheticLipasId: 9_001_019
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/siikanevan-soidensuojelualue',
    name: 'Siikanevan soidensuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'siikanevan-soidensuojelualue',
    sourceName: 'Siikanevan soidensuojelualue',
    syntheticLipasId: 9_001_020
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/viiankiaavan-soidensuojelualue',
    name: 'Viiankiaavan soidensuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'viiankiaavan-soidensuojelualue',
    sourceName: 'Viiankiaavan soidensuojelualue',
    syntheticLipasId: 9_001_021
  },
  {
    displayTypeName: 'Luonnonpuisto',
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/karkalin-luonnonpuisto',
    name: 'Karkalin luonnonpuisto',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'karkalin-luonnonpuisto',
    sourceName: 'Karkalin luonnonpuisto',
    syntheticLipasId: 9_001_022
  },
  {
    displayTypeName: 'Luonnonpuisto',
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/paljakan-luonnonpuisto',
    name: 'Paljakan luonnonpuisto',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'paljakan-luonnonpuisto',
    sourceName: 'Paljakan  luonnonpuisto',
    syntheticLipasId: 9_001_023
  },
  {
    displayTypeName: 'Luonnonpuisto',
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/salamanperan-luonnonpuisto',
    name: 'Salamanperän luonnonpuisto',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'salamanperan-luonnonpuisto',
    sourceName: 'Salamanperän luonnonpuisto',
    syntheticLipasId: 9_001_024
  },
  {
    displayTypeName: 'Luonnonpuisto',
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/sompion-luonnonpuisto',
    name: 'Sompion luonnonpuisto',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'sompion-luonnonpuisto',
    sourceName: 'Sompion luonnonpuisto',
    syntheticLipasId: 9_001_025
  },
  {
    displayTypeName: 'Luonnonpuisto',
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/vaskijarven-luonnonpuisto',
    name: 'Vaskijärven luonnonpuisto',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'vaskijarven-luonnonpuisto',
    sourceName: 'Vaskijärven luonnonpuisto',
    syntheticLipasId: 9_001_026
  }
];

const sourceReadyDestinationAreaSeeds: SykeSpecialParkSeed[] = [
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/liimanninkosken-lehtojensuojelualue',
    name: 'Liimanninkosken lehtojensuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'liimanninkosken-lehtojensuojelualue',
    sourceName: 'Liimanninkosken lehtojensuojelualue',
    syntheticLipasId: 9_001_027
  },
  {
    displayTypeName: null,
    parkUrl: null,
    name: 'Lapakisto',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'lapakisto',
    sourceName: 'Lapakiston luonnonsuojelualue',
    sourceType: 'private',
    syntheticLipasId: 9_001_038
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/dagmarin-puisto',
    name: 'Dagmarin puisto',
    parkTypeSlug: 'cultural-history-area',
    slug: 'dagmarin-puisto',
    sourceName: 'Dagmarin puisto',
    sourceType: 'private',
    syntheticLipasId: 9_001_028
  },
  {
    displayTypeName: 'Luonnonpuisto',
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/olvassuo',
    name: 'Olvassuon luonnonpuisto',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'olvassuon-luonnonpuisto',
    sourceName: 'Olvassuon luonnonpuisto',
    syntheticLipasId: 9_001_029
  },
  {
    displayTypeName: 'Luonnonpuisto',
    parkUrl: 'https://www.luontoon.fi/fi/reitit/tapion-taival-reitti-ilomantsi-47985',
    name: 'Koivusuon luonnonpuisto',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'koivusuon-luonnonpuisto',
    sourceName: 'Koivusuon luonnonpuisto',
    syntheticLipasId: 9_001_040
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/korouoma',
    name: 'Korouoma',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'korouoma',
    sourceName: 'Korouoman lehtojensuojelualue',
    syntheticLipasId: 9_001_037
  }
];

const sourceReadyLuontoonDestinationAreaSeeds: LuontoonDestinationAreaSeed[] = [
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/litokairan-soidensuojelualue',
    name: 'Litokairan soidensuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'litokairan-soidensuojelualue',
    syntheticLipasId: 9_001_045
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/martimoaavan-soidensuojelualue',
    name: 'Martimoaavan soidensuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'martimoaavan-soidensuojelualue',
    syntheticLipasId: 9_001_046
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/paukanevan-soidensuojelualue',
    name: 'Paukanevan soidensuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'paukanevan-soidensuojelualue',
    syntheticLipasId: 9_001_047
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/neitvuori-ja-luonterin-luonnonsuojelualue',
    name: 'Neitvuori ja Luonterin luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'neitvuori-ja-luonterin-luonnonsuojelualue',
    syntheticLipasId: 9_001_048
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/koskeljarvi',
    name: 'Koskeljärvi',
    parkTypeSlug: 'outdoor-recreation-area',
    slug: 'koskeljarvi',
    syntheticLipasId: 9_001_049
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/kurimonkoski',
    name: 'Kurimonkoski',
    parkTypeSlug: 'outdoor-recreation-area',
    slug: 'kurimonkoski',
    syntheticLipasId: 9_001_050
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/pukala',
    name: 'Pukala',
    parkTypeSlug: 'outdoor-recreation-area',
    slug: 'pukala',
    syntheticLipasId: 9_001_051
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/peurajarvi',
    name: 'Peurajärvi',
    parkTypeSlug: 'outdoor-recreation-area',
    slug: 'peurajarvi',
    syntheticLipasId: 9_001_052
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/hepokongas',
    name: 'Hepoköngäs',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'hepokongas',
    syntheticLipasId: 9_001_053
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/auttikongas',
    name: 'Auttiköngäs',
    parkTypeSlug: 'outdoor-recreation-area',
    slug: 'auttikongas',
    syntheticLipasId: 9_001_054
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/pinkjarvi',
    name: 'Pinkjärvi',
    parkTypeSlug: 'outdoor-recreation-area',
    slug: 'pinkjarvi',
    syntheticLipasId: 9_001_055
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/soiperoinen',
    name: 'Soiperoinen',
    parkTypeSlug: 'outdoor-recreation-area',
    slug: 'soiperoinen',
    syntheticLipasId: 9_001_056
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/unarinkongas',
    name: 'Unarinköngäs',
    parkTypeSlug: 'outdoor-recreation-area',
    slug: 'unarinkongas',
    syntheticLipasId: 9_001_057
  }
];

const sourceReadyHistoryAreaSeeds: SykeSpecialParkSeed[] = [
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/harola',
    name: 'Harola',
    parkTypeSlug: 'outdoor-recreation-area',
    slug: 'harola',
    sourceName: 'Harola',
    syntheticLipasId: 9_001_030
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/kajaanin-linna',
    name: 'Kajaanin linna',
    parkTypeSlug: 'cultural-history-area',
    slug: 'kajaanin-linna',
    sourceName: 'Kajaanin linna',
    syntheticLipasId: 9_001_031
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/raaseporin-linna',
    name: 'Raaseporin linna',
    parkTypeSlug: 'cultural-history-area',
    slug: 'raaseporin-linna',
    sourceName: 'Raaseporin linna',
    syntheticLipasId: 9_001_032
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/svartholma',
    name: 'Svartholma',
    parkTypeSlug: 'cultural-history-area',
    slug: 'svartholma',
    sourceName: 'Svartholma',
    syntheticLipasId: 9_001_033
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/kuusiston-linna',
    name: 'Kuusiston linna',
    parkTypeSlug: 'cultural-history-area',
    slug: 'kuusiston-linna',
    sourceName: 'Kuusiston piispanlinna',
    syntheticLipasId: 9_001_039
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/latokartanonkoski',
    name: 'Latokartanonkoski',
    parkTypeSlug: 'cultural-history-area',
    slug: 'latokartanonkoski',
    sourceName: 'Latokartanonkoski',
    syntheticLipasId: 9_001_042
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.luontoon.fi/fi/kohteet/karnakosken-linnoitus',
    name: 'Kärnäkosken linnoitus',
    parkTypeSlug: 'cultural-history-area',
    slug: 'karnakosken-linnoitus',
    sourceName: 'Kärnäkosken linnoitus',
    syntheticLipasId: 9_001_043
  }
];

const sourceReadyHistoryRkyAreaSeeds: MuseovirastoRkyAreaSeed[] = [
  {
    displayTypeName: null,
    parkUrl: null,
    name: 'Bengtskärin majakka',
    parkTypeSlug: 'cultural-history-area',
    slug: 'bengtskarin-majakka',
    sourceName: 'Bengtskärin majakka',
    syntheticLipasId: 9_001_058
  },
  {
    displayTypeName: null,
    parkUrl: null,
    name: 'Haapasaaren saaristokylä',
    parkTypeSlug: 'cultural-history-area',
    slug: 'haapasaaren-saaristokyla',
    sourceName: 'Haapasaaren saaristokylä',
    syntheticLipasId: 9_001_059
  },
  {
    displayTypeName: null,
    parkUrl: null,
    name: 'Kaunissaaren saaristokylä',
    parkTypeSlug: 'cultural-history-area',
    slug: 'kaunissaaren-saaristokyla',
    sourceName: 'Kaunissaaren saaristokylä',
    syntheticLipasId: 9_001_060
  },
  {
    displayTypeName: null,
    parkUrl: null,
    name: 'Vanajanlinna',
    parkTypeSlug: 'cultural-history-area',
    slug: 'vanajanlinna',
    sourceName: 'Vanajanlinna',
    syntheticLipasId: 9_001_061
  },
  {
    displayTypeName: null,
    parkUrl: null,
    name: 'Kissakosken kanava',
    parkTypeSlug: 'cultural-history-area',
    slug: 'kissakosken-kanava',
    sourceName: 'Kissakosken kanava ja tehdasalue',
    syntheticLipasId: 9_001_062
  },
  {
    displayTypeName: null,
    parkUrl: null,
    name: 'Jyväskylän harju',
    parkTypeSlug: 'cultural-history-area',
    slug: 'harju',
    sourceName: 'Jyväskylän Harju ja Vesilinna',
    syntheticLipasId: 9_001_063
  },
  {
    displayTypeName: 'Maailmanperintökohde',
    parkUrl: null,
    name: 'Petäjäveden vanha kirkko',
    parkTypeSlug: 'cultural-history-area',
    slug: 'petajaveden-vanha-kirkko',
    sourceName: 'Petäjäveden vanha ja uusi kirkko ympäristöineen',
    syntheticLipasId: 9_001_064
  },
  {
    displayTypeName: null,
    parkUrl: null,
    name: 'Ylivieskan savisilta',
    parkTypeSlug: 'cultural-history-area',
    slug: 'savisilta',
    sourceName: 'Kalajokivarsi Ylivieskan keskustassa ja Savisilta',
    syntheticLipasId: 9_001_065
  },
  {
    displayTypeName: null,
    parkUrl: null,
    name: 'Vääksyn kanava',
    parkTypeSlug: 'cultural-history-area',
    slug: 'vaaksyn-kanava',
    sourceName: 'Vääksyn kanava',
    syntheticLipasId: 9_001_066
  },
  {
    displayTypeName: null,
    parkUrl: null,
    name: 'Reposaari',
    parkTypeSlug: 'cultural-history-area',
    slug: 'reposaari',
    sourceName: 'Reposaaren yhdyskunta',
    syntheticLipasId: 9_001_067
  },
  {
    displayTypeName: null,
    parkUrl: null,
    name: 'Träskändan kartano',
    parkTypeSlug: 'cultural-history-area',
    slug: 'traskandan-kartano',
    sourceName: 'Träskändan kartano',
    syntheticLipasId: 9_001_068
  },
  {
    displayTypeName: null,
    parkUrl: null,
    name: 'Helsingin Vanhakaupunki',
    parkTypeSlug: 'cultural-history-area',
    slug: 'helsingin-vanhakaupunki',
    sourceName: 'Helsingin Vanhakaupunki',
    syntheticLipasId: 9_001_069
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.rky.fi/read/asp/r_kohde_det.aspx?KOHDE_ID=1840',
    name: 'Pyhämaa',
    parkTypeSlug: 'cultural-history-area',
    slug: 'pyhamaa',
    sourceName: 'Pyhämaan kirkot ja kyläasutus',
    syntheticLipasId: 9_001_074
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.rky.fi/read/asp/r_kohde_det.aspx?KOHDE_ID=284',
    name: 'Hollolan kirkonkylä',
    parkTypeSlug: 'cultural-history-area',
    slug: 'hollolan-kirkonkyla',
    sourceName: 'Hollolan kirkko ja historiallinen pitäjänkeskus',
    syntheticLipasId: 9_001_075
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.rky.fi/read/asp/r_kohde_det.aspx?KOHDE_ID=5021',
    name: 'Tammerkoski',
    parkTypeSlug: 'cultural-history-area',
    slug: 'tammerkoski',
    sourceName: 'Tammerkosken teollisuusmaisema',
    syntheticLipasId: 9_001_077
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.rky.fi/read/asp/r_kohde_det.aspx?KOHDE_ID=1519',
    name: 'Loviisan alakaupunki',
    parkTypeSlug: 'cultural-history-area',
    slug: 'loviisan-alakaupunki',
    sourceName: 'Loviisan alakaupunki',
    syntheticLipasId: 9_001_078
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.rky.fi/read/asp/r_kohde_det.aspx?KOHDE_ID=1750',
    name: 'Louhisaaren kartano',
    parkTypeSlug: 'cultural-history-area',
    slug: 'louhisaaren-kartano',
    sourceName: 'Louhisaaren kartano ja Askaisten kirkko',
    syntheticLipasId: 9_001_081
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.rky.fi/read/asp/r_kohde_det.aspx?KOHDE_ID=4142',
    name: 'Sipoonlinna',
    parkTypeSlug: 'cultural-history-area',
    slug: 'sipoonlinna',
    sourceName: 'Sibbesborgin keskiaikainen linnasaari ja Sipoonjokilaakson viljelymaisema',
    syntheticLipasId: 9_001_082
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.rky.fi/read/asp/r_kohde_det.aspx?KOHDE_ID=5118',
    name: 'Iniön kirkonkylä',
    parkTypeSlug: 'cultural-history-area',
    slug: 'inion-kirkonkyla',
    sourceName: 'Iniön kirkonkylä',
    syntheticLipasId: 9_001_083
  },
  {
    displayTypeName: null,
    parkUrl: 'https://www.rky.fi/read/asp/r_kohde_det.aspx?KOHDE_ID=1799',
    name: 'Turunmaan kalkkilouhokset',
    parkTypeSlug: 'cultural-history-area',
    slug: 'turunmaan-kalkkilouhokset',
    sourceName: 'Turunmaan rannikon kalkkilouhokset ja Paraisten kalkkitehdas',
    syntheticLipasId: 9_001_079
  }
];

const sourceReadyFactoryVillageSeeds: MuseovirastoRkyAreaSeed[] = [
  {
    displayTypeName: 'Tehdaskylä',
    locationLabel: 'Antskogintie 259',
    parkUrl: null,
    name: 'Antskogin ruukki',
    parkTypeSlug: 'cultural-history-area',
    postalCode: '10410',
    postalOffice: 'Antskog',
    slug: 'antskogin-ruukki',
    sourceFeatureName: 'Antskogin ruukinalue',
    sourceName: 'Pohjan ruukkiympäristöt',
    syntheticLipasId: 9_002_001
  },
  {
    displayTypeName: 'Tehdaskylä',
    locationLabel: 'Ruukintie 8',
    parkUrl: null,
    name: 'Billnäsin ruukki',
    parkTypeSlug: 'cultural-history-area',
    postalCode: '10330',
    postalOffice: 'Billnäs',
    slug: 'billnasin-ruukki',
    sourceFeatureName: 'Billnäsin ruukinalue',
    sourceName: 'Pohjan ruukkiympäristöt',
    syntheticLipasId: 9_002_002
  },
  {
    displayTypeName: 'Tehdaskylä',
    locationLabel: 'Fiskarsintie 9',
    parkUrl: null,
    name: 'Fiskarsin ruukki',
    parkTypeSlug: 'cultural-history-area',
    postalCode: '10470',
    postalOffice: 'Fiskars',
    slug: 'fiskarsin-ruukki',
    sourceFeatureName: 'Fiskarsin ruukinalue',
    sourceName: 'Pohjan ruukkiympäristöt',
    syntheticLipasId: 9_002_003
  },
  {
    displayTypeName: 'Tehdaskylä',
    parkUrl: null,
    name: 'Inhan ruukkiyhdyskunta',
    parkTypeSlug: 'cultural-history-area',
    slug: 'inhan-ruukkiyhdyskunta',
    sourceName: 'Inhan ruukkiyhdyskunta',
    syntheticLipasId: 9_002_004
  },
  {
    displayTypeName: 'Tehdaskylä',
    locationLabel: 'Björkbodan ruukinalue',
    parkUrl: null,
    name: 'Björkbodan ruukinalue',
    parkTypeSlug: 'cultural-history-area',
    slug: 'bjorkbodan-ruukinalue',
    sourceName: 'Björkbodan ruukinalue',
    syntheticLipasId: 9_002_005
  },
  {
    displayTypeName: 'Tehdaskylä',
    locationLabel: 'Fagervikintie 21',
    parkUrl: null,
    name: 'Fagervikin ruukki',
    parkTypeSlug: 'cultural-history-area',
    postalCode: '10230',
    postalOffice: 'Fagervik',
    slug: 'fagervikin-ruukki',
    sourceName: 'Fagervikin ruukinalue',
    syntheticLipasId: 9_002_006
  },
  {
    displayTypeName: 'Tehdaskylä',
    excludedSourceNames: ['Kulosuonmäen kaivos'],
    locationLabel: 'Bremerintie 10',
    parkUrl: null,
    name: 'Högforsin ruukki',
    parkTypeSlug: 'cultural-history-area',
    postalCode: '03600',
    postalOffice: 'Karkkila',
    slug: 'hogforsin-ruukki',
    sourceName: 'Högforsin ruukinalue',
    syntheticLipasId: 9_002_007
  },
  {
    displayTypeName: 'Tehdaskylä',
    excludedSourceNames: ['Lohiluoma'],
    locationLabel: 'Kauttuan Ruukinpuisto, Tehtaantie 1',
    parkUrl: null,
    name: 'Kauttuan ruukki',
    parkTypeSlug: 'cultural-history-area',
    postalCode: '27500',
    postalOffice: 'Kauttua',
    slug: 'kauttuan-tehdasyhdyskunta',
    sourceName: 'Kauttuan ruukki- ja paperitehdasyhdyskunta',
    syntheticLipasId: 9_002_008
  },
  {
    displayTypeName: 'Tehdaskylä',
    locationLabel: 'Kärkelänkartanontie 411',
    parkUrl: null,
    name: 'Kärkelän ruukki',
    parkTypeSlug: 'cultural-history-area',
    postalCode: '25470',
    postalOffice: 'Salo',
    slug: 'karkelan-ruukki',
    sourceName: 'Kärkelän ruukkiyhdyskunta',
    syntheticLipasId: 9_002_009
  },
  {
    displayTypeName: 'Tehdaskylä',
    locationLabel: 'Kimon ruukki',
    parkUrl: null,
    name: 'Kimon ruukki',
    parkTypeSlug: 'cultural-history-area',
    slug: 'kimon-ruukki',
    sourceName: 'Kimon ruukki ja Oravaisten tehdasyhdyskunta',
    syntheticLipasId: 9_002_010
  },
  {
    displayTypeName: 'Tehdaskylä',
    locationLabel: 'Kosken ruukki',
    parkUrl: null,
    name: 'Kosken ruukki',
    parkTypeSlug: 'cultural-history-area',
    slug: 'kosken-ruukki',
    sourceName: 'Kosken ruukinalue',
    syntheticLipasId: 9_002_011
  },
  {
    displayTypeName: 'Tehdaskylä',
    locationLabel: 'Ruukintie 16',
    parkUrl: null,
    name: 'Leineperin ruukki',
    parkTypeSlug: 'cultural-history-area',
    postalCode: '29320',
    postalOffice: 'Leineperi',
    slug: 'leineperin-ruukki',
    sourceName: 'Leineperin ruukki ja yhdyskunta',
    syntheticLipasId: 9_002_012
  },
  {
    displayTypeName: 'Tehdaskylä',
    locationLabel: 'Kellokoskentie 2',
    parkUrl: null,
    name: 'Kellokosken ruukki',
    parkTypeSlug: 'cultural-history-area',
    postalCode: '04500',
    postalOffice: 'Kellokoski',
    slug: 'kellokosken-ruukki',
    sourceName: 'Marieforsin ruukki ja Kellokosken sairaala',
    syntheticLipasId: 9_002_013
  },
  {
    displayTypeName: 'Tehdaskylä',
    locationLabel: 'Pruukinraitti 15',
    parkUrl: null,
    name: 'Nuutajärven lasikylä',
    parkTypeSlug: 'cultural-history-area',
    postalCode: '31160',
    postalOffice: 'Urjala',
    slug: 'nuutajarven-lasikyla',
    sourceName: 'Nuutajärven lasitehtaan alue',
    syntheticLipasId: 9_002_025
  },
  {
    displayTypeName: 'Tehdaskylä',
    locationLabel: 'Ruukinrannantie 6',
    parkUrl: null,
    name: 'Mathildedalin ruukkikylä',
    parkTypeSlug: 'cultural-history-area',
    postalCode: '25660',
    postalOffice: 'Mathildedal',
    slug: 'mathildedalin-ruukkikyla',
    sourceName: 'Mathildedalin ruukkiyhdyskunta',
    syntheticLipasId: 9_002_014
  },
  {
    displayTypeName: 'Tehdaskylä',
    locationLabel: 'Männäisten ruukki',
    parkUrl: null,
    name: 'Männäisten ruukki',
    parkTypeSlug: 'cultural-history-area',
    slug: 'mannaisten-ruukki',
    sourceName: 'Männäisten ruukinalue',
    syntheticLipasId: 9_002_015
  },
  {
    displayTypeName: 'Tehdaskylä',
    locationLabel: 'Möhköntie 209',
    parkUrl: null,
    name: 'Möhkön ruukki',
    parkTypeSlug: 'cultural-history-area',
    postalCode: '82980',
    postalOffice: 'Möhkö',
    slug: 'mohkon-ruukki',
    sourceName: 'Möhkön ruukinalue',
    syntheticLipasId: 9_002_016
  },
  {
    displayTypeName: 'Tehdaskylä',
    locationLabel: 'Hållsnäsintie 89',
    parkUrl: null,
    name: 'Mustion ruukki ja linna',
    parkTypeSlug: 'cultural-history-area',
    postalCode: '10360',
    postalOffice: 'Mustio',
    slug: 'mustion-ruukinalue',
    sourceName: 'Mustion ruukinalue',
    syntheticLipasId: 9_002_017
  },
  {
    displayTypeName: 'Tehdaskylä',
    locationLabel: 'Ahlströmintie 1',
    parkUrl: null,
    name: 'Noormarkun ruukki',
    parkTypeSlug: 'cultural-history-area',
    postalCode: '29600',
    postalOffice: 'Noormarkku',
    slug: 'noormarkun-ruukki',
    sourceName: 'Noormarkun ruukin ja Ahlström-yhtiön rakennukset',
    syntheticLipasId: 9_002_018
  },
  {
    displayTypeName: 'Tehdaskylä',
    locationLabel: 'Orisbergin ruukinalue',
    parkUrl: null,
    name: 'Orisbergin ruukinalue',
    parkTypeSlug: 'cultural-history-area',
    slug: 'orisbergin-ruukinalue',
    sourceName: 'Orisbergin ruukinalue',
    syntheticLipasId: 9_002_019
  },
  {
    displayTypeName: 'Tehdaskylä',
    locationLabel: 'Ruukintie 11',
    parkUrl: null,
    name: 'Strömforsin ruukki',
    parkTypeSlug: 'cultural-history-area',
    postalCode: '07970',
    postalOffice: 'Ruotsinpyhtää',
    slug: 'stromforsin-ruukki',
    sourceName: 'Strömforsin ruukkiyhdyskunta',
    syntheticLipasId: 9_002_020
  },
  {
    displayTypeName: 'Tehdaskylä',
    locationLabel: 'Telakkatie 17',
    parkUrl: null,
    name: 'Teijon ruukki',
    parkTypeSlug: 'cultural-history-area',
    postalCode: '25570',
    postalOffice: 'Salo',
    slug: 'teijon-ruukki',
    sourceName: 'Teijon ruukinalue',
    syntheticLipasId: 9_002_021
  },
  {
    displayTypeName: 'Tehdaskylä',
    locationLabel: 'Tullbacksvägen 2',
    parkUrl: null,
    name: 'Taalintehtaan ruukki',
    parkTypeSlug: 'cultural-history-area',
    postalCode: '25900',
    postalOffice: 'Taalintehdas',
    slug: 'taalintehtaan-ruukki',
    sourceName: 'Taalintehtaan historiallinen teollisuusalue',
    syntheticLipasId: 9_002_022
  },
  {
    displayTypeName: 'Maailmanperintökohde',
    locationLabel: 'Verlantie 295',
    parkUrl: null,
    name: 'Verla',
    parkTypeSlug: 'cultural-history-area',
    postalCode: '47850',
    postalOffice: 'Verla',
    slug: 'verla',
    sourceName: 'Verlan teollisuusympäristö',
    syntheticLipasId: 9_002_023
  },
  {
    displayTypeName: 'Tehdaskylä',
    excludedSourceNames: ['hiiliuunit'],
    locationLabel: 'Juankosken ruukki',
    parkUrl: null,
    name: 'Juankosken ruukki',
    parkTypeSlug: 'cultural-history-area',
    slug: 'juankosken-ruukki',
    sourceName: 'Juantehdas',
    syntheticLipasId: 9_002_024
  },
  {
    displayTypeName: 'Tehdaskylä',
    parkUrl: null,
    name: 'Lapuan patruunatehdas',
    parkTypeSlug: 'cultural-history-area',
    slug: 'lapuan-patruunatehdas',
    sourceName: 'Lapuan Patruunatehdas',
    syntheticLipasId: 9_002_028
  },
  {
    displayTypeName: 'Tehdaskylä',
    parkUrl: null,
    name: 'Vääräkosken kartonkitehdas',
    parkTypeSlug: 'cultural-history-area',
    slug: 'vaarakosken-kartonkitehdas',
    sourceName: 'Vääräkosken kartonkitehdas',
    syntheticLipasId: 9_002_029
  },
  {
    displayTypeName: 'Tehdaskylä',
    parkUrl: null,
    name: 'Riihimäen lasitehdas',
    parkTypeSlug: 'cultural-history-area',
    slug: 'riihimaen-lasitehdas',
    sourceName: 'Riihimäen Lasin tehdasalue',
    syntheticLipasId: 9_002_030
  },
  {
    displayTypeName: 'Tehdaskylä',
    parkUrl: null,
    name: 'Koskenkylän ruukinalue',
    parkTypeSlug: 'cultural-history-area',
    slug: 'koskenkylan-ruukinalue',
    sourceName: 'Koskenkylän ruukinalue',
    syntheticLipasId: 9_002_031
  }
];

const sourceReadyFactoryVillageProtectedSiteSeeds: SykeSpecialParkSeed[] = [
  {
    displayTypeName: 'Tehdaskylä',
    locationLabel: 'Jyrkänjoentie 217',
    parkUrl: null,
    name: 'Jyrkkäkosken ruukki',
    parkTypeSlug: 'cultural-history-area',
    postalCode: '74360',
    postalOffice: 'Jyrkkäkoski',
    slug: 'jyrkkakosken-ruukki',
    sourceName: 'Jyrkkäkosken ruukki',
    syntheticLipasId: 9_002_026
  },
  {
    displayTypeName: 'Tehdaskylä',
    locationLabel: 'Haapakoskentie 506',
    parkUrl: null,
    name: 'Haapakosken ruukki',
    parkTypeSlug: 'cultural-history-area',
    postalCode: '77520',
    postalOffice: 'Haapakoski',
    slug: 'haapakosken-ruukki',
    sourceName: 'Haapakosken ruukki',
    syntheticLipasId: 9_002_027
  }
];

const specialParkConfigs: SpecialParkConfig[] = [
  ...baseSpecialParkConfigs,
  ...sourceReadyReserveParkSeeds.map(createSykeSpecialParkConfig),
  ...sourceReadyDestinationAreaSeeds.map(createSykeSpecialParkConfig),
  ...sourceReadyLuontoonDestinationAreaSeeds.map(createLuontoonDestinationAreaConfig),
  ...sourceReadyHistoryAreaSeeds.map(createMuseovirastoSpecialParkConfig),
  ...sourceReadyHistoryRkyAreaSeeds.map(createMuseovirastoRkyAreaConfig),
  ...sourceReadyFactoryVillageProtectedSiteSeeds.map(createMuseovirastoSpecialParkConfig),
  ...sourceReadyFactoryVillageSeeds.map(createMuseovirastoRkyAreaConfig)
];

type ImportSpecialParksOptions = {
  database: Database;
  fetchSource?: (sourceUrl: string) => Promise<unknown>;
  includeSlugs?: string[];
  now?: () => string;
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
