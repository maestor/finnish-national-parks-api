import type { Database } from '../db/database.js';
import { listTripPlannerCandidateParks } from '../db/repositories.js';
import { isTrailTypeSlug } from '../parks/park-types.js';
import {
  boundingBoxesIntersect,
  expandBoundingBoxByKm,
  getDistanceAlongRouteToPointMeters,
  getPointDistanceToBoundingBoxMeters,
  getPointDistanceToFeatureCollectionMeters,
  getRouteDistanceToBoundingBoxMeters,
  getRouteDistanceToFeatureCollectionMeters,
  getRouteDistanceToPointMeters,
  simplifyRouteGeometry,
  toRouteLineString
} from './geometry.js';
import type {
  TripPlannerCoordinate,
  TripPlannerMode,
  TripPlannerNearbySearchInput,
  TripPlannerNearbySearchResponse,
  TripPlannerParkCandidate,
  TripPlannerProvider,
  TripPlannerSearchInput,
  TripPlannerSearchResponse,
  TripPlannerService,
  TripPlannerSuggestion
} from './types.js';

export const DEFAULT_TRIP_PLANNER_MAX_DISTANCE_KM = 25;
export const DEFAULT_TRIP_PLANNER_NEARBY_DISTANCE_KM = 10;

type TripPlannerErrorCode =
  | 'destination_not_found'
  | 'origin_not_found'
  | 'provider_unavailable'
  | 'route_not_found'
  | 'trip_planner_not_configured';

type CreateTripPlannerServiceOptions = {
  database: Database;
  provider: TripPlannerProvider;
};

export class TripPlannerError extends Error {
  code: TripPlannerErrorCode;
  status: 422 | 503;

  constructor(code: TripPlannerErrorCode, message: string, status: 422 | 503) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const roundDistanceKm = (distanceMeters: number) => {
  return Math.round((distanceMeters / 1000) * 10) / 10;
};

const getDefaultDistanceKm = (distanceMeters: number, maxDistanceKm: number) => {
  return Math.min(maxDistanceKm, Math.max(1, Math.ceil(distanceMeters / 1000)));
};

const MAX_UNVISITED_TRAILS = 10;
const NATIONAL_PARK_TYPE_SLUG = 'national-park';
const ROUTE_DISTANCE_SIMPLIFICATION_TOLERANCE_METERS = 100;
const LONG_ROUTE_START_ZONE_MIN_DISTANCE_METERS = 100_000;
const START_ZONE_DISTANCE_LIMIT_METERS = 10_000;
const START_ZONE_LENGTH_METERS = 30_000;

type RankedParkResult = TripPlannerSearchResponse['parks'][number] & {
  distanceKm: number;
  distanceAlongRouteMeters: number;
  isInStartZone: boolean;
};

type RankedNearbyParkResult = TripPlannerNearbySearchResponse['parks'][number] & {
  distanceKm: number;
  distanceMeters: number;
};

type OrderableParkResult = {
  name: string;
  type: {
    slug: string;
  };
  visitedSummary: {
    visited: boolean;
  };
};

type OrderResultsOptions<T> = {
  getDistanceAlongRouteMeters?: ((park: T) => number) | undefined;
  getDistanceKm: (park: T) => number;
  getIsInStartZone?: ((park: T) => boolean) | undefined;
  prioritizeStartZoneLast: boolean;
};

const getDistanceFromRouteMeters = (
  route: Parameters<typeof getRouteDistanceToFeatureCollectionMeters>[0],
  park: TripPlannerParkCandidate
) => {
  if (park.boundaryGeoJson) {
    return getRouteDistanceToFeatureCollectionMeters(route, park.boundaryGeoJson);
  }

  const boundingBoxDistance = getRouteDistanceToBoundingBoxMeters(route, park.boundingBox);

  if (Number.isFinite(boundingBoxDistance)) {
    return boundingBoxDistance;
  }

  return getRouteDistanceToPointMeters(route, park.markerPoint);
};

const createPointBoundingBox = (point: TripPlannerCoordinate) => ({
  maxLat: point.lat,
  maxLon: point.lon,
  minLat: point.lat,
  minLon: point.lon
});

const getDistanceFromOriginMeters = (
  origin: TripPlannerCoordinate,
  park: TripPlannerParkCandidate
) => {
  if (park.boundaryGeoJson) {
    return getPointDistanceToFeatureCollectionMeters(origin, park.boundaryGeoJson);
  }

  const boundingBoxDistance = getPointDistanceToBoundingBoxMeters(origin, park.boundingBox);

  if (Number.isFinite(boundingBoxDistance)) {
    return boundingBoxDistance;
  }

  return getPointDistanceToBoundingBoxMeters(origin, createPointBoundingBox(park.markerPoint));
};

const sortByDistanceAndName = <T extends { name: string }>(
  parks: T[],
  {
    getDistanceAlongRouteMeters,
    getDistanceKm,
    getIsInStartZone,
    prioritizeStartZoneLast
  }: OrderResultsOptions<T>
) => {
  return [...parks].sort((first, second) => {
    const firstIsInStartZone = getIsInStartZone?.(first) ?? false;
    const secondIsInStartZone = getIsInStartZone?.(second) ?? false;

    if (prioritizeStartZoneLast && firstIsInStartZone !== secondIsInStartZone) {
      return Number(firstIsInStartZone) - Number(secondIsInStartZone);
    }

    const firstDistanceKm = getDistanceKm(first);
    const secondDistanceKm = getDistanceKm(second);

    if (firstDistanceKm !== secondDistanceKm) {
      return firstDistanceKm - secondDistanceKm;
    }

    const firstDistanceAlongRouteMeters = getDistanceAlongRouteMeters?.(first);
    const secondDistanceAlongRouteMeters = getDistanceAlongRouteMeters?.(second);

    if (
      prioritizeStartZoneLast &&
      firstDistanceAlongRouteMeters !== undefined &&
      secondDistanceAlongRouteMeters !== undefined &&
      firstDistanceAlongRouteMeters !== secondDistanceAlongRouteMeters
    ) {
      return firstDistanceAlongRouteMeters - secondDistanceAlongRouteMeters;
    }

    return first.name.localeCompare(second.name);
  });
};

const orderResults = <T extends OrderableParkResult>(
  parks: T[],
  options: OrderResultsOptions<T>
) => {
  const unvisitedParks = parks.filter((park) => !park.visitedSummary.visited);
  const visitedParks = parks.filter((park) => park.visitedSummary.visited);
  const unvisitedAreas = unvisitedParks.filter((park) => !isTrailTypeSlug(park.type.slug));
  const unvisitedNationalParks = sortByDistanceAndName(
    unvisitedAreas.filter((park) => park.type.slug === NATIONAL_PARK_TYPE_SLUG),
    options
  );
  const otherUnvisitedAreas = sortByDistanceAndName(
    unvisitedAreas.filter((park) => park.type.slug !== NATIONAL_PARK_TYPE_SLUG),
    options
  );
  const unvisitedTrails = sortByDistanceAndName(
    unvisitedParks.filter((park) => isTrailTypeSlug(park.type.slug)),
    options
  ).slice(0, MAX_UNVISITED_TRAILS);

  return [
    ...unvisitedNationalParks,
    ...otherUnvisitedAreas,
    ...unvisitedTrails,
    ...sortByDistanceAndName(visitedParks, options)
  ];
};

const assertModeSupported = (mode: TripPlannerMode) => {
  if (mode !== 'drive') {
    throw new TripPlannerError('provider_unavailable', 'Unsupported travel mode.', 503);
  }
};

const createProviderUnavailableError = () => {
  return new TripPlannerError('provider_unavailable', 'Trip planner provider is unavailable.', 503);
};

const suggestLocations = async (
  provider: TripPlannerProvider,
  query: string
): Promise<TripPlannerSuggestion[]> => {
  try {
    return await provider.suggest(query);
  } catch (error) {
    if (error instanceof TripPlannerError) {
      throw error;
    }

    throw createProviderUnavailableError();
  }
};

const mapParkBaseResult = (park: TripPlannerParkCandidate) => ({
  address: park.address,
  boundingBox: park.boundingBox,
  category: park.category,
  ...(park.displayTypeName ? { displayTypeName: park.displayTypeName } : {}),
  locationLabel: park.locationLabel,
  markerPoint: park.markerPoint,
  name: park.name,
  postalCode: park.postalCode,
  postalOffice: park.postalOffice,
  slug: park.slug,
  type: park.type,
  visitedSummary: park.visitedSummary
});

export const createTripPlannerService = ({
  database,
  provider
}: CreateTripPlannerServiceOptions): TripPlannerService => {
  return {
    suggest: async (query) => {
      return suggestLocations(provider, query);
    },
    search: async ({
      destinationQuery,
      maxDistanceKm = DEFAULT_TRIP_PLANNER_MAX_DISTANCE_KM,
      mode,
      originQuery
    }: TripPlannerSearchInput) => {
      assertModeSupported(mode);

      try {
        const [origin, destination] = await Promise.all([
          provider.geocode(originQuery),
          provider.geocode(destinationQuery)
        ]);

        if (!origin) {
          throw new TripPlannerError('origin_not_found', 'Origin was not found.', 422);
        }

        if (!destination) {
          throw new TripPlannerError('destination_not_found', 'Destination was not found.', 422);
        }

        const route = await provider.route({
          destination: destination.coordinate,
          mode,
          origin: origin.coordinate
        });

        if (!route) {
          throw new TripPlannerError('route_not_found', 'Route was not found.', 422);
        }

        const candidateBoundingBox = expandBoundingBoxByKm(route.boundingBox, maxDistanceKm);
        const maxDistanceMeters = maxDistanceKm * 1000;
        const defaultDistanceKm = getDefaultDistanceKm(route.distanceMeters, maxDistanceKm);
        const routeGeometry = simplifyRouteGeometry(
          route.geometry,
          ROUTE_DISTANCE_SIMPLIFICATION_TOLERANCE_METERS
        );
        const routeLineString = toRouteLineString(routeGeometry);
        const applyLongRouteStartZoneLogic =
          route.distanceMeters >= LONG_ROUTE_START_ZONE_MIN_DISTANCE_METERS;

        if (!routeLineString) {
          throw new TripPlannerError('route_not_found', 'Route was not found.', 422);
        }

        const parks: RankedParkResult[] = (await listTripPlannerCandidateParks(database))
          .filter((park) => boundingBoxesIntersect(candidateBoundingBox, park.boundingBox))
          .map((park) => ({
            distanceAlongRouteMeters: getDistanceAlongRouteToPointMeters(
              routeLineString,
              park.markerPoint
            ),
            distanceFromRouteMeters: getDistanceFromRouteMeters(routeGeometry, park),
            park
          }))
          .filter(({ distanceAlongRouteMeters, distanceFromRouteMeters }) => {
            const isInStartZone =
              applyLongRouteStartZoneLogic && distanceAlongRouteMeters <= START_ZONE_LENGTH_METERS;
            const effectiveMaxDistanceMeters = isInStartZone
              ? Math.min(maxDistanceMeters, START_ZONE_DISTANCE_LIMIT_METERS)
              : maxDistanceMeters;

            return distanceFromRouteMeters <= effectiveMaxDistanceMeters;
          })
          .map(({ distanceAlongRouteMeters, distanceFromRouteMeters, park }) => ({
            ...mapParkBaseResult(park),
            distanceKm: roundDistanceKm(distanceFromRouteMeters),
            distanceAlongRouteMeters,
            distanceFromRouteKm: roundDistanceKm(distanceFromRouteMeters),
            isInStartZone:
              applyLongRouteStartZoneLogic && distanceAlongRouteMeters <= START_ZONE_LENGTH_METERS
          }));

        return {
          defaultDistanceKm,
          destination,
          maxDistanceKm,
          origin,
          parks: orderResults(parks, {
            getDistanceAlongRouteMeters: (park) => park.distanceAlongRouteMeters,
            getDistanceKm: (park) => park.distanceKm,
            getIsInStartZone: (park) => park.isInStartZone,
            prioritizeStartZoneLast: applyLongRouteStartZoneLogic
          }).map(
            ({
              distanceKm: _distanceKm,
              distanceAlongRouteMeters: _distanceAlongRouteMeters,
              isInStartZone: _isInStartZone,
              ...park
            }) => park
          ),
          route: {
            boundingBox: route.boundingBox,
            distanceMeters: route.distanceMeters,
            durationSeconds: route.durationSeconds,
            geometry: routeLineString,
            mode: route.mode
          }
        };
      } catch (error) {
        if (error instanceof TripPlannerError) {
          throw error;
        }

        throw createProviderUnavailableError();
      }
    },
    searchNearby: async ({
      maxDistanceKm = DEFAULT_TRIP_PLANNER_MAX_DISTANCE_KM,
      originQuery
    }: TripPlannerNearbySearchInput) => {
      try {
        const origin = await provider.geocode(originQuery);

        if (!origin) {
          throw new TripPlannerError('origin_not_found', 'Origin was not found.', 422);
        }

        const searchAreaBoundingBox = expandBoundingBoxByKm(
          createPointBoundingBox(origin.coordinate),
          maxDistanceKm
        );
        const maxDistanceMeters = maxDistanceKm * 1000;
        const parks: RankedNearbyParkResult[] = (await listTripPlannerCandidateParks(database))
          .filter((park) => boundingBoxesIntersect(searchAreaBoundingBox, park.boundingBox))
          .map((park) => {
            const distanceMeters = getDistanceFromOriginMeters(origin.coordinate, park);
            const distanceFromOriginKm = roundDistanceKm(distanceMeters);

            return {
              ...mapParkBaseResult(park),
              distanceMeters,
              distanceFromOriginKm,
              distanceKm: distanceFromOriginKm
            };
          })
          .filter((park) => park.distanceMeters <= maxDistanceMeters);

        return {
          defaultDistanceKm: Math.min(maxDistanceKm, DEFAULT_TRIP_PLANNER_NEARBY_DISTANCE_KM),
          maxDistanceKm,
          origin,
          parks: orderResults(parks, {
            getDistanceKm: (park) => park.distanceKm,
            prioritizeStartZoneLast: false
          }).map(({ distanceKm: _distanceKm, distanceMeters: _distanceMeters, ...park }) => park),
          searchArea: {
            boundingBox: searchAreaBoundingBox,
            center: origin.coordinate,
            maxDistanceKm
          }
        };
      } catch (error) {
        if (error instanceof TripPlannerError) {
          throw error;
        }

        throw createProviderUnavailableError();
      }
    }
  };
};
