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
  LIPAS_NATIONAL_PARKS_URL: z.string().url().optional(),
  LIPAS_PROTECTED_AREAS_URL: z.string().url().optional(),
  MEMORY_STORAGE: z.string().optional().default('false'),
  PORT: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_ENDPOINT: z.string().optional(),
  R2_PUBLIC_URL: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional()
});

export const getEnv = () => {
  const env = envSchema.parse(process.env);

  return {
    ...env,
    LIPAS_PROTECTED_AREAS_URL:
      env.LIPAS_PROTECTED_AREAS_URL ??
      env.LIPAS_NATIONAL_PARKS_URL ??
      'https://api.lipas.fi/v2/sports-sites?type-codes=109,110,111,112&page-size=100&page=1'
  };
};
