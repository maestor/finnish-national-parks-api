import { logger } from '../http/logger.js';
import type { GeoJsonCoordinate, GeoJsonFeatureCollection } from '../importer/geometry.js';
import { deriveLocationDisplayName } from '../location-display.js';
import { type BoundedTtlCache, createBoundedTtlCache } from './bounded-cache.js';
import { createConcurrencyLimiter } from './concurrency.js';
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
  geocodeCacheMaxEntries?: number | undefined;
  geocodeCacheTtlMs?: number | undefined;
  maxConcurrentRequests?: number | undefined;
  now?: (() => number) | undefined;
  requestTimeoutMs?: number | undefined;
  routeCacheMaxBytes?: number | undefined;
  routeCacheMaxEntries?: number | undefined;
  routeCacheTtlMs?: number | undefined;
  suggestionCacheMaxEntries?: number | undefined;
  providerAdmission?: ((operation: GeoapifyOperation) => Promise<void>) | undefined;
};

const GEOAPIFY_GEOCODE_URL = 'https://api.geoapify.com/v1/geocode/search';
const GEOAPIFY_AUTOCOMPLETE_URL = 'https://api.geoapify.com/v1/geocode/autocomplete';
const GEOAPIFY_ROUTING_URL = 'https://api.geoapify.com/v1/routing';
const DEFAULT_GEOAPIFY_REQUEST_TIMEOUT_MS = 8_000;
const DEFAULT_GEOCODE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_ROUTE_CACHE_TTL_MS = 30 * 60 * 1000;
const DEFAULT_SUGGESTION_CACHE_TTL_MS = 60 * 60 * 1000;
const DEFAULT_GEOCODE_CACHE_MAX_ENTRIES = 256;
const DEFAULT_ROUTE_CACHE_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_ROUTE_CACHE_MAX_ENTRIES = 64;
const DEFAULT_SUGGESTION_CACHE_MAX_ENTRIES = 256;
const DEFAULT_MAX_CONCURRENT_REQUESTS = 8;
const DEFAULT_SUGGESTION_LIMIT = 3;
const GEOAPIFY_NORDIC_COUNTRY_CODES = 'countrycode:fi,se,no';

type GeoapifyOperation = 'geocode' | 'route' | 'suggest';

const buildGeocodeUrl = (apiKey: string, query: string) => {
  const params = new URLSearchParams({
    apiKey,
    bias: GEOAPIFY_NORDIC_COUNTRY_CODES,
    filter: GEOAPIFY_NORDIC_COUNTRY_CODES,
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
    bias: GEOAPIFY_NORDIC_COUNTRY_CODES,
    filter: GEOAPIFY_NORDIC_COUNTRY_CODES,
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

const readRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;

const firstEntry = (value: unknown): unknown => readRecord(value)?.[0];

const readOptionalLabel = (value: unknown): string | undefined => {
  if (value == null || typeof value === 'string') {
    return value ?? undefined;
  }

  throw new TypeError('Geoapify location label must be a string.');
};

const normalizeGeocodedLocation = (value: unknown): TripPlannerResolvedLocation | null => {
  const result = readRecord(value);
  if (!result) {
    return null;
  }

  const { formatted, lat, lon } = result;
  if (!formatted || typeof lat !== 'number' || typeof lon !== 'number') {
    return null;
  }

  const label = readOptionalLabel(formatted)!;
  return {
    coordinate: { lat, lon },
    displayName: deriveLocationDisplayName({
      addressLine1: readOptionalLabel(result.address_line1),
      formatted: label,
      name: readOptionalLabel(result.name)
    })!,
    label
  };
};

const normalizeSuggestions = (results: unknown): TripPlannerSuggestion[] => {
  if (results == null) {
    return [];
  }

  if (!Array.isArray(results)) {
    throw new TypeError('Geoapify autocomplete results must be an array.');
  }

  return results
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

const normalizeRouteGeometry = (coordinates: unknown): GeoJsonFeatureCollection | null => {
  if (!coordinates || readRecord(coordinates)?.length === 0) {
    return null;
  }

  if (!Array.isArray(coordinates)) {
    throw new TypeError('Geoapify routing coordinates must be an array.');
  }

  const features: GeoJsonFeatureCollection['features'] = [];
  for (const line of coordinates) {
    if (!Array.isArray(line)) {
      // The provider's short-line filter also ignored entries without a usable length.
      const length = typeof line === 'string' ? line.length : readRecord(line)?.length;
      if (line == null || Number(length) >= 2) {
        throw new TypeError('Geoapify routing lines must be arrays.');
      }
      continue;
    }

    if (line.length >= 2) {
      features.push({
        geometry: {
          // Rejecting incomplete pairs changes the planner response and requires separate review.
          coordinates: (line as number[][]).map(([lon, lat]) => [lon, lat] as GeoJsonCoordinate),
          type: 'LineString'
        },
        type: 'Feature'
      });
    }
  }

  return features.length === 0 ? null : { features, type: 'FeatureCollection' };
};

const normalizeRoute = (mode: TripPlannerMode, value: unknown): TripPlannerRoute | null => {
  const feature = readRecord(value);
  const geometry = normalizeRouteGeometry(readRecord(feature?.geometry)?.coordinates);
  const properties = readRecord(feature?.properties);
  const distanceMeters = properties?.distance;
  const durationSeconds = properties?.time;

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

const estimateSerializedBytes = (value: unknown) => {
  const serialized = JSON.stringify(value)!;
  return new TextEncoder().encode(serialized).byteLength;
};

const fetchJson = async (
  fetchFn: typeof fetch,
  url: string,
  requestTimeoutMs: number,
  operation: GeoapifyOperation,
  now: () => number
): Promise<unknown> => {
  const controller = new AbortController();
  const startedAt = now();
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
      logger.warn(
        {
          durationMs: now() - startedAt,
          errorCategory: 'http_error',
          operation,
          status: response.status
        },
        'Geoapify request failed'
      );
      throw new Error(`Geoapify request failed with status ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    if (isAbortError(error)) {
      logger.warn(
        {
          durationMs: now() - startedAt,
          errorCategory: 'timeout',
          operation,
          requestTimeoutMs
        },
        'Geoapify request timed out'
      );
      throw new Error(`Geoapify request timed out after ${requestTimeoutMs} ms`);
    }

    logger.warn(
      {
        durationMs: now() - startedAt,
        errorCategory: 'unexpected_error',
        operation
      },
      'Geoapify request failed unexpectedly'
    );
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const loadWithCache = <T>({
  cache,
  inFlight,
  key,
  load,
  ttlMs
}: {
  cache: BoundedTtlCache<T>;
  inFlight: Map<string, Promise<T>>;
  key: string;
  load: () => Promise<T>;
  ttlMs: number;
}) => {
  const cachedValue = cache.get(key);

  if (cachedValue !== undefined) {
    return Promise.resolve(cachedValue);
  }

  const pendingRequest = inFlight.get(key);

  if (pendingRequest) {
    return pendingRequest;
  }

  const nextRequest = load()
    .then((value) => {
      cache.set(key, value, ttlMs);

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
  geocodeCacheMaxEntries = DEFAULT_GEOCODE_CACHE_MAX_ENTRIES,
  geocodeCacheTtlMs = DEFAULT_GEOCODE_CACHE_TTL_MS,
  maxConcurrentRequests = DEFAULT_MAX_CONCURRENT_REQUESTS,
  now = Date.now,
  requestTimeoutMs = DEFAULT_GEOAPIFY_REQUEST_TIMEOUT_MS,
  routeCacheMaxBytes = DEFAULT_ROUTE_CACHE_MAX_BYTES,
  routeCacheMaxEntries = DEFAULT_ROUTE_CACHE_MAX_ENTRIES,
  routeCacheTtlMs = DEFAULT_ROUTE_CACHE_TTL_MS,
  suggestionCacheMaxEntries = DEFAULT_SUGGESTION_CACHE_MAX_ENTRIES,
  providerAdmission
}: GeoapifyClientOptions): TripPlannerProvider => {
  const geocodeCache = createBoundedTtlCache<TripPlannerResolvedLocation | null>({
    maxEntries: geocodeCacheMaxEntries,
    now
  });
  const geocodeInFlight = new Map<string, Promise<TripPlannerResolvedLocation | null>>();
  const routeCache = createBoundedTtlCache<TripPlannerRoute | null>({
    estimateBytes: estimateSerializedBytes,
    maxBytes: routeCacheMaxBytes,
    maxEntries: routeCacheMaxEntries,
    now
  });
  const routeInFlight = new Map<string, Promise<TripPlannerRoute | null>>();
  const suggestionCache = createBoundedTtlCache<TripPlannerSuggestion[]>({
    maxEntries: suggestionCacheMaxEntries,
    now
  });
  const suggestionInFlight = new Map<string, Promise<TripPlannerSuggestion[]>>();
  const runProviderRequest = createConcurrencyLimiter(maxConcurrentRequests);
  const runPaidProviderRequest = <T>(operation: GeoapifyOperation, request: () => Promise<T>) => {
    return runProviderRequest(async () => {
      await providerAdmission?.(operation);
      return request();
    });
  };

  return {
    geocode: async (query) => {
      return loadWithCache({
        cache: geocodeCache,
        inFlight: geocodeInFlight,
        key: normalizeGeocodeCacheKey(query),
        load: () =>
          runPaidProviderRequest('geocode', async () => {
            const response = await fetchJson(
              fetchFn,
              buildGeocodeUrl(apiKey, query.trim()),
              requestTimeoutMs,
              'geocode',
              now
            );

            return normalizeGeocodedLocation(firstEntry(readRecord(response)?.results));
          }),
        ttlMs: geocodeCacheTtlMs
      });
    },
    suggest: async (query) => {
      return loadWithCache({
        cache: suggestionCache,
        inFlight: suggestionInFlight,
        key: normalizeGeocodeCacheKey(query),
        load: () =>
          runPaidProviderRequest('suggest', async () => {
            const response = await fetchJson(
              fetchFn,
              buildAutocompleteUrl(apiKey, query.trim()),
              requestTimeoutMs,
              'suggest',
              now
            );

            return normalizeSuggestions(readRecord(response)?.results);
          }),
        ttlMs: DEFAULT_SUGGESTION_CACHE_TTL_MS
      });
    },
    route: async ({ destination, mode, origin }) => {
      return loadWithCache({
        cache: routeCache,
        inFlight: routeInFlight,
        key: createRouteCacheKey(origin, destination, mode),
        load: () =>
          runPaidProviderRequest('route', async () => {
            const response = await fetchJson(
              fetchFn,
              buildRouteUrl(apiKey, origin, destination, mode),
              requestTimeoutMs,
              'route',
              now
            );

            return normalizeRoute(mode, firstEntry(readRecord(response)?.features));
          }),
        ttlMs: routeCacheTtlMs
      });
    }
  };
};
