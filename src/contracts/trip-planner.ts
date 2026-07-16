import { z } from '@hono/zod-openapi';

import { errorSchema } from './common.js';
import {
  boundingBoxSchema,
  geoJsonLineStringSchema,
  parkCategorySchema,
  parkTypeSchema,
  pointSchema,
  visitedSummarySchema
} from './parks.js';

export const tripPlannerModeSchema = z.enum(['drive']);

export const tripPlannerSearchRequestSchema = z.object({
  destinationQuery: z.string().trim().min(1).max(200),
  maxDistanceKm: z.number().min(1).max(100).optional(),
  mode: tripPlannerModeSchema,
  originQuery: z.string().trim().min(1).max(200)
});

export const tripPlannerLocationSchema = z.object({
  coordinate: pointSchema,
  label: z.string()
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

export const tripPlannerSearchResponseSchema = z.object({
  destination: tripPlannerLocationSchema,
  origin: tripPlannerLocationSchema,
  parks: z.array(tripPlannerParkResultSchema),
  route: tripPlannerRouteSchema
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
