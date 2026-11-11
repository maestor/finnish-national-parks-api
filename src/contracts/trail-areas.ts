import { z } from '@hono/zod-openapi';

export const trailAreaCandidateSchema = z.object({
  trailId: z.number().int(),
  name: z.string(),
  slug: z.string()
});
export const trailAreaLinkSchema = trailAreaCandidateSchema.extend({
  automaticMatch: z.boolean(),
  effective: z.boolean(),
  override: z.enum(['include', 'exclude']).nullable(),
  overlapMetres: z.number().nullable(),
  routeMetres: z.number().nullable(),
  overlapRatio: z.number().nullable(),
  calculationMethod: z.string().nullable(),
  geometryFingerprint: z.string().nullable(),
  geometryQuality: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const trailAreaValidationFailureSchema = z.object({
  success: z.literal(false),
  error: z.object({ name: z.string(), message: z.string() }).passthrough()
});

export const trailLinkedAreaSchema = z.object({ name: z.string(), slug: z.string() });
