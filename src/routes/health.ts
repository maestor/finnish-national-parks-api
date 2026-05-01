import { createRoute } from '@hono/zod-openapi';

import { healthResponseSchema } from '../contracts/common.js';

export const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  tags: ['System'],
  responses: {
    200: {
      description: 'Health check response',
      content: {
        'application/json': {
          schema: healthResponseSchema
        }
      }
    }
  }
});
