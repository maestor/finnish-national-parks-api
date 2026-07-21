import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { createSessionToken } from '../../src/http/session.js';
import { importParks } from '../../src/importer/import-parks.js';
import { createMemoryStorage } from '../../src/storage/memory-storage.js';
import { createLipasPark } from '../fixtures/lipas.js';
import { createTestDatabase } from '../helpers/test-db.js';

const authConfig = {
  cookieName: '__session',
  frontendUrl: 'http://localhost:4300',
  googleClientId: 'test-google-client-id',
  googleClientSecret: 'test-google-client-secret',
  jwtSecret: 'test-jwt-secret-at-least-32-characters-long'
};

describe('Visit image routes', () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;
  let storage: ReturnType<typeof createMemoryStorage>;
  let adminSessionCookie: string;

  beforeEach(async () => {
    testDatabase = await createTestDatabase();
    storage = createMemoryStorage();
    adminSessionCookie = await createSessionToken(
      {
        email: 'admin@example.com',
        name: 'Admin User',
        picture: 'https://example.com/photo.jpg',
        role: 'admin',
        sub: 'google-user-id'
      },
      new TextEncoder().encode(authConfig.jwtSecret)
    ).then((token) => `${authConfig.cookieName}=${token}`);

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

  const createAuthedApp = (overrides: Parameters<typeof createApp>[0] = {}) => {
    return createApp({
      auth: authConfig,
      database: testDatabase.database,
      ...overrides
    });
  };

  const requestAsAdmin = (
    app: ReturnType<typeof createApp>,
    input: Parameters<typeof app.request>[0],
    init?: Parameters<typeof app.request>[1]
  ) => {
    const headers = new Headers(init?.headers);
    headers.set('cookie', adminSessionCookie);

    return app.request(input, {
      ...init,
      headers
    });
  };

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
    const app = createAuthedApp({ storage });
    const response = await requestAsAdmin(app, '/api/parks/akasmannyn-kansallispuisto/visits', {
      body: JSON.stringify({ visitedOn: '2026-04-20' }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });
    const body = (await response.json()) as { id: number };
    return body.id;
  };

  const uploadImages = async (visitId: number, files: File[]) => {
    const app = createAuthedApp({ storage });
    const formData = new FormData();
    for (const file of files) {
      formData.append('images', file);
    }
    return requestAsAdmin(app, `/api/visits/${visitId}/images`, {
      body: formData,
      method: 'POST'
    });
  };

  const createDirectUploadPlan = async (
    visitId: number,
    file: File,
    app = createAuthedApp({
      allowServerImageUploads: false,
      storage
    })
  ) => {
    return requestAsAdmin(app, `/api/visits/${visitId}/images/upload-url`, {
      body: JSON.stringify({
        contentType: file.type,
        fileSizeBytes: file.size,
        originalName: file.name
      }),
      headers: { 'content-type': 'application/json' },
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

  it('creates direct upload plans and completes uploaded images without server-side resizing', async () => {
    const visitId = await createVisit();
    const buffer = await createTestImageBuffer(1400, 900);
    const file = new File([buffer], 'cloud.jpg', { type: 'image/jpeg' });
    const app = createAuthedApp({
      allowServerImageUploads: false,
      storage
    });

    const initResponse = await createDirectUploadPlan(visitId, file, app);
    const initBody = (await initResponse.json()) as {
      expiresAt: string;
      headers: { 'content-type': string };
      key: string;
      method: string;
      uploadUrl: string;
    };

    expect(initResponse.status).toBe(201);
    expect(initBody.method).toBe('PUT');
    expect(initBody.headers['content-type']).toBe('image/jpeg');
    expect(initBody.key).toContain(`visits/${visitId}/`);
    expect(initBody.uploadUrl).toContain(initBody.key);
    expect(initBody.expiresAt).toMatch(/T/);

    await storage.upload(initBody.key, buffer, file.type);

    const completeResponse = await requestAsAdmin(app, `/api/visits/${visitId}/images/complete`, {
      body: JSON.stringify({
        fullHeight: 900,
        fullWidth: 1400,
        key: initBody.key,
        originalName: file.name
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });
    const completeBody = (await completeResponse.json()) as {
      image: {
        fullHeight: number | null;
        fullUrl: string;
        fullWidth: number | null;
        originalName: string | null;
        thumbHeight: number | null;
        thumbUrl: string;
        thumbWidth: number | null;
      };
    };

    expect(completeResponse.status).toBe(201);
    expect(completeBody.image.originalName).toBe('cloud.jpg');
    expect(completeBody.image.fullWidth).toBe(1400);
    expect(completeBody.image.thumbWidth).toBe(1400);
    expect(completeBody.image.fullUrl).toContain('memory-storage.test');
    expect(completeBody.image.thumbUrl).toBe(completeBody.image.fullUrl);
  });

  it('creates a direct upload plan with a png key extension for png uploads', async () => {
    const visitId = await createVisit();
    const file = new File([Buffer.from('png-data')], 'cloud.png', { type: 'image/png' });

    const response = await createDirectUploadPlan(visitId, file);
    const body = (await response.json()) as { key: string };

    expect(response.status).toBe(201);
    expect(body.key.endsWith('.png')).toBe(true);
  });

  it('creates a direct upload plan with a webp key extension for webp uploads', async () => {
    const visitId = await createVisit();
    const file = new File([Buffer.from('webp-data')], 'cloud.webp', { type: 'image/webp' });

    const response = await createDirectUploadPlan(visitId, file);
    const body = (await response.json()) as { key: string };

    expect(response.status).toBe(201);
    expect(body.key.endsWith('.webp')).toBe(true);
  });

  it('includes images in park visit history responses', async () => {
    const visitId = await createVisit();
    const buffer = await createTestImageBuffer();
    const file = new File([buffer], 'trail.jpg', { type: 'image/jpeg' });

    await uploadImages(visitId, [file]);

    const app = createAuthedApp({ storage });
    const response = await app.request('/api/parks/akasmannyn-kansallispuisto/visits');
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

    const app = createAuthedApp({ storage });
    const deleteResponse = await requestAsAdmin(app, `/api/visits/${visitId}/images/${imageId}`, {
      method: 'DELETE'
    });

    expect(deleteResponse.status).toBe(204);
    expect(storage.getStore().size).toBe(0);

    const parkVisitsResponse = await app.request('/api/parks/akasmannyn-kansallispuisto/visits');
    const parkVisitsBody = (await parkVisitsResponse.json()) as {
      visits: Array<{ images: unknown[] }>;
    };
    expect(parkVisitsBody.visits[0]!.images).toHaveLength(0);
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

    const app = createAuthedApp({ storage });
    const reorderResponse = await requestAsAdmin(app, `/api/visits/${visitId}/images/reorder`, {
      body: JSON.stringify({
        imageIds: [uploadBody.images[1]!.id, uploadBody.images[0]!.id]
      }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH'
    });

    expect(reorderResponse.status).toBe(204);

    const parkVisitsResponse = await app.request('/api/parks/akasmannyn-kansallispuisto/visits');
    const parkVisitsBody = (await parkVisitsResponse.json()) as {
      visits: Array<{
        images: Array<{ id: number; displayOrder: number }>;
      }>;
    };

    expect(parkVisitsBody.visits[0]!.images[0]!.id).toBe(uploadBody.images[1]!.id);
    expect(parkVisitsBody.visits[0]!.images[1]!.id).toBe(uploadBody.images[0]!.id);
  });

  it('bumps the frontend summary version when visit images change', async () => {
    const visitId = await createVisit();
    const file = new File([await createTestImageBuffer()], 'first.jpg', { type: 'image/jpeg' });
    const secondFile = new File([await createTestImageBuffer()], 'second.jpg', {
      type: 'image/jpeg'
    });
    const app = createAuthedApp({ storage });

    const firstSummaryResponse = await app.request('/api/home-summary');
    const firstSummaryBody = (await firstSummaryResponse.json()) as {
      version: number;
    };

    const uploadResponse = await uploadImages(visitId, [file, secondFile]);
    const uploadBody = (await uploadResponse.json()) as {
      images: Array<{ id: number }>;
    };
    const secondSummaryResponse = await app.request('/api/home-summary');
    const secondSummaryBody = (await secondSummaryResponse.json()) as {
      version: number;
    };

    expect(secondSummaryBody.version).toBeGreaterThan(firstSummaryBody.version);

    const reorderResponse = await requestAsAdmin(app, `/api/visits/${visitId}/images/reorder`, {
      body: JSON.stringify({
        imageIds: [uploadBody.images[1]!.id, uploadBody.images[0]!.id]
      }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH'
    });

    expect(reorderResponse.status).toBe(204);

    const thirdSummaryResponse = await app.request('/api/home-summary');
    const thirdSummaryBody = (await thirdSummaryResponse.json()) as {
      version: number;
    };

    expect(thirdSummaryBody.version).toBeGreaterThan(secondSummaryBody.version);

    const deleteResponse = await requestAsAdmin(
      app,
      `/api/visits/${visitId}/images/${uploadBody.images[0]!.id}`,
      {
        method: 'DELETE'
      }
    );

    expect(deleteResponse.status).toBe(204);

    const fourthSummaryResponse = await app.request('/api/home-summary');
    const fourthSummaryBody = (await fourthSummaryResponse.json()) as {
      version: number;
    };

    expect(fourthSummaryBody.version).toBeGreaterThan(thirdSummaryBody.version);
  });

  it('returns 404 when uploading to a missing visit', async () => {
    const buffer = await createTestImageBuffer();
    const file = new File([buffer], 'orphan.jpg', { type: 'image/jpeg' });

    const response = await uploadImages(99999, [file]);
    expect(response.status).toBe(404);
  });

  it('requires an admin session for multipart uploads', async () => {
    const visitId = await createVisit();
    const file = new File([await createTestImageBuffer()], 'private.jpg', { type: 'image/jpeg' });
    const app = createAuthedApp({ storage });
    const formData = new FormData();
    formData.append('images', file);

    const response = await app.request(`/api/visits/${visitId}/images`, {
      body: formData,
      method: 'POST'
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 404 when creating a direct upload plan for a missing visit', async () => {
    const file = new File([await createTestImageBuffer()], 'orphan.jpg', { type: 'image/jpeg' });

    const response = await createDirectUploadPlan(99999, file);

    expect(response.status).toBe(404);
  });

  it('returns 413 when a direct upload plan declares a file above the size limit', async () => {
    const visitId = await createVisit();
    const app = createAuthedApp({
      allowServerImageUploads: false,
      storage
    });

    const response = await requestAsAdmin(app, `/api/visits/${visitId}/images/upload-url`, {
      body: JSON.stringify({
        contentType: 'image/jpeg',
        fileSizeBytes: 16 * 1024 * 1024,
        originalName: 'huge.jpg'
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(413);
    expect(body.error).toContain('File too large');
  });

  it('requires an admin session for direct upload plans', async () => {
    const visitId = await createVisit();
    const app = createAuthedApp({
      allowServerImageUploads: false,
      storage
    });

    const response = await app.request(`/api/visits/${visitId}/images/upload-url`, {
      body: JSON.stringify({
        contentType: 'image/jpeg',
        fileSizeBytes: 100,
        originalName: 'private.jpg'
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 404 when reordering a missing visit', async () => {
    const app = createAuthedApp({ storage });
    const response = await requestAsAdmin(app, '/api/visits/99999/images/reorder', {
      body: JSON.stringify({ imageIds: [1] }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH'
    });

    expect(response.status).toBe(404);
  });

  it('returns 422 when reordering with invalid image IDs', async () => {
    const visitId = await createVisit();
    const app = createAuthedApp({ storage });
    const response = await requestAsAdmin(app, `/api/visits/${visitId}/images/reorder`, {
      body: JSON.stringify({ imageIds: [99999] }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH'
    });

    expect(response.status).toBe(422);
  });

  it('requires an admin session for reordering visit images', async () => {
    const visitId = await createVisit();
    const app = createAuthedApp({ storage });
    const response = await app.request(`/api/visits/${visitId}/images/reorder`, {
      body: JSON.stringify({ imageIds: [1] }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH'
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 404 when deleting a missing image', async () => {
    const visitId = await createVisit();
    const app = createAuthedApp({ storage });
    const response = await requestAsAdmin(app, `/api/visits/${visitId}/images/99999`, {
      method: 'DELETE'
    });

    expect(response.status).toBe(404);
  });

  it('requires an admin session for deleting visit images', async () => {
    const visitId = await createVisit();
    const app = createAuthedApp({ storage });
    const response = await app.request(`/api/visits/${visitId}/images/99999`, {
      method: 'DELETE'
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 400 when no valid files are provided', async () => {
    const visitId = await createVisit();
    const app = createAuthedApp({ storage });
    const formData = new FormData();
    formData.append('images', 'not-a-file');
    const response = await requestAsAdmin(app, `/api/visits/${visitId}/images`, {
      body: formData,
      method: 'POST'
    });

    expect(response.status).toBe(400);
  });

  it('ignores non-file multipart values when valid files are also provided', async () => {
    const visitId = await createVisit();
    const file = new File([await createTestImageBuffer()], 'mixed.jpg', { type: 'image/jpeg' });
    const app = createAuthedApp({ storage });
    const formData = new FormData();
    formData.append('images', 'not-a-file');
    formData.append('images', file);

    const response = await requestAsAdmin(app, `/api/visits/${visitId}/images`, {
      body: formData,
      method: 'POST'
    });
    const body = (await response.json()) as {
      images: Array<{ originalName: string | null }>;
    };

    expect(response.status).toBe(201);
    expect(body.images).toHaveLength(1);
    expect(body.images[0]!.originalName).toBe('mixed.jpg');
  });

  it('returns 422 when completing a direct upload before the object exists in storage', async () => {
    const visitId = await createVisit();
    const file = new File([await createTestImageBuffer()], 'pending.jpg', { type: 'image/jpeg' });
    const app = createAuthedApp({
      allowServerImageUploads: false,
      storage
    });
    const initResponse = await createDirectUploadPlan(visitId, file, app);
    const initBody = (await initResponse.json()) as { key: string };

    const completeResponse = await requestAsAdmin(app, `/api/visits/${visitId}/images/complete`, {
      body: JSON.stringify({
        fullHeight: 600,
        fullWidth: 800,
        key: initBody.key,
        originalName: file.name
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });
    const completeBody = (await completeResponse.json()) as { error: string };

    expect(completeResponse.status).toBe(422);
    expect(completeBody.error).toContain('Upload is missing');
  });

  it('returns 404 when completing a direct upload for a missing visit', async () => {
    const app = createAuthedApp({
      allowServerImageUploads: false,
      storage
    });

    const response = await requestAsAdmin(app, '/api/visits/99999/images/complete', {
      body: JSON.stringify({
        key: 'visits/99999/missing.jpg',
        originalName: 'missing.jpg'
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toContain('Visit not found');
  });

  it('returns 422 when a direct upload key belongs to a different visit', async () => {
    const visitId = await createVisit();
    const app = createAuthedApp({
      allowServerImageUploads: false,
      storage
    });

    const response = await requestAsAdmin(app, `/api/visits/${visitId}/images/complete`, {
      body: JSON.stringify({
        key: 'visits/99999/wrong.jpg',
        originalName: 'wrong.jpg'
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(422);
    expect(body.error).toContain('does not belong to this visit');
  });

  it('requires an admin session for direct upload completion', async () => {
    const visitId = await createVisit();
    const app = createAuthedApp({
      allowServerImageUploads: false,
      storage
    });

    const response = await app.request(`/api/visits/${visitId}/images/complete`, {
      body: JSON.stringify({
        key: `visits/${visitId}/private.jpg`,
        originalName: 'private.jpg'
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 422 when a stored direct upload has an unsupported content type', async () => {
    const visitId = await createVisit();
    const app = createAuthedApp({
      allowServerImageUploads: false,
      storage
    });
    const initResponse = await createDirectUploadPlan(
      visitId,
      new File(['hello'], 'bad.jpg', { type: 'image/jpeg' }),
      app
    );
    const initBody = (await initResponse.json()) as { key: string };

    await storage.upload(initBody.key, Buffer.from('hello'), 'text/plain');

    const response = await requestAsAdmin(app, `/api/visits/${visitId}/images/complete`, {
      body: JSON.stringify({
        key: initBody.key,
        originalName: 'bad.jpg'
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(422);
    expect(body.error).toContain('Unsupported file type');
  });

  it('stores null optional direct upload fields when metadata is incomplete or blank', async () => {
    const visitId = await createVisit();
    const baseStorage = createMemoryStorage();
    const storageWithNullMetadata = {
      ...baseStorage,
      getObjectMetadata: async () => ({
        contentLength: null,
        contentType: 'image/jpeg'
      })
    };
    const app = createAuthedApp({
      allowServerImageUploads: false,
      storage: storageWithNullMetadata
    });

    const initResponse = await requestAsAdmin(app, `/api/visits/${visitId}/images/upload-url`, {
      body: JSON.stringify({
        contentType: 'image/jpeg',
        fileSizeBytes: 100,
        originalName: 'blank.jpg'
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });
    const initBody = (await initResponse.json()) as { key: string };

    await baseStorage.upload(initBody.key, Buffer.from('jpeg-data'), 'image/jpeg');

    const response = await requestAsAdmin(app, `/api/visits/${visitId}/images/complete`, {
      body: JSON.stringify({
        key: initBody.key
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });
    const body = (await response.json()) as {
      image: {
        fullHeight: number | null;
        fullWidth: number | null;
        originalName: string | null;
        thumbHeight: number | null;
        thumbWidth: number | null;
      };
    };

    expect(response.status).toBe(201);
    expect(body.image.originalName).toBeNull();
    expect(body.image.fullHeight).toBeNull();
    expect(body.image.fullWidth).toBeNull();
    expect(body.image.thumbHeight).toBeNull();
    expect(body.image.thumbWidth).toBeNull();
  });

  it('falls back to application/octet-stream when storage metadata has no content type', async () => {
    const visitId = await createVisit();
    const baseStorage = createMemoryStorage();
    const storageWithMissingContentType = {
      ...baseStorage,
      getObjectMetadata: async () => ({
        contentLength: null,
        contentType: null
      })
    };
    const app = createAuthedApp({
      allowServerImageUploads: false,
      storage: storageWithMissingContentType
    });

    const response = await requestAsAdmin(app, `/api/visits/${visitId}/images/complete`, {
      body: JSON.stringify({
        key: `visits/${visitId}/missing-type.jpg`,
        originalName: 'missing-type.jpg'
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(422);
    expect(body.error).toContain('Unsupported file type');
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
    const response = await app.request('/api/parks/akasmannyn-kansallispuisto/visits');
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

  it('returns 501 for server-side multipart uploads when that mode is disabled', async () => {
    const visitId = await createVisit();
    const file = new File([await createTestImageBuffer()], 'local-only.jpg', {
      type: 'image/jpeg'
    });
    const app = createAuthedApp({
      allowServerImageUploads: false,
      storage
    });
    const formData = new FormData();
    formData.append('images', file);

    const response = await requestAsAdmin(app, `/api/visits/${visitId}/images`, {
      body: formData,
      method: 'POST'
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(501);
    expect(body.error).toContain('direct upload');
  });
});
