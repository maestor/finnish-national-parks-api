import { z } from '@hono/zod-openapi';

export const authUserSchema = z.object({
  email: z.string().openapi({ example: 'admin@example.com' }),
  id: z.string().openapi({ example: '123456789' }),
  name: z.string().openapi({ example: 'Admin User' }),
  picture: z.string().openapi({ example: 'https://lh3.googleusercontent.com/photo.jpg' })
});
