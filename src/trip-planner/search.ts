import type { Database } from '../db/database.js';
import { listTripPlannerCandidateParks } from '../db/repositories.js';
import type { SupportedParkTypeSlug } from '../parks/park-types.js';
import { isTrailTypeSlug } from '../parks/park-types.js';
import {
  boundingBoxesIntersect,
  expandBoundingBoxByKm,
  getRouteDistanceToBoundingBoxMeters,
  getRouteDistanceToFeatureCollectionMeters,
  getRouteDistanceToPointMeters,
  simplifyRouteGeometry
} from './geometry.js';
import type {
  TripPlannerMode,
  TripPlannerParkCandidate,
  TripPlannerProvider,
  TripPlannerSearchInput,
  TripPlannerSearchResponse,
  TripPlannerService
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
const ROUTE_DISTANCE_SIMPLIFICATION_TOLERANCE_METERS = 100;
const areaTypePriority: Record<
  Exclude<SupportedParkTypeSlug, 'walking-trail' | 'nature-trail' | 'hiking-trail'>,
  number
> = {
  'cultural-history-area': 4,
  'hiking-area': 2,
  'national-park': 1,
  'nature-reserve-area': 6,
  'outdoor-recreation-area': 5,
  'wilderness-area': 3
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

const sortByDistanceAndName = (parks: TripPlannerSearchResponse['parks']) => {
  return [...parks].sort((first, second) => {
    if (first.distanceFromRouteKm !== second.distanceFromRouteKm) {
      return first.distanceFromRouteKm - second.distanceFromRouteKm;
    }

    return first.name.localeCompare(second.name);
  });
};

const sortAreasByPriorityDistanceAndName = (parks: TripPlannerSearchResponse['parks']) => {
  return [...parks].sort((first, second) => {
    const priorityDifference =
      areaTypePriority[first.type.slug as keyof typeof areaTypePriority] -
      areaTypePriority[second.type.slug as keyof typeof areaTypePriority];

    if (priorityDifference !== 0) {
      return priorityDifference;
    }

    if (first.distanceFromRouteKm !== second.distanceFromRouteKm) {
      return first.distanceFromRouteKm - second.distanceFromRouteKm;
    }

    return first.name.localeCompare(second.name);
  });
};

const orderResults = (parks: TripPlannerSearchResponse['parks']) => {
  const unvisitedParks = parks.filter((park) => !park.visitedSummary.visited);
  const visitedParks = parks.filter((park) => park.visitedSummary.visited);
  const unvisitedAreas = sortAreasByPriorityDistanceAndName(
    unvisitedParks.filter((park) => !isTrailTypeSlug(park.type.slug))
  );
  const unvisitedTrails = sortByDistanceAndName(
    unvisitedParks.filter((park) => isTrailTypeSlug(park.type.slug))
  ).slice(0, MAX_UNVISITED_TRAILS);

  return [...unvisitedAreas, ...unvisitedTrails, ...sortByDistanceAndName(visitedParks)];
};

const assertModeSupported = (mode: TripPlannerMode) => {
  if (mode !== 'drive') {
    throw new TripPlannerError('provider_unavailable', 'Unsupported travel mode.', 503);
  }
};

export const createTripPlannerService = ({
  database,
  provider
}: CreateTripPlannerServiceOptions): TripPlannerService => {
  return {
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
        const parks = (await listTripPlannerCandidateParks(database))
          .filter((park) => boundingBoxesIntersect(candidateBoundingBox, park.boundingBox))
          .map((park) => ({
            distanceFromRouteMeters: getDistanceFromRouteMeters(routeGeometry, park),
            park
          }))
          .filter(({ distanceFromRouteMeters }) => distanceFromRouteMeters <= maxDistanceMeters)
          .map(({ distanceFromRouteMeters, park }) => ({
            address: park.address,
            category: park.category,
            ...(park.displayTypeName ? { displayTypeName: park.displayTypeName } : {}),
            distanceFromRouteKm: roundDistanceKm(distanceFromRouteMeters),
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
          parks: orderResults(parks),
          route: {
            distanceMeters: route.distanceMeters,
            durationSeconds: route.durationSeconds,
            mode: route.mode
          }
        };
      } catch (error) {
        if (error instanceof TripPlannerError) {
          throw error;
        }

        throw new TripPlannerError(
          'provider_unavailable',
          'Trip planner provider is unavailable.',
          503
        );
      }
    }
  };
};
