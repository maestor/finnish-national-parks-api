import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { createSessionToken } from '../../src/http/session.js';
import { createTestDatabase } from '../helpers/test-db.js';

const authConfig = {
  cookieName: '__session',
  frontendUrl: 'http://localhost:4300',
  googleClientId: 'test-google-client-id',
  googleClientSecret: 'test-google-client-secret',
  jwtSecret: 'test-jwt-secret-at-least-32-characters-long'
};

const createAdminSessionCookie = async () => {
  const token = await createSessionToken(
    {
      email: 'admin@example.com',
      name: 'Admin User',
      picture: 'https://example.com/photo.jpg',
      sub: 'google-user-id'
    },
    new TextEncoder().encode(authConfig.jwtSecret)
  );

  return `${authConfig.cookieName}=${token}`;
};

describe('auth middleware', () => {
  const apiKey = 'test-secret-key';
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    testDatabase = await createTestDatabase();
  });

  afterEach(async () => {
    await testDatabase.dispose();
  });

  it('allows all requests when no api key is configured', async () => {
    const app = createApp({ database: testDatabase.database });
    const response = await app.request('/api/parks');

    expect(response.status).toBe(200);
  });

  it('allows localhost requests without an api key', async () => {
    const app = createApp({ apiKey, database: testDatabase.database });

    const localhostResponse = await app.request('/api/parks', {
      headers: {
        host: 'localhost:3004'
      }
    });
    const ipv4Response = await app.request('/api/parks', {
      headers: {
        host: '127.0.0.1'
      }
    });
    const ipv6Response = await app.request('/api/parks', {
      headers: {
        host: '::1'
      }
    });

    expect(localhostResponse.status).toBe(200);
    expect(ipv4Response.status).toBe(200);
    expect(ipv6Response.status).toBe(200);
  });

  it('rejects remote requests without an api key', async () => {
    const app = createApp({ apiKey, database: testDatabase.database });
    const response = await app.request('/api/parks', {
      headers: {
        'x-forwarded-for': '203.0.113.1'
      }
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('rejects remote requests with an invalid api key', async () => {
    const app = createApp({ apiKey, database: testDatabase.database });
    const response = await app.request('/api/parks', {
      headers: {
        authorization: 'Bearer wrong-key',
        'x-forwarded-for': '203.0.113.1'
      }
    });

    expect(response.status).toBe(401);
  });

  it('allows remote requests with a valid api key', async () => {
    const app = createApp({ apiKey, database: testDatabase.database });
    const response = await app.request('/api/parks', {
      headers: {
        authorization: `Bearer ${apiKey}`,
        'x-forwarded-for': '203.0.113.1'
      }
    });

    expect(response.status).toBe(200);
  });

  it('keeps admin park visibility listing protected', async () => {
    const app = createApp({ apiKey, auth: authConfig, database: testDatabase.database });

    const unauthorizedResponse = await app.request('/api/admin/parks/visibility', {
      headers: {
        'x-forwarded-for': '203.0.113.1'
      }
    });
    const authorizedResponse = await app.request('/api/admin/parks/visibility', {
      headers: {
        authorization: `Bearer ${apiKey}`,
        cookie: await createAdminSessionCookie(),
        'x-forwarded-for': '203.0.113.1'
      }
    });

    expect(unauthorizedResponse.status).toBe(401);
    expect(authorizedResponse.status).toBe(200);
  });

  it('leaves health and openapi.json unprotected', async () => {
    const app = createApp({ apiKey, database: testDatabase.database });

    const healthResponse = await app.request('/health', {
      headers: {
        'x-forwarded-for': '203.0.113.1'
      }
    });
    const openApiResponse = await app.request('/openapi.json', {
      headers: {
        'x-forwarded-for': '203.0.113.1'
      }
    });

    expect(healthResponse.status).toBe(200);
    expect(openApiResponse.status).toBe(200);
  });

  it('protects public summary endpoints', async () => {
    const app = createApp({ apiKey, database: testDatabase.database });

    const unauthorizedResponse = await app.request('/api/public/home-summary', {
      headers: {
        'x-forwarded-for': '203.0.113.1'
      }
    });
    const authorizedResponse = await app.request('/api/public/home-summary', {
      headers: {
        authorization: `Bearer ${apiKey}`,
        'x-forwarded-for': '203.0.113.1'
      }
    });

    expect(unauthorizedResponse.status).toBe(401);
    expect(authorizedResponse.status).toBe(200);
  });
});
