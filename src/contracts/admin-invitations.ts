import { z } from '@hono/zod-openapi';

export const createAdminInvitationRequestSchema = z.object({
  email: z.string().trim().email().max(320)
});

export const adminInvitationResponseSchema = z.object({
  email: z.string().email(),
  expiresAt: z.string().datetime(),
  invitationUrl: z.string().url()
});
