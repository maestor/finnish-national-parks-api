import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { createTestDatabase } from '../helpers/test-db.js';

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

  it('keeps removed-park admin listing protected', async () => {
    const app = createApp({ apiKey, database: testDatabase.database });

    const unauthorizedResponse = await app.request('/api/parks/removed', {
      headers: {
        'x-forwarded-for': '203.0.113.1'
      }
    });
    const authorizedResponse = await app.request('/api/parks/removed', {
      headers: {
        authorization: `Bearer ${apiKey}`,
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

  it('leaves public summary endpoints unprotected', async () => {
    const app = createApp({ apiKey, database: testDatabase.database });

    const response = await app.request('/api/public/home-summary', {
      headers: {
        'x-forwarded-for': '203.0.113.1'
      }
    });

    expect(response.status).toBe(200);
  });
});
