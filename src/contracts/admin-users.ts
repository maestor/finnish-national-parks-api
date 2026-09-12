import { z } from '@hono/zod-openapi';

export const adminUserSchema = z.object({
  createdAt: z.string().datetime(),
  email: z.string().email(),
  id: z.number().int().positive(),
  isEnrolled: z.boolean(),
  isSuperAdmin: z.boolean(),
  updatedAt: z.string().datetime()
});

export const adminUserListResponseSchema = z.object({
  admins: z.array(adminUserSchema)
});

export const updateAdminUserRequestSchema = z.object({
  isSuperAdmin: z.boolean()
});
