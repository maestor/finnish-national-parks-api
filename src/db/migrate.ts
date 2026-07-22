import { readdir, readFile } from 'node:fs/promises';

import type { Client } from '@libsql/client';

const migrationDirectoryUrl = new URL('./migrations/', import.meta.url);

const ensureSchemaMigrationsTable = async (client: Client) => {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
};

const getMigrationFileNames = async () => {
  return (await readdir(migrationDirectoryUrl))
    .filter((filename) => filename.endsWith('.sql'))
    .sort();
};

const getAppliedMigrationNames = async (client: Client) => {
  const tableExists = await client.execute(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name = 'schema_migrations'
  `);

  if (tableExists.rows.length === 0) {
    return new Set<string>();
  }

  const appliedRows = await client.execute('SELECT name FROM schema_migrations');
  return new Set(appliedRows.rows.map((row) => String(row.name)));
};

export const getPendingMigrationNames = async (client: Client) => {
  const [migrationFiles, appliedNames] = await Promise.all([
    getMigrationFileNames(),
    getAppliedMigrationNames(client)
  ]);

  return migrationFiles.filter((filename) => !appliedNames.has(filename));
};

export const migrateDatabase = async (client: Client) => {
  await ensureSchemaMigrationsTable(client);

  for (const filename of await getPendingMigrationNames(client)) {
    const migrationFileUrl = new URL(`./migrations/${filename}`, import.meta.url);
    const sql = await readFile(migrationFileUrl, 'utf8');

    await client.executeMultiple(sql);
    await client.execute({
      args: [filename, new Date().toISOString()],
      sql: 'INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)'
    });
  }
};
