import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createClient } from '@libsql/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getPendingMigrationNames, migrateDatabase } from '../../src/db/migrate.js';

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
    const tripColumns = await client.execute('PRAGMA table_info(trips)');
    const tripStopColumns = await client.execute('PRAGMA table_info(trip_stops)');
    const tripVisitColumns = await client.execute('PRAGMA table_info(park_visits)');
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
      '0008_manual_catalog_parks.sql',
      '0009_park_logos.sql',
      '0010_park_maps.sql',
      '0011_refresh_park_type_slugs.sql',
      '0012_supported_catalog_types.sql',
      '0013_park_imported_editable_fields.sql',
      '0014_cultural_history_area_type.sql',
      '0015_rename_park_urls.sql',
      '0016_trips.sql',
      '0017_trip_stop_order.sql',
      '0018_trip_slug_and_starting_point.sql',
      '0019_trip_stops.sql',
      '0020_trip_stop_visited_on.sql',
      '0021_visit_exclude_from_route.sql'
    ]);
    expect(parkTypes.rows.map((row) => String(row.slug))).toEqual([
      'outdoor-recreation-area',
      'hiking-area',
      'wilderness-area',
      'national-park',
      'nature-reserve-area',
      'walking-trail',
      'nature-trail',
      'hiking-trail',
      'cultural-history-area'
    ]);
    expect(parkColumns.rows.some((row) => String(row.name) === 'removed')).toBe(true);
    expect(parkColumns.rows.some((row) => String(row.name) === 'postal_code')).toBe(true);
    expect(parkColumns.rows.some((row) => String(row.name) === 'display_type_name')).toBe(true);
    expect(parkColumns.rows.some((row) => String(row.name) === 'managed_by_lipas_import')).toBe(
      true
    );
    expect(parkColumns.rows.some((row) => String(row.name) === 'logo_key')).toBe(true);
    expect(parkColumns.rows.some((row) => String(row.name) === 'logo_updated_at')).toBe(true);
    expect(parkColumns.rows.some((row) => String(row.name) === 'map_key')).toBe(true);
    expect(parkColumns.rows.some((row) => String(row.name) === 'map_updated_at')).toBe(true);
    expect(parkColumns.rows.some((row) => String(row.name) === 'imported_name')).toBe(true);
    expect(parkColumns.rows.some((row) => String(row.name) === 'imported_slug')).toBe(true);
    expect(parkColumns.rows.some((row) => String(row.name) === 'imported_location_label')).toBe(
      true
    );
    expect(parkColumns.rows.some((row) => String(row.name) === 'imported_display_type_name')).toBe(
      true
    );
    expect(tripColumns.rows.some((row) => String(row.name) === 'name')).toBe(true);
    expect(tripColumns.rows.some((row) => String(row.name) === 'slug')).toBe(true);
    expect(tripColumns.rows.some((row) => String(row.name) === 'description')).toBe(true);
    expect(tripColumns.rows.some((row) => String(row.name) === 'starting_point_label')).toBe(true);
    expect(tripColumns.rows.some((row) => String(row.name) === 'starting_point_lat')).toBe(true);
    expect(tripColumns.rows.some((row) => String(row.name) === 'starting_point_lon')).toBe(true);
    expect(tripStopColumns.rows.some((row) => String(row.name) === 'trip_id')).toBe(true);
    expect(tripStopColumns.rows.some((row) => String(row.name) === 'trip_stop_order')).toBe(true);
    expect(tripStopColumns.rows.some((row) => String(row.name) === 'visited_on')).toBe(true);
    expect(tripStopColumns.rows.some((row) => String(row.name) === 'label')).toBe(true);
    expect(tripStopColumns.rows.some((row) => String(row.name) === 'lat')).toBe(true);
    expect(tripStopColumns.rows.some((row) => String(row.name) === 'lon')).toBe(true);
    expect(tripStopColumns.rows.some((row) => String(row.name) === 'note')).toBe(true);
    expect(tripVisitColumns.rows.some((row) => String(row.name) === 'trip_id')).toBe(true);
    expect(tripVisitColumns.rows.some((row) => String(row.name) === 'trip_stop_order')).toBe(true);
    expect(tripVisitColumns.rows.some((row) => String(row.name) === 'exclude_from_route')).toBe(
      true
    );
    expect(publicDataVersionColumns.rows.some((row) => String(row.name) === 'version')).toBe(true);
  });

  it('reports pending migrations without mutating a fresh database', async () => {
    const pendingBeforeApply = await getPendingMigrationNames(client);
    const schemaMigrationTableBeforeApply = await client.execute(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = 'schema_migrations'
    `);

    await migrateDatabase(client);

    const pendingAfterApply = await getPendingMigrationNames(client);

    expect(pendingBeforeApply).toEqual([
      '0000_init.sql',
      '0001_park_types.sql',
      '0002_admins.sql',
      '0003_visit_details.sql',
      '0004_visit_images.sql',
      '0005_removed_parks.sql',
      '0006_public_data_versions.sql',
      '0007_postal_code_and_nature_trails.sql',
      '0008_manual_catalog_parks.sql',
      '0009_park_logos.sql',
      '0010_park_maps.sql',
      '0011_refresh_park_type_slugs.sql',
      '0012_supported_catalog_types.sql',
      '0013_park_imported_editable_fields.sql',
      '0014_cultural_history_area_type.sql',
      '0015_rename_park_urls.sql',
      '0016_trips.sql',
      '0017_trip_stop_order.sql',
      '0018_trip_slug_and_starting_point.sql',
      '0019_trip_stops.sql',
      '0020_trip_stop_visited_on.sql',
      '0021_visit_exclude_from_route.sql'
    ]);
    expect(schemaMigrationTableBeforeApply.rows).toEqual([]);
    expect(pendingAfterApply).toEqual([]);
  });

  it('renames the cultural history type and retags existing manual rows', async () => {
    await client.executeMultiple(`
      CREATE TABLE park_types (
        id INTEGER PRIMARY KEY,
        code INTEGER NOT NULL,
        name TEXT NOT NULL,
        slug TEXT NOT NULL
      );

      CREATE TABLE parks (
        id INTEGER PRIMARY KEY,
        managed_by_lipas_import INTEGER NOT NULL,
        type_id INTEGER NOT NULL,
        display_type_name TEXT,
        imported_display_type_name TEXT
      );
    `);

    await client.executeMultiple(`
      INSERT INTO park_types (id, code, name, slug)
      VALUES (9001, 9001, 'Tehdaskylä', 'factory-village');

      INSERT INTO parks (id, managed_by_lipas_import, type_id, display_type_name, imported_display_type_name)
      VALUES
        (1, 0, 103, 'Historia-alue', 'Historia-alue'),
        (2, 0, 9001, NULL, NULL),
        (3, 0, 9001, 'Maailmanperintökohde', 'Maailmanperintökohde'),
        (4, 0, 103, NULL, 'Historia-alue'),
        (5, 0, 103, 'Maailmanperintökohde', 'Maailmanperintökohde');
    `);

    const migrationSql = await readFile(
      new URL('../../src/db/migrations/0014_cultural_history_area_type.sql', import.meta.url),
      'utf8'
    );

    await client.executeMultiple(migrationSql);

    const parkTypes = await client.execute('SELECT id, name, slug FROM park_types WHERE id = 9001');
    const parks = await client.execute(
      'SELECT id, type_id, display_type_name, imported_display_type_name FROM parks ORDER BY id'
    );

    expect(parkTypes.rows).toEqual([
      {
        id: 9001,
        name: 'Historia-alue',
        slug: 'cultural-history-area'
      }
    ]);
    expect(parks.rows).toEqual([
      {
        display_type_name: null,
        id: 1,
        imported_display_type_name: null,
        type_id: 9001
      },
      {
        display_type_name: 'Tehdaskylä',
        id: 2,
        imported_display_type_name: 'Tehdaskylä',
        type_id: 9001
      },
      {
        display_type_name: 'Maailmanperintökohde',
        id: 3,
        imported_display_type_name: 'Maailmanperintökohde',
        type_id: 9001
      },
      {
        display_type_name: null,
        id: 4,
        imported_display_type_name: null,
        type_id: 9001
      },
      {
        display_type_name: 'Maailmanperintökohde',
        id: 5,
        imported_display_type_name: 'Maailmanperintökohde',
        type_id: 9001
      }
    ]);
  });

  it('backfills trip slugs and starting point columns for existing trips', async () => {
    await client.executeMultiple(`
      CREATE TABLE trips (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO trips (id, name, description, created_at, updated_at)
      VALUES
        (1, 'Kesäreissu 2026', 'Lapin kansallispuistoja.', '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'),
        (2, 'Kesäreissu 2026', NULL, '2026-06-02T00:00:00.000Z', '2026-06-02T00:00:00.000Z'),
        (3, 'Öinen retki / yö', NULL, '2026-06-03T00:00:00.000Z', '2026-06-03T00:00:00.000Z');
    `);

    const migrationSql = await readFile(
      new URL('../../src/db/migrations/0018_trip_slug_and_starting_point.sql', import.meta.url),
      'utf8'
    );

    await client.executeMultiple(migrationSql);

    const trips = await client.execute(`
      SELECT
        id,
        slug,
        starting_point_label,
        starting_point_lat,
        starting_point_lon
      FROM trips
      ORDER BY id
    `);

    expect(trips.rows).toEqual([
      {
        id: 1,
        slug: 'kesareissu-2026',
        starting_point_label: null,
        starting_point_lat: null,
        starting_point_lon: null
      },
      {
        id: 2,
        slug: 'kesareissu-2026-2',
        starting_point_label: null,
        starting_point_lat: null,
        starting_point_lon: null
      },
      {
        id: 3,
        slug: 'oinen-retki-yo',
        starting_point_label: null,
        starting_point_lat: null,
        starting_point_lon: null
      }
    ]);
  });
});
