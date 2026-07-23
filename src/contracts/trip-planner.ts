import { z } from '@hono/zod-openapi';

import { errorSchema } from './common.js';
import {
  boundingBoxSchema,
  geoJsonLineStringSchema,
  labeledPointSchema,
  parkCategorySchema,
  parkTypeSchema,
  pointSchema,
  visitedSummarySchema
} from './parks.js';

export const tripPlannerModeSchema = z.enum(['drive']);

export const tripPlannerSuggestionsRequestSchema = z.object({
  query: z.string().trim().min(2).max(200)
});

export const tripPlannerSearchRequestSchema = z.object({
  destinationQuery: z.string().trim().min(1).max(200),
  maxDistanceKm: z.number().min(1).max(100).optional(),
  mode: tripPlannerModeSchema,
  originQuery: z.string().trim().min(1).max(200)
});

export const tripPlannerNearbyRequestSchema = z.object({
  maxDistanceKm: z.number().min(1).max(100).optional(),
  originQuery: z.string().trim().min(1).max(200)
});

export const tripPlannerLocationSchema = labeledPointSchema;

export const tripPlannerSuggestionsResponseSchema = z.object({
  suggestions: z.array(tripPlannerLocationSchema)
});

export const tripPlannerRouteSchema = z.object({
  boundingBox: boundingBoxSchema,
  distanceMeters: z.number().nonnegative(),
  durationSeconds: z.number().nonnegative(),
  geometry: geoJsonLineStringSchema,
  mode: tripPlannerModeSchema
});

export const tripPlannerParkResultSchema = z.object({
  address: z.string(),
  boundingBox: boundingBoxSchema,
  category: parkCategorySchema,
  displayTypeName: z.string().nullable().optional(),
  distanceFromRouteKm: z.number().nonnegative(),
  locationLabel: z.string(),
  markerPoint: pointSchema,
  name: z.string(),
  postalCode: z.string().nullable(),
  postalOffice: z.string().nullable(),
  slug: z.string(),
  type: parkTypeSchema,
  visitedSummary: visitedSummarySchema
});

export const tripPlannerNearbyParkResultSchema = tripPlannerParkResultSchema
  .omit({ distanceFromRouteKm: true })
  .extend({
    distanceFromOriginKm: z.number().nonnegative()
  });

export const tripPlannerSearchAreaSchema = z.object({
  boundingBox: boundingBoxSchema,
  center: pointSchema,
  maxDistanceKm: z.number().min(1).max(100)
});

export const tripPlannerSearchResponseSchema = z.object({
  defaultDistanceKm: z.number().min(1).max(100),
  destination: tripPlannerLocationSchema,
  maxDistanceKm: z.number().min(1).max(100),
  origin: tripPlannerLocationSchema,
  parks: z.array(tripPlannerParkResultSchema),
  route: tripPlannerRouteSchema
});

export const tripPlannerNearbyResponseSchema = z.object({
  defaultDistanceKm: z.number().min(1).max(100),
  maxDistanceKm: z.number().min(1).max(100),
  origin: tripPlannerLocationSchema,
  parks: z.array(tripPlannerNearbyParkResultSchema),
  searchArea: tripPlannerSearchAreaSchema
});

export const tripPlannerErrorCodeSchema = z.enum([
  'destination_not_found',
  'origin_not_found',
  'provider_unavailable',
  'route_not_found',
  'trip_planner_not_configured'
]);

export const tripPlannerErrorSchema = errorSchema.extend({
  errorCode: tripPlannerErrorCodeSchema
});
