import { createRoute, z } from '@hono/zod-openapi';
import { errorSchema } from '../contracts/common.js';
import {
  trailAreaCandidateSchema,
  trailAreaLinkSchema,
  trailAreaValidationFailureSchema,
  trailLinkedAreaSchema
} from '../contracts/trail-areas.js';

const params = z.object({ slug: z.string() });
const linkParams = params.extend({ trailId: z.coerce.number().int().positive() });
const errors = {
  400: {
    description: 'Invalid request parameters',
    content: { 'application/json': { schema: trailAreaValidationFailureSchema } }
  },
  401: {
    description: 'Admin session required',
    content: { 'application/json': { schema: errorSchema } }
  },
  404: {
    description: 'Area or trail not found',
    content: { 'application/json': { schema: errorSchema } }
  },
  422: {
    description: 'Invalid area or trail',
    content: { 'application/json': { schema: errorSchema } }
  },
  503: {
    description: 'Authentication unavailable',
    content: { 'application/json': { schema: errorSchema } }
  }
};
const common = { tags: ['Parks'], security: [{ bearerAuth: [], sessionAuth: [] }] };
export const listAreaTrailsRoute = createRoute({
  ...common,
  method: 'get',
  path: '/api/admin/parks/{slug}/trails',
  request: { params },
  responses: {
    200: {
      description: 'Trail links and overrides',
      content: {
        'application/json': { schema: z.object({ trails: z.array(trailAreaLinkSchema) }) }
      }
    },
    ...errors
  }
});
export const listTrailAreasRoute = createRoute({
  ...common,
  method: 'get',
  path: '/api/admin/parks/{slug}/areas',
  request: { params },
  responses: {
    200: {
      description: 'Effective areas linked to a trail',
      content: {
        'application/json': { schema: z.object({ areas: z.array(trailLinkedAreaSchema) }) }
      }
    },
    ...errors
  }
});
export const listAreaTrailCandidatesRoute = createRoute({
  ...common,
  method: 'get',
  path: '/api/admin/parks/{slug}/trail-candidates',
  request: {
    params,
    query: z.object({
      q: z.string().trim().max(100).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(25),
      offset: z.coerce.number().int().nonnegative().default(0)
    })
  },
  responses: {
    200: {
      description: 'Eligible stored trails',
      content: {
        'application/json': {
          schema: z.object({
            trails: z.array(trailAreaCandidateSchema),
            nextOffset: z.number().int().nullable()
          })
        }
      }
    },
    ...errors
  }
});
export const addAreaTrailRoute = createRoute({
  ...common,
  method: 'put',
  path: '/api/admin/parks/{slug}/trails/{trailId}',
  request: { params: linkParams },
  responses: {
    200: {
      description: 'Manually included trail',
      content: { 'application/json': { schema: trailAreaLinkSchema } }
    },
    ...errors
  }
});
export const removeAreaTrailRoute = createRoute({
  ...common,
  method: 'delete',
  path: '/api/admin/parks/{slug}/trails/{trailId}',
  request: { params: linkParams },
  responses: {
    200: {
      description: 'Manually excluded trail',
      content: { 'application/json': { schema: trailAreaLinkSchema } }
    },
    ...errors
  }
});
