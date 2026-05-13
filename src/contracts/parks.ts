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

export const noteSchema = z.object({
  note: z.string(),
  updatedAt: z.string()
});

export const visitSchema = z.object({
  createdAt: z.string(),
  id: z.number().int(),
  note: z.string().nullable(),
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

export const personalParkSchema = parkDetailSchema
  .omit({
    boundaryGeoJson: true
  })
  .extend({
    note: noteSchema.nullable(),
    visitedSummary: visitedSummarySchema,
    visits: z.array(visitSchema)
  });

export const parkListResponseSchema = z.object({
  parks: z.array(parkListItemSchema)
});

export const personalParkListResponseSchema = z.object({
  parks: z.array(personalParkSchema)
});

export const putNoteRequestSchema = z.object({
  note: z.string().max(10000)
});

export const putNoteResponseSchema = z.object({
  note: noteSchema.nullable()
});

export const createVisitRequestSchema = z.object({
  note: z.string().max(5000).nullable().optional(),
  visitedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
});

export const updateVisitRequestSchema = createVisitRequestSchema
  .partial()
  .refine((input) => input.note !== undefined || input.visitedOn !== undefined, {
    message: 'Provide at least one field to update.'
  });
