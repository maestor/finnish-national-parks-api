import { execFile } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  backfillParkFeaturedImages,
  createVisitImage,
  getPublicVisitDataVersion
} from '../../src/db/repositories.js';
import { parkFeaturedImages, parks, parkVisits } from '../../src/db/schema.js';
import { importParks } from '../../src/importer/import-parks.js';
import { createLipasPark } from '../fixtures/lipas.js';
import { createTestDatabase } from '../helpers/test-db.js';

const execFileAsync = promisify(execFile);
const timestamp = '2026-10-05T10:00:00.000Z';
const runCli = (file: string, ...args: string[]) =>
  execFileAsync(
    process.execPath,
    [
      '--import',
      resolve('node_modules/tsx/dist/esm/index.mjs'),
      resolve('src/cli/backfill-park-featured-images.ts'),
      ...args
    ],
    {
      cwd: dirname(file),
      env: { DATABASE_URL: `file:${file}`, NODE_ENV: 'test', PATH: process.env.PATH }
    }
  );

describe('park featured-image backfill', () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  type Park = typeof parks.$inferSelect;
  let catalog: [Park, Park, Park, Park, Park, Park];
  let imageNumber = 0;
  beforeEach(async () => {
    imageNumber = 0;
    db = await createTestDatabase();
    await importParks({
      database: db.database,
      expectedActiveCount: 6,
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: Array.from({ length: 6 }, (_, index) =>
          createLipasPark({ 'lipas-id': 100 + index, name: `Park ${index}` })
        )
      })
    });
    const rows = await db.database.select().from(parks).orderBy(parks.id);
    expect(rows).toHaveLength(6);
    catalog = rows as typeof catalog;
  });
  afterEach(async () => db.dispose());

  const visit = async (
    parkId: number,
    visitedOn: string,
    status: 'draft' | 'published' = 'published'
  ) => {
    const [row] = await db.database
      .insert(parkVisits)
      .values({
        parkId,
        visitedOn,
        status,
        createdAt: timestamp,
        updatedAt: timestamp
      })
      .returning();
    return row!;
  };
  const image = (visitId: number, displayOrder = 0) => {
    const key = `visits/${visitId}/${imageNumber++}`;
    return createVisitImage(db.database, {
      visitId,
      displayOrder,
      fullKey: `${key}.jpg`,
      thumbKey: `${key}-thumb.jpg`,
      mimeType: 'image/jpeg',
      fullWidth: 1200,
      fullHeight: 800,
      createdAt: timestamp,
      updatedAt: timestamp
    });
  };

  it('previews and fills only missing selections, follows picker order and safely reruns', async () => {
    const oldVisit = await visit(catalog[0].id, '2025-01-01');
    await image(oldVisit.id);
    const newer = await visit(catalog[0].id, '2026-01-01');
    await image(newer.id);
    const latestTie = await visit(catalog[0].id, '2026-01-01');
    await image(latestTie.id, 9);
    const first = await image(latestTie.id, 2);
    await image(latestTie.id, 2);
    const draft = await visit(catalog[0].id, '2026-10-01', 'draft');
    await image(draft.id);
    // A newer imageless visit must not prevent selecting an older photo.
    await visit(catalog[0].id, '2026-10-02');
    const savedVisit = await visit(catalog[1].id, '2025-01-01');
    const saved = await image(savedVisit.id);
    await db.database
      .insert(parkFeaturedImages)
      .values({ parkId: catalog[1].id, visitImageId: saved.id });
    await image((await visit(catalog[1].id, '2026-01-01')).id);
    await image((await visit(catalog[2].id, '2026-01-01', 'draft')).id);
    await visit(catalog[3].id, '2026-01-01');
    // No visit at catalog[4]. Hidden parks remain eligible, as in admin editing.
    await db.database.update(parks).set({ removed: true }).where(eq(parks.id, catalog[5].id));
    const hidden = await image((await visit(catalog[5].id, '2026-01-01')).id);
    const before = await getPublicVisitDataVersion(db.database);
    const expected = [
      { parkId: catalog[0].id, slug: catalog[0].slug, name: catalog[0].name, imageId: first.id },
      { parkId: catalog[5].id, slug: catalog[5].slug, name: catalog[5].name, imageId: hidden.id }
    ];
    expect(await backfillParkFeaturedImages(db.database, true)).toEqual({
      dryRun: true,
      parks: expected
    });
    expect(await db.database.select().from(parkFeaturedImages)).toHaveLength(1);
    expect(await getPublicVisitDataVersion(db.database)).toEqual(before);
    expect(await backfillParkFeaturedImages(db.database, false)).toEqual({
      dryRun: false,
      parks: expected
    });
    expect((await getPublicVisitDataVersion(db.database)).version).toBe(before.version + 1);
    expect(
      await db.database.select().from(parkFeaturedImages).orderBy(parkFeaturedImages.parkId)
    ).toEqual([
      { parkId: catalog[0].id, visitImageId: first.id },
      { parkId: catalog[1].id, visitImageId: saved.id },
      { parkId: catalog[5].id, visitImageId: hidden.id }
    ]);
    // A saved selection whose visit is later withdrawn is still preserved.
    await db.database
      .update(parkVisits)
      .set({ status: 'draft' })
      .where(eq(parkVisits.id, savedVisit.id));
    const filledVersion = await getPublicVisitDataVersion(db.database);
    expect(await backfillParkFeaturedImages(db.database, false)).toEqual({
      dryRun: false,
      parks: []
    });
    expect(await getPublicVisitDataVersion(db.database)).toEqual(filledVersion);
    const newPhoto = await image((await visit(catalog[4].id, '2026-10-05')).id);
    const rerun = await backfillParkFeaturedImages(db.database, false);
    expect(rerun.parks).toEqual([
      { parkId: catalog[4].id, slug: catalog[4].slug, name: catalog[4].name, imageId: newPhoto.id }
    ]);
  });

  it('rolls back all selections if cache-version invalidation fails', async () => {
    await image((await visit(catalog[0].id, '2026-10-05')).id);
    const before = await getPublicVisitDataVersion(db.database);
    await db.client.execute(`CREATE TRIGGER fail_backfill_version BEFORE UPDATE ON public_data_versions
      BEGIN SELECT RAISE(ABORT, 'cache version failure'); END`);
    await expect(backfillParkFeaturedImages(db.database, false)).rejects.toMatchObject({
      cause: { message: expect.stringContaining('cache version failure') }
    });
    expect(await db.database.select().from(parkFeaturedImages)).toEqual([]);
    expect(await getPublicVisitDataVersion(db.database)).toEqual(before);
  });

  it('runs the real CLI against a temporary database for preview, apply and no-op rerun', async () => {
    const photo = await image((await visit(catalog[0].id, '2026-10-05')).id);
    const { file } = (await db.client.execute('PRAGMA database_list')).rows[0]!;
    const run = (...args: string[]) => runCli(String(file), ...args);
    const preview = await run('--dry-run');
    expect(preview.stdout).toContain('Would set featured images for 1 park(s).');
    expect(preview.stdout).toContain(`${catalog[0].slug}: image ${photo.id}`);
    expect(await db.database.select().from(parkFeaturedImages)).toEqual([]);
    expect((await run()).stdout).toContain('Set featured images for 1 park(s).');
    expect((await run()).stdout).toContain('Set featured images for 0 park(s).');
    await expect(run('--unknown')).rejects.toMatchObject({
      stderr: expect.stringContaining('Unknown argument: --unknown')
    });
  });

  it('refuses an unmigrated database without creating schema tables, including in dry-run', async () => {
    const { file } = (await db.client.execute('PRAGMA database_list')).rows[0]!;
    const emptyFile = join(dirname(String(file)), 'unmigrated.db');
    await expect(runCli(emptyFile, '--dry-run')).rejects.toMatchObject({
      stderr: expect.stringContaining('Run npm run db:migrate first')
    });
    const client = createClient({ url: `file:${emptyFile}` });
    try {
      expect(
        (await client.execute("SELECT name FROM sqlite_master WHERE type = 'table'")).rows
      ).toEqual([]);
    } finally {
      await client.close();
    }
  });
});
