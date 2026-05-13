import { z } from 'zod';

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
  PORT: z.string().optional()
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
