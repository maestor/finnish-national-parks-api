import { describe, expect, it } from 'vitest';
import type { Env } from '../../src/env.js';
import { createAuthConfig, createStorage } from '../../src/runtime.js';

const createEnv = (overrides: Partial<Env> = {}): Env => {
  return {
    API_KEY: 'test-api-key',
    AUTH_COOKIE_NAME: '__session',
    AUTH_JWT_SECRET: undefined,
    DATABASE_AUTH_TOKEN: 'test-db-token',
    DATABASE_URL: 'libsql://parks-db.turso.io',
    FRONTEND_URL: 'https://parks.example.com',
    GOOGLE_CLIENT_ID: undefined,
    GOOGLE_CLIENT_SECRET: undefined,
    MEMORY_STORAGE: 'false',
    PORT: undefined,
    R2_ACCESS_KEY_ID: undefined,
    R2_BUCKET_NAME: undefined,
    R2_ENDPOINT: undefined,
    R2_PUBLIC_URL: undefined,
    R2_SECRET_ACCESS_KEY: undefined,
    ...overrides
  };
};

describe('runtime helpers', () => {
  it('creates memory storage only when explicitly enabled', async () => {
    const memoryStorage = createStorage(createEnv({ MEMORY_STORAGE: 'true' }));
    const noStorage = createStorage(createEnv());

    expect(memoryStorage).toBeDefined();
    expect('getStore' in memoryStorage!).toBe(true);
    expect(noStorage).toBeUndefined();
  });

  it('creates an R2 storage client when all R2 variables are present', () => {
    const storage = createStorage(
      createEnv({
        R2_ACCESS_KEY_ID: 'access-key',
        R2_BUCKET_NAME: 'bucket',
        R2_ENDPOINT: 'https://r2.example.com',
        R2_SECRET_ACCESS_KEY: 'secret-key'
      })
    );

    expect(storage).toBeDefined();
    expect(typeof storage?.delete).toBe('function');
    expect(typeof storage?.upload).toBe('function');
    expect(typeof storage?.getPresignedUrl).toBe('function');
  });

  it('creates auth config only when all OAuth variables are present', () => {
    expect(createAuthConfig(createEnv())).toBeUndefined();

    expect(
      createAuthConfig(
        createEnv({
          AUTH_JWT_SECRET: '12345678901234567890123456789012',
          GOOGLE_CLIENT_ID: 'google-client-id',
          GOOGLE_CLIENT_SECRET: 'google-client-secret'
        })
      )
    ).toEqual({
      cookieName: '__session',
      frontendUrl: 'https://parks.example.com',
      googleClientId: 'google-client-id',
      googleClientSecret: 'google-client-secret',
      jwtSecret: '12345678901234567890123456789012'
    });
  });
});
