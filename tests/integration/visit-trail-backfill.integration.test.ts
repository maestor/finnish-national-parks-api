import { execFile } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backfillVisitTrails, getPublicVisitDataVersion } from '../../src/db/repositories.js';
import { parks, parkVisits, trailAreaLinks, visitTrails } from '../../src/db/schema.js';
import { createLipasHikingTrail, createLipasPark, createLipasTrail } from '../fixtures/lipas.js';
import { importPublishedParkFixtures } from '../helpers/import-published-park-fixtures.js';
import { createTestDatabase } from '../helpers/test-db.js';

const execFileAsync = promisify(execFile);
const timestamp = '2026-11-12T10:00:00.000Z';
const runCli = (file: string, ...args: string[]) =>
  execFileAsync(
    process.execPath,
    [
      '--import',
      resolve('node_modules/tsx/dist/esm/index.mjs'),
      resolve('src/cli/backfill-visit-trails.ts'),
      ...args
    ],
    {
      cwd: dirname(file),
      env: { DATABASE_URL: `file:${file}`, NODE_ENV: 'test', PATH: process.env.PATH }
    }
  );

describe('visit trail backfill', () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let area: typeof parks.$inferSelect;
  let trail: typeof parks.$inferSelect;
  let otherTrail: typeof parks.$inferSelect;
  const visit = async (
    route: string | null,
    status: 'draft' | 'published' = 'published',
    parkId = area.id
  ) => {
    const [row] = await db.database
      .insert(parkVisits)
      .values({
        parkId,
        route,
        status,
        visitedOn: '2026-11-12',
        note: 'Preserve notes',
        createdAt: timestamp,
        updatedAt: timestamp
      })
      .returning();
    return row!;
  };
  const run = async (...args: string[]) => {
    const { file } = (await db.client.execute('PRAGMA database_list')).rows[0]!;
    return runCli(String(file), ...args);
  };
  beforeEach(async () => {
    db = await createTestDatabase();
    await importPublishedParkFixtures({
      database: db.database,
      sourceUrl: 'https://example.test',
      fetchSource: async () => ({
        items: [createLipasPark(), createLipasTrail(), createLipasHikingTrail()]
      })
    });
    area = (
      await db.database.select().from(parks).where(eq(parks.lipasId, createLipasPark()['lipas-id']))
    )[0]!;
    trail = (
      await db.database
        .select()
        .from(parks)
        .where(eq(parks.lipasId, createLipasTrail()['lipas-id']))
    )[0]!;
    otherTrail = (
      await db.database
        .select()
        .from(parks)
        .where(eq(parks.lipasId, createLipasHikingTrail()['lipas-id']))
    )[0]!;
    await db.database
      .insert(trailAreaLinks)
      .values(
        [trail, otherTrail].map((item) => ({
          areaId: area.id,
          trailId: item.id,
          automaticMatch: true,
          createdAt: timestamp,
          updatedAt: timestamp
        }))
      )
      .onConflictDoNothing();
  });
  afterEach(async () => db.dispose());

  it('previews exact matches, adds them without replacing existing assignments, and reruns as a no-op', async () => {
    const published = await visit(trail.name);
    const draft = await visit(trail.name, 'draft');
    await db.database.insert(visitTrails).values({ visitId: draft.id, trailId: otherTrail.id });
    const beforeVisits = await db.database.select().from(parkVisits);
    const beforeLinks = await db.database.select().from(trailAreaLinks);
    const beforeVersion = await getPublicVisitDataVersion(db.database);
    const preview = await run('--dry-run');
    expect(preview.stdout).toContain('Would add trail links to 2 visit(s).');
    expect(preview.stdout).toContain(area.slug);
    expect(preview.stdout).toContain(trail.name);
    expect(await db.database.select().from(parkVisits)).toEqual(beforeVisits);
    expect(await db.database.select().from(trailAreaLinks)).toEqual(beforeLinks);
    expect(await db.database.select().from(visitTrails)).toEqual([
      { visitId: draft.id, trailId: otherTrail.id }
    ]);
    expect(await getPublicVisitDataVersion(db.database)).toEqual(beforeVersion);
    const applied = await run();
    expect(applied.stdout).toContain('Added trail links to 2 visit(s).');
    expect(applied.stdout).toContain('Refresh the frontend public park caches');
    expect(
      await db.database.select().from(visitTrails).orderBy(visitTrails.visitId, visitTrails.trailId)
    ).toEqual([
      { visitId: published.id, trailId: trail.id },
      ...[trail.id, otherTrail.id]
        .sort((a, b) => a - b)
        .map((trailId) => ({ visitId: draft.id, trailId }))
    ]);
    expect((await getPublicVisitDataVersion(db.database)).version).toBe(beforeVersion.version + 1);
    for (const row of await db.database.select().from(parkVisits)) {
      expect(row.route).toBe(trail.name);
      expect(row.note).toBe('Preserve notes');
      expect(row.updatedAt).not.toBe(timestamp);
    }
    expect(
      (
        await db.database.select().from(trailAreaLinks).where(eq(trailAreaLinks.trailId, trail.id))
      )[0]
    ).toMatchObject({ override: 'include' });
    const appliedVersion = await getPublicVisitDataVersion(db.database);
    const rerun = await run();
    expect(rerun.stdout).toContain('Added trail links to 0 visit(s).');
    expect(rerun.stdout).toContain('2 already linked');
    expect(await getPublicVisitDataVersion(db.database)).toEqual(appliedVersion);
  });

  it('requires one exact effective park match and reports ambiguous names for manual review', async () => {
    let number = 0;
    const addTrail = async (
      name: string,
      override: 'include' | 'exclude',
      catalogStatus = 'active'
    ) => {
      number += 1;
      const [row] = await db.database
        .insert(parks)
        .values({
          ...trail,
          id: undefined,
          lipasId: 200000 + number,
          slug: `backfill-trail-${number}`,
          name,
          catalogStatus
        })
        .returning();
      await db.database.insert(trailAreaLinks).values({
        trailId: row!.id,
        areaId: area.id,
        override,
        createdAt: timestamp,
        updatedAt: timestamp
      });
      return row!;
    };
    const exact = await visit(trail.name);
    await db.database.insert(visitTrails).values({ visitId: exact.id, trailId: otherTrail.id });
    const existing = await visit(trail.name, 'draft');
    await db.database.insert(visitTrails).values({ visitId: existing.id, trailId: trail.id });
    for (const route of [
      trail.name.toLowerCase(),
      `${trail.name} `,
      `${trail.name} ja ${otherTrail.name}`,
      'No match'
    ])
      await visit(route);
    await visit(null);
    await visit('');
    await addTrail('Excluded trail', 'exclude');
    await visit('Excluded trail');
    await addTrail('Inactive trail', 'include', 'inactive');
    await visit('Inactive trail');
    const twin1 = await addTrail('Same name', 'include');
    const twin2 = await addTrail('Same name', 'include');
    const ambiguous = await visit('Same name');
    // The same route at another park cannot borrow this area's trails.
    const [otherArea] = await db.database
      .insert(parks)
      .values({ ...area, id: undefined, lipasId: 300000, slug: 'other-area' })
      .returning();
    await visit(trail.name, 'published', otherArea!.id);
    await db.database.update(parks).set({ removed: true }).where(eq(parks.id, area.id));
    const before = await db.database.select().from(visitTrails);
    const preview = await backfillVisitTrails(db.database, true);
    expect(preview).toMatchObject({
      dryRun: true,
      added: [{ visitId: exact.id, trailId: trail.id }],
      alreadyLinked: 1,
      unmatched: 7,
      ambiguous: [{ visitId: ambiguous.id, trailIds: [twin1.id, twin2.id] }]
    });
    expect(await db.database.select().from(visitTrails)).toEqual(before);
    const applied = await backfillVisitTrails(db.database, false);
    expect(applied).toEqual({ ...preview, dryRun: false });
    expect(await db.database.select().from(visitTrails)).toEqual(
      expect.arrayContaining([
        { visitId: exact.id, trailId: trail.id },
        { visitId: existing.id, trailId: trail.id }
      ])
    );
    expect(await db.database.select().from(visitTrails)).toHaveLength(3);
    const report = await run('--dry-run');
    expect(report.stdout).toContain('1 ambiguous');
    expect(report.stdout).toContain(`Ambiguous: ${area.slug}: visit ${ambiguous.id}`);
    expect(report.stdout).toContain(`trails ${twin1.id}, ${twin2.id}`);
    expect(await backfillVisitTrails(db.database, false)).toMatchObject({
      added: [],
      alreadyLinked: 2
    });
  });

  it('rolls back assignments, pinned memberships and visit timestamps if the transaction fails', async () => {
    await visit(trail.name);
    await visit(trail.name, 'draft');
    const beforeVisits = await db.database.select().from(parkVisits);
    const beforeLinks = await db.database.select().from(trailAreaLinks);
    const beforeVersion = await getPublicVisitDataVersion(db.database);
    await db.client.execute(`CREATE TRIGGER fail_trail_backfill_version BEFORE INSERT ON public_data_versions
      BEGIN SELECT RAISE(ABORT, 'cache version failure'); END`);
    await expect(backfillVisitTrails(db.database, false)).rejects.toMatchObject({
      cause: { message: expect.stringContaining('cache version failure') }
    });
    expect(await db.database.select().from(visitTrails)).toEqual([]);
    expect(await db.database.select().from(parkVisits)).toEqual(beforeVisits);
    expect(await db.database.select().from(trailAreaLinks)).toEqual(beforeLinks);
    expect(await getPublicVisitDataVersion(db.database)).toEqual(beforeVersion);
  });

  it('leaves an empty history unchanged and rejects unknown CLI arguments', async () => {
    const version = await getPublicVisitDataVersion(db.database);
    expect(await backfillVisitTrails(db.database, false)).toEqual({
      dryRun: false,
      added: [],
      ambiguous: [],
      alreadyLinked: 0,
      unmatched: 0
    });
    expect(await getPublicVisitDataVersion(db.database)).toEqual(version);
    await expect(run('--unknown')).rejects.toMatchObject({
      stderr: expect.stringContaining('Unknown argument: --unknown')
    });
  });

  it('refuses an unmigrated database without modifying its schema, including in preview mode', async () => {
    const { file } = (await db.client.execute('PRAGMA database_list')).rows[0]!;
    const emptyFile = join(dirname(String(file)), 'unmigrated.db');
    for (const args of [[], ['--dry-run']]) {
      await expect(runCli(emptyFile, ...args)).rejects.toMatchObject({
        stderr: expect.stringContaining('Run npm run db:migrate first')
      });
    }
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
