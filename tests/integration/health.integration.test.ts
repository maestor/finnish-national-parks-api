import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { createTestDatabase } from '../helpers/test-db.js';

describe('health endpoint', () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    testDatabase = await createTestDatabase();
  });

  afterEach(async () => {
    await testDatabase.dispose();
  });

  it('returns a healthy response', async () => {
    const response = await createApp().request('/health');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: 'finnish-national-parks-api'
    });
  });

  it('exposes the OpenAPI document', async () => {
    const response = await createApp({ database: testDatabase.database }).request('/openapi.json');
    const document = (await response.json()) as { paths: Record<string, unknown> };
    const serialized = JSON.stringify(document);

    expect(response.status).toBe(200);
    expect(document.paths['/health']).toBeDefined();
    expect(serialized).toContain('hasMagnet');
  });

  it('returns safe 500 for unhandled errors without leaking stack traces', async () => {
    const app = createApp();
    app.get('/test-error', () => {
      throw new Error('Unexpected failure');
    });

    const response = await app.request('/test-error');
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(500);
    expect(body.error).toBe('Internal server error.');
  });
});
