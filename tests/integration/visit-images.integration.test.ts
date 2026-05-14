import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { importParks } from '../../src/importer/import-parks.js';
import { createMemoryStorage } from '../../src/storage/memory-storage.js';
import { createLipasPark } from '../fixtures/lipas.js';
import { createTestDatabase } from '../helpers/test-db.js';

describe('Visit image routes', () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;
  let storage: ReturnType<typeof createMemoryStorage>;

  beforeEach(async () => {
    testDatabase = await createTestDatabase();
    storage = createMemoryStorage();

    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 1,
      now: () => '2026-05-01T09:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [createLipasPark()]
      })
    });
  });

  afterEach(async () => {
    await testDatabase.dispose();
  });

  const createTestImageBuffer = async (width = 800, height = 600) => {
    return sharp({
      create: {
        background: { b: 100, g: 150, r: 50 },
        channels: 3,
        height,
        width
      }
    })
      .jpeg()
      .toBuffer();
  };

  const createVisit = async () => {
    const app = createApp({ database: testDatabase.database, storage });
    const response = await app.request('/api/me/parks/akasmannyn-kansallispuisto/visits', {
      body: JSON.stringify({ visitedOn: '2026-04-20' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });
    const body = (await response.json()) as { id: number };
    return body.id;
  };

  const uploadImages = async (visitId: number, files: File[]) => {
    const app = createApp({ database: testDatabase.database, storage });
    const formData = new FormData();
    for (const file of files) {
      formData.append('images', file);
    }
    return app.request(`/api/me/visits/${visitId}/images`, {
      body: formData,
      method: 'POST'
    });
  };

  it('uploads images, resizes them, and returns metadata with public URLs', async () => {
    const visitId = await createVisit();
    const buffer = await createTestImageBuffer(1200, 800);
    const file = new File([buffer], 'park.jpg', { type: 'image/jpeg' });

    const response = await uploadImages(visitId, [file]);
    const body = (await response.json()) as {
      images: Array<{
        fullUrl: string;
        thumbUrl: string;
        fullWidth: number;
        fullHeight: number;
        thumbWidth: number;
        thumbHeight: number;
        originalName: string | null;
      }>;
    };

    expect(response.status).toBe(201);
    expect(body.images).toHaveLength(1);
    expect(body.images[0]!.fullUrl).toContain('memory-storage.test');
    expect(body.images[0]!.thumbUrl).toContain('memory-storage.test');
    expect(body.images[0]!.fullWidth).toBeLessThanOrEqual(1920);
    expect(body.images[0]!.thumbWidth).toBeLessThanOrEqual(400);
    expect(body.images[0]!.originalName).toBe('park.jpg');

    // Verify storage received both full and thumbnail
    const storedKeys = Array.from(storage.getStore().keys());
    expect(storedKeys).toHaveLength(2);
    expect(storedKeys.some((k) => k.endsWith('-full.jpg'))).toBe(true);
    expect(storedKeys.some((k) => k.endsWith('-thumb.jpg'))).toBe(true);
  });

  it('includes images in personal park and visit responses', async () => {
    const visitId = await createVisit();
    const buffer = await createTestImageBuffer();
    const file = new File([buffer], 'trail.jpg', { type: 'image/jpeg' });

    await uploadImages(visitId, [file]);

    const app = createApp({ database: testDatabase.database, storage });
    const response = await app.request('/api/me/parks/akasmannyn-kansallispuisto');
    const body = (await response.json()) as {
      visits: Array<{
        images: Array<{ id: number; fullUrl: string }>;
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.visits[0]!.images).toHaveLength(1);
    expect(body.visits[0]!.images[0]!.fullUrl).toContain('memory-storage.test');
  });

  it('deletes an image and removes it from storage', async () => {
    const visitId = await createVisit();
    const buffer = await createTestImageBuffer();
    const file = new File([buffer], 'to-delete.jpg', { type: 'image/jpeg' });

    const uploadResponse = await uploadImages(visitId, [file]);
    const uploadBody = (await uploadResponse.json()) as {
      images: Array<{ id: number }>;
    };
    const imageId = uploadBody.images[0]!.id;

    const app = createApp({ database: testDatabase.database, storage });
    const deleteResponse = await app.request(`/api/me/visits/${visitId}/images/${imageId}`, {
      method: 'DELETE'
    });

    expect(deleteResponse.status).toBe(204);
    expect(storage.getStore().size).toBe(0);

    const personalResponse = await app.request('/api/me/parks/akasmannyn-kansallispuisto');
    const personalBody = (await personalResponse.json()) as {
      visits: Array<{ images: unknown[] }>;
    };
    expect(personalBody.visits[0]!.images).toHaveLength(0);
  });

  it('reorders images via PATCH', async () => {
    const visitId = await createVisit();
    const file1 = new File([await createTestImageBuffer()], 'first.jpg', { type: 'image/jpeg' });
    const file2 = new File([await createTestImageBuffer()], 'second.jpg', { type: 'image/jpeg' });

    const uploadResponse = await uploadImages(visitId, [file1, file2]);
    const uploadBody = (await uploadResponse.json()) as {
      images: Array<{ id: number; displayOrder: number }>;
    };

    expect(uploadBody.images[0]!.displayOrder).toBe(0);
    expect(uploadBody.images[1]!.displayOrder).toBe(0);

    const app = createApp({ database: testDatabase.database, storage });
    const reorderResponse = await app.request(`/api/me/visits/${visitId}/images/reorder`, {
      body: JSON.stringify({
        imageIds: [uploadBody.images[1]!.id, uploadBody.images[0]!.id]
      }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH'
    });

    expect(reorderResponse.status).toBe(204);

    const personalResponse = await app.request('/api/me/parks/akasmannyn-kansallispuisto');
    const personalBody = (await personalResponse.json()) as {
      visits: Array<{
        images: Array<{ id: number; displayOrder: number }>;
      }>;
    };

    expect(personalBody.visits[0]!.images[0]!.id).toBe(uploadBody.images[1]!.id);
    expect(personalBody.visits[0]!.images[1]!.id).toBe(uploadBody.images[0]!.id);
  });

  it('returns 404 when uploading to a missing visit', async () => {
    const buffer = await createTestImageBuffer();
    const file = new File([buffer], 'orphan.jpg', { type: 'image/jpeg' });

    const response = await uploadImages(99999, [file]);
    expect(response.status).toBe(404);
  });

  it('returns 404 when reordering a missing visit', async () => {
    const app = createApp({ database: testDatabase.database, storage });
    const response = await app.request('/api/me/visits/99999/images/reorder', {
      body: JSON.stringify({ imageIds: [1] }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH'
    });

    expect(response.status).toBe(404);
  });

  it('returns 422 when reordering with invalid image IDs', async () => {
    const visitId = await createVisit();
    const app = createApp({ database: testDatabase.database, storage });
    const response = await app.request(`/api/me/visits/${visitId}/images/reorder`, {
      body: JSON.stringify({ imageIds: [99999] }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH'
    });

    expect(response.status).toBe(422);
  });

  it('returns 404 when deleting a missing image', async () => {
    const visitId = await createVisit();
    const app = createApp({ database: testDatabase.database, storage });
    const response = await app.request(`/api/me/visits/${visitId}/images/99999`, {
      method: 'DELETE'
    });

    expect(response.status).toBe(404);
  });

  it('returns 400 when no valid files are provided', async () => {
    const visitId = await createVisit();
    const app = createApp({ database: testDatabase.database, storage });
    const formData = new FormData();
    formData.append('images', 'not-a-file');
    const response = await app.request(`/api/me/visits/${visitId}/images`, {
      body: formData,
      method: 'POST'
    });

    expect(response.status).toBe(400);
  });

  it('returns empty URLs when storage is not configured', async () => {
    const visit = await createVisit();
    await import('../../src/db/repositories.js').then(async ({ createVisitImage }) => {
      await createVisitImage(testDatabase.database, {
        createdAt: new Date().toISOString(),
        displayOrder: 0,
        fullHeight: 100,
        fullKey: 'k1',
        fullWidth: 100,
        mimeType: 'image/jpeg',
        thumbHeight: 50,
        thumbKey: 't1',
        thumbWidth: 50,
        updatedAt: new Date().toISOString(),
        visitId: visit
      });
    });

    const app = createApp({ database: testDatabase.database });
    const response = await app.request('/api/me/parks/akasmannyn-kansallispuisto');
    const body = (await response.json()) as {
      visits: Array<{ images: Array<{ fullUrl: string }> }>;
    };

    expect(response.status).toBe(200);
    expect(body.visits[0]!.images[0]!.fullUrl).toBe('');
  });

  it('returns 422 when a file exceeds the size limit', async () => {
    const visitId = await createVisit();
    const largeBuffer = Buffer.alloc(16 * 1024 * 1024);
    const file = new File([largeBuffer], 'huge.jpg', { type: 'image/jpeg' });

    const response = await uploadImages(visitId, [file]);
    const body = (await response.json()) as {
      errors: Array<{ reason: string }>;
    };

    expect(response.status).toBe(422);
    expect(body.errors[0]!.reason).toBe('File too large.');
  });

  it('returns partial success when a file fails processing', async () => {
    const visitId = await createVisit();
    const badFile = new File(['not-a-valid-jpeg'], 'bad.jpg', { type: 'image/jpeg' });

    const response = await uploadImages(visitId, [badFile]);
    const body = (await response.json()) as {
      images: unknown[];
      errors: Array<{ reason: string }>;
    };

    expect(response.status).toBe(422);
    expect(body.errors[0]!.reason).toBe('Processing failed.');
  });

  it('returns 422 for unsupported file types', async () => {
    const visitId = await createVisit();
    const file = new File(['not an image'], 'readme.txt', { type: 'text/plain' });

    const response = await uploadImages(visitId, [file]);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(422);
    expect(body.error).toContain('All uploads failed');
  });

  it('returns partial success when only some files are invalid', async () => {
    const visitId = await createVisit();
    const goodFile = new File([await createTestImageBuffer()], 'good.jpg', { type: 'image/jpeg' });
    const badFile = new File(['not an image'], 'bad.txt', { type: 'text/plain' });

    const response = await uploadImages(visitId, [goodFile, badFile]);
    const body = (await response.json()) as {
      images: unknown[];
      errors: Array<{ originalName: string }>;
    };

    expect(response.status).toBe(201);
    expect(body.images).toHaveLength(1);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]!.originalName).toBe('bad.txt');
  });
});
