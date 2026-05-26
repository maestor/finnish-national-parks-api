import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createClient } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { migrateDatabase } from '../../src/db/migrate.js';

describe('migrateDatabase', () => {
  let directory: string;
  let client: ReturnType<typeof createClient>;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'parks-migrate-'));
    client = createClient({
      url: `file:${join(directory, 'test.db')}`
    });
  });

  afterEach(async () => {
    await client.close();
    await rm(directory, { force: true, recursive: true });
  });

  it('applies each migration once even when called repeatedly', async () => {
    await migrateDatabase(client);
    await migrateDatabase(client);

    const migrations = await client.execute('SELECT name FROM schema_migrations ORDER BY name');
    const parkTypes = await client.execute('SELECT slug FROM park_types ORDER BY id');
    const parkColumns = await client.execute('PRAGMA table_info(parks)');
    const publicDataVersionColumns = await client.execute(
      'PRAGMA table_info(public_data_versions)'
    );

    expect(migrations.rows.map((row) => String(row.name))).toEqual([
      '0000_init.sql',
      '0001_park_types.sql',
      '0002_admins.sql',
      '0003_visit_details.sql',
      '0004_visit_images.sql',
      '0005_removed_parks.sql',
      '0006_public_data_versions.sql',
      '0007_postal_code_and_nature_trails.sql',
      '0008_manual_catalog_parks.sql'
    ]);
    expect(parkTypes.rows.map((row) => String(row.slug))).toEqual([
      'outdoor-recreation-area',
      'state-hiking-area',
      'wilderness-area',
      'national-park',
      'other-nature-reserve',
      'nature-trail'
    ]);
    expect(parkColumns.rows.some((row) => String(row.name) === 'removed')).toBe(true);
    expect(parkColumns.rows.some((row) => String(row.name) === 'postal_code')).toBe(true);
    expect(parkColumns.rows.some((row) => String(row.name) === 'display_type_name')).toBe(true);
    expect(parkColumns.rows.some((row) => String(row.name) === 'managed_by_lipas_import')).toBe(
      true
    );
    expect(publicDataVersionColumns.rows.some((row) => String(row.name) === 'version')).toBe(true);
  });
});
