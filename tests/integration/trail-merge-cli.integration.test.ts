import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parks, trailAreaLinks, trailMergeGroups } from '../../src/db/schema.js';
import { importOsmTrails } from '../../src/importer/import-osm-trails.js';
import { importParks } from '../../src/importer/import-parks.js';
import { createLipasPark } from '../fixtures/lipas.js';
import { createTestDatabase } from '../helpers/test-db.js';

const exec = promisify(execFile);
describe('manual trail merge operator command', () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  const args = ['--from', 'osm-relation-1', '--to', 'osm-relation-2'];
  const run = async (...argv: string[]) => {
    const file = String((await db.client.execute('PRAGMA database_list')).rows[0]!.file);
    return exec(
      process.execPath,
      [
        '--import',
        resolve('node_modules/tsx/dist/esm/index.mjs'),
        resolve('src/cli/merge-trails.ts'),
        ...argv
      ],
      {
        cwd: dirname(file),
        env: { DATABASE_URL: `file:${file}`, NODE_ENV: 'test', PATH: process.env.PATH }
      }
    );
  };
  beforeEach(async () => {
    db = await createTestDatabase();
    await importParks({
      database: db.database,
      sourceUrl: 'https://example.test',
      fetchSource: async () => ({ items: [createLipasPark()] })
    });
    await importOsmTrails({
      database: db.database,
      snapshot: {
        timestamp: '2026-11-12T10:00:00Z',
        routes: [1, 2].map((id) => ({
          id,
          name: `Polku ${id}`,
          reportedLengthKm: 1,
          geometry: {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: {
                  type: 'LineString',
                  coordinates: [
                    [25, 61 + id / 100],
                    [25.01, 61 + id / 100]
                  ]
                }
              }
            ]
          }
        }))
      }
    });
  });
  afterEach(async () => db.dispose());

  it('previews without writing, applies a name-driven slug, and accepts the exact original request again', async () => {
    const before = await db.database.select().from(parks);
    const preview = await run(...args, '--name', 'Storträskin reitti', '--dry-run');
    expect(preview.stdout).toContain('Would merge osm-relation-1 into stortraskin-reitti');
    expect(preview.stdout).toContain('unique mapped-line length');
    expect(preview.stdout).toContain('osm-relation-2, stortraskin-reitti');
    expect(await db.database.select().from(parks)).toEqual(before);
    expect(await db.database.select().from(trailMergeGroups)).toEqual([]);
    expect((await run(...args, '--name', 'Storträskin reitti')).stdout).toContain(
      'Merged osm-relation-1 into stortraskin-reitti'
    );
    expect((await run(...args, '--name', 'Storträskin reitti')).stdout).toContain(
      'Already merged into stortraskin-reitti; no changes.'
    );
  });

  it('keeps the existing destination slug and reports extra pinned areas without a name argument', async () => {
    const area = (await db.database.select().from(parks).where(eq(parks.lipasId, 12345)))[0]!;
    const source = (
      await db.database.select().from(parks).where(eq(parks.slug, 'osm-relation-1'))
    )[0]!;
    const [extra] = await db.database
      .insert(parks)
      .values({ ...area, id: undefined, lipasId: 999, slug: 'extra' })
      .returning();
    await db.database.insert(trailAreaLinks).values({
      trailId: source.id,
      areaId: extra!.id,
      override: 'include',
      createdAt: area.createdAt,
      updatedAt: area.updatedAt
    });
    const result = await run(...args);
    expect(result.stdout).toContain('Merged osm-relation-1 into osm-relation-2');
    expect(result.stdout).toContain('Additional pinned destination areas: extra');
  });

  it('rejects malformed arguments and missing values without writing', async () => {
    for (const input of [
      [],
      ['--apply'],
      ['--from'],
      ['--from', '--to', 'x'],
      [...args, '--from', 'x'],
      [...args, '--name'],
      ['--to', 'x']
    ]) {
      await expect(run(...input)).rejects.toThrow('Usage: npm run trails:merge');
    }
    expect(await db.database.select().from(trailMergeGroups)).toEqual([]);
  });

  it('refuses pending migrations even for preview and leaves migrations unapplied', async () => {
    await db.client.execute("DELETE FROM schema_migrations WHERE name = '0051_trail_merges.sql'");
    await expect(run(...args, '--dry-run')).rejects.toThrow('Run npm run db:migrate');
    expect(
      (
        await db.client.execute(
          "SELECT name FROM schema_migrations WHERE name = '0051_trail_merges.sql'"
        )
      ).rows
    ).toEqual([]);
    expect(await db.database.select().from(trailMergeGroups)).toEqual([]);
  });
});
