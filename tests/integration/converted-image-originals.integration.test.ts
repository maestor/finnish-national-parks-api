import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTrip, createTripStop, createVisit } from '../../src/db/repositories.js';
import { tripStopImages, visitImages } from '../../src/db/schema.js';
import { importParks } from '../../src/importer/import-parks.js';
import { runConvertedImageOriginalRetirement } from '../../src/media/retire-converted-image-originals.js';
import { createMemoryStorage } from '../../src/storage/memory-storage.js';
import { createLipasPark } from '../fixtures/lipas.js';
import { createTestDatabase } from '../helpers/test-db.js';

describe('converted image original retirement', () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;
  let storage: ReturnType<typeof createMemoryStorage>;

  beforeEach(async () => {
    testDatabase = await createTestDatabase();
    storage = createMemoryStorage();

    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 1,
      fetchSource: async () => ({ items: [createLipasPark()] }),
      now: () => '2026-09-12T10:00:00.000Z',
      sourceUrl: 'https://example.test/lipas'
    });
  });

  afterEach(async () => {
    await testDatabase.dispose();
  });

  const createConvertedVisitImage = async () => {
    const timestamp = '2026-09-12T10:00:00.000Z';
    const visit = await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-09-12'
    });
    const sourceKey = `visits/${visit.id}/legacy-original.jpg`;
    const [image] = await testDatabase.database
      .insert(visitImages)
      .values({
        createdAt: timestamp,
        displayOrder: 0,
        fullKey: `visits/${visit.id}/final/backfill-1-full.jpg`,
        mimeType: 'image/jpeg',
        thumbKey: `visits/${visit.id}/final/backfill-1-thumb.jpg`,
        updatedAt: timestamp,
        uploadKey: sourceKey,
        visitId: visit.id
      })
      .returning();
    const fullKey = `visits/${visit.id}/final/backfill-${image!.id}-full.jpg`;
    const thumbKey = `visits/${visit.id}/final/backfill-${image!.id}-thumb.jpg`;

    await testDatabase.database
      .update(visitImages)
      .set({ fullKey, thumbKey })
      .where(eq(visitImages.id, image!.id));
    await storage.upload(sourceKey, Buffer.from('old original'), 'image/jpeg');
    await storage.upload(fullKey, Buffer.from('full image'), 'image/jpeg');
    await storage.upload(thumbKey, Buffer.from('thumbnail'), 'image/jpeg');

    return { fullKey, sourceKey, thumbKey };
  };

  const createConvertedTripStopImage = async () => {
    const timestamp = '2026-09-12T10:00:00.000Z';
    const trip = await createTrip(testDatabase.database, { name: 'Syysretki' });
    await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      tripId: trip.id,
      visitedOn: '2026-09-12'
    });
    const stop = await createTripStop(testDatabase.database, trip.id, {
      location: {
        coordinate: { lat: 61.3167, lon: 22.1333 },
        label: 'Huittinen'
      },
      visitedOn: '2026-09-12'
    });
    const sourceKey = `trip-stops/${stop.id}/legacy-original.jpg`;
    const [image] = await testDatabase.database
      .insert(tripStopImages)
      .values({
        createdAt: timestamp,
        displayOrder: 0,
        fullKey: `trip-stops/${stop.id}/final/backfill-1-full.jpg`,
        mimeType: 'image/jpeg',
        thumbKey: `trip-stops/${stop.id}/final/backfill-1-thumb.jpg`,
        tripStopId: stop.id,
        updatedAt: timestamp,
        uploadKey: sourceKey
      })
      .returning();
    const fullKey = `trip-stops/${stop.id}/final/backfill-${image!.id}-full.jpg`;
    const thumbKey = `trip-stops/${stop.id}/final/backfill-${image!.id}-thumb.jpg`;

    await testDatabase.database
      .update(tripStopImages)
      .set({ fullKey, thumbKey })
      .where(eq(tripStopImages.id, image!.id));
    await storage.upload(sourceKey, Buffer.from('old stop original'), 'image/jpeg');
    await storage.upload(fullKey, Buffer.from('stop full image'), 'image/jpeg');
    await storage.upload(thumbKey, Buffer.from('stop thumbnail'), 'image/jpeg');

    return { fullKey, sourceKey, thumbKey };
  };

  it('previews only an old source after M1 conversion and keeps the current two image sizes', async () => {
    const { fullKey, sourceKey, thumbKey } = await createConvertedVisitImage();

    const result = await runConvertedImageOriginalRetirement({
      apply: false,
      database: testDatabase.database,
      storage
    });

    expect(result).toMatchObject({
      deleted: 0,
      eligibleBytes: Buffer.byteLength('old original'),
      eligibleKeys: [sourceKey],
      protectedKeys: [],
      scanned: 3
    });
    expect(storage.getStore().has(sourceKey)).toBe(true);
    expect(storage.getStore().has(fullKey)).toBe(true);
    expect(storage.getStore().has(thumbKey)).toBe(true);
  });

  it('keeps an old source that a published review snapshot still uses', async () => {
    const { sourceKey } = await createConvertedVisitImage();
    await testDatabase.database.run(sql`
      INSERT INTO year_review_shares (
        year, share_id, story_json, generated_at, published_at, created_at, updated_at
      ) VALUES (
        2026, 'published-review', ${JSON.stringify({
          cards: [{ featuredImage: { fullKey: sourceKey } }],
          legacyValue: null,
          title: 'No media in this text'
        })},
        '2026-09-12T10:00:00.000Z', '2026-09-12T10:00:00.000Z',
        '2026-09-12T10:00:00.000Z', '2026-09-12T10:00:00.000Z'
      )
    `);

    const result = await runConvertedImageOriginalRetirement({
      apply: true,
      database: testDatabase.database,
      storage
    });

    expect(result).toMatchObject({ deleted: 0, eligibleKeys: [], protectedKeys: [sourceKey] });
    expect(storage.getStore().has(sourceKey)).toBe(true);
  });

  it('does not treat a non-M1 image row as an old conversion source', async () => {
    const { sourceKey } = await createConvertedVisitImage();
    await testDatabase.database
      .update(visitImages)
      .set({ fullKey: 'visits/1/final/current-full.jpg' })
      .where(eq(visitImages.uploadKey, sourceKey));

    const result = await runConvertedImageOriginalRetirement({
      apply: false,
      database: testDatabase.database,
      storage
    });

    expect(result).toMatchObject({ eligibleKeys: [], missingKeys: [], oldSourceImagesFound: 0 });
    expect(storage.getStore().has(sourceKey)).toBe(true);
  });

  it('fails safe when an unreadable published review may contain an image key', async () => {
    const { sourceKey } = await createConvertedVisitImage();
    await testDatabase.database.run(sql`
      INSERT INTO date_range_review_shares (
        name, overview_slug, start_date, end_date, share_id, story_json,
        generated_at, published_at, created_at, updated_at
      ) VALUES (
        'Syysretki', 'syysretki', '2026-09-01', '2026-09-12', 'published-review',
        ${`{"featuredImage":"${sourceKey}"`}, '2026-09-12T10:00:00.000Z',
        '2026-09-12T10:00:00.000Z', '2026-09-12T10:00:00.000Z', '2026-09-12T10:00:00.000Z'
      )
    `);

    const result = await runConvertedImageOriginalRetirement({
      apply: true,
      database: testDatabase.database,
      storage
    });

    expect(result).toMatchObject({ deleted: 0, eligibleKeys: [], protectedKeys: [sourceKey] });
    expect(storage.getStore().has(sourceKey)).toBe(true);
  });

  it('includes converted trip-stop sources but does not select their current image sizes', async () => {
    const { fullKey, sourceKey, thumbKey } = await createConvertedTripStopImage();

    const result = await runConvertedImageOriginalRetirement({
      apply: false,
      database: testDatabase.database,
      storage
    });

    expect(result.eligibleKeys).toEqual([sourceKey]);
    expect(result.eligibleKeys).not.toContain(fullKey);
    expect(result.eligibleKeys).not.toContain(thumbKey);
  });

  it('reports a source already absent from storage without selecting a new deletion', async () => {
    const { sourceKey } = await createConvertedVisitImage();
    await storage.delete(sourceKey);

    const result = await runConvertedImageOriginalRetirement({
      apply: false,
      database: testDatabase.database,
      storage
    });

    expect(result).toMatchObject({ eligibleKeys: [], missingKeys: [sourceKey] });
  });

  it('continues through every storage page and treats an unknown source size as zero bytes', async () => {
    const { sourceKey } = await createConvertedVisitImage();
    const extraKeys = Array.from(
      { length: 100 },
      (_, index) => `visits/99/staged/page-${String(index).padStart(3, '0')}.jpg`
    );
    await Promise.all(
      extraKeys.map((key) => storage.upload(key, Buffer.from('extra'), 'image/jpeg'))
    );

    const result = await runConvertedImageOriginalRetirement({
      apply: false,
      database: testDatabase.database,
      storage: {
        ...storage,
        listObjects: async (input) => {
          const page = await storage.listObjects(input);

          return {
            ...page,
            items: page.items.map((object) =>
              object.key === sourceKey ? { ...object, size: null } : object
            )
          };
        }
      }
    });

    expect(result).toMatchObject({ eligibleBytes: 0, eligibleKeys: [sourceKey], scanned: 103 });
  });

  it('does not delete a source when a fresh reference check discovers a published review', async () => {
    const { sourceKey } = await createConvertedVisitImage();
    let referenceReadCount = 0;
    const database = {
      ...testDatabase.database,
      all: async (...args: Parameters<typeof testDatabase.database.all>) => {
        referenceReadCount += 1;
        if (referenceReadCount === 5) {
          await testDatabase.database.run(sql`
            INSERT INTO year_review_shares (
              year, share_id, story_json, generated_at, published_at, created_at, updated_at
            ) VALUES (
              2026, 'published-during-cleanup',
              ${JSON.stringify({ featuredImage: { fullKey: sourceKey } })},
              '2026-09-12T10:00:00.000Z', '2026-09-12T10:00:00.000Z',
              '2026-09-12T10:00:00.000Z', '2026-09-12T10:00:00.000Z'
            )
          `);
        }

        return testDatabase.database.all(...args);
      }
    } as typeof testDatabase.database;

    const result = await runConvertedImageOriginalRetirement({ apply: true, database, storage });

    expect(result.deleted).toBe(0);
    expect(storage.getStore().has(sourceKey)).toBe(true);
  });

  it('retries a transient R2 deletion failure before removing an eligible source', async () => {
    const { sourceKey } = await createConvertedVisitImage();
    let attempts = 0;

    const result = await runConvertedImageOriginalRetirement({
      apply: true,
      database: testDatabase.database,
      storage: {
        ...storage,
        delete: async (key) => {
          attempts += 1;
          if (attempts < 4) {
            throw new Error('ssl/tls alert bad record mac');
          }

          await storage.delete(key);
        }
      }
    });

    expect(result).toMatchObject({ deleted: 1, failures: [] });
    expect(attempts).toBe(4);
    expect(storage.getStore().has(sourceKey)).toBe(false);
  });

  it('reports an unrecoverable storage deletion failure without removing the source', async () => {
    const { sourceKey } = await createConvertedVisitImage();

    const result = await runConvertedImageOriginalRetirement({
      apply: true,
      database: testDatabase.database,
      storage: { ...storage, delete: async () => Promise.reject('unavailable') }
    });

    expect(result).toMatchObject({
      deleted: 0,
      failures: [{ key: sourceKey, message: 'Storage deletion failed.' }]
    });
    expect(storage.getStore().has(sourceKey)).toBe(true);
  });

  it('reports an Error from storage without treating it as a retryable R2 failure', async () => {
    const { sourceKey } = await createConvertedVisitImage();

    const result = await runConvertedImageOriginalRetirement({
      apply: true,
      database: testDatabase.database,
      storage: { ...storage, delete: async () => Promise.reject(new Error('access denied')) }
    });

    expect(result).toMatchObject({
      deleted: 0,
      failures: [{ key: sourceKey, message: 'access denied' }]
    });
  });

  it('ignores a malformed snapshot that does not mention managed media', async () => {
    const { sourceKey } = await createConvertedVisitImage();
    await testDatabase.database.run(sql`
      INSERT INTO date_range_review_shares (
        name, overview_slug, start_date, end_date, share_id, story_json,
        generated_at, published_at, created_at, updated_at
      ) VALUES (
        'Kevätretki', 'kevatretki', '2026-09-01', '2026-09-12', 'broken-without-media',
        '{"title":', '2026-09-12T10:00:00.000Z', '2026-09-12T10:00:00.000Z',
        '2026-09-12T10:00:00.000Z', '2026-09-12T10:00:00.000Z'
      )
    `);

    const result = await runConvertedImageOriginalRetirement({
      apply: false,
      database: testDatabase.database,
      storage
    });

    expect(result.eligibleKeys).toEqual([sourceKey]);
  });

  it('permanently removes the old source only after explicit apply', async () => {
    const { fullKey, sourceKey, thumbKey } = await createConvertedVisitImage();

    const result = await runConvertedImageOriginalRetirement({
      apply: true,
      database: testDatabase.database,
      storage
    });

    expect(result).toMatchObject({ deleted: 1, eligibleKeys: [sourceKey] });
    expect(storage.getStore().has(sourceKey)).toBe(false);
    expect(storage.getStore().has(fullKey)).toBe(true);
    expect(storage.getStore().has(thumbKey)).toBe(true);
  });
});
