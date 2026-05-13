import { describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';

describe('health endpoint', () => {
  it('returns a healthy response', async () => {
    const response = await createApp().request('/health');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: 'finnish-national-parks-api'
    });
  });

  it('exposes the OpenAPI document', async () => {
    const response = await createApp().request('/openapi.json');
    const document = (await response.json()) as { paths: Record<string, unknown> };

    expect(response.status).toBe(200);
    expect(document.paths['/health']).toBeDefined();
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
