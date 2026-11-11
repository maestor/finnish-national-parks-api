import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { migrateDatabase } from '../../src/db/migrate.js';
import { parks, trailAreaLinks } from '../../src/db/schema.js';
import { importParks } from '../../src/importer/import-parks.js';
import { createLipasPark } from '../fixtures/lipas.js';

const exec = promisify(execFile);
const cli = resolve('src/cli/import-osm-trails.ts');
const loader = resolve('node_modules/tsx/dist/loader.mjs');
describe('OSM import command', () => {
  let directory: string;
  let client: ReturnType<typeof createClient>;
  let database: ReturnType<typeof createDatabase>;
  let preload: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'osm-cli-'));
    client = createClient({ url: `file:${join(directory, 'catalog.db')}` });
    await migrateDatabase(client);
    database = createDatabase(client);
    await importParks({
      database,
      sourceUrl: 'https://example.test',
      fetchSource: async () => ({ items: [createLipasPark()] })
    });
    preload = join(directory, 'mock-source.mjs');
    await writeFile(
      preload,
      `const osm3s={timestamp_osm_base:'2026-11-10T21:21:39Z'};
const roots=[{type:'relation',id:12345,tags:{type:'route',route:'foot',name:'Testipolku'}},{type:'relation',id:12346,tags:{type:'route',route:'foot',name:'Pitkä reitti',distance:'150'}},{type:'relation',id:12347,tags:{type:'route',route:'foot',name:'Alapolku'}}];
const relation=(id,coordinates)=>({type:'relation',id,members:[{type:'way',ref:id,geometry:coordinates}]});
const members=[relation(12345,[{lon:25,lat:61},{lon:25.01,lat:61}]),relation(12346,[{lon:25,lat:61},{lon:25.01,lat:61}]),relation(12347,[{lon:25.002,lat:61},{lon:25.008,lat:61}])];
globalThis.fetch=async (_url,options)=>Response.json({osm3s,elements:String(options.body).includes('rel%28id%3A')?members:roots});`
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
    const result = await exec(
      process.execPath,
      ['--import', loader, '--import', preload, cli, ...args],
      { cwd: directory, env }
    );
    return result.stdout;
  };
  it('previews without writing and imports with no parameters', async () => {
    const preview = await run('--dry-run');
    expect(preview).toContain('Dry run');
    expect(preview).toContain('Testipolku');
    expect(preview).toContain('Äkäsmännyn kansallispuisto');
    expect(preview).not.toContain('Not imported');
    expect(preview).not.toContain('Pitkä reitti');
    expect(preview).not.toContain('Alapolku');
    expect(preview).not.toContain('affectedSlugs');
    expect(preview).not.toContain('{');
    expect(await database.select().from(trailAreaLinks)).toHaveLength(0);
    await writeFile(
      preload,
      "globalThis.fetch = async () => { throw new Error('unexpected refetch'); };"
    );
    const result = await run();
    expect(result).toContain('Imported or updated');
    expect(result).toContain('Testipolku');
    expect(result).toContain('Äkäsmännyn kansallispuisto');
    expect(await database.select().from(trailAreaLinks)).toHaveLength(1);
    expect(await database.select().from(parks).where(eq(parks.name, 'Testipolku'))).toHaveLength(1);
  });
  it('imports without requiring a previous preview', async () => {
    expect(await run()).toContain('Imported or updated');
    expect(await database.select().from(trailAreaLinks)).toHaveLength(1);
  });
  it('refreshes the source when area bounds change', async () => {
    await run('--dry-run');
    const area = (
      await database.select().from(parks).where(eq(parks.lipasId, createLipasPark()['lipas-id']))
    )[0]!;
    await database
      .update(parks)
      .set({ bboxMaxLon: area.bboxMaxLon + 0.01 })
      .where(eq(parks.id, area.id));
    await writeFile(
      preload,
      "globalThis.fetch = async () => { throw new Error('area changed: refetch required'); };"
    );
    await expect(run('--dry-run')).rejects.toThrow('area changed: refetch required');
  });
  it('rejects the old apply flag', async () => {
    await expect(run('--apply')).rejects.toThrow('Usage: npm run import:osm-trails');
  });
  it('shows manual exclusions and unchanged trails clearly', async () => {
    await run();
    await database.update(trailAreaLinks).set({ override: 'exclude' });
    await database.update(parks).set({ importedLengthKm: 9 }).where(eq(parks.name, 'Testipolku'));
    const preview = await run('--dry-run');
    expect(preview).not.toContain('Already up to date');
    expect(preview).toContain('Äkäsmännyn kansallispuisto (manually excluded)');
  });
  it('reports retirements because they change the catalog', async () => {
    await run();
    await database.update(parks).set({ lengthKm: 101 }).where(eq(parks.name, 'Testipolku'));
    const preview = await run('--dry-run');
    expect(preview).toContain('Would retire 1 trails');
    expect(preview).toContain('Testipolku');
    expect(preview).not.toContain('Not imported');
    expect(
      (await database.select().from(parks).where(eq(parks.name, 'Testipolku')))[0]?.catalogStatus
    ).toBe('active');
    expect(await run()).toContain('Retired 1 trails');
    expect(
      (await database.select().from(parks).where(eq(parks.name, 'Testipolku')))[0]?.catalogStatus
    ).toBe('inactive');
  });
  it('omits unchanged trails from the preview', async () => {
    await run();
    const preview = await run('--dry-run');
    expect(preview).toContain('would import or update 0 trails');
    expect(preview).not.toContain('Testipolku');
    expect(preview).not.toContain('Already up to date');
  });
});
