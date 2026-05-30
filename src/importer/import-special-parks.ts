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
  luontoonUrl: string;
  name: string;
  parkTypeSlug: SupportedParkTypeSlug;
  postalCode: string | null;
  postalOffice: string | null;
  responseShapeVersion: string;
  slug: string;
  sourceUrl: string;
  syntheticLipasId: number;
};

type SykeProtectedSitesSourceType = 'private' | 'state';

type SykeSpecialParkSeed = {
  displayTypeName: string | null;
  locationLabel?: string;
  luontoonUrl: string;
  name: string;
  parkTypeSlug: SupportedParkTypeSlug;
  slug: string;
  sourceName: string;
  sourceType?: SykeProtectedSitesSourceType;
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
  postalCode: null,
  postalOffice: null,
  responseShapeVersion: 'syke-protected-sites-v1',
  slug,
  sourceUrl: buildSykeProtectedSitesSourceUrl(sourceName, sourceType),
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

const specialParkConfigs: SpecialParkConfig[] = [
  ...baseSpecialParkConfigs,
  ...sourceReadyReserveParkSeeds.map(createSykeSpecialParkConfig),
  ...sourceReadyDestinationAreaSeeds.map(createSykeSpecialParkConfig)
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
      properties?: Record<string, unknown> | undefined;
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
    } else if (config.sourceUrl.startsWith('special://')) {
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
