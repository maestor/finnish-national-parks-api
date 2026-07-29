import { z } from '@hono/zod-openapi';

import { visitDateSchema } from './parks.js';

const yearReviewSeasonSchema = z.enum(['autumn', 'spring', 'summer', 'winter']);

const yearReviewVisitsBySeasonSchema = z.object({
  autumn: z.number().int().nonnegative(),
  spring: z.number().int().nonnegative(),
  summer: z.number().int().nonnegative(),
  winter: z.number().int().nonnegative()
});

const yearReviewTripReferenceSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  slug: z.string()
});

const yearReviewVisitReferenceSchema = z.object({
  id: z.number().int(),
  imageCount: z.number().int().nonnegative(),
  park: z.object({
    name: z.string(),
    slug: z.string()
  }),
  route: z.string().nullable(),
  trip: yearReviewTripReferenceSchema.nullable(),
  visitedOn: visitDateSchema
});

const yearReviewMostVisitedParkSchema = z.object({
  name: z.string(),
  slug: z.string(),
  visitCount: z.number().int().positive()
});

const yearReviewSummarySchema = z.object({
  activeMonthCount: z.number().int().nonnegative(),
  distinctParkCount: z.number().int().nonnegative(),
  imageCount: z.number().int().nonnegative(),
  newParkCount: z.number().int().nonnegative(),
  revisitedParkCount: z.number().int().nonnegative(),
  visitCount: z.number().int().nonnegative(),
  visitsBySeason: yearReviewVisitsBySeasonSchema
});

const yearReviewIntroCardSchema = z.object({
  kind: z.literal('intro'),
  primaryStat: z.object({
    key: z.literal('visitCount'),
    value: z.number().int().nonnegative()
  }),
  year: z.number().int()
});

const yearReviewMilestoneCardSchema = z.object({
  kind: z.literal('milestone'),
  milestone: z.enum(['first-visit', 'last-visit']),
  visit: yearReviewVisitReferenceSchema
});

const yearReviewPhotoHighlightCardSchema = z.object({
  kind: z.literal('photo-highlight'),
  totalImageCount: z.number().int().nonnegative(),
  visit: yearReviewVisitReferenceSchema.nullable()
});

const yearReviewProfileCardSchema = z.object({
  busiestMonth: z.number().int().min(1).max(12).nullable(),
  busiestWeekday: z.number().int().min(0).max(6).nullable(),
  kind: z.literal('profile'),
  mostVisitedPark: yearReviewMostVisitedParkSchema.nullable(),
  topRoute: z.string().nullable(),
  topTypeLabel: z.string().nullable()
});

const yearReviewTripHighlightCardSchema = z.object({
  kind: z.literal('trip-highlight'),
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
    visitCount: z.number().int().nonnegative()
  })
});

const yearReviewSeasonalCardSchema = z.object({
  kind: z.literal('seasonal'),
  strongestSeason: yearReviewSeasonSchema.nullable(),
  visitsBySeason: yearReviewVisitsBySeasonSchema
});

const yearReviewSummaryCardSchema = z.object({
  highlights: z.array(z.string()),
  kind: z.literal('summary')
});

export const yearReviewCardSchema = z.discriminatedUnion('kind', [
  yearReviewIntroCardSchema,
  yearReviewMilestoneCardSchema,
  yearReviewPhotoHighlightCardSchema,
  yearReviewProfileCardSchema,
  yearReviewTripHighlightCardSchema,
  yearReviewSeasonalCardSchema,
  yearReviewSummaryCardSchema
]);

export const yearReviewStorySchema = z.object({
  cards: z.array(yearReviewCardSchema),
  summary: yearReviewSummarySchema,
  year: z.number().int()
});

export const yearReviewPreviewSchema = z.object({
  generatedAt: z.string().datetime(),
  publishInfo: z.object({
    publicUrl: z.string().url().nullable(),
    publishedAt: z.string().datetime().nullable(),
    publishedShareId: z.string().uuid().nullable(),
    sharePath: z.string().nullable()
  }),
  status: z.enum(['draft', 'published']),
  story: yearReviewStorySchema,
  year: z.number().int()
});

export const yearReviewPublishResponseSchema = z.object({
  publicUrl: z.string().url(),
  publishedAt: z.string().datetime(),
  shareId: z.string().uuid(),
  sharePath: z.string()
});

export const yearReviewShareResponseSchema = z.object({
  publishedAt: z.string().datetime(),
  shareId: z.string().uuid(),
  story: yearReviewStorySchema,
  year: z.number().int()
});
