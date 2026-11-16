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
import { curatedTrailSources, parks, trailAreaLinks } from '../../src/db/schema.js';
import { importParks } from '../../src/importer/import-parks.js';
import { createLipasPark } from '../fixtures/lipas.js';

const exec = promisify(execFile);
const cli = resolve('src/cli/import-selected-trails.ts');
const loader = resolve('node_modules/tsx/dist/loader.mjs');
const manifest = JSON.parse(
  await readFile(
    new URL('../../src/importer/selected-trails/selected-trails-27.json', import.meta.url),
    'utf8'
  )
) as { selections: { parentSlug: string; name: string }[] };

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
      [...new Set(manifest.selections.map((s) => s.parentSlug))].map((slug, index) => ({
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
  it('shows a readable preview and apply summary, with a compact no-op rerun', async () => {
    const preview = await run('--selection', 'visited-trails-2026-11', '--dry-run');
    expect(preview.stdout).toContain('Dry run — 27 trails in 11 areas');
    expect(preview.stdout).toContain('27 to add, 0 to update, 0 unchanged');
    for (const selection of manifest.selections) {
      expect(preview.stdout).toContain(selection.parentSlug);
      expect(preview.stdout).toContain(selection.name);
    }
    expect(preview.stdout).toContain('--json');
    expect(preview.stdout).not.toContain('"geometryHash"');
    expect(preview.stdout).not.toContain('(add)');
    expect(await database.select().from(curatedTrailSources)).toHaveLength(0);
    const applied = await run('--selection', 'visited-trails-2026-11');
    expect(applied.stdout).toContain('Imported — 27 trails in 11 areas');
    expect(applied.stdout).toContain('27 added, 0 updated, 0 unchanged');
    expect(applied.stderr).toContain('Expire affected UI caches now');
    expect(await database.select().from(trailAreaLinks)).toHaveLength(27);
    const rerun = await run('--selection', 'visited-trails-2026-11');
    expect(rerun.stdout).toContain('No changes needed');
    expect(rerun.stderr).not.toContain('Expire');
    const link = (await database.select().from(trailAreaLinks))[0]!;
    await database.delete(trailAreaLinks).where(eq(trailAreaLinks.trailId, link.trailId));
    const mixed = await run('--selection', 'visited-trails-2026-11', '--dry-run');
    expect(mixed.stdout).toContain('0 to add, 1 to update, 26 unchanged');
    expect(mixed.stdout).toContain('(update)');
    expect(mixed.stdout).toContain('(unchanged)');
  });
  it('provides the complete structured report on request', async () => {
    const preview = JSON.parse(
      (await run('--selection', 'visited-trails-2026-11', '--dry-run', '--json')).stdout
    );
    expect(preview.mode).toBe('preview');
    expect(preview.selections).toHaveLength(27);
    expect(preview.selections[0].geometryHash).toMatch(/^[a-f0-9]{64}$/);
    const applied = JSON.parse(
      (await run('--selection', 'visited-trails-2026-11', '--json')).stdout
    );
    expect(applied.mode).toBe('apply');
    expect(applied.manifestHash).toBe(preview.manifestHash);
    const rerun = JSON.parse(
      (await run('--selection', 'visited-trails-2026-11', '--json', '--dry-run')).stdout
    );
    expect(rerun.affectedSlugs).toEqual([]);
    expect(rerun.selections.every((s: { action: string }) => s.action === 'unchanged')).toBe(true);
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
    const preview = await run('--selection', 'visited-trails-2026-11', '--dry-run');
    expect(preview.stdout).toContain('Other trails with the same name (not changed):');
    expect(preview.stdout).toContain('Korpinkierros: unrelated-korpinkierros');
    expect(await database.select().from(curatedTrailSources)).toHaveLength(0);
  });
  it('refuses pending migrations and unsupported arguments', async () => {
    await client.execute(
      "DELETE FROM schema_migrations WHERE name = '0052_curated_trail_sources.sql'"
    );
    await expect(run('--selection', 'visited-trails-2026-11', '--dry-run')).rejects.toThrow(
      'Database schema is not current'
    );
    await expect(run('--selection', 'other')).rejects.toThrow('Usage:');
    await expect(run('--selection', 'visited-trails-2026-11', '--json', '--json')).rejects.toThrow(
      'Usage:'
    );
  });
});
