import { logger } from '../http/logger.js';
import type { GeoJsonFeatureCollection } from '../importer/geometry.js';
import { deriveLocationDisplayName } from '../location-display.js';
import { deriveBoundingBox } from './geometry.js';
import type {
  TripPlannerCoordinate,
  TripPlannerMode,
  TripPlannerProvider,
  TripPlannerResolvedLocation,
  TripPlannerRoute,
  TripPlannerSuggestion
} from './types.js';

type GeoapifyClientOptions = {
  apiKey: string;
  fetchFn?: typeof fetch | undefined;
  geocodeCacheTtlMs?: number | undefined;
  now?: (() => number) | undefined;
  requestTimeoutMs?: number | undefined;
  routeCacheTtlMs?: number | undefined;
};

type GeoapifyGeocodeResponse = {
  results?: GeoapifyGeocodeResult[];
};

type GeoapifyGeocodeResult = {
  address_line1?: string;
  formatted?: string;
  lat?: number;
  lon?: number;
  name?: string;
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
const GEOAPIFY_AUTOCOMPLETE_URL = 'https://api.geoapify.com/v1/geocode/autocomplete';
const GEOAPIFY_ROUTING_URL = 'https://api.geoapify.com/v1/routing';
const DEFAULT_GEOAPIFY_REQUEST_TIMEOUT_MS = 8_000;
const DEFAULT_GEOCODE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_ROUTE_CACHE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_SUGGESTION_CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_SUGGESTION_LIMIT = 3;

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

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

const buildAutocompleteUrl = (apiKey: string, query: string) => {
  const params = new URLSearchParams({
    apiKey,
    filter: 'countrycode:fi',
    format: 'json',
    lang: 'fi',
    limit: String(DEFAULT_SUGGESTION_LIMIT),
    text: query
  });

  return `${GEOAPIFY_AUTOCOMPLETE_URL}?${params.toString()}`;
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
    displayName: deriveLocationDisplayName({
      addressLine1: result.address_line1,
      formatted: result.formatted,
      name: result.name
    })!,
    label: result.formatted
  };
};

const normalizeSuggestions = (results?: GeoapifyGeocodeResult[]): TripPlannerSuggestion[] => {
  return (results ?? [])
    .map((result) => normalizeGeocodedLocation(result))
    .filter((result): result is TripPlannerSuggestion => result !== null)
    .slice(0, DEFAULT_SUGGESTION_LIMIT);
};

const normalizeGeocodeCacheKey = (query: string) => {
  return query.trim().replaceAll(/\s+/g, ' ').toLowerCase();
};

const formatCoordinateForCacheKey = ({ lat, lon }: TripPlannerCoordinate) => {
  return `${lat.toFixed(6)},${lon.toFixed(6)}`;
};

const createRouteCacheKey = (
  origin: TripPlannerCoordinate,
  destination: TripPlannerCoordinate,
  mode: TripPlannerMode
) => {
  return `${mode}:${formatCoordinateForCacheKey(origin)}->${formatCoordinateForCacheKey(destination)}`;
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

const isAbortError = (error: unknown) => {
  return error instanceof Error && error.name === 'AbortError';
};

const fetchJson = async <T>(
  fetchFn: typeof fetch,
  url: string,
  requestTimeoutMs: number
): Promise<T | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, requestTimeoutMs);

  try {
    const response = await fetchFn(url, {
      headers: {
        accept: 'application/json'
      },
      signal: controller.signal
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      logger.warn({ status: response.status, url }, 'Geoapify request failed');
      throw new Error(`Geoapify request failed with status ${response.status}`);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (isAbortError(error)) {
      logger.warn({ requestTimeoutMs, url }, 'Geoapify request timed out');
      throw new Error(`Geoapify request timed out after ${requestTimeoutMs} ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const getCachedValue = <T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  now: number
): T | undefined => {
  const cachedEntry = cache.get(key);

  if (!cachedEntry) {
    return undefined;
  }

  if (cachedEntry.expiresAt <= now) {
    cache.delete(key);
    return undefined;
  }

  return cachedEntry.value;
};

const loadWithCache = <T>({
  cache,
  inFlight,
  key,
  load,
  now,
  ttlMs
}: {
  cache: Map<string, CacheEntry<T>>;
  inFlight: Map<string, Promise<T>>;
  key: string;
  load: () => Promise<T>;
  now: () => number;
  ttlMs: number;
}) => {
  const cachedValue = getCachedValue(cache, key, now());

  if (cachedValue !== undefined) {
    return Promise.resolve(cachedValue);
  }

  const pendingRequest = inFlight.get(key);

  if (pendingRequest) {
    return pendingRequest;
  }

  const nextRequest = load()
    .then((value) => {
      cache.set(key, {
        expiresAt: now() + ttlMs,
        value
      });

      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, nextRequest);
  return nextRequest;
};

export const createGeoapifyClient = ({
  apiKey,
  fetchFn = fetch,
  geocodeCacheTtlMs = DEFAULT_GEOCODE_CACHE_TTL_MS,
  now = Date.now,
  requestTimeoutMs = DEFAULT_GEOAPIFY_REQUEST_TIMEOUT_MS,
  routeCacheTtlMs = DEFAULT_ROUTE_CACHE_TTL_MS
}: GeoapifyClientOptions): TripPlannerProvider => {
  const geocodeCache = new Map<string, CacheEntry<TripPlannerResolvedLocation | null>>();
  const geocodeInFlight = new Map<string, Promise<TripPlannerResolvedLocation | null>>();
  const routeCache = new Map<string, CacheEntry<TripPlannerRoute | null>>();
  const routeInFlight = new Map<string, Promise<TripPlannerRoute | null>>();
  const suggestionCache = new Map<string, CacheEntry<TripPlannerSuggestion[]>>();
  const suggestionInFlight = new Map<string, Promise<TripPlannerSuggestion[]>>();

  return {
    geocode: async (query) => {
      return loadWithCache({
        cache: geocodeCache,
        inFlight: geocodeInFlight,
        key: normalizeGeocodeCacheKey(query),
        load: async () => {
          const response = await fetchJson<GeoapifyGeocodeResponse>(
            fetchFn,
            buildGeocodeUrl(apiKey, query.trim()),
            requestTimeoutMs
          );

          return normalizeGeocodedLocation(response?.results?.[0]);
        },
        now,
        ttlMs: geocodeCacheTtlMs
      });
    },
    suggest: async (query) => {
      return loadWithCache({
        cache: suggestionCache,
        inFlight: suggestionInFlight,
        key: normalizeGeocodeCacheKey(query),
        load: async () => {
          const response = await fetchJson<GeoapifyGeocodeResponse>(
            fetchFn,
            buildAutocompleteUrl(apiKey, query.trim()),
            requestTimeoutMs
          );

          return normalizeSuggestions(response?.results);
        },
        now,
        ttlMs: DEFAULT_SUGGESTION_CACHE_TTL_MS
      });
    },
    route: async ({ destination, mode, origin }) => {
      return loadWithCache({
        cache: routeCache,
        inFlight: routeInFlight,
        key: createRouteCacheKey(origin, destination, mode),
        load: async () => {
          const response = await fetchJson<GeoapifyRoutingResponse>(
            fetchFn,
            buildRouteUrl(apiKey, origin, destination, mode),
            requestTimeoutMs
          );

          return normalizeRoute(mode, response?.features?.[0]);
        },
        now,
        ttlMs: routeCacheTtlMs
      });
    }
  };
};
