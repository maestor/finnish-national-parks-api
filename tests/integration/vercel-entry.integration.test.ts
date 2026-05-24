import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import app from '../../src/index.js';

describe('Vercel entrypoint', () => {
  it('keeps a direct hono import in the recognized Vercel entry file', async () => {
    const source = await readFile(resolve(process.cwd(), 'src/index.ts'), 'utf8');

    expect(source).toMatch(/from ['"]hono['"]/);
  });

  it('exports a Hono app that can serve requests directly', async () => {
    const response = await app.request('/health');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: 'finnish-national-parks-api'
    });
  });
});
