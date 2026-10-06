import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { admins } from '../../src/db/schema.js';
import { createTestDatabase } from '../helpers/test-db.js';

const authConfig = {
  cookieName: '__session',
  frontendUrl: 'http://localhost:4300',
  googleClientId: 'test-google-client-id',
  googleClientSecret: 'test-google-client-secret',
  jwtSecret: 'test-jwt-secret-at-least-32-characters-long'
};
const googleClaimsFixtureUrl = 'https://test.invalid/google-id-token-claims';

const testGoogleKeysPromise = (async () => {
  const keyPair = await generateKeyPair('RS256');
  const jwk = await exportJWK(keyPair.publicKey);

  return {
    jwk: { ...jwk, alg: 'RS256', kid: 'test-google-key', use: 'sig' },
    privateKey: keyPair.privateKey
  };
})();

const createTestGoogleIdToken = async (payload: object) => {
  const { privateKey } = await testGoogleKeysPromise;
  const claims = { ...(payload as Record<string, unknown>) };

  if (claims.email_verified === undefined) {
    claims.email_verified = true;
  }
  if (typeof claims.exp === 'string') {
    claims.exp = Number(claims.exp);
  }

  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-google-key' })
    .sign(privateKey);
};

const mockFetch = (
  responses: Array<{
    body: object;
    method?: string;
    status?: number;
    url: RegExp | string;
  }>
) => {
  return vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';

    if (url === 'https://www.googleapis.com/oauth2/v3/certs') {
      const { jwk } = await testGoogleKeysPromise;
      return new Response(JSON.stringify({ keys: [jwk] }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200
      });
    }

    if (url === 'https://oauth2.googleapis.com/token') {
      const claimsFixtureResponse = responses.find(
        (response) => typeof response.url === 'string' && response.url === googleClaimsFixtureUrl
      );

      if (claimsFixtureResponse) {
        const idToken = await createTestGoogleIdToken(claimsFixtureResponse.body);
        return new Response(JSON.stringify({ id_token: idToken }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200
        });
      }
    }

    const match = responses.find((r) => {
      const urlMatch = typeof r.url === 'string' ? url === r.url : r.url.test(url);
      const methodMatch = !r.method || r.method === method;
      return urlMatch && methodMatch;
    });

    if (!match) {
      return Promise.resolve(new Response('Not found', { status: 404 }));
    }

    return new Response(JSON.stringify(match.body), {
      headers: { 'Content-Type': 'application/json' },
      status: match.status ?? 200
    });
  });
};

const extractCookies = (response: Response): Record<string, string> => {
  const cookies: Record<string, string> = {};
  const setCookies = response.headers.getSetCookie?.() ?? [];

  for (const cookie of setCookies) {
    const parts = cookie.split(';');
    const nameValue = parts[0];

    if (!nameValue) {
      continue;
    }

    const [name, value] = nameValue.split('=');

    if (name && value !== undefined) {
      cookies[name.trim()] = value.trim();
    }
  }

  return cookies;
};

describe('google oauth', () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    testDatabase = await createTestDatabase();
  });

  afterEach(async () => {
    await testDatabase.dispose();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('redirects to google auth url with state and pkce cookies', async () => {
    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const response = await app.request('/auth/google');

    expect(response.status).toBe(302);
    const location = response.headers.get('location');
    expect(location).toContain('accounts.google.com');
    expect(location).toContain('client_id=test-google-client-id');
    expect(location).toContain('code_challenge_method=S256');

    const cookies = extractCookies(response);
    expect(cookies.__oauth_state).toBeDefined();
    expect(cookies.__oauth_pkce).toBeDefined();
  });

  it.each([undefined, 'http://localhost:4300/auth/google/callback'])(
    'returns directly to the public destination with callback URI %s',
    async (googleRedirectUri) => {
      global.fetch = mockFetch([
        {
          url: googleClaimsFixtureUrl,
          body: {
            aud: authConfig.googleClientId,
            email: 'admin@example.com',
            exp: Math.floor(Date.now() / 1000) + 3600,
            iss: 'https://accounts.google.com',
            sub: 'google-user-id'
          }
        }
      ]);
      await testDatabase.database.insert(admins).values({
        createdAt: '2026-05-01T10:00:00.000Z',
        email: 'admin@example.com',
        googleSub: 'google-user-id',
        updatedAt: '2026-05-01T10:00:00.000Z'
      });
      const app = createApp({
        auth: googleRedirectUri === undefined ? authConfig : { ...authConfig, googleRedirectUri },
        database: testDatabase.database
      });
      const returnTo = '/reissusuunnittelu?paikka=pallas#reitti';
      const startUrl = new URL('http://localhost:3004/auth/google');
      startUrl.searchParams.set('returnTo', returnTo);
      const start = await app.request(startUrl.toString());
      const cookies = extractCookies(start);

      expect(new URL(start.headers.get('location') ?? '').searchParams.get('redirect_uri')).toBe(
        googleRedirectUri ?? 'http://localhost:3004/auth/google/callback'
      );
      expect(decodeURIComponent(cookies.__oauth_return ?? '')).toBe(returnTo);
      const returnCookie = start.headers
        .getSetCookie()
        .find((cookie) => cookie.startsWith('__oauth_return='));
      expect(returnCookie).toContain('HttpOnly');
      expect(returnCookie).toContain('SameSite=Lax');
      expect(returnCookie).toContain('Max-Age=600');
      expect(returnCookie).toContain('Path=/');

      const callback = await app.request(
        `http://localhost:3004/auth/google/callback?code=auth-code&state=${cookies.__oauth_state}`,
        {
          headers: {
            cookie: `__oauth_state=${cookies.__oauth_state}; __oauth_pkce=${cookies.__oauth_pkce}; __oauth_return=${cookies.__oauth_return}`
          }
        }
      );

      expect(callback.status).toBe(302);
      expect(callback.headers.get('location')).toBe(`${authConfig.frontendUrl}${returnTo}`);
      expect(extractCookies(callback).__session).toBeDefined();
      expect(
        callback.headers.getSetCookie().find((cookie) => cookie.startsWith('__oauth_return='))
      ).toContain('Max-Age=0');
      expect(callback.headers.get('cache-control')).toBe('private, no-store');
    }
  );

  it('clears a previous destination when starting login without a return path', async () => {
    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const start = await app.request('/auth/google', {
      headers: { cookie: '__oauth_return=%2Fretket' }
    });

    expect(
      start.headers.getSetCookie().find((cookie) => cookie.startsWith('__oauth_return='))
    ).toContain('Max-Age=0');
  });

  it.each([
    'https://evil.example/phish',
    '//evil.example/phish',
    '/retket/..//evil.example/phish',
    '/\\evil.example/phish',
    '/auth/logout',
    '/hallinta',
    '/kirjaudu?error=auth_failed'
  ])('ignores unsafe destination %j even when its cookie is tampered with', async (returnTo) => {
    global.fetch = mockFetch([
      {
        url: googleClaimsFixtureUrl,
        body: {
          aud: authConfig.googleClientId,
          email: 'admin@example.com',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iss: 'https://accounts.google.com',
          sub: 'google-user-id'
        }
      }
    ]);
    await testDatabase.database.insert(admins).values({
      createdAt: '2026-05-01T10:00:00.000Z',
      email: 'admin@example.com',
      googleSub: 'google-user-id',
      updatedAt: '2026-05-01T10:00:00.000Z'
    });
    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const start = await app.request(`/auth/google?${new URLSearchParams({ returnTo })}`);
    expect(
      start.headers.getSetCookie().find((cookie) => cookie.startsWith('__oauth_return='))
    ).toContain('Max-Age=0');
    const cookies = extractCookies(start);
    const callback = await app.request(
      `/auth/google/callback?code=auth-code&state=${cookies.__oauth_state}`,
      {
        headers: {
          cookie: `__oauth_state=${cookies.__oauth_state}; __oauth_pkce=${cookies.__oauth_pkce}; __oauth_return=${encodeURIComponent(returnTo)}`
        }
      }
    );

    expect(callback.headers.get('location')).toBe(`${authConfig.frontendUrl}/hallinta`);
    expect(extractCookies(callback).__session).toBeDefined();
  });

  it('keeps return cookies secure in production and clears them on failure', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const start = await app.request('https://api.example.com/auth/google?returnTo=%2Fretket');
    expect(
      start.headers.getSetCookie().find((cookie) => cookie.startsWith('__oauth_return='))
    ).toContain('Secure');

    const callback = await app.request(
      'https://api.example.com/auth/google/callback?error=access_denied'
    );
    const clearedCookie = callback.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('__oauth_return='));
    expect(clearedCookie).toContain('Secure');
    expect(clearedCookie).toContain('Max-Age=0');
  });

  it('documents the optional return destination and rejects oversized query values', async () => {
    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const schema = (await (await app.request('/openapi.json')).json()) as {
      paths: { '/auth/google': { get: { parameters: unknown[] } } };
    };
    expect(schema.paths['/auth/google'].get.parameters).toContainEqual(
      expect.objectContaining({
        in: 'query',
        name: 'returnTo',
        required: false,
        schema: expect.objectContaining({ type: 'string', maxLength: 2048 })
      })
    );
    const response = await app.request(
      `/auth/google?${new URLSearchParams({ returnTo: '/'.repeat(2049) })}`
    );
    expect(response.status).toBe(400);
  });

  it('clears the destination on failed OAuth callbacks without returning to the public page', async () => {
    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const callback = await app.request('/auth/google/callback?error=access_denied', {
      headers: { cookie: '__oauth_return=%2Fretket' }
    });

    expect(callback.headers.get('location')).toBe(
      `${authConfig.frontendUrl}/login?error=auth_failed`
    );
    expect(
      callback.headers.getSetCookie().find((cookie) => cookie.startsWith('__oauth_return='))
    ).toContain('Max-Age=0');
    expect(extractCookies(callback).__session).toBeUndefined();
  });

  it('uses configured public redirect uri for proxied oauth deployments', async () => {
    const googleRedirectUri = 'https://parks.example.com/auth/google/callback';

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        const body = init?.body;
        expect(body).toBeInstanceOf(URLSearchParams);
        expect((body as URLSearchParams).get('redirect_uri')).toBe(googleRedirectUri);

        const idToken = await createTestGoogleIdToken({
          aud: 'test-google-client-id',
          email: 'admin@example.com',
          exp: Math.floor(Date.now() / 1000) + 3600,
          iss: 'https://accounts.google.com',
          sub: 'google-user-id'
        });

        return new Response(JSON.stringify({ id_token: idToken }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200
        });
      }

      if (url === 'https://www.googleapis.com/oauth2/v3/certs') {
        const { jwk } = await testGoogleKeysPromise;
        return new Response(JSON.stringify({ keys: [jwk] }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200
        });
      }

      return new Response('Not found', { status: 404 });
    }) as typeof fetch;

    await testDatabase.database.insert(admins).values({
      createdAt: '2026-05-01T10:00:00.000Z',
      email: 'admin@example.com',
      googleSub: 'google-user-id',
      updatedAt: '2026-05-01T10:00:00.000Z'
    });

    const app = createApp({
      auth: {
        ...authConfig,
        googleRedirectUri
      },
      database: testDatabase.database
    });
    const initResponse = await app.request('/auth/google');
    const cookies = extractCookies(initResponse);
    const location = new URL(initResponse.headers.get('location') ?? '');

    expect(location.searchParams.get('redirect_uri')).toBe(googleRedirectUri);

    const callbackResponse = await app.request(
      `/auth/google/callback?code=auth-code&state=${cookies.__oauth_state}`,
      {
        headers: {
          cookie: `__oauth_state=${cookies.__oauth_state}; __oauth_pkce=${cookies.__oauth_pkce}`
        }
      }
    );

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get('location')).toBe('http://localhost:4300/hallinta');
  });

  it('completes callback and sets session cookie for allowed admin', async () => {
    global.fetch = mockFetch([
      {
        body: { id_token: 'mock-id-token' },
        method: 'POST',
        url: 'https://oauth2.googleapis.com/token'
      },
      {
        body: {
          aud: 'test-google-client-id',
          email: 'admin@example.com',
          exp: String(Math.floor(Date.now() / 1000) + 3600),
          iss: 'https://accounts.google.com',
          name: 'Admin User',
          picture: 'https://example.com/photo.jpg',
          sub: 'google-user-id'
        },
        url: googleClaimsFixtureUrl
      }
    ]);

    await testDatabase.database.insert(admins).values({
      createdAt: '2026-05-01T10:00:00.000Z',
      email: 'admin@example.com',
      googleSub: 'google-user-id',
      updatedAt: '2026-05-01T10:00:00.000Z'
    });

    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const initResponse = await app.request('/auth/google');
    const cookies = extractCookies(initResponse);

    const callbackResponse = await app.request(
      `/auth/google/callback?code=auth-code&state=${cookies.__oauth_state}`,
      {
        headers: {
          cookie: `__oauth_state=${cookies.__oauth_state}; __oauth_pkce=${cookies.__oauth_pkce}`
        }
      }
    );

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get('location')).toBe('http://localhost:4300/hallinta');

    const sessionCookies = extractCookies(callbackResponse);
    expect(sessionCookies.__session).toBeDefined();

    const setCookieHeader = callbackResponse.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith('__session='));
    expect(setCookieHeader).toContain('HttpOnly');
    expect(setCookieHeader).toContain('SameSite=Lax');
    expect(setCookieHeader).toContain('Path=/');

    const [, payloadSegment] = (sessionCookies.__session ?? '').split('.');
    const claims = JSON.parse(Buffer.from(payloadSegment ?? '', 'base64url').toString()) as {
      aud?: string;
      iss?: string;
      role?: string;
    };
    expect(claims.iss).toBe('reissuvihko-api');
    expect(claims.aud).toBe('reissuvihko-ui');
    expect(claims.role).toBe('admin');
  });

  it('redirects to access_denied for non-admin email', async () => {
    global.fetch = mockFetch([
      {
        body: { id_token: 'mock-id-token' },
        method: 'POST',
        url: 'https://oauth2.googleapis.com/token'
      },
      {
        body: {
          aud: 'test-google-client-id',
          email: 'unknown@example.com',
          exp: String(Math.floor(Date.now() / 1000) + 3600),
          iss: 'https://accounts.google.com',
          sub: 'google-user-id'
        },
        url: googleClaimsFixtureUrl
      }
    ]);

    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const initResponse = await app.request('/auth/google');
    const cookies = extractCookies(initResponse);

    const callbackResponse = await app.request(
      `/auth/google/callback?code=auth-code&state=${cookies.__oauth_state}`,
      {
        headers: {
          cookie: `__oauth_state=${cookies.__oauth_state}; __oauth_pkce=${cookies.__oauth_pkce}`
        }
      }
    );

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get('location')).toBe(
      'http://localhost:4300/login?error=access_denied'
    );
  });

  it('redirects to access_denied when the provisioned admin has a conflicting Google subject', async () => {
    global.fetch = mockFetch([
      {
        body: { id_token: 'mock-id-token' },
        method: 'POST',
        url: 'https://oauth2.googleapis.com/token'
      },
      {
        body: {
          aud: 'test-google-client-id',
          email: 'admin@example.com',
          exp: String(Math.floor(Date.now() / 1000) + 3600),
          iss: 'https://accounts.google.com',
          sub: 'unexpected-google-user-id'
        },
        url: googleClaimsFixtureUrl
      }
    ]);

    await testDatabase.database.insert(admins).values({
      createdAt: '2026-05-01T10:00:00.000Z',
      email: 'admin@example.com',
      googleSub: 'google-user-id',
      updatedAt: '2026-05-01T10:00:00.000Z'
    });

    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const initResponse = await app.request('/auth/google');
    const cookies = extractCookies(initResponse);

    const callbackResponse = await app.request(
      `/auth/google/callback?code=auth-code&state=${cookies.__oauth_state}`,
      {
        headers: {
          cookie: `__oauth_state=${cookies.__oauth_state}; __oauth_pkce=${cookies.__oauth_pkce}`
        }
      }
    );

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get('location')).toBe(
      'http://localhost:4300/login?error=access_denied'
    );
  });

  it('redirects to access_denied for an email-only admin without subject enrollment', async () => {
    global.fetch = mockFetch([
      {
        body: { id_token: 'mock-id-token' },
        method: 'POST',
        url: 'https://oauth2.googleapis.com/token'
      },
      {
        body: {
          aud: 'test-google-client-id',
          email: 'admin@example.com',
          exp: String(Math.floor(Date.now() / 1000) + 3600),
          iss: 'https://accounts.google.com',
          sub: 'google-user-id'
        },
        url: googleClaimsFixtureUrl
      }
    ]);

    await testDatabase.database.insert(admins).values({
      createdAt: '2026-05-01T10:00:00.000Z',
      email: 'admin@example.com',
      updatedAt: '2026-05-01T10:00:00.000Z'
    });

    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const initResponse = await app.request('/auth/google');
    const cookies = extractCookies(initResponse);

    const callbackResponse = await app.request(
      `/auth/google/callback?code=auth-code&state=${cookies.__oauth_state}`,
      {
        headers: {
          cookie: `__oauth_state=${cookies.__oauth_state}; __oauth_pkce=${cookies.__oauth_pkce}`
        }
      }
    );

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get('location')).toBe(
      'http://localhost:4300/login?error=access_denied'
    );
  });

  it('redirects to auth_failed when token exchange fails', async () => {
    global.fetch = mockFetch([
      {
        body: { error: 'invalid_grant' },
        method: 'POST',
        status: 400,
        url: 'https://oauth2.googleapis.com/token'
      }
    ]);

    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const initResponse = await app.request('/auth/google');
    const cookies = extractCookies(initResponse);

    const callbackResponse = await app.request(
      `/auth/google/callback?code=auth-code&state=${cookies.__oauth_state}`,
      {
        headers: {
          cookie: `__oauth_state=${cookies.__oauth_state}; __oauth_pkce=${cookies.__oauth_pkce}`
        }
      }
    );

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get('location')).toBe(
      'http://localhost:4300/login?error=auth_failed'
    );
  });

  it('redirects to auth_failed when google returns error param', async () => {
    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const response = await app.request('/auth/google/callback?error=access_denied');

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('http://localhost:4300/login?error=auth_failed');
  });

  it('redirects to auth_failed when state does not match', async () => {
    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const initResponse = await app.request('/auth/google');
    const cookies = extractCookies(initResponse);

    const callbackResponse = await app.request(
      '/auth/google/callback?code=auth-code&state=wrong-state',
      {
        headers: {
          cookie: `__oauth_state=${cookies.__oauth_state}; __oauth_pkce=${cookies.__oauth_pkce}`
        }
      }
    );

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get('location')).toBe(
      'http://localhost:4300/login?error=auth_failed'
    );
  });

  it('redirects to auth_failed when code is missing', async () => {
    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const initResponse = await app.request('/auth/google');
    const cookies = extractCookies(initResponse);

    const callbackResponse = await app.request('/auth/google/callback?state=test-state', {
      headers: {
        cookie: `__oauth_state=${cookies.__oauth_state}; __oauth_pkce=${cookies.__oauth_pkce}`
      }
    });

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get('location')).toBe(
      'http://localhost:4300/login?error=auth_failed'
    );
  });

  it('redirects to auth_failed when the signed ID token is invalid', async () => {
    global.fetch = mockFetch([
      {
        body: { id_token: 'mock-id-token' },
        method: 'POST',
        url: 'https://oauth2.googleapis.com/token'
      },
      {
        body: { error: 'invalid_token' },
        url: googleClaimsFixtureUrl
      }
    ]);

    await testDatabase.database.insert(admins).values({
      createdAt: '2026-05-01T10:00:00.000Z',
      email: 'admin@example.com',
      googleSub: 'google-user-id',
      updatedAt: '2026-05-01T10:00:00.000Z'
    });

    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const initResponse = await app.request('/auth/google');
    const cookies = extractCookies(initResponse);

    const callbackResponse = await app.request(
      `/auth/google/callback?code=auth-code&state=${cookies.__oauth_state}`,
      {
        headers: {
          cookie: `__oauth_state=${cookies.__oauth_state}; __oauth_pkce=${cookies.__oauth_pkce}`
        }
      }
    );

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get('location')).toBe(
      'http://localhost:4300/login?error=auth_failed'
    );
  });

  it('redirects to auth_failed when id token has invalid audience', async () => {
    global.fetch = mockFetch([
      {
        body: { id_token: 'mock-id-token' },
        method: 'POST',
        url: 'https://oauth2.googleapis.com/token'
      },
      {
        body: {
          aud: 'wrong-client-id',
          email: 'admin@example.com',
          exp: String(Math.floor(Date.now() / 1000) + 3600),
          iss: 'https://accounts.google.com',
          sub: 'google-user-id'
        },
        url: googleClaimsFixtureUrl
      }
    ]);

    await testDatabase.database.insert(admins).values({
      createdAt: '2026-05-01T10:00:00.000Z',
      email: 'admin@example.com',
      googleSub: 'google-user-id',
      updatedAt: '2026-05-01T10:00:00.000Z'
    });

    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const initResponse = await app.request('/auth/google');
    const cookies = extractCookies(initResponse);

    const callbackResponse = await app.request(
      `/auth/google/callback?code=auth-code&state=${cookies.__oauth_state}`,
      {
        headers: {
          cookie: `__oauth_state=${cookies.__oauth_state}; __oauth_pkce=${cookies.__oauth_pkce}`
        }
      }
    );

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get('location')).toBe(
      'http://localhost:4300/login?error=auth_failed'
    );
  });

  it('redirects to auth_failed when id token has invalid issuer', async () => {
    global.fetch = mockFetch([
      {
        body: { id_token: 'mock-id-token' },
        method: 'POST',
        url: 'https://oauth2.googleapis.com/token'
      },
      {
        body: {
          aud: 'test-google-client-id',
          email: 'admin@example.com',
          exp: String(Math.floor(Date.now() / 1000) + 3600),
          iss: 'https://evil.com',
          sub: 'google-user-id'
        },
        url: googleClaimsFixtureUrl
      }
    ]);

    await testDatabase.database.insert(admins).values({
      createdAt: '2026-05-01T10:00:00.000Z',
      email: 'admin@example.com',
      googleSub: 'google-user-id',
      updatedAt: '2026-05-01T10:00:00.000Z'
    });

    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const initResponse = await app.request('/auth/google');
    const cookies = extractCookies(initResponse);

    const callbackResponse = await app.request(
      `/auth/google/callback?code=auth-code&state=${cookies.__oauth_state}`,
      {
        headers: {
          cookie: `__oauth_state=${cookies.__oauth_state}; __oauth_pkce=${cookies.__oauth_pkce}`
        }
      }
    );

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get('location')).toBe(
      'http://localhost:4300/login?error=auth_failed'
    );
  });

  it('redirects to auth_failed when id token is expired', async () => {
    global.fetch = mockFetch([
      {
        body: { id_token: 'mock-id-token' },
        method: 'POST',
        url: 'https://oauth2.googleapis.com/token'
      },
      {
        body: {
          aud: 'test-google-client-id',
          email: 'admin@example.com',
          exp: String(Math.floor(Date.now() / 1000) - 3600),
          iss: 'https://accounts.google.com',
          sub: 'google-user-id'
        },
        url: googleClaimsFixtureUrl
      }
    ]);

    await testDatabase.database.insert(admins).values({
      createdAt: '2026-05-01T10:00:00.000Z',
      email: 'admin@example.com',
      googleSub: 'google-user-id',
      updatedAt: '2026-05-01T10:00:00.000Z'
    });

    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const initResponse = await app.request('/auth/google');
    const cookies = extractCookies(initResponse);

    const callbackResponse = await app.request(
      `/auth/google/callback?code=auth-code&state=${cookies.__oauth_state}`,
      {
        headers: {
          cookie: `__oauth_state=${cookies.__oauth_state}; __oauth_pkce=${cookies.__oauth_pkce}`
        }
      }
    );

    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get('location')).toBe(
      'http://localhost:4300/login?error=auth_failed'
    );
  });

  it('returns current user for valid session', async () => {
    global.fetch = mockFetch([
      {
        body: { id_token: 'mock-id-token' },
        method: 'POST',
        url: 'https://oauth2.googleapis.com/token'
      },
      {
        body: {
          aud: 'test-google-client-id',
          email: 'admin@example.com',
          exp: String(Math.floor(Date.now() / 1000) + 3600),
          iss: 'https://accounts.google.com',
          name: 'Admin User',
          picture: 'https://example.com/photo.jpg',
          sub: 'google-user-id'
        },
        url: googleClaimsFixtureUrl
      }
    ]);

    await testDatabase.database.insert(admins).values({
      createdAt: '2026-05-01T10:00:00.000Z',
      email: 'admin@example.com',
      googleSub: 'google-user-id',
      updatedAt: '2026-05-01T10:00:00.000Z'
    });

    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const initResponse = await app.request('/auth/google');
    const cookies = extractCookies(initResponse);

    const callbackResponse = await app.request(
      `/auth/google/callback?code=auth-code&state=${cookies.__oauth_state}`,
      {
        headers: {
          cookie: `__oauth_state=${cookies.__oauth_state}; __oauth_pkce=${cookies.__oauth_pkce}`
        }
      }
    );

    const sessionCookies = extractCookies(callbackResponse);

    const meResponse = await app.request('/auth/me', {
      headers: {
        cookie: `__session=${sessionCookies.__session}`
      }
    });

    expect(meResponse.status).toBe(200);
    const body = (await meResponse.json()) as {
      id: string;
      email: string;
      name: string;
      picture: string;
    };
    expect(body).toMatchObject({
      email: 'admin@example.com',
      id: 'google-user-id',
      name: 'Admin User',
      picture: 'https://example.com/photo.jpg'
    });
  });

  it('returns 401 when session is missing', async () => {
    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const response = await app.request('/auth/me');

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 401 when session token is invalid', async () => {
    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const response = await app.request('/auth/me', {
      headers: {
        cookie: '__session=invalid-token'
      }
    });

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('Unauthorized');
  });

  it('clears session cookie on logout', async () => {
    global.fetch = mockFetch([
      {
        body: { id_token: 'mock-id-token' },
        method: 'POST',
        url: 'https://oauth2.googleapis.com/token'
      },
      {
        body: {
          aud: 'test-google-client-id',
          email: 'admin@example.com',
          exp: String(Math.floor(Date.now() / 1000) + 3600),
          iss: 'https://accounts.google.com',
          sub: 'google-user-id'
        },
        url: googleClaimsFixtureUrl
      }
    ]);

    await testDatabase.database.insert(admins).values({
      createdAt: '2026-05-01T10:00:00.000Z',
      email: 'admin@example.com',
      googleSub: 'google-user-id',
      updatedAt: '2026-05-01T10:00:00.000Z'
    });

    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const initResponse = await app.request('/auth/google');
    const cookies = extractCookies(initResponse);

    const callbackResponse = await app.request(
      `/auth/google/callback?code=auth-code&state=${cookies.__oauth_state}`,
      {
        headers: {
          cookie: `__oauth_state=${cookies.__oauth_state}; __oauth_pkce=${cookies.__oauth_pkce}`
        }
      }
    );

    const sessionCookies = extractCookies(callbackResponse);

    const logoutResponse = await app.request('/auth/logout', {
      headers: {
        cookie: `__session=${sessionCookies.__session}`
      },
      method: 'POST'
    });

    expect(logoutResponse.status).toBe(204);

    const logoutCookies = extractCookies(logoutResponse);
    expect(logoutCookies.__session).toBe('');
  });

  it('bypasses bearer auth for auth routes', async () => {
    const app = createApp({
      apiKey: 'test-api-key',
      auth: authConfig,
      database: testDatabase.database
    });

    const response = await app.request('/auth/google', {
      headers: {
        'x-forwarded-for': '203.0.113.1'
      }
    });

    expect(response.status).toBe(302);
  });

  it('returns 503 when OAuth is not configured', async () => {
    const app = createApp({ database: testDatabase.database });

    const googleResponse = await app.request('/auth/google');
    expect(googleResponse.status).toBe(503);
    const googleBody = (await googleResponse.json()) as { error: string };
    expect(googleBody.error).toBe('OAuth not configured.');
    expect(googleResponse.headers.get('cache-control')).toBe('private, no-store');

    const callbackResponse = await app.request('/auth/google/callback');
    expect(callbackResponse.status).toBe(503);
    const callbackBody = (await callbackResponse.json()) as { error: string };
    expect(callbackBody.error).toBe('OAuth not configured.');
    expect(callbackResponse.headers.get('cache-control')).toBe('private, no-store');

    const meResponse = await app.request('/auth/me');
    expect(meResponse.status).toBe(503);
    const meBody = (await meResponse.json()) as { error: string };
    expect(meBody.error).toBe('OAuth not configured.');
    expect(meResponse.headers.get('cache-control')).toBe('private, no-store');

    const logoutResponse = await app.request('/auth/logout', { method: 'POST' });
    expect(logoutResponse.status).toBe(503);
    const logoutBody = (await logoutResponse.json()) as { error: string };
    expect(logoutBody.error).toBe('OAuth not configured.');
    expect(logoutResponse.headers.get('cache-control')).toBe('private, no-store');
  });
});
