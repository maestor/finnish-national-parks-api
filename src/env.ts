import { config } from 'dotenv';
import { z } from 'zod';

config();

const envSchema = z.object({
  API_KEY: z.string().optional(),
  AUTH_COOKIE_NAME: z.string().default('__session'),
  AUTH_JWT_SECRET: z.string().optional(),
  DATABASE_AUTH_TOKEN: z.string().optional(),
  DATABASE_URL: z.string().default('file:./data/local.db'),
  FRONTEND_URL: z.string().url().default('http://localhost:4300'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  MEMORY_STORAGE: z.string().optional().default('false'),
  PORT: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_ENDPOINT: z.string().optional(),
  R2_PUBLIC_URL: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional()
});

export const getEnv = () => {
  return envSchema.parse(process.env);
};
