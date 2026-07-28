import { describe, expect, it } from 'vitest';
import type { Env } from '../../src/env.js';
import {
  createAuthConfig,
  createLogoPublicUrl,
  createStorage,
  createTripPlanner
} from '../../src/runtime.js';

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
    PUBLIC_API_BASE_URL: undefined,
    R2_ACCESS_KEY_ID: undefined,
    R2_BUCKET_NAME: undefined,
    R2_ENDPOINT: undefined,
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
    expect(typeof storage?.getObjectMetadata).toBe('function');
    expect(typeof storage?.upload).toBe('function');
    expect(typeof storage?.getPresignedUrl).toBe('function');
    expect(typeof storage?.getPresignedUploadUrl).toBe('function');
  });

  it('creates auth config only when all required OAuth variables are present', () => {
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

  it('creates a stable public logo URL builder only when a public API base URL is configured', () => {
    expect(createLogoPublicUrl(createEnv())).toBeUndefined();

    const getLogoPublicUrl = createLogoPublicUrl(
      createEnv({
        PUBLIC_API_BASE_URL: 'https://api.example.com'
      })
    );
    const getLogoPublicUrlWithTrailingSlash = createLogoPublicUrl(
      createEnv({
        PUBLIC_API_BASE_URL: 'https://api.example.com/'
      })
    );

    expect(getLogoPublicUrl).toBeDefined();
    expect(
      getLogoPublicUrl?.('logos/akasmannyn-kansallispuisto.png', '2026-07-28T10:00:00.000Z')
    ).toBe(
      'https://api.example.com/assets/logos/akasmannyn-kansallispuisto.png?v=2026-07-28T10%3A00%3A00.000Z'
    );
    expect(getLogoPublicUrl?.('nested/logo image.png', '2026-07-28T11:00:00.000Z')).toBe(
      'https://api.example.com/assets/logos/nested/logo%20image.png?v=2026-07-28T11%3A00%3A00.000Z'
    );
    expect(
      getLogoPublicUrlWithTrailingSlash?.(
        'logos/ukko-kolin-kansallismaisema.png',
        '2026-07-28T12:00:00.000Z'
      )
    ).toBe(
      'https://api.example.com/assets/logos/ukko-kolin-kansallismaisema.png?v=2026-07-28T12%3A00%3A00.000Z'
    );
  });

  it('adds google redirect uri when one is configured', () => {
    expect(
      createAuthConfig(
        createEnv({
          AUTH_JWT_SECRET: '12345678901234567890123456789012',
          GOOGLE_CLIENT_ID: 'google-client-id',
          GOOGLE_CLIENT_SECRET: 'google-client-secret',
          GOOGLE_REDIRECT_URI: 'https://parks.example.com/auth/google/callback'
        })
      )
    ).toEqual({
      cookieName: '__session',
      frontendUrl: 'https://parks.example.com',
      googleClientId: 'google-client-id',
      googleClientSecret: 'google-client-secret',
      googleRedirectUri: 'https://parks.example.com/auth/google/callback',
      jwtSecret: '12345678901234567890123456789012'
    });
  });

  it('creates a trip planner service only when a Geoapify key is configured', () => {
    expect(createTripPlanner(createEnv(), {} as never)).toBeUndefined();

    const tripPlanner = createTripPlanner(
      createEnv({
        GEOAPIFY_API_KEY: 'geoapify-key'
      }),
      {} as never
    );

    expect(tripPlanner).toBeDefined();
    expect(typeof tripPlanner?.search).toBe('function');
    expect(typeof tripPlanner?.searchNearby).toBe('function');
    expect(typeof tripPlanner?.suggest).toBe('function');
  });
});
