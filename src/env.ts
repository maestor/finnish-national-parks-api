import { z } from 'zod';

const envSchema = z.object({
  DATABASE_AUTH_TOKEN: z.string().optional(),
  DATABASE_URL: z.string().default('file:./data/local.db'),
  LIPAS_NATIONAL_PARKS_URL: z.string().url().default(
    'https://api.lipas.fi/v2/sports-sites?type-codes=111&page-size=100&page=1'
  ),
  PORT: z.string().optional()
});

export function getEnv() {
  return envSchema.parse(process.env);
}
