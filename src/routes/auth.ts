import { createRoute, z } from '@hono/zod-openapi';

import { authUserSchema } from '../contracts/auth.js';

export const googleAuthRoute = createRoute({
  method: 'get',
  path: '/auth/google',
  tags: ['Auth'],
  responses: {
    302: {
      description: 'Redirect to Google OAuth consent screen'
    }
  }
});

export const googleAuthCallbackRoute = createRoute({
  method: 'get',
  path: '/auth/google/callback',
  request: {
    query: z.object({
      code: z.string().optional(),
      error: z.string().optional(),
      state: z.string().optional()
    })
  },
  tags: ['Auth'],
  responses: {
    302: {
      description: 'Redirect to frontend after authentication'
    }
  }
});

export const getAuthMeRoute = createRoute({
  method: 'get',
  path: '/auth/me',
  tags: ['Auth'],
  responses: {
    200: {
      content: {
        'application/json': {
          schema: authUserSchema
        }
      },
      description: 'Current authenticated user'
    },
    401: {
      description: 'Not authenticated'
    }
  }
});

export const postAuthLogoutRoute = createRoute({
  method: 'post',
  path: '/auth/logout',
  tags: ['Auth'],
  responses: {
    204: {
      description: 'Logged out successfully'
    }
  }
});
