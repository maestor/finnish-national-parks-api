import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createClient } from '@libsql/client';

import { createDatabase } from '../../src/db/database.js';
import { migrateDatabase } from '../../src/db/migrate.js';

export async function createTestDatabase() {
  const directory = await mkdtemp(join(tmpdir(), 'parks-api-'));
  const url = `file:${join(directory, 'test.db')}`;
  const client = createClient({ url });

  await migrateDatabase(client);

  return {
    database: createDatabase(client),
    async dispose() {
      await client.close();
      await rm(directory, { force: true, recursive: true });
    }
  };
}
