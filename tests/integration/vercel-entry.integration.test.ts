import { describe, expect, it } from 'vitest';

import app from '../../src/index.js';

describe('Vercel entrypoint', () => {
  it('exports a Hono app that can serve requests directly', async () => {
    const response = await app.request('/health');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: 'finnish-national-parks-api'
    });
  });
});
