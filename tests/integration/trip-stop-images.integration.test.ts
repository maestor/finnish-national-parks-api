import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import * as repositories from '../../src/db/repositories.js';
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

describe('Trip stop image routes', () => {
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

  const createTripStopFixture = async () => {
    const app = createAuthedApp({ storage });

    const tripResponse = await requestAsAdmin(app, '/api/trips', {
      body: JSON.stringify({
        name: 'Kesäreissu 2026',
        startingPoint: {
          coordinate: {
            lat: 60.1699,
            lon: 24.9384
          },
          label: 'Helsinki'
        }
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });
    const trip = (await tripResponse.json()) as { id: number; slug: string };

    await requestAsAdmin(app, '/api/parks/akasmannyn-kansallispuisto/visits', {
      body: JSON.stringify({
        tripId: trip.id,
        tripStopOrder: 1,
        visitedOn: '2026-06-07'
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });

    const stopResponse = await requestAsAdmin(app, `/api/trips/${trip.id}/stops`, {
      body: JSON.stringify({
        location: {
          coordinate: {
            lat: 61.3167,
            lon: 22.1333
          },
          label: 'ABC Huittinen'
        },
        note: 'Lunch break',
        tripStopOrder: 2,
        visitedOn: '2026-06-07'
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });
    const stop = (await stopResponse.json()) as { id: number };

    return {
      app,
      stopId: stop.id,
      tripId: trip.id,
      tripSlug: trip.slug
    };
  };

  const uploadImages = async (stopId: number, files: File[]) => {
    const app = createAuthedApp({ storage });
    const formData = new FormData();
    for (const file of files) {
      formData.append('images', file);
    }

    return requestAsAdmin(app, `/api/trip-stops/${stopId}/images`, {
      body: formData,
      method: 'POST'
    });
  };

  const createDirectUploadPlan = async (
    stopId: number,
    file: File,
    app = createAuthedApp({
      allowServerImageUploads: false,
      storage
    })
  ) => {
    return requestAsAdmin(app, `/api/trip-stops/${stopId}/images/upload-url`, {
      body: JSON.stringify({
        contentType: file.type,
        fileSizeBytes: file.size,
        originalName: file.name
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });
  };

  it('uploads, reorders, and deletes trip stop images through trip detail responses', async () => {
    const { app, stopId, tripId, tripSlug } = await createTripStopFixture();
    const firstFile = new File([await createTestImageBuffer()], 'first.jpg', {
      type: 'image/jpeg'
    });
    const secondFile = new File([await createTestImageBuffer()], 'second.jpg', {
      type: 'image/jpeg'
    });

    const uploadResponse = await uploadImages(stopId, [firstFile, secondFile]);
    const uploadBody = (await uploadResponse.json()) as {
      images: Array<{ displayOrder: number; id: number; originalName: string | null }>;
    };

    expect(uploadResponse.status).toBe(201);
    expect(uploadBody.images).toHaveLength(2);
    expect(uploadBody.images[0]!.originalName).toBe('first.jpg');
    expect(uploadBody.images[1]!.originalName).toBe('second.jpg');

    const reorderResponse = await requestAsAdmin(app, `/api/trip-stops/${stopId}/images/reorder`, {
      body: JSON.stringify({
        imageIds: [uploadBody.images[1]!.id, uploadBody.images[0]!.id]
      }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH'
    });

    expect(reorderResponse.status).toBe(204);

    const tripDetailResponse = await app.request(`/api/trips/${tripId}`);
    const tripDetailBody = (await tripDetailResponse.json()) as {
      itinerary: Array<
        | { kind: 'visit' }
        | {
            kind: 'stop';
            stop: {
              id: number;
              images: Array<{ id: number; originalName: string | null }>;
            };
          }
      >;
    };

    expect(tripDetailResponse.status).toBe(200);
    expect(tripDetailBody.itinerary.find((entry) => entry.kind === 'stop')).toMatchObject({
      kind: 'stop',
      stop: {
        id: stopId,
        images: [
          {
            id: uploadBody.images[1]!.id,
            originalName: 'second.jpg'
          },
          {
            id: uploadBody.images[0]!.id,
            originalName: 'first.jpg'
          }
        ]
      }
    });

    const publicTripResponse = await app.request(`/api/trips/slug/${tripSlug}`);
    const publicTripBody = (await publicTripResponse.json()) as {
      itinerary: Array<
        | { kind: 'visit' }
        | {
            kind: 'stop';
            stop: {
              id: number;
              images: Array<{ originalName: string | null }>;
            };
          }
      >;
    };

    expect(publicTripResponse.status).toBe(200);
    expect(publicTripBody.itinerary.find((entry) => entry.kind === 'stop')).toMatchObject({
      kind: 'stop',
      stop: {
        id: stopId,
        images: [{ originalName: 'second.jpg' }, { originalName: 'first.jpg' }]
      }
    });

    const deleteResponse = await requestAsAdmin(
      app,
      `/api/trip-stops/${stopId}/images/${uploadBody.images[1]!.id}`,
      {
        method: 'DELETE'
      }
    );

    expect(deleteResponse.status).toBe(204);
  });

  it('completes direct trip stop uploads without server-side resizing', async () => {
    const { stopId } = await createTripStopFixture();
    const buffer = await createTestImageBuffer(1400, 900);
    const file = new File([buffer], 'cloud.jpg', { type: 'image/jpeg' });
    const app = createAuthedApp({
      allowServerImageUploads: false,
      storage
    });

    const initResponse = await createDirectUploadPlan(stopId, file, app);
    const initBody = (await initResponse.json()) as {
      headers: { 'content-type': string };
      key: string;
      method: string;
    };

    expect(initResponse.status).toBe(201);
    expect(initBody.method).toBe('PUT');
    expect(initBody.headers['content-type']).toBe('image/jpeg');
    expect(initBody.key).toContain(`trip-stops/${stopId}/`);

    await storage.upload(initBody.key, buffer, file.type);

    const completeResponse = await requestAsAdmin(
      app,
      `/api/trip-stops/${stopId}/images/complete`,
      {
        body: JSON.stringify({
          fullHeight: 900,
          fullWidth: 1400,
          key: initBody.key,
          originalName: file.name
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST'
      }
    );
    const completeBody = (await completeResponse.json()) as {
      image: {
        fullWidth: number | null;
        originalName: string | null;
        thumbWidth: number | null;
      };
    };

    expect(completeResponse.status).toBe(201);
    expect(completeBody.image.originalName).toBe('cloud.jpg');
    expect(completeBody.image.fullWidth).toBe(1400);
    expect(completeBody.image.thumbWidth).toBe(1400);
  });

  it('returns 404 when creating a direct trip stop upload plan for a missing stop', async () => {
    const file = new File([await createTestImageBuffer()], 'missing.jpg', { type: 'image/jpeg' });
    const response = await createDirectUploadPlan(99999, file);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toContain('Trip stop not found');
  });

  it('returns 413 when a direct trip stop upload plan declares a file above the size limit', async () => {
    const { stopId } = await createTripStopFixture();
    const file = new File([Buffer.alloc(16 * 1024 * 1024)], 'huge.jpg', { type: 'image/jpeg' });

    const response = await createDirectUploadPlan(stopId, file);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(413);
    expect(body.error).toBe('File too large.');
  });

  it('requires an admin session for direct trip stop upload plan creation', async () => {
    const { stopId } = await createTripStopFixture();
    const app = createAuthedApp({
      allowServerImageUploads: false,
      storage
    });

    const response = await app.request(`/api/trip-stops/${stopId}/images/upload-url`, {
      body: JSON.stringify({
        contentType: 'image/jpeg',
        fileSizeBytes: 1024,
        originalName: 'private.jpg'
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 422 when a stored direct trip stop upload has an unsupported content type', async () => {
    const { stopId } = await createTripStopFixture();
    const app = createAuthedApp({
      allowServerImageUploads: false,
      storage
    });
    const initResponse = await createDirectUploadPlan(
      stopId,
      new File(['hello'], 'bad.jpg', { type: 'image/jpeg' }),
      app
    );
    const initBody = (await initResponse.json()) as { key: string };

    await storage.upload(initBody.key, Buffer.from('hello'), 'text/plain');

    const response = await requestAsAdmin(app, `/api/trip-stops/${stopId}/images/complete`, {
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

  it('returns 422 when direct trip stop upload metadata is missing a content type', async () => {
    const { stopId } = await createTripStopFixture();
    const app = createAuthedApp({
      allowServerImageUploads: false,
      storage
    });
    const initResponse = await createDirectUploadPlan(
      stopId,
      new File(['hello'], 'unknown.jpg', { type: 'image/jpeg' }),
      app
    );
    const initBody = (await initResponse.json()) as { key: string };

    await storage.upload(initBody.key, Buffer.from('hello'), 'image/jpeg');
    vi.spyOn(storage, 'getObjectMetadata').mockResolvedValueOnce({
      contentLength: 5,
      contentType: undefined as unknown as string
    });

    const response = await requestAsAdmin(app, `/api/trip-stops/${stopId}/images/complete`, {
      body: JSON.stringify({
        key: initBody.key,
        originalName: 'unknown.jpg'
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(422);
    expect(body.error).toContain('Unsupported file type');
  });

  it('returns 422 when completing a direct trip stop upload before the object exists in storage', async () => {
    const { stopId } = await createTripStopFixture();
    const file = new File([await createTestImageBuffer()], 'pending.jpg', { type: 'image/jpeg' });
    const app = createAuthedApp({
      allowServerImageUploads: false,
      storage
    });
    const initResponse = await createDirectUploadPlan(stopId, file, app);
    const initBody = (await initResponse.json()) as { key: string };

    const response = await requestAsAdmin(app, `/api/trip-stops/${stopId}/images/complete`, {
      body: JSON.stringify({
        fullHeight: 600,
        fullWidth: 800,
        key: initBody.key,
        originalName: file.name
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(422);
    expect(body.error).toContain('Upload is missing');
  });

  it('requires an admin session for direct trip stop upload completion', async () => {
    const { stopId } = await createTripStopFixture();
    const app = createAuthedApp({
      allowServerImageUploads: false,
      storage
    });

    const response = await app.request(`/api/trip-stops/${stopId}/images/complete`, {
      body: JSON.stringify({
        key: `trip-stops/${stopId}/private.jpg`,
        originalName: 'private.jpg'
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 404 when completing a direct trip stop upload for a missing stop', async () => {
    const app = createAuthedApp({
      allowServerImageUploads: false,
      storage
    });

    const response = await requestAsAdmin(app, '/api/trip-stops/99999/images/complete', {
      body: JSON.stringify({
        key: 'trip-stops/99999/missing.jpg',
        originalName: 'missing.jpg'
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toContain('Trip stop not found');
  });

  it('returns 422 when a direct trip stop upload key belongs to a different stop', async () => {
    const { stopId } = await createTripStopFixture();
    const app = createAuthedApp({
      allowServerImageUploads: false,
      storage
    });

    const response = await requestAsAdmin(app, `/api/trip-stops/${stopId}/images/complete`, {
      body: JSON.stringify({
        key: 'trip-stops/99999/wrong.jpg',
        originalName: 'wrong.jpg'
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(422);
    expect(body.error).toContain('does not belong to this trip stop');
  });

  it('returns 422 when direct trip stop upload completion fails validation', async () => {
    const { stopId } = await createTripStopFixture();
    const file = new File([await createTestImageBuffer()], 'late-failure.jpg', {
      type: 'image/jpeg'
    });
    const app = createAuthedApp({
      allowServerImageUploads: false,
      storage
    });
    const initResponse = await createDirectUploadPlan(stopId, file, app);
    const initBody = (await initResponse.json()) as { key: string };

    await storage.upload(initBody.key, Buffer.from('jpeg-data'), file.type);

    const spy = vi
      .spyOn(repositories, 'createTripStopImage')
      .mockRejectedValueOnce(
        new repositories.RepositoryValidationError('Trip stop already has the maximum of 6 images.')
      );

    const response = await requestAsAdmin(app, `/api/trip-stops/${stopId}/images/complete`, {
      body: JSON.stringify({
        key: initBody.key,
        originalName: file.name
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(422);
    expect(body.error).toContain('maximum of 6 images');

    spy.mockRestore();
  });

  it('returns 500 when direct trip stop upload completion fails unexpectedly', async () => {
    const { stopId } = await createTripStopFixture();
    const file = new File([await createTestImageBuffer()], 'boom.jpg', { type: 'image/jpeg' });
    const app = createAuthedApp({
      allowServerImageUploads: false,
      storage
    });
    const initResponse = await createDirectUploadPlan(stopId, file, app);
    const initBody = (await initResponse.json()) as { key: string };

    await storage.upload(initBody.key, Buffer.from('jpeg-data'), file.type);

    const spy = vi
      .spyOn(repositories, 'createTripStopImage')
      .mockRejectedValueOnce(new Error('boom'));

    const response = await requestAsAdmin(app, `/api/trip-stops/${stopId}/images/complete`, {
      body: JSON.stringify({
        key: initBody.key,
        originalName: file.name
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });

    expect(response.status).toBe(500);

    spy.mockRestore();
  });

  it('rejects a seventh trip stop image', async () => {
    const { stopId } = await createTripStopFixture();

    for (let index = 0; index < 6; index++) {
      const response = await uploadImages(stopId, [
        new File([await createTestImageBuffer()], `image-${index + 1}.jpg`, { type: 'image/jpeg' })
      ]);
      expect(response.status).toBe(201);
    }

    const seventhResponse = await uploadImages(stopId, [
      new File([await createTestImageBuffer()], 'image-7.jpg', { type: 'image/jpeg' })
    ]);
    const seventhBody = (await seventhResponse.json()) as { error: string };

    expect(seventhResponse.status).toBe(422);
    expect(seventhBody.error).toContain('maximum of 6 images');

    const directUploadPlanResponse = await createDirectUploadPlan(
      stopId,
      new File([Buffer.from('jpeg-data')], 'image-8.jpg', { type: 'image/jpeg' })
    );
    const directUploadPlanBody = (await directUploadPlanResponse.json()) as { error: string };

    expect(directUploadPlanResponse.status).toBe(422);
    expect(directUploadPlanBody.error).toContain('maximum of 6 images');
  });

  it('returns 422 when a trip stop image file exceeds the size limit', async () => {
    const { stopId } = await createTripStopFixture();
    const largeBuffer = Buffer.alloc(16 * 1024 * 1024);
    const file = new File([largeBuffer], 'huge.jpg', { type: 'image/jpeg' });

    const response = await uploadImages(stopId, [file]);
    const body = (await response.json()) as {
      error: string;
      errors: Array<{ reason: string }>;
    };

    expect(response.status).toBe(422);
    expect(body.error).toContain('All uploads failed');
    expect(body.errors[0]!.reason).toBe('File too large.');
  });

  it('returns 422 for unsupported trip stop image file types', async () => {
    const { stopId } = await createTripStopFixture();
    const file = new File(['not an image'], 'readme.txt', { type: 'text/plain' });

    const response = await uploadImages(stopId, [file]);
    const body = (await response.json()) as {
      error: string;
      errors: Array<{ reason: string }>;
    };

    expect(response.status).toBe(422);
    expect(body.error).toContain('All uploads failed');
    expect(body.errors[0]!.reason).toBe('Unsupported file type.');
  });

  it('returns 404 when uploading images to a missing trip stop', async () => {
    const response = await uploadImages(99999, [
      new File([await createTestImageBuffer()], 'missing-stop.jpg', { type: 'image/jpeg' })
    ]);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe('Trip stop not found.');
  });

  it('returns 404 when reordering a missing trip stop', async () => {
    const { app } = await createTripStopFixture();

    const response = await requestAsAdmin(app, '/api/trip-stops/99999/images/reorder', {
      body: JSON.stringify({ imageIds: [1] }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH'
    });

    expect(response.status).toBe(404);
  });

  it('returns 422 when reordering with invalid trip stop image IDs', async () => {
    const { app, stopId } = await createTripStopFixture();
    const uploadResponse = await uploadImages(stopId, [
      new File([await createTestImageBuffer()], 'first.jpg', { type: 'image/jpeg' })
    ]);

    expect(uploadResponse.status).toBe(201);

    const response = await requestAsAdmin(app, `/api/trip-stops/${stopId}/images/reorder`, {
      body: JSON.stringify({ imageIds: [99999] }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH'
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(422);
    expect(body.error).toContain('Invalid image order');
  });

  it('returns 404 when deleting a missing trip stop image', async () => {
    const { app, stopId } = await createTripStopFixture();

    const response = await requestAsAdmin(app, `/api/trip-stops/${stopId}/images/99999`, {
      method: 'DELETE'
    });

    expect(response.status).toBe(404);
  });

  it('returns 422 when all trip stop image uploads fail processing', async () => {
    const { stopId } = await createTripStopFixture();
    const badFile = new File(['not-a-valid-jpeg'], 'bad.jpg', { type: 'image/jpeg' });

    const response = await uploadImages(stopId, [badFile]);
    const body = (await response.json()) as {
      error: string;
      errors: Array<{ reason: string }>;
    };

    expect(response.status).toBe(422);
    expect(body.error).toContain('All uploads failed');
    expect(body.errors[0]!.reason).toBe('Processing failed.');
  });

  it('requires an admin session for uploading trip stop images', async () => {
    const { stopId } = await createTripStopFixture();
    const formData = new FormData();
    formData.append(
      'images',
      new File([await createTestImageBuffer()], 'unauthorized.jpg', { type: 'image/jpeg' })
    );

    const response = await createAuthedApp({ storage }).request(
      `/api/trip-stops/${stopId}/images`,
      {
        body: formData,
        method: 'POST'
      }
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 501 when server-side trip stop uploads are disabled', async () => {
    const { stopId } = await createTripStopFixture();
    const app = createAuthedApp({
      allowServerImageUploads: false,
      storage
    });
    const formData = new FormData();
    formData.append(
      'images',
      new File([await createTestImageBuffer()], 'direct-only.jpg', { type: 'image/jpeg' })
    );

    const response = await requestAsAdmin(app, `/api/trip-stops/${stopId}/images`, {
      body: formData,
      method: 'POST'
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(501);
    expect(body.error).toContain('direct upload flow');
  });

  it('returns 400 when multipart trip stop images contain no files', async () => {
    const { stopId } = await createTripStopFixture();
    const formData = new FormData();
    formData.append('images', 'not-a-file');

    const response = await requestAsAdmin(
      createAuthedApp({ storage }),
      `/api/trip-stops/${stopId}/images`,
      {
        body: formData,
        method: 'POST'
      }
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(400);
    expect(body.error).toBe('No images provided.');
  });

  it('ignores non-file multipart trip stop image entries when a file is present', async () => {
    const { stopId } = await createTripStopFixture();
    const formData = new FormData();
    formData.append('images', 'not-a-file');
    formData.append(
      'images',
      new File([await createTestImageBuffer()], 'mixed.jpg', { type: 'image/jpeg' })
    );

    const response = await requestAsAdmin(
      createAuthedApp({ storage }),
      `/api/trip-stops/${stopId}/images`,
      {
        body: formData,
        method: 'POST'
      }
    );
    const body = (await response.json()) as {
      images: Array<{ originalName: string | null }>;
    };

    expect(response.status).toBe(201);
    expect(body.images).toHaveLength(1);
    expect(body.images[0]?.originalName).toBe('mixed.jpg');
  });

  it('requires an admin session for reordering trip stop images', async () => {
    const { app, stopId } = await createTripStopFixture();

    const response = await app.request(`/api/trip-stops/${stopId}/images/reorder`, {
      body: JSON.stringify({ imageIds: [1] }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH'
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('requires an admin session for deleting trip stop images', async () => {
    const { stopId } = await createTripStopFixture();

    const response = await createAuthedApp({ storage }).request(
      `/api/trip-stops/${stopId}/images/1`,
      {
        method: 'DELETE'
      }
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 422 when trip stop image creation fails validation after upload processing', async () => {
    const { stopId } = await createTripStopFixture();
    const spy = vi
      .spyOn(repositories, 'createTripStopImage')
      .mockRejectedValueOnce(
        new repositories.RepositoryValidationError('Trip stop already has the maximum of 6 images.')
      );

    const response = await uploadImages(stopId, [
      new File([await createTestImageBuffer()], 'late-failure.jpg', { type: 'image/jpeg' })
    ]);
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(422);
    expect(body.error).toContain('maximum of 6 images');

    spy.mockRestore();
  });

  it('returns 500 when trip stop image reorder fails unexpectedly', async () => {
    const { app, stopId } = await createTripStopFixture();
    const uploadResponse = await uploadImages(stopId, [
      new File([await createTestImageBuffer()], 'first.jpg', { type: 'image/jpeg' })
    ]);
    const uploadBody = (await uploadResponse.json()) as {
      images: Array<{ id: number }>;
    };

    const spy = vi
      .spyOn(repositories, 'reorderTripStopImages')
      .mockRejectedValueOnce(new Error('boom'));

    const response = await requestAsAdmin(app, `/api/trip-stops/${stopId}/images/reorder`, {
      body: JSON.stringify({ imageIds: [uploadBody.images[0]!.id] }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH'
    });

    expect(response.status).toBe(500);

    spy.mockRestore();
  });
});
