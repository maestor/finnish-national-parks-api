import { z } from '@hono/zod-openapi';

import { supportedParkCategorySlugs, supportedParkTypeSlugs } from '../parks/park-types.js';

export const parkTypeSchema = z.object({
  code: z.number().int(),
  id: z.number().int(),
  name: z.string(),
  slug: z.enum(supportedParkTypeSlugs)
});

export const parkCategorySchema = z.object({
  name: z.string(),
  slug: z.enum(supportedParkCategorySlugs)
});

export const pointSchema = z.object({
  lat: z.number(),
  lon: z.number()
});

export const geoJsonCoordinateSchema = z.tuple([z.number(), z.number()]).rest(z.number());

export const boundingBoxSchema = z.object({
  maxLat: z.number(),
  maxLon: z.number(),
  minLat: z.number(),
  minLon: z.number()
});

export const parkLogoSchema = z.object({
  key: z.string(),
  updatedAt: z.string().datetime(),
  url: z.string().url()
});

export const parkMapSchema = z.object({
  key: z.string(),
  updatedAt: z.string().datetime(),
  url: z.string().url()
});

export const geoJsonPolygonSchema = z.object({
  coordinates: z.array(z.array(geoJsonCoordinateSchema)),
  type: z.literal('Polygon')
});

export const geoJsonLineStringSchema = z.object({
  coordinates: z.array(geoJsonCoordinateSchema),
  type: z.literal('LineString')
});

export const geoJsonFeatureCollectionSchema = z.object({
  features: z.array(
    z.object({
      geometry: z.union([geoJsonPolygonSchema, geoJsonLineStringSchema]),
      type: z.literal('Feature')
    })
  ),
  type: z.literal('FeatureCollection')
});

export const parkListItemSchema = z.object({
  address: z.string(),
  areaKm2: z.number().nullable(),
  boundingBox: boundingBoxSchema,
  category: parkCategorySchema,
  displayTypeName: z.string().nullable().optional(),
  establishmentYear: z.number().int().nullable(),
  locationLabel: z.string(),
  logo: parkLogoSchema.nullable(),
  parkUrl: z.string().nullable(),
  map: parkMapSchema.nullable(),
  markerPoint: pointSchema,
  name: z.string(),
  postalCode: z.string().nullable(),
  postalOffice: z.string().nullable(),
  slug: z.string(),
  type: parkTypeSchema
});

export const parkSearchItemSchema = z.object({
  address: z.string(),
  displayTypeName: z.string().nullable().optional(),
  locationLabel: z.string(),
  name: z.string(),
  postalCode: z.string().nullable(),
  postalOffice: z.string().nullable(),
  slug: z.string(),
  type: parkTypeSchema
});

export const adminParkVisibilityItemSchema = parkSearchItemSchema.extend({
  boundingBox: boundingBoxSchema,
  markerPoint: pointSchema
});

export const parkDetailSchema = parkListItemSchema.extend({
  boundaryGeoJson: geoJsonFeatureCollectionSchema.optional(),
  catalogStatus: z.enum(['active', 'inactive']),
  lipasId: z.number().int(),
  municipalityCode: z.number().int().nullable(),
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

export const directVisitImageUploadRequestSchema = z.object({
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  fileSizeBytes: z.number().int().positive(),
  originalName: z.string().trim().min(1).max(255)
});

export const directVisitImageUploadPlanSchema = z.object({
  expiresAt: z.string().datetime(),
  headers: z.object({
    'content-type': z.string()
  }),
  key: z.string(),
  method: z.literal('PUT'),
  uploadUrl: z.string().url()
});

export const completeDirectVisitImageUploadRequestSchema = z.object({
  fullHeight: z.number().int().positive().nullable().optional(),
  fullWidth: z.number().int().positive().nullable().optional(),
  key: z.string().min(1),
  originalName: z.string().trim().min(1).max(255).nullable().optional()
});

export const completeDirectVisitImageUploadResponseSchema = z.object({
  image: visitImageSchema
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
  visible: z.boolean(),
  visitedParks: z.number().int()
});

export const publicCategoryProgressSchema = z.object({
  category: parkCategorySchema,
  totalParks: z.number().int(),
  totalVisits: z.number().int(),
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

export const seasonalVisitCountsSchema = z.object({
  autumn: z.number().int(),
  spring: z.number().int(),
  summer: z.number().int(),
  winter: z.number().int()
});

export const publicHomeSummaryResponseSchema = publicVisitVersionSchema.extend({
  progressByCategory: z.array(publicCategoryProgressSchema),
  latestVisitEntries: z.array(publicVisitEntrySchema),
  mostVisitedParks: z.array(publicMostVisitedParkSchema),
  progressByType: z.array(publicTypeProgressSchema),
  recentVisits: z.array(publicRecentParkVisitSchema),
  seasonalVisitCounts: seasonalVisitCountsSchema,
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

export const parkSearchResponseSchema = z.object({
  parks: z.array(parkSearchItemSchema)
});

export const adminParkVisibilityResponseSchema = z.object({
  removedParks: z.array(adminParkVisibilityItemSchema),
  visibleParks: z.array(adminParkVisibilityItemSchema)
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

export const updateParkRequestSchema = z
  .object({
    areaKm2: z.number().nonnegative().nullable().optional(),
    displayTypeName: z.string().max(120).nullable().optional(),
    establishmentYear: z.number().int().nullable().optional(),
    locationLabel: z.string().trim().min(1).max(255).optional(),
    parkUrl: z.string().trim().min(1).max(500).nullable().optional(),
    name: z.string().trim().min(1).max(255).optional(),
    postalCode: z.string().trim().max(20).nullable().optional(),
    postalOffice: z.string().trim().max(120).nullable().optional(),
    slug: z.string().trim().min(1).max(255).optional()
  })
  .refine(
    (input) =>
      input.areaKm2 !== undefined ||
      input.displayTypeName !== undefined ||
      input.establishmentYear !== undefined ||
      input.locationLabel !== undefined ||
      input.parkUrl !== undefined ||
      input.name !== undefined ||
      input.postalCode !== undefined ||
      input.postalOffice !== undefined ||
      input.slug !== undefined,
    {
      message: 'Provide at least one field to update.'
    }
  );

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
