import { logger } from '../http/logger.js';
import type { GeoJsonFeatureCollection } from '../importer/geometry.js';
import { deriveBoundingBox } from './geometry.js';
import type {
  TripPlannerCoordinate,
  TripPlannerMode,
  TripPlannerProvider,
  TripPlannerResolvedLocation,
  TripPlannerRoute
} from './types.js';

type GeoapifyClientOptions = {
  apiKey: string;
  fetchFn?: typeof fetch | undefined;
};

type GeoapifyGeocodeResponse = {
  results?: GeoapifyGeocodeResult[];
};

type GeoapifyGeocodeResult = {
  formatted?: string;
  lat?: number;
  lon?: number;
};

type GeoapifyRoutingResponse = {
  features?: GeoapifyRoutingFeature[];
};

type GeoapifyRoutingFeature = {
  geometry?: {
    coordinates?: number[][][];
    type?: string;
  };
  properties?: {
    distance?: number;
    time?: number;
  };
};

const GEOAPIFY_GEOCODE_URL = 'https://api.geoapify.com/v1/geocode/search';
const GEOAPIFY_ROUTING_URL = 'https://api.geoapify.com/v1/routing';

const buildGeocodeUrl = (apiKey: string, query: string) => {
  const params = new URLSearchParams({
    apiKey,
    bias: 'countrycode:fi',
    format: 'json',
    lang: 'fi',
    limit: '1',
    text: query
  });

  return `${GEOAPIFY_GEOCODE_URL}?${params.toString()}`;
};

const buildRouteUrl = (
  apiKey: string,
  origin: TripPlannerCoordinate,
  destination: TripPlannerCoordinate,
  mode: TripPlannerMode
) => {
  const params = new URLSearchParams({
    apiKey,
    mode,
    waypoints: `${origin.lat},${origin.lon}|${destination.lat},${destination.lon}`
  });

  return `${GEOAPIFY_ROUTING_URL}?${params.toString()}`;
};

const normalizeGeocodedLocation = (
  result?: GeoapifyGeocodeResult
): TripPlannerResolvedLocation | null => {
  if (!(result?.formatted && typeof result.lat === 'number' && typeof result.lon === 'number')) {
    return null;
  }

  return {
    coordinate: {
      lat: result.lat,
      lon: result.lon
    },
    label: result.formatted
  };
};

const normalizeRouteGeometry = (coordinates?: number[][][]): GeoJsonFeatureCollection | null => {
  if (!coordinates || coordinates.length === 0) {
    return null;
  }

  const features = coordinates
    .filter((line) => line.length >= 2)
    .map((line) => ({
      geometry: {
        coordinates: line.map(([lon, lat]) => [lon, lat] as [number, number]),
        type: 'LineString' as const
      },
      type: 'Feature' as const
    }));

  if (features.length === 0) {
    return null;
  }

  return {
    features,
    type: 'FeatureCollection'
  };
};

const normalizeRoute = (
  mode: TripPlannerMode,
  feature?: GeoapifyRoutingFeature
): TripPlannerRoute | null => {
  const geometry = normalizeRouteGeometry(feature?.geometry?.coordinates);
  const distanceMeters = feature?.properties?.distance;
  const durationSeconds = feature?.properties?.time;

  if (!(geometry && typeof distanceMeters === 'number' && typeof durationSeconds === 'number')) {
    return null;
  }

  return {
    boundingBox: deriveBoundingBox(geometry),
    distanceMeters,
    durationSeconds,
    geometry,
    mode
  };
};

const fetchJson = async <T>(fetchFn: typeof fetch, url: string): Promise<T | null> => {
  const response = await fetchFn(url, {
    headers: {
      accept: 'application/json'
    }
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    logger.warn({ status: response.status, url }, 'Geoapify request failed');
    throw new Error(`Geoapify request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
};

export const createGeoapifyClient = ({
  apiKey,
  fetchFn = fetch
}: GeoapifyClientOptions): TripPlannerProvider => {
  return {
    geocode: async (query) => {
      const response = await fetchJson<GeoapifyGeocodeResponse>(
        fetchFn,
        buildGeocodeUrl(apiKey, query)
      );

      return normalizeGeocodedLocation(response?.results?.[0]);
    },
    route: async ({ destination, mode, origin }) => {
      const response = await fetchJson<GeoapifyRoutingResponse>(
        fetchFn,
        buildRouteUrl(apiKey, origin, destination, mode)
      );

      return normalizeRoute(mode, response?.features?.[0]);
    }
  };
};
