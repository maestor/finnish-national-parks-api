import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import type { Database } from '../db/database.js';
import { createImportRun, syncParkTypes, upsertCatalogPark } from '../db/repositories.js';
import type { SupportedParkTypeSlug } from '../parks/park-types.js';
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
  luontoonUrl: string | null;
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
  luontoonUrl: string | null;
  name: string;
  parkTypeSlug: SupportedParkTypeSlug;
  postalCode?: string | null;
  postalOffice?: string | null;
  slug: string;
  sourceName: string;
  sourceType?: SykeProtectedSitesSourceType;
  syntheticLipasId: number;
};

type MuseovirastoRkyAreaSeed = {
  displayTypeName: string | null;
  excludedSourceNames?: string[];
  locationLabel?: string;
  luontoonUrl: string | null;
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

const createSykeSpecialParkConfig = ({
  displayTypeName,
  locationLabel,
  luontoonUrl,
  name,
  parkTypeSlug,
  postalCode,
  postalOffice,
  slug,
  sourceName,
  sourceType,
  syntheticLipasId
}: SykeSpecialParkSeed): SpecialParkConfig => ({
  displayTypeName,
  locationLabel: locationLabel ?? name,
  luontoonUrl,
  name,
  parkTypeSlug,
  postalCode: postalCode ?? null,
  postalOffice: postalOffice ?? null,
  responseShapeVersion: 'syke-protected-sites-v1',
  slug,
  sourceUrl: buildSykeProtectedSitesSourceUrl(sourceName, sourceType),
  syntheticLipasId
});

const buildMuseovirastoProtectedSitesSourceUrl = (sourceName: string) => {
  return `https://geoserver.museovirasto.fi/geoserver/rajapinta_suojellut/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=rajapinta_suojellut:muinaisjaannos_alue&outputFormat=application/json&srsName=EPSG:4326&cql_filter=kohdenimi='${sourceName}'`;
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
  luontoonUrl,
  name,
  parkTypeSlug,
  postalCode,
  postalOffice,
  slug,
  sourceName,
  syntheticLipasId
}: SykeSpecialParkSeed): SpecialParkConfig => ({
  displayTypeName,
  locationLabel: locationLabel ?? name,
  luontoonUrl,
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

const createMuseovirastoRkyAreaConfig = ({
  displayTypeName,
  excludedSourceNames,
  locationLabel,
  luontoonUrl,
  name,
  parkTypeSlug,
  postalCode,
  postalOffice,
  slug,
  sourceFeatureName,
  sourceName,
  syntheticLipasId
}: MuseovirastoRkyAreaSeed): SpecialParkConfig => ({
  displayTypeName,
  locationLabel: locationLabel ?? name,
  luontoonUrl,
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
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/merenkurkun-maailmanperintoalue',
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
    luontoonUrl: null,
    name: 'Sammallahdenmäki',
    parkTypeSlug: 'outdoor-recreation-area',
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
    luontoonUrl: null,
    name: 'Suomenlinna',
    parkTypeSlug: 'outdoor-recreation-area',
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
    luontoonUrl: null,
    name: 'Vanha Rauma',
    parkTypeSlug: 'outdoor-recreation-area',
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
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/kevon-luonnonpuisto',
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
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/laajalahden-luonnonsuojelualue',
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
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/liminganlahti',
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
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/mallan-luonnonpuisto',
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
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/siikalahden-luonnonsuojelualue',
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
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/napapiirin-retkeilyalue',
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
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/inarin-retkeilyalue',
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
    displayTypeName: 'Historia-alue',
    locationLabel: 'Seili',
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/seili',
    name: 'Seili',
    parkTypeSlug: 'outdoor-recreation-area',
    postalCode: null,
    postalOffice: null,
    responseShapeVersion: 'manual-mml-landwaterboundary-v1',
    slug: 'seili',
    sourceUrl: 'special://seili',
    syntheticLipasId: 9_001_034
  },
  {
    displayTypeName: null,
    locationLabel: 'Vallisaari',
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/vallisaari',
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
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/hailuoto',
    name: 'Hailuoto',
    parkTypeSlug: 'outdoor-recreation-area',
    postalCode: null,
    postalOffice: null,
    responseShapeVersion: 'manual-mml-kunta-v1',
    slug: 'hailuoto',
    sourceUrl: 'special://hailuoto',
    syntheticLipasId: 9_001_036
  }
];

const sourceReadyReserveParkSeeds: SykeSpecialParkSeed[] = [
  {
    displayTypeName: 'Ystävyyden puisto',
    luontoonUrl:
      'https://www.luontoon.fi/fi/kohteet/elimyssalon-luonnonsuojelualue-ystavyyden-puisto',
    name: 'Elimyssalon luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'elimyssalon-luonnonsuojelualue-ystavyyden-puisto',
    sourceName: 'Elimyssalon luonnonsuojelualue (Ystävyyden puisto)',
    syntheticLipasId: 9_001_001
  },
  {
    displayTypeName: null,
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/hiidenvaaran-luonnonsuojelualue',
    name: 'Hiidenvaaran luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'hiidenvaaran-luonnonsuojelualue',
    sourceName: 'Hiidenvaaran luonnonsuojelualue',
    syntheticLipasId: 9_001_002
  },
  {
    displayTypeName: 'Ystävyyden puisto',
    luontoonUrl:
      'https://www.luontoon.fi/fi/kohteet/ison-palosen-ja-maariansarkkien-luonnonsuojelualue-ystavyyden-puisto',
    name: 'Ison-Palosen ja Maariansarkkien luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'ison-palosen-ja-maariansarkkien-luonnonsuojelualue-ystavyyden-puisto',
    sourceName: 'Ison-Palosen ja Maariansärkkien luonnonsuojelualue (Ystävyyden puisto)',
    syntheticLipasId: 9_001_003
  },
  {
    displayTypeName: null,
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/jouhtenisen-luonnonsuojelualue',
    name: 'Jouhtenisen luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'jouhtenisen-luonnonsuojelualue',
    sourceName: 'Jouhtenisen luonnonsuojelualue',
    syntheticLipasId: 9_001_004
  },
  {
    displayTypeName: null,
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/kermajarven-luonnonsuojelualue',
    name: 'Kermajärven luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'kermajarven-luonnonsuojelualue',
    sourceName: 'Kermajärven luonnonsuojelualue',
    syntheticLipasId: 9_001_005
  },
  {
    displayTypeName: 'Ystävyyden puisto',
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/lentuan-luonnonsuojelualue-ystavyyden-puisto',
    name: 'Lentuan luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'lentuan-luonnonsuojelualue-ystavyyden-puisto',
    sourceName: 'Lentuan luonnonsuojelualue (Ystävyyden puisto)',
    syntheticLipasId: 9_001_006
  },
  {
    displayTypeName: null,
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/levanevan-luonnonsuojelualue',
    name: 'Levänevan luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'levanevan-luonnonsuojelualue',
    sourceName: 'Levanevan luonnonsuojelualue',
    syntheticLipasId: 9_001_007
  },
  {
    displayTypeName: null,
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/medvaston-ja-stormossenin-luonnonsuojelualue',
    name: 'Medvastön ja Stormossenin luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'medvaston-ja-stormossenin-luonnonsuojelualue',
    sourceName: 'Medvastön ja Stormossenin luonnonsuojelualue',
    syntheticLipasId: 9_001_008
  },
  {
    displayTypeName: null,
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/mietoistenlahden-luonnonsuojelualue',
    name: 'Mietoistenlahden luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'mietoistenlahden-luonnonsuojelualue',
    sourceName: 'Mietoistenlahden luonnonsuojelualue',
    syntheticLipasId: 9_001_009
  },
  {
    displayTypeName: null,
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/mujejarven-luonnonsuojelualue',
    name: 'Mujejärven luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'mujejarven-luonnonsuojelualue',
    sourceName: 'Mujejärven luonnonsuojelualue',
    syntheticLipasId: 9_001_010
  },
  {
    displayTypeName: null,
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/otajarven-luonnonsuojelualue',
    name: 'Otajärven luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'otajarven-luonnonsuojelualue',
    sourceName: 'Otajärven luonnonsuojelualue',
    syntheticLipasId: 9_001_011
  },
  {
    displayTypeName: null,
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/pihlajaveden-luonnonsuojelualue',
    name: 'Pihlajaveden luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'pihlajaveden-luonnonsuojelualue',
    sourceName: 'Pihlajaveden luonnonsuojelualue',
    syntheticLipasId: 9_001_012
  },
  {
    displayTypeName: null,
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/punkaharjun-luonnonsuojelualue',
    name: 'Punkaharjun luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'punkaharjun-luonnonsuojelualue',
    sourceName: 'Punkaharjun luonnonsuojelualue',
    syntheticLipasId: 9_001_013
  },
  {
    displayTypeName: null,
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/saltfjardenin-luonnonsuojelualue',
    name: 'Saltfjärdenin luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'saltfjardenin-luonnonsuojelualue',
    sourceName: 'Saltfjärdenin luonnonsuojelualue',
    syntheticLipasId: 9_001_014
  },
  {
    displayTypeName: null,
    luontoonUrl:
      'https://www.luontoon.fi/fi/kohteet/taktominlahden-ja-svanvikenin-luonnonsuojelualue',
    name: 'Täktominlahden ja Svanvikenin luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'taktominlahden-ja-svanvikenin-luonnonsuojelualue',
    sourceName: 'Täktominlahden ja Svanvikenin luonnonsuojelualue',
    syntheticLipasId: 9_001_015
  },
  {
    displayTypeName: null,
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/vaisakon-luonnonsuojelualue',
    name: 'Vaisakon luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'vaisakon-luonnonsuojelualue',
    sourceName: 'Vaisakon luonnonsuojelualue',
    syntheticLipasId: 9_001_016
  },
  {
    displayTypeName: null,
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/valtavaaran-ja-pyhavaaran-luonnonsuojelualue',
    name: 'Valtavaaran ja Pyhävaaran luonnonsuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'valtavaaran-ja-pyhavaaran-luonnonsuojelualue',
    sourceName: 'Valtavaaran ja Pyhävaaran luonnonsuojelualue',
    syntheticLipasId: 9_001_017
  },
  {
    displayTypeName: null,
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/ilmakkiaavan-soidensuojelualue',
    name: 'Ilmakkiaavan soidensuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'ilmakkiaavan-soidensuojelualue',
    sourceName: 'Ilmakkiaavan soidensuojelualue',
    syntheticLipasId: 9_001_018
  },
  {
    displayTypeName: 'Ystävyyden puisto',
    luontoonUrl:
      'https://www.luontoon.fi/fi/kohteet/juortanansalon-lapinsuon-soidensuojelualue-ystavyyden-puisto',
    name: 'Juortanansalon-Lapinsuon soidensuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'juortanansalon-lapinsuon-soidensuojelualue-ystavyyden-puisto',
    sourceName: 'Juortanansalon-Lapinsuon soidensuojelualue (Ystävyyden p.)',
    syntheticLipasId: 9_001_019
  },
  {
    displayTypeName: null,
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/siikanevan-soidensuojelualue',
    name: 'Siikanevan soidensuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'siikanevan-soidensuojelualue',
    sourceName: 'Siikanevan soidensuojelualue',
    syntheticLipasId: 9_001_020
  },
  {
    displayTypeName: null,
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/viiankiaavan-soidensuojelualue',
    name: 'Viiankiaavan soidensuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'viiankiaavan-soidensuojelualue',
    sourceName: 'Viiankiaavan soidensuojelualue',
    syntheticLipasId: 9_001_021
  },
  {
    displayTypeName: 'Luonnonpuisto',
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/karkalin-luonnonpuisto',
    name: 'Karkalin luonnonpuisto',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'karkalin-luonnonpuisto',
    sourceName: 'Karkalin luonnonpuisto',
    syntheticLipasId: 9_001_022
  },
  {
    displayTypeName: 'Luonnonpuisto',
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/paljakan-luonnonpuisto',
    name: 'Paljakan luonnonpuisto',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'paljakan-luonnonpuisto',
    sourceName: 'Paljakan  luonnonpuisto',
    syntheticLipasId: 9_001_023
  },
  {
    displayTypeName: 'Luonnonpuisto',
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/salamanperan-luonnonpuisto',
    name: 'Salamanperän luonnonpuisto',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'salamanperan-luonnonpuisto',
    sourceName: 'Salamanperän luonnonpuisto',
    syntheticLipasId: 9_001_024
  },
  {
    displayTypeName: 'Luonnonpuisto',
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/sompion-luonnonpuisto',
    name: 'Sompion luonnonpuisto',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'sompion-luonnonpuisto',
    sourceName: 'Sompion luonnonpuisto',
    syntheticLipasId: 9_001_025
  },
  {
    displayTypeName: 'Luonnonpuisto',
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/vaskijarven-luonnonpuisto',
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
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/liimanninkosken-lehtojensuojelualue',
    name: 'Liimanninkosken lehtojensuojelualue',
    parkTypeSlug: 'nature-reserve-area',
    slug: 'liimanninkosken-lehtojensuojelualue',
    sourceName: 'Liimanninkosken lehtojensuojelualue',
    syntheticLipasId: 9_001_027
  },
  {
    displayTypeName: 'Historia-alue',
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/dagmarin-puisto',
    name: 'Dagmarin puisto',
    parkTypeSlug: 'outdoor-recreation-area',
    slug: 'dagmarin-puisto',
    sourceName: 'Dagmarin puisto',
    sourceType: 'private',
    syntheticLipasId: 9_001_028
  },
  {
    displayTypeName: null,
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/olvassuo',
    name: 'Olvassuo',
    parkTypeSlug: 'outdoor-recreation-area',
    slug: 'olvassuo',
    sourceName: 'Olvassuon luonnonpuisto',
    syntheticLipasId: 9_001_029
  }
];

const sourceReadyHistoryAreaSeeds: SykeSpecialParkSeed[] = [
  {
    displayTypeName: null,
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/harola',
    name: 'Harola',
    parkTypeSlug: 'outdoor-recreation-area',
    slug: 'harola',
    sourceName: 'Harola',
    syntheticLipasId: 9_001_030
  },
  {
    displayTypeName: 'Historia-alue',
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/kajaanin-linna',
    name: 'Kajaanin linna',
    parkTypeSlug: 'outdoor-recreation-area',
    slug: 'kajaanin-linna',
    sourceName: 'Kajaanin linna',
    syntheticLipasId: 9_001_031
  },
  {
    displayTypeName: 'Historia-alue',
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/raaseporin-linna',
    name: 'Raaseporin linna',
    parkTypeSlug: 'outdoor-recreation-area',
    slug: 'raaseporin-linna',
    sourceName: 'Raaseporin linna',
    syntheticLipasId: 9_001_032
  },
  {
    displayTypeName: 'Historia-alue',
    luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/svartholma',
    name: 'Svartholma',
    parkTypeSlug: 'outdoor-recreation-area',
    slug: 'svartholma',
    sourceName: 'Svartholma',
    syntheticLipasId: 9_001_033
  }
];

const sourceReadyFactoryVillageSeeds: MuseovirastoRkyAreaSeed[] = [
  {
    displayTypeName: null,
    locationLabel: 'Antskogintie 259',
    luontoonUrl: null,
    name: 'Antskogin ruukki',
    parkTypeSlug: 'factory-village',
    postalCode: '10410',
    postalOffice: 'Antskog',
    slug: 'antskogin-ruukki',
    sourceFeatureName: 'Antskogin ruukinalue',
    sourceName: 'Pohjan ruukkiympäristöt',
    syntheticLipasId: 9_002_001
  },
  {
    displayTypeName: null,
    locationLabel: 'Ruukintie 8',
    luontoonUrl: null,
    name: 'Billnäsin ruukki',
    parkTypeSlug: 'factory-village',
    postalCode: '10330',
    postalOffice: 'Billnäs',
    slug: 'billnasin-ruukki',
    sourceFeatureName: 'Billnäsin ruukinalue',
    sourceName: 'Pohjan ruukkiympäristöt',
    syntheticLipasId: 9_002_002
  },
  {
    displayTypeName: null,
    locationLabel: 'Fiskarsintie 9',
    luontoonUrl: null,
    name: 'Fiskarsin ruukki',
    parkTypeSlug: 'factory-village',
    postalCode: '10470',
    postalOffice: 'Fiskars',
    slug: 'fiskarsin-ruukki',
    sourceFeatureName: 'Fiskarsin ruukinalue',
    sourceName: 'Pohjan ruukkiympäristöt',
    syntheticLipasId: 9_002_003
  },
  {
    displayTypeName: null,
    luontoonUrl: null,
    name: 'Inhan ruukkiyhdyskunta',
    parkTypeSlug: 'factory-village',
    slug: 'inhan-ruukkiyhdyskunta',
    sourceName: 'Inhan ruukkiyhdyskunta',
    syntheticLipasId: 9_002_004
  },
  {
    displayTypeName: null,
    locationLabel: 'Björkbodan ruukinalue',
    luontoonUrl: null,
    name: 'Björkbodan ruukinalue',
    parkTypeSlug: 'factory-village',
    slug: 'bjorkbodan-ruukinalue',
    sourceName: 'Björkbodan ruukinalue',
    syntheticLipasId: 9_002_005
  },
  {
    displayTypeName: null,
    locationLabel: 'Fagervikintie 21',
    luontoonUrl: null,
    name: 'Fagervikin ruukki',
    parkTypeSlug: 'factory-village',
    postalCode: '10230',
    postalOffice: 'Fagervik',
    slug: 'fagervikin-ruukki',
    sourceName: 'Fagervikin ruukinalue',
    syntheticLipasId: 9_002_006
  },
  {
    displayTypeName: null,
    excludedSourceNames: ['Kulosuonmäen kaivos'],
    locationLabel: 'Bremerintie 10',
    luontoonUrl: null,
    name: 'Högforsin ruukki',
    parkTypeSlug: 'factory-village',
    postalCode: '03600',
    postalOffice: 'Karkkila',
    slug: 'hogforsin-ruukki',
    sourceName: 'Högforsin ruukinalue',
    syntheticLipasId: 9_002_007
  },
  {
    displayTypeName: null,
    excludedSourceNames: ['Lohiluoma'],
    locationLabel: 'Kauttuan Ruukinpuisto, Tehtaantie 1',
    luontoonUrl: null,
    name: 'Kauttuan ruukki',
    parkTypeSlug: 'factory-village',
    postalCode: '27500',
    postalOffice: 'Kauttua',
    slug: 'kauttuan-tehdasyhdyskunta',
    sourceName: 'Kauttuan ruukki- ja paperitehdasyhdyskunta',
    syntheticLipasId: 9_002_008
  },
  {
    displayTypeName: null,
    locationLabel: 'Kärkelänkartanontie 411',
    luontoonUrl: null,
    name: 'Kärkelän ruukki',
    parkTypeSlug: 'factory-village',
    postalCode: '25470',
    postalOffice: 'Salo',
    slug: 'karkelan-ruukki',
    sourceName: 'Kärkelän ruukkiyhdyskunta',
    syntheticLipasId: 9_002_009
  },
  {
    displayTypeName: null,
    locationLabel: 'Kimon ruukki',
    luontoonUrl: null,
    name: 'Kimon ruukki',
    parkTypeSlug: 'factory-village',
    slug: 'kimon-ruukki',
    sourceName: 'Kimon ruukki ja Oravaisten tehdasyhdyskunta',
    syntheticLipasId: 9_002_010
  },
  {
    displayTypeName: null,
    locationLabel: 'Kosken ruukki',
    luontoonUrl: null,
    name: 'Kosken ruukki',
    parkTypeSlug: 'factory-village',
    slug: 'kosken-ruukki',
    sourceName: 'Kosken ruukinalue',
    syntheticLipasId: 9_002_011
  },
  {
    displayTypeName: null,
    locationLabel: 'Ruukintie 16',
    luontoonUrl: null,
    name: 'Leineperin ruukki',
    parkTypeSlug: 'factory-village',
    postalCode: '29320',
    postalOffice: 'Leineperi',
    slug: 'leineperin-ruukki',
    sourceName: 'Leineperin ruukki ja yhdyskunta',
    syntheticLipasId: 9_002_012
  },
  {
    displayTypeName: null,
    locationLabel: 'Kellokoskentie 2',
    luontoonUrl: null,
    name: 'Kellokosken ruukki',
    parkTypeSlug: 'factory-village',
    postalCode: '04500',
    postalOffice: 'Kellokoski',
    slug: 'kellokosken-ruukki',
    sourceName: 'Marieforsin ruukki ja Kellokosken sairaala',
    syntheticLipasId: 9_002_013
  },
  {
    displayTypeName: null,
    locationLabel: 'Pruukinraitti 15',
    luontoonUrl: null,
    name: 'Nuutajärven lasikylä',
    parkTypeSlug: 'factory-village',
    postalCode: '31160',
    postalOffice: 'Urjala',
    slug: 'nuutajarven-lasikyla',
    sourceName: 'Nuutajärven lasitehtaan alue',
    syntheticLipasId: 9_002_025
  },
  {
    displayTypeName: null,
    locationLabel: 'Ruukinrannantie 6',
    luontoonUrl: null,
    name: 'Mathildedalin ruukkikylä',
    parkTypeSlug: 'factory-village',
    postalCode: '25660',
    postalOffice: 'Mathildedal',
    slug: 'mathildedalin-ruukkikyla',
    sourceName: 'Mathildedalin ruukkiyhdyskunta',
    syntheticLipasId: 9_002_014
  },
  {
    displayTypeName: null,
    locationLabel: 'Männäisten ruukki',
    luontoonUrl: null,
    name: 'Männäisten ruukki',
    parkTypeSlug: 'factory-village',
    slug: 'mannaisten-ruukki',
    sourceName: 'Männäisten ruukinalue',
    syntheticLipasId: 9_002_015
  },
  {
    displayTypeName: null,
    locationLabel: 'Möhköntie 209',
    luontoonUrl: null,
    name: 'Möhkön ruukki',
    parkTypeSlug: 'factory-village',
    postalCode: '82980',
    postalOffice: 'Möhkö',
    slug: 'mohkon-ruukki',
    sourceName: 'Möhkön ruukinalue',
    syntheticLipasId: 9_002_016
  },
  {
    displayTypeName: null,
    locationLabel: 'Hållsnäsintie 89',
    luontoonUrl: null,
    name: 'Mustion ruukki ja linna',
    parkTypeSlug: 'factory-village',
    postalCode: '10360',
    postalOffice: 'Mustio',
    slug: 'mustion-ruukinalue',
    sourceName: 'Mustion ruukinalue',
    syntheticLipasId: 9_002_017
  },
  {
    displayTypeName: null,
    locationLabel: 'Ahlströmintie 1',
    luontoonUrl: null,
    name: 'Noormarkun ruukki',
    parkTypeSlug: 'factory-village',
    postalCode: '29600',
    postalOffice: 'Noormarkku',
    slug: 'noormarkun-ruukki',
    sourceName: 'Noormarkun ruukin ja Ahlström-yhtiön rakennukset',
    syntheticLipasId: 9_002_018
  },
  {
    displayTypeName: null,
    locationLabel: 'Orisbergin ruukinalue',
    luontoonUrl: null,
    name: 'Orisbergin ruukinalue',
    parkTypeSlug: 'factory-village',
    slug: 'orisbergin-ruukinalue',
    sourceName: 'Orisbergin ruukinalue',
    syntheticLipasId: 9_002_019
  },
  {
    displayTypeName: null,
    locationLabel: 'Ruukintie 11',
    luontoonUrl: null,
    name: 'Strömforsin ruukki',
    parkTypeSlug: 'factory-village',
    postalCode: '07970',
    postalOffice: 'Ruotsinpyhtää',
    slug: 'stromforsin-ruukki',
    sourceName: 'Strömforsin ruukkiyhdyskunta',
    syntheticLipasId: 9_002_020
  },
  {
    displayTypeName: null,
    locationLabel: 'Telakkatie 17',
    luontoonUrl: null,
    name: 'Teijon ruukki',
    parkTypeSlug: 'factory-village',
    postalCode: '25570',
    postalOffice: 'Salo',
    slug: 'teijon-ruukki',
    sourceName: 'Teijon ruukinalue',
    syntheticLipasId: 9_002_021
  },
  {
    displayTypeName: null,
    locationLabel: 'Tullbacksvägen 2',
    luontoonUrl: null,
    name: 'Taalintehtaan ruukki',
    parkTypeSlug: 'factory-village',
    postalCode: '25900',
    postalOffice: 'Taalintehdas',
    slug: 'taalintehtaan-ruukki',
    sourceName: 'Taalintehtaan historiallinen teollisuusalue',
    syntheticLipasId: 9_002_022
  },
  {
    displayTypeName: 'Maailmanperintökohde',
    locationLabel: 'Verlantie 295',
    luontoonUrl: null,
    name: 'Verla',
    parkTypeSlug: 'factory-village',
    postalCode: '47850',
    postalOffice: 'Verla',
    slug: 'verla',
    sourceName: 'Verlan teollisuusympäristö',
    syntheticLipasId: 9_002_023
  },
  {
    displayTypeName: null,
    excludedSourceNames: ['hiiliuunit'],
    locationLabel: 'Juankosken ruukki',
    luontoonUrl: null,
    name: 'Juankosken ruukki',
    parkTypeSlug: 'factory-village',
    slug: 'juankosken-ruukki',
    sourceName: 'Juantehdas',
    syntheticLipasId: 9_002_024
  }
];

const sourceReadyFactoryVillageProtectedSiteSeeds: SykeSpecialParkSeed[] = [
  {
    displayTypeName: null,
    locationLabel: 'Jyrkänjoentie 217',
    luontoonUrl: null,
    name: 'Jyrkkäkosken ruukki',
    parkTypeSlug: 'factory-village',
    postalCode: '74360',
    postalOffice: 'Jyrkkäkoski',
    slug: 'jyrkkakosken-ruukki',
    sourceName: 'Jyrkkäkosken ruukki',
    syntheticLipasId: 9_002_026
  },
  {
    displayTypeName: null,
    locationLabel: 'Haapakoskentie 506',
    luontoonUrl: null,
    name: 'Haapakosken ruukki',
    parkTypeSlug: 'factory-village',
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
  ...sourceReadyHistoryAreaSeeds.map(createMuseovirastoSpecialParkConfig),
  ...sourceReadyFactoryVillageProtectedSiteSeeds.map(createMuseovirastoSpecialParkConfig),
  ...sourceReadyFactoryVillageSeeds.map(createMuseovirastoRkyAreaConfig)
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
