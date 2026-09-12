import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTrip, createTripStop, createVisit } from '../../src/db/repositories.js';
import { tripStopImages, visitImages } from '../../src/db/schema.js';
import { runImageDerivativeBackfill } from '../../src/images/backfill-image-derivatives.js';
import { importParks } from '../../src/importer/import-parks.js';
import { createMemoryStorage } from '../../src/storage/memory-storage.js';
import { createLipasPark } from '../fixtures/lipas.js';
import { createTestDatabase } from '../helpers/test-db.js';

describe('image derivative backfill', () => {
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

  const createImageBuffer = async () => {
    return sharp({
      create: {
        background: { alpha: 128, b: 70, g: 120, r: 20 },
        channels: 4,
        height: 900,
        width: 1400
      }
    })
      .png()
      .toBuffer();
  };

  const createLegacyRecords = async () => {
    const timestamp = '2026-09-12T10:00:00.000Z';
    const trip = await createTrip(testDatabase.database, { name: 'Syysretki' });
    const visit = await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
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
    const sourceBuffer = await createImageBuffer();
    const visitSourceKey = `visits/${visit.id}/legacy-source.png`;
    const tripStopSourceKey = `trip-stops/${stop.id}/legacy-source.png`;

    const [visitImage] = await testDatabase.database
      .insert(visitImages)
      .values({
        createdAt: timestamp,
        displayOrder: 0,
        fileSizeBytes: sourceBuffer.length,
        fullKey: visitSourceKey,
        mimeType: 'image/png',
        thumbKey: visitSourceKey,
        updatedAt: timestamp,
        uploadKey: visitSourceKey,
        visitId: visit.id
      })
      .returning();
    const [tripStopImage] = await testDatabase.database
      .insert(tripStopImages)
      .values({
        createdAt: timestamp,
        displayOrder: 0,
        fileSizeBytes: sourceBuffer.length,
        fullKey: tripStopSourceKey,
        mimeType: 'image/png',
        thumbKey: tripStopSourceKey,
        tripStopId: stop.id,
        updatedAt: timestamp,
        uploadKey: tripStopSourceKey
      })
      .returning();

    await storage.upload(visitSourceKey, sourceBuffer, 'image/png');
    await storage.upload(tripStopSourceKey, sourceBuffer, 'image/png');

    return { sourceBuffer, tripStopImage: tripStopImage!, visitImage: visitImage! };
  };

  it('reports a dry-run batch without writing database rows or derivative objects', async () => {
    const { sourceBuffer, visitImage } = await createLegacyRecords();

    const result = await runImageDerivativeBackfill({
      batchSize: 1,
      cursor: { tripStopImageId: 0, visitImageId: 0 },
      database: testDatabase.database,
      dryRun: true,
      storage
    });
    const stored = await testDatabase.database
      .select()
      .from(visitImages)
      .where(eq(visitImages.id, visitImage.id));

    expect(result).toMatchObject({
      completed: 1,
      dryRun: true,
      failures: [],
      outputBytes: 0,
      scanned: 1,
      sourceBytes: sourceBuffer.length
    });
    expect(result.nextCursor).toEqual({ tripStopImageId: 0, visitImageId: 0 });
    expect(result.previewCursor.visitImageId).toBe(visitImage.id);
    expect(stored[0]?.fullKey).toBe(visitImage.fullKey);
    expect(stored[0]?.thumbKey).toBe(visitImage.thumbKey);
    expect(Array.from(storage.getStore().keys())).toEqual(
      expect.arrayContaining([visitImage.fullKey])
    );
    expect(Array.from(storage.getStore().keys())).not.toContain(
      `visits/${visitImage.visitId}/final/backfill-${visitImage.id}-full.jpg`
    );
  });

  it('processes bounded batches with deterministic retry-safe keys and retains sources', async () => {
    const { tripStopImage, visitImage } = await createLegacyRecords();
    const first = await runImageDerivativeBackfill({
      batchSize: 1,
      cursor: { tripStopImageId: 0, visitImageId: 0 },
      database: testDatabase.database,
      dryRun: false,
      storage
    });
    const second = await runImageDerivativeBackfill({
      batchSize: 1,
      cursor: first.nextCursor,
      database: testDatabase.database,
      dryRun: false,
      storage
    });
    const [updatedVisit] = await testDatabase.database
      .select()
      .from(visitImages)
      .where(eq(visitImages.id, visitImage.id));
    const [updatedTripStop] = await testDatabase.database
      .select()
      .from(tripStopImages)
      .where(eq(tripStopImages.id, tripStopImage.id));

    expect(first).toMatchObject({ completed: 1, failures: [], scanned: 1 });
    expect(second).toMatchObject({ completed: 1, failures: [], scanned: 1 });
    expect(updatedVisit).toMatchObject({
      fullKey: `visits/${visitImage.visitId}/final/backfill-${visitImage.id}-full.jpg`,
      mimeType: 'image/jpeg',
      thumbKey: `visits/${visitImage.visitId}/final/backfill-${visitImage.id}-thumb.jpg`
    });
    expect(updatedTripStop).toMatchObject({
      fullKey: `trip-stops/${tripStopImage.tripStopId}/final/backfill-${tripStopImage.id}-full.jpg`,
      mimeType: 'image/jpeg',
      thumbKey: `trip-stops/${tripStopImage.tripStopId}/final/backfill-${tripStopImage.id}-thumb.jpg`
    });
    expect(storage.getStore().has(visitImage.fullKey)).toBe(true);
    expect(storage.getStore().has(tripStopImage.fullKey)).toBe(true);
    expect(storage.getStore().has(updatedVisit!.fullKey)).toBe(true);
    expect(storage.getStore().has(updatedVisit!.thumbKey)).toBe(true);
    expect(storage.getStore().has(updatedTripStop!.fullKey)).toBe(true);
    expect(storage.getStore().has(updatedTripStop!.thumbKey)).toBe(true);
  });

  it('leaves the cursor at a missing source so the next run can retry it', async () => {
    const { visitImage } = await createLegacyRecords();
    await storage.delete(visitImage.fullKey);

    const result = await runImageDerivativeBackfill({
      batchSize: 2,
      cursor: { tripStopImageId: 0, visitImageId: 0 },
      database: testDatabase.database,
      dryRun: false,
      storage
    });

    expect(result.completed).toBe(0);
    expect(result.failures).toEqual([
      {
        id: visitImage.id,
        message: 'Source object is missing or has an invalid size.',
        type: 'visit'
      }
    ]);
    expect(result.nextCursor).toEqual({ tripStopImageId: 0, visitImageId: 0 });
  });

  it('leaves the cursor at an object that disappears after its metadata check', async () => {
    const { visitImage } = await createLegacyRecords();
    vi.spyOn(storage, 'getObject').mockResolvedValueOnce(null);

    const result = await runImageDerivativeBackfill({
      batchSize: 1,
      cursor: { tripStopImageId: 0, visitImageId: 0 },
      database: testDatabase.database,
      dryRun: false,
      storage
    });

    expect(result.failures).toEqual([
      { id: visitImage.id, message: 'Source object is missing.', type: 'visit' }
    ]);
    expect(result.nextCursor).toEqual({ tripStopImageId: 0, visitImageId: 0 });
  });

  it('reports a non-Error storage failure and leaves its cursor retryable', async () => {
    const { visitImage } = await createLegacyRecords();
    vi.spyOn(storage, 'getObjectMetadata').mockRejectedValueOnce('R2 unavailable');

    const result = await runImageDerivativeBackfill({
      batchSize: 1,
      cursor: { tripStopImageId: 0, visitImageId: 0 },
      database: testDatabase.database,
      dryRun: false,
      storage
    });

    expect(result.failures).toEqual([
      { id: visitImage.id, message: 'R2 unavailable', type: 'visit' }
    ]);
    expect(result.nextCursor).toEqual({ tripStopImageId: 0, visitImageId: 0 });
  });

  it('leaves the cursor at a row changed during finalization', async () => {
    const { visitImage } = await createLegacyRecords();
    const originalUpload = storage.upload;
    vi.spyOn(storage, 'upload').mockImplementation(async (key, buffer, contentType) => {
      await originalUpload(key, buffer, contentType);

      if (key.endsWith('-thumb.jpg')) {
        await testDatabase.database
          .update(visitImages)
          .set({ fullKey: 'visits/concurrently-updated.jpg' })
          .where(eq(visitImages.id, visitImage.id));
      }
    });

    const result = await runImageDerivativeBackfill({
      batchSize: 1,
      cursor: { tripStopImageId: 0, visitImageId: 0 },
      database: testDatabase.database,
      dryRun: false,
      storage
    });

    expect(result.failures).toEqual([
      {
        id: visitImage.id,
        message: 'Image row changed before derivatives could be recorded.',
        type: 'visit'
      }
    ]);
    expect(result.nextCursor).toEqual({ tripStopImageId: 0, visitImageId: 0 });
  });
});
