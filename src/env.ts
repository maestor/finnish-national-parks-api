import { z } from 'zod';

const envSchema = z.object({
  DATABASE_AUTH_TOKEN: z.string().optional(),
  DATABASE_URL: z.string().default('file:./data/local.db'),
  LIPAS_NATIONAL_PARKS_URL: z.string().url().optional(),
  LIPAS_PROTECTED_AREAS_URL: z.string().url().optional(),
  PORT: z.string().optional()
});

export function getEnv() {
  const env = envSchema.parse(process.env);

  return {
    ...env,
    LIPAS_PROTECTED_AREAS_URL:
      env.LIPAS_PROTECTED_AREAS_URL ??
      env.LIPAS_NATIONAL_PARKS_URL ??
      'https://api.lipas.fi/v2/sports-sites?type-codes=109,110,111,112&page-size=200&page=1'
  };
}
