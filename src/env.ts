import { config } from 'dotenv';
import { z } from 'zod';

config();

const envSchema = z.object({
  API_KEY: z.string().min(1).optional(),
  AUTH_COOKIE_NAME: z.string().default('__session'),
  AUTH_JWT_SECRET: z.string().min(32).optional(),
  DATABASE_AUTH_TOKEN: z.string().optional(),
  DATABASE_URL: z.string().default('file:./data/local.db'),
  FRONTEND_URL: z.string().url().default('http://localhost:4300'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().url().optional(),
  MEMORY_STORAGE: z.enum(['true', 'false']).default('false'),
  PORT: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_ENDPOINT: z.string().optional(),
  R2_PUBLIC_URL: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional()
});

export type Env = z.infer<typeof envSchema>;

const isVercelDeployment = (runtimeEnv: NodeJS.ProcessEnv = process.env) => {
  return (
    runtimeEnv.VERCEL === '1' ||
    runtimeEnv.VERCEL === 'true' ||
    typeof runtimeEnv.VERCEL_ENV === 'string'
  );
};

const hasOAuthConfig = (env: Env) => {
  return Boolean(env.AUTH_JWT_SECRET && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
};

export const assertDeploymentEnv = (env: Env, runtimeEnv: NodeJS.ProcessEnv = process.env) => {
  if (!isVercelDeployment(runtimeEnv)) {
    return;
  }

  if (!env.API_KEY) {
    throw new Error('Vercel deployments require API_KEY to protect non-public endpoints.');
  }

  if (env.DATABASE_URL.startsWith('file:')) {
    throw new Error(
      'Vercel deployments require DATABASE_URL to point at Turso/libSQL instead of a local file.'
    );
  }

  if (env.MEMORY_STORAGE === 'true') {
    throw new Error('Vercel deployments cannot use MEMORY_STORAGE=true.');
  }

  if (hasOAuthConfig(env) && env.FRONTEND_URL.startsWith('http://localhost')) {
    throw new Error(
      'Vercel deployments with Google OAuth enabled require FRONTEND_URL to use the deployed frontend URL.'
    );
  }

  if (hasOAuthConfig(env) && env.GOOGLE_REDIRECT_URI?.startsWith('http://localhost')) {
    throw new Error(
      'Vercel deployments with Google OAuth enabled require GOOGLE_REDIRECT_URI to use a deployed callback URL when it is set.'
    );
  }
};

export const getEnv = () => {
  const env = envSchema.parse(process.env);
  assertDeploymentEnv(env);
  return env;
};
