import { createRoute, z } from '@hono/zod-openapi';
import { authUserSchema } from '../contracts/auth.js';
import { errorSchema } from '../contracts/common.js';

export const googleAuthRoute = createRoute({
  method: 'get',
  path: '/auth/google',
  security: [],
  tags: ['Auth'],
  responses: {
    302: {
      description: 'Redirect to Google OAuth consent screen',
      headers: {
        Location: {
          description: 'Google OAuth authorization URL',
          schema: { type: 'string' }
        }
      }
    },
    503: {
      content: {
        'application/json': {
          schema: errorSchema
        }
      },
      description: 'OAuth not configured'
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
  security: [],
  tags: ['Auth'],
  responses: {
    302: {
      description: 'Redirect to frontend after authentication',
      headers: {
        Location: {
          description: 'Frontend redirect URL',
          schema: { type: 'string' }
        }
      }
    },
    503: {
      content: {
        'application/json': {
          schema: errorSchema
        }
      },
      description: 'OAuth not configured'
    }
  }
});

export const getAuthMeRoute = createRoute({
  method: 'get',
  path: '/auth/me',
  security: [],
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
      content: {
        'application/json': {
          schema: errorSchema
        }
      },
      description: 'Not authenticated'
    },
    503: {
      content: {
        'application/json': {
          schema: errorSchema
        }
      },
      description: 'OAuth not configured'
    }
  }
});

export const postAuthLogoutRoute = createRoute({
  method: 'post',
  path: '/auth/logout',
  security: [],
  tags: ['Auth'],
  responses: {
    204: {
      description: 'Logged out successfully'
    },
    503: {
      content: {
        'application/json': {
          schema: errorSchema
        }
      },
      description: 'OAuth not configured'
    }
  }
});
