import { z } from '@hono/zod-openapi';

export const errorSchema = z.object({
  error: z.string().openapi({
    example: 'Not found'
  })
});

export const healthResponseSchema = z.object({
  ok: z.literal(true),
  service: z.literal('finnish-national-parks-api')
});
