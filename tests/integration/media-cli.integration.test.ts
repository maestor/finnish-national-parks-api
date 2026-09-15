import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { createClient } from '@libsql/client';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const tsxLoaderPath = resolve('node_modules/tsx/dist/esm/index.mjs');
const cliScripts = [
  'src/cli/backfill-image-derivatives.ts',
  'src/cli/cleanup-unused-images.ts',
  'src/cli/retire-converted-image-originals.ts'
];

describe('media CLI migration boundary', () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { force: true, recursive: true }))
    );
  });

  it.each(cliScripts)(
    'does not migrate an empty database before %s validates storage',
    async (script) => {
      const directory = await mkdtemp(join(tmpdir(), 'parks-media-cli-'));
      temporaryDirectories.push(directory);
      const databasePath = join(directory, 'empty.db');
      const databaseUrl = `file:${databasePath}`;

      await expect(
        execFileAsync(process.execPath, ['--import', tsxLoaderPath, resolve(script)], {
          cwd: directory,
          env: {
            DATABASE_URL: databaseUrl,
            MEMORY_STORAGE: 'false',
            NODE_ENV: 'test',
            PATH: process.env.PATH
          }
        })
      ).rejects.toMatchObject({ stderr: expect.stringContaining('requires R2_') });

      const client = createClient({ url: databaseUrl });
      const tables = await client.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('schema_migrations', 'parks', 'media_uploads')"
      );
      await client.close();

      expect(tables.rows).toEqual([]);
    }
  );

  it.each(cliScripts)(
    'reports pending migrations without changing the database for %s',
    async (script) => {
      const directory = await mkdtemp(join(tmpdir(), 'parks-media-cli-pending-'));
      temporaryDirectories.push(directory);
      const databasePath = join(directory, 'pending.db');
      const databaseUrl = `file:${databasePath}`;

      await expect(
        execFileAsync(process.execPath, ['--import', tsxLoaderPath, resolve(script)], {
          cwd: directory,
          env: {
            DATABASE_URL: databaseUrl,
            MEMORY_STORAGE: 'false',
            NODE_ENV: 'test',
            PATH: process.env.PATH,
            R2_ACCESS_KEY_ID: 'test-access-key',
            R2_BUCKET_NAME: 'test-bucket',
            R2_ENDPOINT: 'https://r2.example.test',
            R2_SECRET_ACCESS_KEY: 'test-secret-key'
          }
        })
      ).rejects.toMatchObject({
        stderr: expect.stringContaining('Database schema is not current')
      });

      const client = createClient({ url: databaseUrl });
      const tables = await client.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('schema_migrations', 'parks', 'media_uploads')"
      );
      await client.close();

      expect(tables.rows).toEqual([]);
    }
  );
});
