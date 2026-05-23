import { z } from '@hono/zod-openapi';

import { supportedParkTypeSlugs } from '../parks/park-types.js';

export const parkTypeSchema = z.object({
  code: z.number().int(),
  id: z.number().int(),
  name: z.string(),
  slug: z.enum(supportedParkTypeSlugs)
});

export const pointSchema = z.object({
  lat: z.number(),
  lon: z.number()
});

export const boundingBoxSchema = z.object({
  maxLat: z.number(),
  maxLon: z.number(),
  minLat: z.number(),
  minLon: z.number()
});

export const geoJsonPolygonSchema = z.object({
  coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))),
  type: z.literal('Polygon')
});

export const geoJsonFeatureCollectionSchema = z.object({
  features: z.array(
    z.object({
      geometry: geoJsonPolygonSchema,
      type: z.literal('Feature')
    })
  ),
  type: z.literal('FeatureCollection')
});

export const parkListItemSchema = z.object({
  areaKm2: z.number().nullable(),
  boundingBox: boundingBoxSchema,
  establishmentYear: z.number().int().nullable(),
  locationLabel: z.string(),
  luontoonUrl: z.string().nullable(),
  markerPoint: pointSchema,
  name: z.string(),
  slug: z.string(),
  type: parkTypeSchema
});

export const parkDetailSchema = parkListItemSchema.extend({
  boundaryGeoJson: geoJsonFeatureCollectionSchema.optional(),
  catalogStatus: z.enum(['active', 'inactive']),
  lipasId: z.number().int(),
  municipalityCode: z.number().int().nullable(),
  postalOffice: z.string().nullable(),
  sourceEventDate: z.string().datetime().nullable(),
  updatedAt: z.string()
});

export const visitImageSchema = z.object({
  id: z.number().int(),
  fullUrl: z.string().url(),
  thumbUrl: z.string().url(),
  fullWidth: z.number().int().nullable(),
  fullHeight: z.number().int().nullable(),
  thumbWidth: z.number().int().nullable(),
  thumbHeight: z.number().int().nullable(),
  originalName: z.string().nullable(),
  displayOrder: z.number().int(),
  createdAt: z.string()
});

export const visitSchema = z.object({
  author: z.string().nullable(),
  createdAt: z.string(),
  id: z.number().int(),
  images: z.array(visitImageSchema),
  note: z.string().nullable(),
  route: z.string().nullable(),
  updatedAt: z.string(),
  visitedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

export const visitedSummarySchema = z.object({
  lastVisitedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  visitCount: z.number().int(),
  visited: z.boolean()
});

export const parkVisitsResponseSchema = z.object({
  visitedSummary: visitedSummarySchema,
  visits: z.array(visitSchema)
});

export const visitParkSchema = z.object({
  name: z.string(),
  slug: z.string()
});

export const visitWithParkSchema = visitSchema.extend({
  park: visitParkSchema
});

export const publicVisitVersionSchema = z.object({
  updatedAt: z.string().datetime().nullable(),
  version: z.number().int().nonnegative()
});

export const publicTypeProgressSchema = z.object({
  totalParks: z.number().int(),
  totalVisits: z.number().int(),
  type: parkTypeSchema,
  visitedParks: z.number().int()
});

export const publicMostVisitedParkSchema = z.object({
  lastVisitedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  park: visitParkSchema,
  visitCount: z.number().int()
});

export const publicRecentParkVisitSchema = z.object({
  park: visitParkSchema,
  visitedSummary: visitedSummarySchema
});

export const publicVisitEntrySchema = z.object({
  createdAt: z.string().datetime(),
  id: z.number().int(),
  park: visitParkSchema,
  updatedAt: z.string().datetime(),
  visitedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

export const publicHomeSummaryResponseSchema = publicVisitVersionSchema.extend({
  latestVisitEntries: z.array(publicVisitEntrySchema),
  mostVisitedParks: z.array(publicMostVisitedParkSchema),
  progressByType: z.array(publicTypeProgressSchema),
  recentVisits: z.array(publicRecentParkVisitSchema),
  totalVisits: z.number().int(),
  uniqueVisitedParks: z.number().int()
});

export const publicMapParkSchema = parkListItemSchema.extend({
  visitedSummary: visitedSummarySchema
});

export const publicMapSummaryResponseSchema = publicVisitVersionSchema.extend({
  parks: z.array(publicMapParkSchema)
});

export const parkListResponseSchema = z.object({
  parks: z.array(parkListItemSchema)
});

export const visitListResponseSchema = z.object({
  visits: z.array(visitWithParkSchema)
});

export const createVisitRequestSchema = z.object({
  author: z.string().max(50).nullable().optional(),
  note: z.string().max(5000).nullable().optional(),
  route: z.string().max(80).nullable().optional(),
  visitedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

export const updateParkRemovedRequestSchema = z.object({
  removed: z.boolean()
});

export const updateVisitRequestSchema = createVisitRequestSchema
  .partial()
  .refine(
    (input) =>
      input.author !== undefined ||
      input.note !== undefined ||
      input.route !== undefined ||
      input.visitedOn !== undefined,
    {
      message: 'Provide at least one field to update.'
    }
  );

export const reorderVisitImagesRequestSchema = z.object({
  imageIds: z.array(z.number().int()).min(1)
});
