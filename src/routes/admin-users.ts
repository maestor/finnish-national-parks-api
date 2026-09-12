import { createRoute, z } from '@hono/zod-openapi';
import {
  adminUserListResponseSchema,
  adminUserSchema,
  updateAdminUserRequestSchema
} from '../contracts/admin-users.js';
import { errorSchema } from '../contracts/common.js';

const superAdminErrorResponses = {
  401: {
    content: { 'application/json': { schema: errorSchema } },
    description: 'Admin session required'
  },
  403: {
    content: { 'application/json': { schema: errorSchema } },
    description: 'Super admin session required'
  },
  503: {
    content: { 'application/json': { schema: errorSchema } },
    description: 'OAuth not configured'
  }
};

export const listAdminUsersRoute = createRoute({
  method: 'get',
  path: '/api/admin/admins',
  security: [{ sessionAuth: [] }],
  tags: ['Admin users'],
  responses: {
    200: {
      content: { 'application/json': { schema: adminUserListResponseSchema } },
      description: 'List of admin users'
    },
    ...superAdminErrorResponses
  }
});

export const updateAdminUserRoute = createRoute({
  method: 'patch',
  path: '/api/admin/admins/{id}',
  request: {
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: {
      content: { 'application/json': { schema: updateAdminUserRequestSchema } }
    }
  },
  security: [{ sessionAuth: [] }],
  tags: ['Admin users'],
  responses: {
    200: {
      content: { 'application/json': { schema: adminUserSchema } },
      description: 'Updated admin user'
    },
    400: {
      content: { 'application/json': { schema: errorSchema } },
      description: 'Invalid admin operation'
    },
    401: superAdminErrorResponses[401],
    403: superAdminErrorResponses[403],
    503: superAdminErrorResponses[503],
    409: {
      content: { 'application/json': { schema: errorSchema } },
      description: 'A super admin cannot modify their own account'
    },
    404: {
      content: { 'application/json': { schema: errorSchema } },
      description: 'Admin user not found'
    }
  }
});

export const deleteAdminUserRoute = createRoute({
  method: 'delete',
  path: '/api/admin/admins/{id}',
  request: {
    params: z.object({ id: z.coerce.number().int().positive() })
  },
  security: [{ sessionAuth: [] }],
  tags: ['Admin users'],
  responses: {
    204: { description: 'Admin user removed' },
    400: {
      content: { 'application/json': { schema: errorSchema } },
      description: 'Invalid admin operation'
    },
    401: superAdminErrorResponses[401],
    403: superAdminErrorResponses[403],
    503: superAdminErrorResponses[503],
    409: {
      content: { 'application/json': { schema: errorSchema } },
      description: 'A super admin cannot modify their own account'
    },
    404: {
      content: { 'application/json': { schema: errorSchema } },
      description: 'Admin user not found'
    }
  }
});
