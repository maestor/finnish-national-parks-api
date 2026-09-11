import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import {
  createTripDescriptionExcerpt,
  createTripStopImage,
  createVisitImage,
  decodeTripArchiveCursor,
  listTripArchive
} from '../../src/db/repositories.js';
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

describe('trip archive API', () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;
  let adminSessionCookie: string;

  beforeEach(async () => {
    testDatabase = await createTestDatabase();
    const token = await createSessionToken(
      {
        email: 'admin@example.com',
        name: 'Admin User',
        picture: 'https://example.com/photo.jpg',
        role: 'admin',
        sub: 'google-user-id'
      },
      new TextEncoder().encode(authConfig.jwtSecret)
    );
    adminSessionCookie = `${authConfig.cookieName}=${token}`;

    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 1,
      now: () => '2026-05-01T09:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({ items: [createLipasPark()] })
    });
  });

  afterEach(async () => {
    await testDatabase.dispose();
  });

  const createAuthedApp = (overrides: Parameters<typeof createApp>[0] = {}) =>
    createApp({
      auth: authConfig,
      database: testDatabase.database,
      ...overrides
    });

  const requestAsAdmin = (
    app: ReturnType<typeof createApp>,
    input: Parameters<typeof app.request>[0],
    init?: Parameters<typeof app.request>[1]
  ) => {
    const headers = new Headers(init?.headers);
    headers.set('cookie', adminSessionCookie);
    return app.request(input, { ...init, headers });
  };

  const createTrip = async (
    app: ReturnType<typeof createApp>,
    input: { description?: string | null; name: string }
  ) => {
    const response = await requestAsAdmin(app, '/api/trips', {
      body: JSON.stringify(input),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });
    return (await response.json()) as { id: number; slug: string };
  };

  const createVisit = async (
    app: ReturnType<typeof createApp>,
    tripId: number,
    visitedOn: string
  ) => {
    const response = await requestAsAdmin(app, '/api/parks/akasmannyn-kansallispuisto/visits', {
      body: JSON.stringify({ tripId, visitedOn }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });
    return (await response.json()) as { id: number };
  };

  const createTripStop = async (app: ReturnType<typeof createApp>, tripId: number) => {
    const response = await requestAsAdmin(app, `/api/trips/${tripId}/stops`, {
      body: JSON.stringify({
        location: { coordinate: { lat: 60, lon: 24 }, label: 'Helsinki' },
        tripStopOrder: 1,
        visitedOn: '2026-06-08'
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST'
    });
    return (await response.json()) as { id: number };
  };

  it('returns bounded deterministic cards and continues with a cursor', async () => {
    const app = createAuthedApp();

    for (let index = 0; index < 13; index += 1) {
      const trip = await createTrip(app, {
        description: index === 0 ? '  Ensimmäinen\n\nretki  ' : null,
        name: `Retki ${index + 1}`
      });
      await createVisit(
        app,
        trip.id,
        `2026-${String(12 - Math.floor(index / 2)).padStart(2, '0')}-0${(index % 2) + 1}`
      );
    }
    await createTrip(app, { name: 'Ilman ajankohtaa' });

    const firstResponse = await app.request('/api/trips/archive?limit=12');
    const firstBody = (await firstResponse.json()) as {
      nextCursor: string | null;
      total: number;
      trips: Array<{ dateRange: { start: string } | null; name: string }>;
    };

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.headers.get('cache-control')).toBe('private, no-store');
    expect(firstBody.total).toBe(14);
    expect(firstBody.trips).toHaveLength(12);
    expect(firstBody.trips[0]?.dateRange?.start).toBe('2026-12-02');
    expect(firstBody.trips.at(-1)?.dateRange).not.toBeNull();
    expect(firstBody.nextCursor).toEqual(expect.any(String));

    const secondResponse = await app.request(
      `/api/trips/archive?limit=12&cursor=${encodeURIComponent(firstBody.nextCursor!)}`
    );
    const secondBody = (await secondResponse.json()) as {
      nextCursor: string | null;
      trips: Array<{ name: string; dateRange: unknown }>;
    };

    expect(secondResponse.status).toBe(200);
    expect(secondBody.trips).toHaveLength(2);
    expect(secondBody.trips.at(-1)).toMatchObject({
      dateRange: null,
      name: 'Ilman ajankohtaa'
    });
    expect(secondBody.nextCursor).toBeNull();

    const nullDateCursorArchive = await listTripArchive(testDatabase.database, 12, {
      createdAt: '2026-05-01T09:00:00.000Z',
      id: 1,
      startVisitedOn: null
    });
    expect(nullDateCursorArchive.trips).toEqual([]);
  });

  it('returns one explicitly selected visible cover and omits hidden covers', async () => {
    const storage = createMemoryStorage();
    const app = createAuthedApp({ storage });
    const trip = await createTrip(app, { name: 'Kuvallinen arkistoretki' });
    const visit = await createVisit(app, trip.id, '2026-06-07');
    const image = await createVisitImage(testDatabase.database, {
      createdAt: '2026-06-07T09:00:00.000Z',
      displayOrder: 0,
      fullHeight: 800,
      fullKey: 'visits/archive/full.jpg',
      fullWidth: 1200,
      mimeType: 'image/jpeg',
      thumbKey: 'visits/archive/thumb.jpg',
      updatedAt: '2026-06-07T09:00:00.000Z',
      visitId: visit.id
    });
    const selectResponse = await requestAsAdmin(app, `/api/admin/trips/${trip.id}/featured-image`, {
      body: JSON.stringify({ featuredImage: { imageId: image.id, source: 'visit-image' } }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH'
    });

    expect(selectResponse.status).toBe(200);
    const archiveResponse = await app.request('/api/trips/archive');
    const archiveBody = (await archiveResponse.json()) as {
      trips: Array<{ featuredImage: { height: number; url: string; width: number } | null }>;
    };
    expect(archiveBody.trips[0]?.featuredImage).toEqual({
      height: 800,
      url: 'https://memory-storage.test/visits/archive/full.jpg',
      width: 1200
    });

    const imageWithoutDimensions = await createVisitImage(testDatabase.database, {
      createdAt: '2026-06-07T09:01:00.000Z',
      displayOrder: 1,
      fullHeight: null,
      fullKey: 'visits/archive/no-dimensions-full.jpg',
      fullWidth: null,
      mimeType: 'image/jpeg',
      thumbKey: 'visits/archive/no-dimensions-thumb.jpg',
      updatedAt: '2026-06-07T09:01:00.000Z',
      visitId: visit.id
    });
    const selectImageWithoutDimensionsResponse = await requestAsAdmin(
      app,
      `/api/admin/trips/${trip.id}/featured-image`,
      {
        body: JSON.stringify({
          featuredImage: { imageId: imageWithoutDimensions.id, source: 'visit-image' }
        }),
        headers: { 'content-type': 'application/json' },
        method: 'PATCH'
      }
    );

    expect(selectImageWithoutDimensionsResponse.status).toBe(200);
    const archiveWithoutDimensionsResponse = await app.request('/api/trips/archive');
    const archiveWithoutDimensionsBody = (await archiveWithoutDimensionsResponse.json()) as {
      trips: Array<{
        featuredImage: { height: number | null; url: string; width: number | null } | null;
      }>;
    };
    expect(archiveWithoutDimensionsBody.trips[0]?.featuredImage).toEqual({
      height: null,
      url: 'https://memory-storage.test/visits/archive/no-dimensions-full.jpg',
      width: null
    });

    const emptyUrlArchive = await listTripArchive(testDatabase.database, 12, null, async () => '');
    expect(emptyUrlArchive.trips[0]?.featuredImage).toBeNull();

    await requestAsAdmin(app, '/api/parks/akasmannyn-kansallispuisto/removed', {
      body: JSON.stringify({ removed: true }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH'
    });
    const hiddenArchiveResponse = await app.request('/api/trips/archive');
    const hiddenArchiveBody = (await hiddenArchiveResponse.json()) as {
      trips: Array<{ featuredImage: unknown; visitCount: number }>;
    };
    expect(hiddenArchiveBody.trips[0]).toMatchObject({ featuredImage: null, visitCount: 0 });

    await requestAsAdmin(app, '/api/parks/akasmannyn-kansallispuisto/removed', {
      body: JSON.stringify({ removed: false }),
      headers: { 'content-type': 'application/json' },
      method: 'PATCH'
    });

    const stop = await createTripStop(app, trip.id);
    const stopImage = await createTripStopImage(testDatabase.database, {
      createdAt: '2026-06-08T09:00:00.000Z',
      displayOrder: 0,
      fullHeight: 600,
      fullKey: 'stops/archive/full.jpg',
      fullWidth: 900,
      mimeType: 'image/jpeg',
      thumbKey: 'stops/archive/thumb.jpg',
      tripStopId: stop.id,
      updatedAt: '2026-06-08T09:00:00.000Z'
    });
    const selectStopResponse = await requestAsAdmin(
      app,
      `/api/admin/trips/${trip.id}/featured-image`,
      {
        body: JSON.stringify({
          featuredImage: { imageId: stopImage.id, source: 'trip-stop-image' }
        }),
        headers: { 'content-type': 'application/json' },
        method: 'PATCH'
      }
    );

    expect(selectStopResponse.status).toBe(200);
    const archiveWithStopImage = await app.request('/api/trips/archive');
    const archiveWithStopImageBody = (await archiveWithStopImage.json()) as {
      trips: Array<{ featuredImage: { height: number; url: string; width: number } | null }>;
    };
    expect(archiveWithStopImageBody.trips[0]?.featuredImage).toEqual({
      height: 600,
      url: 'https://memory-storage.test/stops/archive/full.jpg',
      width: 900
    });
  });

  it('rejects invalid cursors and protects remote direct access with the API key', async () => {
    const app = createAuthedApp({ apiKey: 'archive-api-key' });

    const localHeaders = { host: 'localhost:3004' };
    expect(
      (await app.request('/api/trips/archive?limit=0', { headers: localHeaders })).status
    ).toBe(400);
    expect(
      (await app.request('/api/trips/archive?cursor=not-a-cursor', { headers: localHeaders }))
        .status
    ).toBe(400);
    expect(
      (
        await app.request('/api/trips/archive', {
          headers: { host: 'api.example.test', 'x-forwarded-for': '203.0.113.10' }
        })
      ).status
    ).toBe(401);
    expect(
      (
        await app.request('/api/trips/archive', {
          headers: {
            authorization: 'Bearer archive-api-key',
            host: 'api.example.test',
            'x-forwarded-for': '203.0.113.10'
          }
        })
      ).status
    ).toBe(200);
  });

  it('rejects decoded cursors that are not objects or have invalid fields', () => {
    const nullCursor = Buffer.from('null').toString('base64url');
    const invalidFieldsCursor = Buffer.from(
      JSON.stringify({
        createdAt: '2026-05-01T09:00:00.000Z',
        id: 1,
        startVisitedOn: null,
        version: 0
      })
    ).toString('base64url');

    expect(() => decodeTripArchiveCursor(nullCursor)).toThrow('Invalid archive cursor.');
    expect(() => decodeTripArchiveCursor(invalidFieldsCursor)).toThrow('Invalid archive cursor.');
  });

  it('normalizes and truncates descriptions by Unicode code point', () => {
    expect(createTripDescriptionExcerpt('  retki\n  luonnossa  ')).toBe('retki luonnossa');
    expect(createTripDescriptionExcerpt('   ')).toBeNull();
    expect(createTripDescriptionExcerpt('a'.repeat(239))).toBe('a'.repeat(239));
    expect(createTripDescriptionExcerpt(`${'retki '.repeat(50)}loppu`)).toMatch(/…$/u);
    expect(createTripDescriptionExcerpt(`${'retki '.repeat(50)}loppu`)).toHaveLength(234);
    expect(createTripDescriptionExcerpt('😀'.repeat(300))).toBe(`${'😀'.repeat(239)}…`);
  });
});
