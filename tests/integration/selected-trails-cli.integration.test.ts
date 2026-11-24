import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { migrateDatabase } from '../../src/db/migrate.js';
import {
  curatedTrailSources,
  osmTrailSources,
  parks,
  trailAreaLinks
} from '../../src/db/schema.js';
import { importParks } from '../../src/importer/import-parks.js';
import { createLipasPark } from '../fixtures/lipas.js';

const exec = promisify(execFile);
const cli = resolve('src/cli/import-selected-trails.ts');
const loader = resolve('node_modules/tsx/dist/loader.mjs');
const manifest = JSON.parse(
  await readFile(new URL('../../src/importer/osm-linked-trails.geojson', import.meta.url), 'utf8')
) as { selections: { parentSlug: string; name: string; selectionKey: string }[] };
const parentSlugs = [...new Set(manifest.selections.map((selection) => selection.parentSlug))];

describe('selected trails CLI', () => {
  let directory: string;
  let client: ReturnType<typeof createClient>;
  let database: ReturnType<typeof createDatabase>;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'selected-trails-cli-'));
    client = createClient({ url: `file:${join(directory, 'catalog.db')}` });
    await migrateDatabase(client);
    database = createDatabase(client);
    await importParks({
      database,
      sourceUrl: 'https://example.test',
      fetchSource: async () => ({ items: [createLipasPark()] })
    });
    const { id: _id, ...area } = (await database.select().from(parks))[0]!;
    await database.insert(parks).values(
      parentSlugs.map((slug, index) => ({
        ...area,
        slug,
        name: slug,
        lipasId: 900000 + index
      }))
    );
  });
  afterEach(async () => {
    await client.close();
    await rm(directory, { recursive: true, force: true });
  });
  const run = async (...args: string[]) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: `file:${join(directory, 'catalog.db')}`,
      DOTENV_CONFIG_QUIET: 'true'
    };
    delete env.DATABASE_AUTH_TOKEN;
    return exec(process.execPath, ['--import', loader, cli, ...args], { cwd: directory, env });
  };
  it('lists only changed trails in readable preview and apply output', async () => {
    const preview = await run('--dry-run');
    expect(preview.stdout).toContain(
      `Dry run — ${manifest.selections.length} trails in ${parentSlugs.length} areas`
    );
    expect(preview.stdout).toContain(`${manifest.selections.length} to add, 0 to update`);
    for (const selection of manifest.selections) {
      expect(preview.stdout).toContain(selection.parentSlug);
      expect(preview.stdout).toContain(selection.name);
    }
    expect(preview.stdout).toContain('--json');
    expect(preview.stdout).not.toContain('"geometryHash"');
    expect(preview.stdout).not.toContain('(add)');
    expect(await database.select().from(curatedTrailSources)).toHaveLength(0);
    const applied = await run();
    expect(applied.stdout).toContain(
      `Imported — ${manifest.selections.length} trails in ${parentSlugs.length} areas`
    );
    expect(applied.stdout).toContain(`${manifest.selections.length} added, 0 updated`);
    expect(applied.stderr).toContain('Expire affected UI caches now');
    expect(await database.select().from(trailAreaLinks)).toHaveLength(manifest.selections.length);
    const rerun = await run();
    expect(rerun.stdout.trim()).toBe('No changes needed.');
    expect(rerun.stderr).not.toContain('Expire');
    expect((await run('--dry-run')).stdout.trim()).toBe('No changes needed.');
    const link = (await database.select().from(trailAreaLinks))[0]!;
    const [changed] = await database.select().from(parks).where(eq(parks.id, link.trailId));
    await database.delete(trailAreaLinks).where(eq(trailAreaLinks.trailId, link.trailId));
    const mixed = await run('--dry-run');
    expect(mixed.stdout).toContain('Dry run — 1 trail in 1 area');
    expect(mixed.stdout).toContain('0 to add, 1 to update');
    expect(mixed.stdout).not.toContain('unchanged');
    expect(mixed.stdout.split('\n').filter((line) => line.startsWith('- '))).toEqual([
      `- ${changed!.name}`
    ]);
    const previewJson = JSON.parse((await run('--dry-run', '--json')).stdout);
    expect(previewJson.selections).toEqual([
      expect.objectContaining({ name: changed!.name, action: 'update' })
    ]);
    const mixedApply = await run();
    expect(mixedApply.stdout).toContain('Imported — 1 trail in 1 area');
    expect(mixedApply.stdout).toContain('0 added, 1 updated');
    expect(mixedApply.stdout).not.toContain('unchanged');
    expect(mixedApply.stdout.split('\n').filter((line) => line.startsWith('- '))).toEqual([
      `- ${changed!.name}`
    ]);
  });
  it('lists only changed trails in JSON preview and apply output', async () => {
    const preview = JSON.parse((await run('--dry-run', '--json')).stdout);
    expect(preview.mode).toBe('preview');
    expect(preview.selections).toHaveLength(manifest.selections.length);
    expect(preview.selections[0].geometryHash).toMatch(/^[a-f0-9]{64}$/);
    const applied = JSON.parse((await run('--json')).stdout);
    expect(applied.mode).toBe('apply');
    expect(applied.manifestHash).toBe(preview.manifestHash);
    expect(applied.selections).toHaveLength(manifest.selections.length);
    const [link] = await database.select().from(trailAreaLinks).limit(1);
    await database.delete(trailAreaLinks).where(eq(trailAreaLinks.trailId, link!.trailId));
    const mixedApply = JSON.parse((await run('--json')).stdout);
    expect(mixedApply.selections).toEqual([
      expect.objectContaining({ trailId: link!.trailId, action: 'update' })
    ]);
    for (const args of [['--json', '--dry-run'], ['--json']]) {
      const rerun = JSON.parse((await run(...args)).stdout);
      expect(rerun.affectedSlugs).toEqual([]);
      expect(rerun.selections).toEqual([]);
    }
  });
  it('imports reviewed national park routes while preserving a previous OSM trail identity', async () => {
    const { id: _id, ...area } = (await database.select().from(parks))[0]!;
    const [iso] = await database
      .insert(parks)
      .values({
        ...area,
        lipasId: -42,
        managedByLipasImport: false,
        name: 'Iso Karhunkierros',
        importedName: 'Iso Karhunkierros',
        lengthKm: 82,
        importedLengthKm: 82,
        slug: 'osm-relation-1633747',
        typeId: 4405,
        trailPublicationRole: 'area_member',
        removed: true
      })
      .returning();
    await database.insert(osmTrailSources).values({
      trailId: iso!.id,
      relationId: 1633747,
      sourceTimestamp: '2026-11-10T21:21:39Z'
    });
    const before = JSON.parse((await run('--dry-run', '--json')).stdout);
    expect(before.selections.map((trail: { action: string }) => trail.action).sort()).toEqual([
      ...Array(manifest.selections.length - 1).fill('create'),
      'update'
    ]);
    expect(await database.select().from(curatedTrailSources)).toHaveLength(0);
    const applied = JSON.parse((await run('--json')).stdout);
    expect(applied.selections).toHaveLength(manifest.selections.length);
    expect((await database.select().from(parks).where(eq(parks.id, iso!.id)))[0]).toMatchObject({
      name: 'Iso Karhunkierros',
      slug: 'osm-relation-1633747',
      lengthKm: 89
    });
    expect(
      (await database.select().from(curatedTrailSources))
        .filter((source) => source.selectionKey.startsWith('osm-relation-'))
        .every(
          (source) =>
            source.sourceKind === 'osm-relation' &&
            JSON.parse(source.sourceUrlsJson)[0] ===
              `https://www.openstreetmap.org/relation/${source.selectionKey.slice(13)}`
        )
    ).toBe(true);
    expect(await database.select().from(trailAreaLinks)).toHaveLength(manifest.selections.length);
    const rerun = JSON.parse((await run('--json')).stdout);
    expect(rerun.affectedSlugs).toEqual([]);
    expect(rerun.selections).toEqual([]);
  });
  it('identifies distant namesakes without treating them as imported trails', async () => {
    const { id: _id, ...area } = (await database.select().from(parks))[0]!;
    await database.insert(parks).values({
      ...area,
      name: 'Korpinkierros',
      slug: 'unrelated-korpinkierros',
      lipasId: 603820,
      typeId: 4405,
      bboxMinLon: 22.96,
      bboxMaxLon: 22.98,
      bboxMinLat: 63.25,
      bboxMaxLat: 63.28
    });
    const preview = await run('--dry-run');
    expect(preview.stdout).not.toContain('unrelated-korpinkierros');
    const details = JSON.parse((await run('--dry-run', '--json')).stdout);
    expect(details.selections).toContainEqual(
      expect.objectContaining({
        name: 'Korpinkierros',
        distantNamesakes: [expect.objectContaining({ slug: 'unrelated-korpinkierros' })]
      })
    );
    expect(await database.select().from(curatedTrailSources)).toHaveLength(0);
  });
  it('applies only the requested selections', async () => {
    const requested = manifest.selections.slice(0, 2).map(({ selectionKey }) => selectionKey);
    const result = JSON.parse(
      (
        await run(
          '--json',
          '--guard-public-conversions',
          ...requested.flatMap((key) => ['--selection', key])
        )
      ).stdout
    );
    expect(result.selections.map(({ key }: { key: string }) => key)).toEqual(requested);
    expect(
      (await database.select().from(curatedTrailSources))
        .map(({ selectionKey }) => selectionKey)
        .sort()
    ).toEqual(requested.toSorted());
    await expect(run('--selection', 'unknown')).rejects.toThrow('Unknown selection keys: unknown');
  });

  it('refuses pending migrations and unsupported arguments', async () => {
    await client.execute(
      "DELETE FROM schema_migrations WHERE name = '0052_curated_trail_sources.sql'"
    );
    await expect(run('--dry-run')).rejects.toThrow('Database schema is not current');
    await expect(run('--selection')).rejects.toThrow('Usage:');
    await expect(run('--selection', 'one', '--selection', 'one')).rejects.toThrow('Usage:');
    await expect(run('--json', '--json')).rejects.toThrow('Usage:');
  });
});
