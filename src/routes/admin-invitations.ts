import { createRoute } from '@hono/zod-openapi';

import {
  adminInvitationResponseSchema,
  createAdminInvitationRequestSchema
} from '../contracts/admin-invitations.js';
import { errorSchema } from '../contracts/common.js';

export const createAdminInvitationRoute = createRoute({
  method: 'post',
  path: '/api/admin/invitations',
  tags: ['Auth'],
  security: [{ bearerAuth: [], sessionAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: createAdminInvitationRequestSchema
        }
      }
    }
  },
  responses: {
    201: {
      description: 'Created short-lived admin invitation',
      content: {
        'application/json': {
          schema: adminInvitationResponseSchema
        }
      }
    },
    400: {
      description: 'Invalid invitation request',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    },
    401: {
      description: 'Admin session required',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    },
    403: {
      description: 'Admin session is not provisioned',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    },
    409: {
      description: 'The email already belongs to an enrolled admin',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    },
    503: {
      description: 'OAuth not configured',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    }
  }
});
