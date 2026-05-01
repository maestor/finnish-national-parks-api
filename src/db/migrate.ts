import { readFile } from 'node:fs/promises';

import type { Client } from '@libsql/client';

const migrationFileUrl = new URL('./migrations/0000_init.sql', import.meta.url);

export async function migrateDatabase(client: Client) {
  const sql = await readFile(migrationFileUrl, 'utf8');
  await client.executeMultiple(sql);
}
