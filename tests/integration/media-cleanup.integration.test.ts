import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createVisit, createVisitImage } from '../../src/db/repositories.js';
import { importParks } from '../../src/importer/import-parks.js';
import { runUnusedMediaCleanup } from '../../src/media/unused-media-cleanup.js';
import { createMemoryStorage } from '../../src/storage/memory-storage.js';
import { createLipasPark } from '../fixtures/lipas.js';
import { createTestDatabase } from '../helpers/test-db.js';

describe('unused media cleanup', () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;
  let storage: ReturnType<typeof createMemoryStorage>;

  beforeEach(async () => {
    testDatabase = await createTestDatabase();
    storage = createMemoryStorage();
  });

  afterEach(async () => {
    await testDatabase.dispose();
  });

  it('reports an expired abandoned upload without deleting it during a preview', async () => {
    const key = 'visits/12/staged/abandoned.jpg';
    await storage.upload(key, Buffer.from('abandoned'), 'image/jpeg');
    await testDatabase.database.run(sql`
      INSERT INTO media_uploads (
        parent_type, parent_id, upload_key, full_key, thumb_key,
        expires_at, created_at, updated_at
      ) VALUES (
        'visit', 12, ${key}, 'visits/12/final/abandoned-full.jpg',
        'visits/12/final/abandoned-thumb.jpg',
        '2026-01-01T00:00:00.000Z', '2025-12-31T23:45:00.000Z', '2025-12-31T23:45:00.000Z'
      )
    `);

    const result = await runUnusedMediaCleanup({
      apply: false,
      database: testDatabase.database,
      now: new Date('2030-01-10T00:00:00.000Z'),
      storage
    });

    expect(result).toMatchObject({
      deleted: 0,
      eligibleKeys: [key],
      protectedKeys: [],
      scanned: 1
    });
    expect(storage.getStore().has(key)).toBe(true);
  });

  it('keeps an otherwise unused image that a published review snapshot still references', async () => {
    const key = 'visits/12/final/kept-full.jpg';
    await storage.upload(key, Buffer.from('published'), 'image/jpeg');
    await testDatabase.database.run(sql`
      INSERT INTO year_review_shares (
        year, share_id, story_json, generated_at, published_at, created_at, updated_at
      ) VALUES (
        2025, 'published-review', ${JSON.stringify({
          cards: [{ featuredImage: { fullKey: key } }],
          legacyValue: null,
          title: 'No media in this text'
        })},
        '2025-12-01T00:00:00.000Z', '2025-12-01T00:00:00.000Z',
        '2025-12-01T00:00:00.000Z', '2025-12-01T00:00:00.000Z'
      )
    `);

    const result = await runUnusedMediaCleanup({
      apply: true,
      database: testDatabase.database,
      now: new Date('2030-01-10T00:00:00.000Z'),
      storage
    });

    expect(result).toMatchObject({
      deleted: 0,
      eligibleKeys: [],
      protectedKeys: [key],
      scanned: 1
    });
    expect(storage.getStore().has(key)).toBe(true);
  });

  it('keeps managed files when a legacy review snapshot is malformed but may reference one', async () => {
    const key = 'visits/12/final/malformed-snapshot.jpg';
    await storage.upload(key, Buffer.from('legacy'), 'image/jpeg');
    await testDatabase.database.run(sql`
      INSERT INTO year_review_shares (
        year, share_id, story_json, generated_at, published_at, created_at, updated_at
      ) VALUES (
        2024, 'malformed-review', ${`{"featuredImage":"${key}"`},
        '2025-12-01T00:00:00.000Z', '2025-12-01T00:00:00.000Z',
        '2025-12-01T00:00:00.000Z', '2025-12-01T00:00:00.000Z'
      ), (
        2023, 'malformed-without-media', '{"title":',
        '2025-12-01T00:00:00.000Z', '2025-12-01T00:00:00.000Z',
        '2025-12-01T00:00:00.000Z', '2025-12-01T00:00:00.000Z'
      )
    `);

    const result = await runUnusedMediaCleanup({
      apply: true,
      database: testDatabase.database,
      now: new Date('2030-01-10T00:00:00.000Z'),
      storage
    });

    expect(result).toMatchObject({ deleted: 0, eligibleKeys: [], protectedKeys: [key] });
    expect(storage.getStore().has(key)).toBe(true);
  });

  it('protects an upload while its URL is still valid', async () => {
    const key = 'trip-stops/22/staged/uploading.jpg';
    await storage.upload(key, Buffer.from('still uploading'), 'image/jpeg');
    await testDatabase.database.run(sql`
      INSERT INTO media_uploads (
        parent_type, parent_id, upload_key, full_key, thumb_key,
        expires_at, created_at, updated_at
      ) VALUES (
        'trip-stop', 22, ${key}, 'trip-stops/22/final/uploading-full.jpg',
        'trip-stops/22/final/uploading-thumb.jpg',
        '2031-01-01T00:00:00.000Z', '2025-12-31T23:45:00.000Z', '2025-12-31T23:45:00.000Z'
      )
    `);

    const result = await runUnusedMediaCleanup({
      apply: true,
      database: testDatabase.database,
      now: new Date('2030-01-10T00:00:00.000Z'),
      storage
    });

    expect(result).toMatchObject({
      deleted: 0,
      eligibleKeys: [],
      protectedKeys: [key],
      scanned: 1
    });
    expect(storage.getStore().has(key)).toBe(true);
  });

  it('keeps image files that are still referenced by a current visit row', async () => {
    const timestamp = '2026-05-01T10:00:00.000Z';
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 1,
      fetchSource: async () => ({ items: [createLipasPark()] }),
      now: () => timestamp,
      sourceUrl: 'https://example.test/lipas'
    });
    const visit = await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-04-10'
    });
    const originalKey = `visits/${visit.id}/legacy-original.jpg`;
    const fullKey = `visits/${visit.id}/final/current-full.jpg`;
    const thumbKey = `visits/${visit.id}/final/current-thumb.jpg`;
    await createVisitImage(testDatabase.database, {
      createdAt: timestamp,
      displayOrder: 0,
      fullKey,
      mimeType: 'image/jpeg',
      thumbKey,
      updatedAt: timestamp,
      uploadKey: originalKey,
      visitId: visit.id
    });
    await storage.upload(originalKey, Buffer.from('original'), 'image/jpeg');
    await storage.upload(fullKey, Buffer.from('full'), 'image/jpeg');
    await storage.upload(thumbKey, Buffer.from('thumb'), 'image/jpeg');

    const result = await runUnusedMediaCleanup({
      apply: true,
      database: testDatabase.database,
      now: new Date('2030-01-10T00:00:00.000Z'),
      storage
    });

    expect(result).toMatchObject({
      deleted: 0,
      eligibleKeys: [],
      protectedKeys: [fullKey, thumbKey, originalKey]
    });
  });

  it('cleans a completed direct-upload staging file after its recovery window', async () => {
    const timestamp = '2026-05-01T10:00:00.000Z';
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 1,
      fetchSource: async () => ({ items: [createLipasPark()] }),
      now: () => timestamp,
      sourceUrl: 'https://example.test/lipas'
    });
    const visit = await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-04-10'
    });
    const stagedKey = `visits/${visit.id}/staged/completed.jpg`;
    const fullKey = `visits/${visit.id}/final/current-full.jpg`;
    const thumbKey = `visits/${visit.id}/final/current-thumb.jpg`;
    await createVisitImage(testDatabase.database, {
      createdAt: timestamp,
      displayOrder: 0,
      fullKey,
      mimeType: 'image/jpeg',
      thumbKey,
      updatedAt: timestamp,
      uploadKey: stagedKey,
      visitId: visit.id
    });
    await testDatabase.database.run(sql`
      INSERT INTO media_cleanup_tasks (key, eligible_at, created_at, updated_at)
      VALUES (
        ${stagedKey}, '2026-05-09T10:00:00.000Z', ${timestamp}, ${timestamp}
      )
    `);
    await storage.upload(stagedKey, Buffer.from('staged'), 'image/jpeg');
    await storage.upload(fullKey, Buffer.from('full'), 'image/jpeg');
    await storage.upload(thumbKey, Buffer.from('thumb'), 'image/jpeg');

    const result = await runUnusedMediaCleanup({
      apply: true,
      database: testDatabase.database,
      now: new Date('2030-01-10T00:00:00.000Z'),
      storage
    });

    expect(result).toMatchObject({ deleted: 1, eligibleKeys: [stagedKey] });
    expect(storage.getStore().has(stagedKey)).toBe(false);
    expect(storage.getStore().has(fullKey)).toBe(true);
    expect(storage.getStore().has(thumbKey)).toBe(true);
  });

  it('keeps a deleted image through its scheduled recovery window even when the object itself is old', async () => {
    const key = 'visits/56/final/recovery-window.jpg';
    await storage.upload(key, Buffer.from('keep briefly'), 'image/jpeg');
    await testDatabase.database.run(sql`
      INSERT INTO media_cleanup_tasks (key, eligible_at, created_at, updated_at)
      VALUES (
        ${key}, '2030-01-17T00:00:00.000Z',
        '2030-01-09T00:00:00.000Z', '2030-01-09T00:00:00.000Z'
      )
    `);

    const result = await runUnusedMediaCleanup({
      apply: true,
      database: testDatabase.database,
      now: new Date('2030-01-10T00:00:00.000Z'),
      storage
    });

    expect(result).toMatchObject({ deleted: 0, eligibleKeys: [], protectedKeys: [key] });
    expect(storage.getStore().has(key)).toBe(true);
  });

  it('scans every internally paginated storage page', async () => {
    const keys = Array.from(
      { length: 101 },
      (_, index) => `visits/78/staged/page-${String(index).padStart(3, '0')}.jpg`
    );
    await Promise.all(keys.map((key) => storage.upload(key, Buffer.from('paged'), 'image/jpeg')));
    storage.getStore().set('visits/78/staged/without-metadata.jpg', Buffer.from('unknown age'));

    const result = await runUnusedMediaCleanup({
      apply: false,
      database: testDatabase.database,
      now: new Date('2030-01-10T00:00:00.000Z'),
      storage
    });

    expect(result).toMatchObject({
      deleted: 0,
      eligibleKeys: keys,
      scanned: 102
    });
  });

  it('does not delete a file when a fresh reference check protects it', async () => {
    const key = 'visits/56/final/protected-during-cleanup.jpg';
    const now = new Date('2030-01-10T00:00:00.000Z');
    let referenceReadCount = 0;
    await storage.upload(key, Buffer.from('recheck'), 'image/jpeg');
    const database = {
      ...testDatabase.database,
      all: async (...args: Parameters<typeof testDatabase.database.all>) => {
        referenceReadCount += 1;
        if (referenceReadCount === 12) {
          await testDatabase.database.run(sql`
            INSERT INTO media_cleanup_tasks (key, eligible_at, created_at, updated_at)
            VALUES (
              ${key}, '2030-01-17T00:00:00.000Z',
              '2030-01-10T00:00:00.000Z', '2030-01-10T00:00:00.000Z'
            )
          `);
        }

        return testDatabase.database.all(...args);
      },
      run: testDatabase.database.run.bind(testDatabase.database)
    } as typeof testDatabase.database;

    const result = await runUnusedMediaCleanup({
      apply: true,
      database,
      now,
      storage
    });

    expect(result.deleted).toBe(0);
    expect(storage.getStore().has(key)).toBe(true);
  });

  it('records a storage deletion failure and retries it on the next run', async () => {
    const key = 'visits/34/final/retry-full.jpg';
    await storage.upload(key, Buffer.from('retry me'), 'image/jpeg');
    const now = new Date('2030-01-10T00:00:00.000Z');

    const failedResult = await runUnusedMediaCleanup({
      apply: true,
      database: testDatabase.database,
      now,
      storage: {
        ...storage,
        delete: async () => {
          throw new Error('R2 temporarily unavailable');
        }
      }
    });

    expect(failedResult.failures).toEqual([{ key, message: 'R2 temporarily unavailable' }]);
    await expect(
      testDatabase.database.all<{ attemptCount: number; key: string }>(sql`
        SELECT attempt_count AS attemptCount, key FROM media_cleanup_tasks
      `)
    ).resolves.toEqual([{ attemptCount: 1, key }]);

    const retryResult = await runUnusedMediaCleanup({
      apply: true,
      database: testDatabase.database,
      now,
      storage
    });

    expect(retryResult.deleted).toBe(1);
    expect(storage.getStore().has(key)).toBe(false);
    await expect(
      testDatabase.database.all<{ key: string }>(sql`SELECT key FROM media_cleanup_tasks`)
    ).resolves.toEqual([]);
  });

  it('reports a generic failure message when storage throws a non-Error value', async () => {
    const key = 'visits/34/final/non-error.jpg';
    await storage.upload(key, Buffer.from('retry me'), 'image/jpeg');

    const result = await runUnusedMediaCleanup({
      apply: true,
      database: testDatabase.database,
      now: new Date('2030-01-10T00:00:00.000Z'),
      storage: { ...storage, delete: async () => Promise.reject('unavailable') }
    });

    expect(result.failures).toEqual([{ key, message: 'Storage deletion failed.' }]);
  });
});
