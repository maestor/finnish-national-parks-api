import type { Database } from '../db/database.js';
import { listTripPlannerCandidateParks } from '../db/repositories.js';
import { isTrailTypeSlug } from '../parks/park-types.js';
import {
  boundingBoxesIntersect,
  expandBoundingBoxByKm,
  getDistanceAlongRouteToPointMeters,
  getRouteDistanceToBoundingBoxMeters,
  getRouteDistanceToFeatureCollectionMeters,
  getRouteDistanceToPointMeters,
  simplifyRouteGeometry,
  toRouteLineString
} from './geometry.js';
import type {
  TripPlannerMode,
  TripPlannerParkCandidate,
  TripPlannerProvider,
  TripPlannerSearchInput,
  TripPlannerSearchResponse,
  TripPlannerService,
  TripPlannerSuggestion
} from './types.js';

export const DEFAULT_TRIP_PLANNER_MAX_DISTANCE_KM = 25;

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

const MAX_UNVISITED_TRAILS = 10;
const NATIONAL_PARK_TYPE_SLUG = 'national-park';
const ROUTE_DISTANCE_SIMPLIFICATION_TOLERANCE_METERS = 100;
const LONG_ROUTE_START_ZONE_MIN_DISTANCE_METERS = 100_000;
const START_ZONE_DISTANCE_LIMIT_METERS = 10_000;
const START_ZONE_LENGTH_METERS = 30_000;

type RankedParkResult = TripPlannerSearchResponse['parks'][number] & {
  distanceAlongRouteMeters: number;
  isInStartZone: boolean;
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

const sortByDistanceAndName = (parks: RankedParkResult[], prioritizeStartZoneLast: boolean) => {
  return [...parks].sort((first, second) => {
    if (prioritizeStartZoneLast && first.isInStartZone !== second.isInStartZone) {
      return Number(first.isInStartZone) - Number(second.isInStartZone);
    }

    if (first.distanceFromRouteKm !== second.distanceFromRouteKm) {
      return first.distanceFromRouteKm - second.distanceFromRouteKm;
    }

    if (
      prioritizeStartZoneLast &&
      first.distanceAlongRouteMeters !== second.distanceAlongRouteMeters
    ) {
      return first.distanceAlongRouteMeters - second.distanceAlongRouteMeters;
    }

    return first.name.localeCompare(second.name);
  });
};

const orderResults = (parks: RankedParkResult[], prioritizeStartZoneLast: boolean) => {
  const unvisitedParks = parks.filter((park) => !park.visitedSummary.visited);
  const visitedParks = parks.filter((park) => park.visitedSummary.visited);
  const unvisitedAreas = unvisitedParks.filter((park) => !isTrailTypeSlug(park.type.slug));
  const unvisitedNationalParks = sortByDistanceAndName(
    unvisitedAreas.filter((park) => park.type.slug === NATIONAL_PARK_TYPE_SLUG),
    prioritizeStartZoneLast
  );
  const otherUnvisitedAreas = sortByDistanceAndName(
    unvisitedAreas.filter((park) => park.type.slug !== NATIONAL_PARK_TYPE_SLUG),
    prioritizeStartZoneLast
  );
  const unvisitedTrails = sortByDistanceAndName(
    unvisitedParks.filter((park) => isTrailTypeSlug(park.type.slug)),
    prioritizeStartZoneLast
  ).slice(0, MAX_UNVISITED_TRAILS);

  return [
    ...unvisitedNationalParks,
    ...otherUnvisitedAreas,
    ...unvisitedTrails,
    ...sortByDistanceAndName(visitedParks, prioritizeStartZoneLast)
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

        const parks = (await listTripPlannerCandidateParks(database))
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
            address: park.address,
            boundingBox: park.boundingBox,
            category: park.category,
            ...(park.displayTypeName ? { displayTypeName: park.displayTypeName } : {}),
            distanceAlongRouteMeters,
            distanceFromRouteKm: roundDistanceKm(distanceFromRouteMeters),
            isInStartZone:
              applyLongRouteStartZoneLogic && distanceAlongRouteMeters <= START_ZONE_LENGTH_METERS,
            locationLabel: park.locationLabel,
            markerPoint: park.markerPoint,
            name: park.name,
            postalCode: park.postalCode,
            postalOffice: park.postalOffice,
            slug: park.slug,
            type: park.type,
            visitedSummary: park.visitedSummary
          }));

        return {
          destination,
          origin,
          parks: orderResults(parks, applyLongRouteStartZoneLogic).map(
            ({
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
    }
  };
};
