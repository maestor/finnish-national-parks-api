import type { Database } from '../db/database.js';
import { listTripPlannerCandidateParks } from '../db/repositories.js';
import {
  boundingBoxesIntersect,
  expandBoundingBoxByKm,
  getRouteDistanceToBoundingBoxMeters,
  getRouteDistanceToFeatureCollectionMeters,
  getRouteDistanceToPointMeters
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

const sortResults = (parks: TripPlannerSearchResponse['parks']) => {
  return [...parks].sort((first, second) => {
    if (first.visitedSummary.visited !== second.visitedSummary.visited) {
      return Number(first.visitedSummary.visited) - Number(second.visitedSummary.visited);
    }

    if (first.distanceFromRouteKm !== second.distanceFromRouteKm) {
      return first.distanceFromRouteKm - second.distanceFromRouteKm;
    }

    return first.name.localeCompare(second.name);
  });
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
        const origin = await provider.geocode(originQuery);

        if (!origin) {
          throw new TripPlannerError('origin_not_found', 'Origin was not found.', 422);
        }

        const destination = await provider.geocode(destinationQuery);

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
        const parks = (await listTripPlannerCandidateParks(database))
          .filter((park) => boundingBoxesIntersect(candidateBoundingBox, park.boundingBox))
          .map((park) => ({
            distanceFromRouteMeters: getDistanceFromRouteMeters(route.geometry, park),
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
          parks: sortResults(parks),
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
