import { readFile, readdir } from 'node:fs/promises';

import type { Client } from '@libsql/client';

const migrationDirectoryUrl = new URL('./migrations/', import.meta.url);

export async function migrateDatabase(client: Client) {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const migrationFiles = (await readdir(migrationDirectoryUrl))
    .filter((filename) => filename.endsWith('.sql'))
    .sort();
  const appliedRows = await client.execute('SELECT name FROM schema_migrations');
  const appliedNames = new Set(appliedRows.rows.map((row) => String(row.name)));

  for (const filename of migrationFiles) {
    if (appliedNames.has(filename)) {
      continue;
    }

    const migrationFileUrl = new URL(`./migrations/${filename}`, import.meta.url);
    const sql = await readFile(migrationFileUrl, 'utf8');

    await client.executeMultiple(sql);
    await client.execute({
      args: [filename, new Date().toISOString()],
      sql: 'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)'
    });
  }
}
