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

const mockFetch = (
  responses: Array<{
    body: object;
    method?: string;
    status?: number;
    url: RegExp | string;
  }>
) => {
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const match = responses.find((r) => {
      const urlMatch = typeof r.url === 'string' ? url === r.url : r.url.test(url);
      const methodMatch = !r.method || r.method === method;
      return urlMatch && methodMatch;
    });

    if (!match) {
      return Promise.resolve(new Response('Not found', { status: 404 }));
    }

    return Promise.resolve(
      new Response(JSON.stringify(match.body), {
        headers: { 'Content-Type': 'application/json' },
        status: match.status ?? 200
      })
    );
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
        url: 'https://oauth2.googleapis.com/tokeninfo?id_token=mock-id-token'
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
    expect(callbackResponse.headers.get('location')).toBe('http://localhost:4300/control-panel');

    const sessionCookies = extractCookies(callbackResponse);
    expect(sessionCookies.__session).toBeDefined();
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
        url: 'https://oauth2.googleapis.com/tokeninfo?id_token=mock-id-token'
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

  it('redirects to auth_failed when tokeninfo endpoint rejects the id token', async () => {
    global.fetch = mockFetch([
      {
        body: { id_token: 'mock-id-token' },
        method: 'POST',
        url: 'https://oauth2.googleapis.com/token'
      },
      {
        body: { error: 'invalid_token' },
        status: 400,
        url: 'https://oauth2.googleapis.com/tokeninfo?id_token=mock-id-token'
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
        url: 'https://oauth2.googleapis.com/tokeninfo?id_token=mock-id-token'
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
        url: 'https://oauth2.googleapis.com/tokeninfo?id_token=mock-id-token'
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
        url: 'https://oauth2.googleapis.com/tokeninfo?id_token=mock-id-token'
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
        url: 'https://oauth2.googleapis.com/tokeninfo?id_token=mock-id-token'
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
        url: 'https://oauth2.googleapis.com/tokeninfo?id_token=mock-id-token'
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

    const callbackResponse = await app.request('/auth/google/callback');
    expect(callbackResponse.status).toBe(503);
    const callbackBody = (await callbackResponse.json()) as { error: string };
    expect(callbackBody.error).toBe('OAuth not configured.');

    const meResponse = await app.request('/auth/me');
    expect(meResponse.status).toBe(503);
    const meBody = (await meResponse.json()) as { error: string };
    expect(meBody.error).toBe('OAuth not configured.');

    const logoutResponse = await app.request('/auth/logout', { method: 'POST' });
    expect(logoutResponse.status).toBe(503);
    const logoutBody = (await logoutResponse.json()) as { error: string };
    expect(logoutBody.error).toBe('OAuth not configured.');
  });
});
