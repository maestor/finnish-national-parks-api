import { describe, expect, it } from 'vitest';

import { assertDeploymentEnv, type Env } from '../../src/env.js';

const createEnv = (overrides: Partial<Env> = {}): Env => {
  return {
    API_KEY: 'test-api-key',
    AUTH_COOKIE_NAME: '__session',
    AUTH_JWT_SECRET: undefined,
    DATABASE_AUTH_TOKEN: 'test-db-token',
    DATABASE_URL: 'libsql://parks-db.turso.io',
    FRONTEND_URL: 'https://parks.example.com',
    GEOAPIFY_API_KEY: undefined,
    GOOGLE_CLIENT_ID: undefined,
    GOOGLE_CLIENT_SECRET: undefined,
    GOOGLE_REDIRECT_URI: undefined,
    MEMORY_STORAGE: 'false',
    PORT: undefined,
    R2_ACCESS_KEY_ID: undefined,
    R2_BUCKET_NAME: undefined,
    R2_ENDPOINT: undefined,
    R2_SECRET_ACCESS_KEY: undefined,
    ...overrides
  };
};

describe('deployment environment guardrails', () => {
  it('allows local file database defaults outside Vercel', () => {
    expect(() =>
      assertDeploymentEnv(createEnv({ API_KEY: undefined, DATABASE_URL: 'file:./data/local.db' }), {
        NODE_ENV: 'development'
      })
    ).not.toThrow();
  });

  it('requires API key and remote database on Vercel', () => {
    expect(() =>
      assertDeploymentEnv(createEnv({ API_KEY: undefined }), {
        VERCEL: '1',
        VERCEL_ENV: 'preview'
      })
    ).toThrow('Vercel deployments require API_KEY');

    expect(() =>
      assertDeploymentEnv(createEnv({ DATABASE_URL: 'file:./data/local.db' }), {
        VERCEL: '1',
        VERCEL_ENV: 'production'
      })
    ).toThrow('Vercel deployments require DATABASE_URL');
  });

  it('rejects ephemeral storage and localhost frontend redirects on Vercel', () => {
    expect(() =>
      assertDeploymentEnv(createEnv({ MEMORY_STORAGE: 'true' }), {
        VERCEL: '1',
        VERCEL_ENV: 'production'
      })
    ).toThrow('Vercel deployments cannot use MEMORY_STORAGE=true.');

    expect(() =>
      assertDeploymentEnv(
        createEnv({
          AUTH_JWT_SECRET: '12345678901234567890123456789012',
          FRONTEND_URL: 'http://localhost:4300',
          GOOGLE_CLIENT_ID: 'google-client-id',
          GOOGLE_CLIENT_SECRET: 'google-client-secret'
        }),
        {
          VERCEL: '1',
          VERCEL_ENV: 'production'
        }
      )
    ).toThrow('Vercel deployments with Google OAuth enabled require FRONTEND_URL');

    expect(() =>
      assertDeploymentEnv(
        createEnv({
          AUTH_JWT_SECRET: '12345678901234567890123456789012',
          FRONTEND_URL: 'https://parks.example.com',
          GOOGLE_CLIENT_ID: 'google-client-id',
          GOOGLE_CLIENT_SECRET: 'google-client-secret',
          GOOGLE_REDIRECT_URI: 'http://localhost:4300/auth/google/callback'
        }),
        {
          VERCEL: '1',
          VERCEL_ENV: 'production'
        }
      )
    ).toThrow('Vercel deployments with Google OAuth enabled require GOOGLE_REDIRECT_URI');
  });
});
