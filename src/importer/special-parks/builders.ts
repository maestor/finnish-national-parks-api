import type {
  LuontoonDestinationAreaSeed,
  MuseovirastoRkyAreaSeed,
  SpecialParkConfig,
  SykeProtectedSitesSourceType,
  SykeSpecialParkSeed
} from './types.js';

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

export const extractLuontoonDestinationMetadata = (
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

export const extractGeoJsonAreaM2Metadata = (
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

export const buildSykeProtectedSitesSourceUrl = (
  sourceName: string,
  sourceType: SykeProtectedSitesSourceType = 'state'
) => {
  const typeName =
    sourceType === 'state'
      ? 'inspire_ps:PS.ProtectedSitesValtionOmistamaLuonnonsuojelualue'
      : 'inspire_ps:PS.ProtectedSitesYksityistenMaillaOlevaLuonnonsuojelualue';

  return `https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=${typeName}&outputFormat=application/json&srsName=EPSG:4326&cql_filter=nimi='${sourceName}'`;
};

export const buildSykePrivateProtectedSitesCompositeSourceUrl = (sourceNames: string[]) => {
  const cqlFilter = encodeURIComponent(
    sourceNames.map((sourceName) => `nimi='${sourceName}'`).join(' OR ')
  );

  return `https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=inspire_ps:PS.ProtectedSitesYksityistenMaillaOlevaLuonnonsuojelualue&outputFormat=application/json&srsName=EPSG:4326&cql_filter=${cqlFilter}`;
};

const normalizeSpecialParkDisplayTypeName = (name: string, displayTypeName: string | null) => {
  if (name.toLocaleLowerCase('fi-FI').endsWith('soidensuojelualue')) {
    return 'Soidensuojelualue';
  }

  return displayTypeName;
};

export const buildMuseovirastoProtectedSitesSourceUrl = (sourceName: string) => {
  return `https://geoserver.museovirasto.fi/geoserver/rajapinta_suojellut/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=rajapinta_suojellut:muinaisjaannos_alue&outputFormat=application/json&srsName=EPSG:4326&cql_filter=kohdenimi='${sourceName}'`;
};

export const buildSykeGeologicalRockAreaSourceUrl = (sourceName: string) => {
  return `https://paikkatiedot.ymparisto.fi/geoserver/syke_geologisetmuodostumat/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=syke_geologisetmuodostumat:Arvokkaat_kallioalueet&outputFormat=application/json&srsName=EPSG:4326&cql_filter=nimi='${sourceName}'`;
};

export const buildArcGisGeoJsonQuerySourceUrl = ({
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

export const buildLuontoonGeoJsonCollectionSourceUrl = ({
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

export const buildMuseovirastoRkyAreaSourceUrl = ({
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

export const createSykeSpecialParkConfig = ({
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

export const createMuseovirastoSpecialParkConfig = ({
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

export const createLuontoonDestinationAreaConfig = ({
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

export const createMuseovirastoRkyAreaConfig = ({
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
