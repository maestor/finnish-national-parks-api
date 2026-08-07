import { z } from '@hono/zod-openapi';

import { visitDateSchema } from './parks.js';

const dateRangeReviewOverviewSchema = z.object({
  endDate: visitDateSchema,
  name: z.string(),
  shareSlug: z.string(),
  startDate: visitDateSchema
});

const dateRangeReviewTripReferenceSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  slug: z.string()
});

const dateRangeReviewVisitReferenceSchema = z.object({
  id: z.number().int(),
  imageCount: z.number().int().nonnegative(),
  park: z.object({
    name: z.string(),
    slug: z.string()
  }),
  route: z.string().nullable(),
  trip: dateRangeReviewTripReferenceSchema.nullable(),
  visitedOn: visitDateSchema
});

const dateRangeReviewStoryImageSchema = z.object({
  alt: z.string().nullable(),
  fullHeight: z.number().int().positive().nullable(),
  fullUrl: z.string().url(),
  fullWidth: z.number().int().positive().nullable(),
  thumbHeight: z.number().int().positive().nullable(),
  thumbUrl: z.string().url(),
  thumbWidth: z.number().int().positive().nullable()
});

const dateRangeReviewParkSummarySchema = z.object({
  name: z.string(),
  slug: z.string(),
  typeLabel: z.string(),
  typeSlug: z.string()
});

const dateRangeReviewParkVisitSummarySchema = z.object({
  park: dateRangeReviewParkSummarySchema,
  visitedOn: visitDateSchema
});

const dateRangeReviewSummarySchema = z.object({
  distinctParkCount: z.number().int().nonnegative(),
  imageCount: z.number().int().nonnegative(),
  newNationalParkCount: z.number().int().nonnegative(),
  revisitedParkCount: z.number().int().nonnegative(),
  tripCount: z.number().int().nonnegative(),
  visitCount: z.number().int().nonnegative()
});

const namedDateRangeReviewInputSchema = z.object({
  endDate: visitDateSchema,
  name: z.string().trim().min(1).max(120),
  startDate: visitDateSchema
});

export const dateRangeReviewPreviewQuerySchema = namedDateRangeReviewInputSchema;
export const dateRangeReviewPublishRequestSchema = namedDateRangeReviewInputSchema;
export const dateRangeReviewUnpublishQuerySchema = z.object({
  name: z.string().trim().min(1).max(120)
});

const dateRangeReviewIntroCardSchema = z.object({
  dateRange: z.object({
    endDate: visitDateSchema,
    startDate: visitDateSchema
  }),
  kind: z.literal('intro'),
  name: z.string(),
  primaryStat: z.object({
    key: z.literal('visitCount'),
    value: z.number().int().nonnegative()
  }),
  tripCount: z.number().int().nonnegative()
});

const dateRangeReviewPhotoHighlightCardSchema = z.object({
  featuredImage: dateRangeReviewStoryImageSchema.nullable(),
  kind: z.literal('photo-highlight'),
  totalImageCount: z.number().int().nonnegative(),
  visit: dateRangeReviewVisitReferenceSchema.nullable()
});

const dateRangeReviewNewParksCardSchema = z.object({
  kind: z.literal('new-parks'),
  parks: z.array(
    z.object({
      featuredImage: dateRangeReviewStoryImageSchema.nullable(),
      park: z.object({
        name: z.string(),
        slug: z.string()
      }),
      visitedOn: visitDateSchema
    })
  )
});

const dateRangeReviewRevisitedParksCardSchema = z.object({
  kind: z.literal('revisited-parks'),
  parks: z.array(
    z.object({
      featuredImage: dateRangeReviewStoryImageSchema.nullable(),
      park: z.object({
        name: z.string(),
        slug: z.string()
      }),
      previousVisitDate: visitDateSchema,
      revisitCount: z.number().int().positive(),
      visitedOn: visitDateSchema
    })
  )
});

const dateRangeReviewTripSummaryCardSchema = z.object({
  featuredImage: dateRangeReviewStoryImageSchema.nullable(),
  kind: z.literal('trip-summary'),
  trip: z.object({
    dateRange: z
      .object({
        end: visitDateSchema,
        start: visitDateSchema
      })
      .nullable(),
    id: z.number().int(),
    imageCount: z.number().int().nonnegative(),
    name: z.string(),
    slug: z.string(),
    visits: z.array(dateRangeReviewParkVisitSummarySchema),
    visitCount: z.number().int().nonnegative()
  })
});

const dateRangeReviewOtherVisitsCardSchema = z.object({
  kind: z.literal('other-visits'),
  visits: z.array(dateRangeReviewParkVisitSummarySchema)
});

export const dateRangeReviewCardSchema = z.discriminatedUnion('kind', [
  dateRangeReviewIntroCardSchema,
  dateRangeReviewPhotoHighlightCardSchema,
  dateRangeReviewNewParksCardSchema,
  dateRangeReviewRevisitedParksCardSchema,
  dateRangeReviewTripSummaryCardSchema,
  dateRangeReviewOtherVisitsCardSchema
]);

export const dateRangeReviewStorySchema = z.object({
  cards: z.array(dateRangeReviewCardSchema),
  summary: dateRangeReviewSummarySchema
});

export const dateRangeReviewPreviewSchema = z.object({
  generatedAt: z.string().datetime(),
  overview: dateRangeReviewOverviewSchema,
  publishInfo: z.object({
    publicUrl: z.string().url().nullable(),
    publishedAt: z.string().datetime().nullable(),
    publishedShareId: z.string().uuid().nullable(),
    sharePath: z.string().nullable()
  }),
  status: z.enum(['draft', 'published']),
  story: dateRangeReviewStorySchema
});

export const dateRangeReviewPublishResponseSchema = z.object({
  overview: dateRangeReviewOverviewSchema,
  publicUrl: z.string().url(),
  publishedAt: z.string().datetime(),
  shareId: z.string().uuid(),
  sharePath: z.string()
});

export const dateRangeReviewShareResponseSchema = z.object({
  overview: dateRangeReviewOverviewSchema,
  publishedAt: z.string().datetime(),
  shareId: z.string().uuid(),
  story: dateRangeReviewStorySchema
});
