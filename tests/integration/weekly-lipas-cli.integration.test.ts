import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { createClient } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const script = resolve('src/cli/import-parks-scheduled.ts');
const loader = resolve('node_modules/tsx/dist/esm/index.mjs');

describe('scheduled LIPAS CLI boundaries', () => {
  let directory: string;
  let databaseUrl: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'parks-weekly-cli-'));
    databaseUrl = `file:${join(directory, 'test.db')}`;
  });

  afterEach(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  it.each([
    { github: {}, error: 'requires GITHUB_REPOSITORY and GITHUB_TOKEN' },
    { github: { GITHUB_REPOSITORY: '../another/repo', GITHUB_TOKEN: 'test' }, error: 'Invalid' },
    {
      github: { GITHUB_REPOSITORY: 'maestor/finnish-national-parks-api', GITHUB_TOKEN: 'test' },
      error: 'pending migrations'
    }
  ])('rejects invalid configuration or an outdated schema: $error', async ({ github, error }) => {
    await expect(
      execFileAsync(process.execPath, ['--import', loader, script], {
        cwd: directory,
        env: {
          DATABASE_URL: databaseUrl,
          NODE_ENV: 'test',
          PATH: process.env.PATH,
          ...github
        }
      })
    ).rejects.toMatchObject({ stderr: expect.stringContaining(error) });

    const client = createClient({ url: databaseUrl });
    try {
      const tables = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table'");
      expect(tables.rows).toEqual([]);
    } finally {
      await client.close();
    }
  });
});
