import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { createSessionToken } from '../../src/http/session.js';
import { importParks } from '../../src/importer/import-parks.js';
import { createMemoryStorage } from '../../src/storage/memory-storage.js';
import { createLipasPark, parkTypeFixtures } from '../fixtures/lipas.js';
import { createTestDatabase } from '../helpers/test-db.js';

const authConfig = {
  cookieName: '__session',
  frontendUrl: 'http://localhost:4300',
  googleClientId: 'test-google-client-id',
  googleClientSecret: 'test-google-client-secret',
  jwtSecret: 'test-jwt-secret-at-least-32-characters-long'
};

const createAdminSessionCookie = async () => {
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

  return `${authConfig.cookieName}=${token}`;
};

describe('year review routes', () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;
  let adminSessionCookie: string;

  beforeEach(async () => {
    testDatabase = await createTestDatabase();
    adminSessionCookie = await createAdminSessionCookie();

    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 3,
      now: () => '2026-05-01T09:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark(),
          createLipasPark({
            'lipas-id': 67890,
            name: 'Seitsemisen kansallispuisto',
            location: {
              address: 'Seitsemisentie 1',
              'postal-office': 'Ylöjärvi'
            },
            properties: {
              'area-km2': 45.2
            },
            www: 'https://www.luontoon.fi/seitseminen'
          }),
          createLipasPark({
            'lipas-id': 67891,
            name: 'Evon retkeilyalue',
            type: {
              'type-code': parkTypeFixtures.stateHikingArea.typeCode
            },
            location: {
              address: 'Evontie 1',
              'postal-office': 'Evo'
            },
            properties: {
              'area-km2': 47.0
            },
            www: 'https://www.luontoon.fi/evo'
          })
        ]
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
    headers.set('host', 'localhost:3004');

    return app.request(input, {
      ...init,
      headers
    });
  };

  const createVisit = async (
    app: ReturnType<typeof createApp>,
    slug: string,
    body: {
      route?: string;
      tripId?: number | null;
      tripStopOrder?: number;
      visitedOn: string;
    }
  ) => {
    return requestAsAdmin(app, `/api/parks/${slug}/visits`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json'
      }
    });
  };

  const createTrip = async (
    app: ReturnType<typeof createApp>,
    body: {
      description?: string | null;
      name: string;
      slug?: string;
    }
  ) => {
    return requestAsAdmin(app, '/api/trips', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json'
      }
    });
  };

  const createTestImageBuffer = async (width = 1200, height = 800) => {
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

  const uploadImages = async (
    app: ReturnType<typeof createApp>,
    visitId: number,
    files: File[]
  ) => {
    const formData = new FormData();

    for (const file of files) {
      formData.append('images', file);
    }

    return requestAsAdmin(app, `/api/visits/${visitId}/images`, {
      body: formData,
      method: 'POST'
    });
  };

  it('builds an admin-only preview from existing visits and trips', async () => {
    const app = createAuthedApp();
    const tripResponse = await createTrip(app, {
      description: 'Kesäreissu Kainuuseen',
      name: 'Kesäreissu 2026'
    });
    const trip = (await tripResponse.json()) as { id: number };

    await createVisit(app, 'akasmannyn-kansallispuisto', {
      route: 'North trail',
      tripId: trip.id,
      tripStopOrder: 1,
      visitedOn: '2026-01-15'
    });
    await createVisit(app, 'seitsemisen-kansallispuisto', {
      route: 'Harjupolku',
      tripId: trip.id,
      tripStopOrder: 2,
      visitedOn: '2026-07-20'
    });

    const previewResponse = await requestAsAdmin(app, '/api/year-review/2026/preview');
    const previewBody = (await previewResponse.json()) as {
      generatedAt: string;
      publishInfo: {
        publicUrl: string | null;
        publishedAt: string | null;
        publishedShareId: string | null;
        sharePath: string | null;
      };
      status: 'draft' | 'published';
      story: {
        cards: Array<{ kind: string }>;
        summary: {
          distinctParkCount: number;
          imageCount: number;
          newParkCount: number;
          visitCount: number;
        };
        year: number;
      };
      year: number;
    };

    expect(previewResponse.status).toBe(200);
    expect(previewResponse.headers.get('cache-control')).toBe('private, no-store');
    expect(previewBody.year).toBe(2026);
    expect(previewBody.generatedAt).toMatch(/^2026-\d{2}-\d{2}T/);
    expect(previewBody.status).toBe('draft');
    expect(previewBody.publishInfo).toEqual({
      publicUrl: null,
      publishedAt: null,
      publishedShareId: null,
      sharePath: null
    });
    expect(previewBody.story.year).toBe(2026);
    expect(previewBody.story.summary).toMatchObject({
      distinctParkCount: 2,
      imageCount: 0,
      visitCount: 2
    });
    expect(previewBody.story.cards.map((card) => card.kind)).toEqual(
      expect.arrayContaining([
        'intro',
        'milestone',
        'photo-highlight',
        'profile',
        'trip-highlight',
        'seasonal',
        'summary'
      ])
    );
  });

  it('builds a preview without photo highlight assets when the selected year has no visits', async () => {
    const app = createAuthedApp();

    const previewResponse = await requestAsAdmin(app, '/api/year-review/2027/preview');
    const previewBody = (await previewResponse.json()) as {
      story: {
        cards: Array<
          | { kind: string }
          | {
              featuredImage: null;
              kind: 'photo-highlight';
              visit: null;
            }
        >;
        summary: {
          distinctParkCount: number;
          imageCount: number;
          newParkCount: number;
          visitCount: number;
        };
      };
      year: number;
    };

    expect(previewResponse.status).toBe(200);
    expect(previewBody.year).toBe(2027);
    expect(previewBody.story.summary).toMatchObject({
      distinctParkCount: 0,
      imageCount: 0,
      newParkCount: 0,
      visitCount: 0
    });

    const photoHighlightCard = previewBody.story.cards.find(
      (
        card
      ): card is Extract<(typeof previewBody.story.cards)[number], { kind: 'photo-highlight' }> =>
        card.kind === 'photo-highlight'
    );

    expect(photoHighlightCard).toMatchObject({
      featuredImage: null,
      kind: 'photo-highlight',
      visit: null
    });
  });

  it('resolves the published photo highlight image to fresh public urls for preview and share reads', async () => {
    const apiKey = 'test-secret-key';
    const storage = createMemoryStorage();
    const app = createAuthedApp({ apiKey, storage });

    const visitResponse = await createVisit(app, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-06-07'
    });
    const visitBody = (await visitResponse.json()) as { id: number };
    const imageBuffer = await createTestImageBuffer();
    const imageFile = new File([imageBuffer], 'year-review.jpg', { type: 'image/jpeg' });

    const uploadResponse = await uploadImages(app, visitBody.id, [imageFile]);
    expect(uploadResponse.status).toBe(201);

    const previewResponse = await requestAsAdmin(app, '/api/year-review/2026/preview');
    const previewBody = (await previewResponse.json()) as {
      story: {
        cards: Array<
          | { kind: string }
          | {
              featuredImage: {
                alt: string | null;
                fullHeight: number | null;
                fullUrl: string;
                fullWidth: number | null;
                thumbHeight: number | null;
                thumbUrl: string;
                thumbWidth: number | null;
              } | null;
              kind: 'photo-highlight';
            }
        >;
      };
    };
    const previewPhotoCard = previewBody.story.cards.find(
      (
        card
      ): card is Extract<(typeof previewBody.story.cards)[number], { kind: 'photo-highlight' }> =>
        card.kind === 'photo-highlight'
    );

    expect(previewPhotoCard?.featuredImage).toMatchObject({
      alt: 'Kuva käynniltä Äkäsmännyn kansallispuisto 2026-06-07',
      fullHeight: 800,
      fullWidth: 1200
    });
    expect(previewPhotoCard?.featuredImage?.fullUrl).toContain('https://memory-storage.test/');
    expect(previewPhotoCard?.featuredImage?.thumbUrl).toContain('https://memory-storage.test/');

    const publishResponse = await requestAsAdmin(app, '/api/year-review/2026/publish', {
      method: 'POST'
    });
    const publishBody = (await publishResponse.json()) as {
      shareId: string;
    };

    const shareResponse = await app.request(`/api/year-review/shares/${publishBody.shareId}`, {
      headers: {
        authorization: `Bearer ${apiKey}`,
        'x-forwarded-for': '203.0.113.1'
      }
    });
    const shareBody = (await shareResponse.json()) as {
      story: {
        cards: Array<
          | { kind: string }
          | {
              featuredImage: {
                alt: string | null;
                fullHeight: number | null;
                fullUrl: string;
                fullWidth: number | null;
                thumbHeight: number | null;
                thumbUrl: string;
                thumbWidth: number | null;
              } | null;
              kind: 'photo-highlight';
            }
        >;
      };
    };
    const sharePhotoCard = shareBody.story.cards.find(
      (
        card
      ): card is Extract<(typeof shareBody.story.cards)[number], { kind: 'photo-highlight' }> =>
        card.kind === 'photo-highlight'
    );

    expect(shareResponse.status).toBe(200);
    expect(sharePhotoCard?.featuredImage).toMatchObject({
      alt: 'Kuva käynniltä Äkäsmännyn kansallispuisto 2026-06-07',
      fullHeight: 800,
      fullWidth: 1200
    });
    expect(sharePhotoCard?.featuredImage?.fullUrl).toContain('https://memory-storage.test/');
    expect(sharePhotoCard?.featuredImage?.thumbUrl).toContain('https://memory-storage.test/');
  });

  it('drops the photo highlight image from the response when a fresh public url cannot be resolved', async () => {
    const baseStorage = createMemoryStorage();
    const storageWithMissingThumbUrl = {
      ...baseStorage,
      getPresignedUrl: async (key: string, expiresInSeconds: number) => {
        if (key.endsWith('-thumb.jpg')) {
          return '';
        }

        return baseStorage.getPresignedUrl(key, expiresInSeconds);
      }
    };
    const app = createAuthedApp({ storage: storageWithMissingThumbUrl });

    const visitResponse = await createVisit(app, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-06-07'
    });
    const visitBody = (await visitResponse.json()) as { id: number };
    const imageBuffer = await createTestImageBuffer();
    const imageFile = new File([imageBuffer], 'year-review.jpg', { type: 'image/jpeg' });

    const uploadResponse = await uploadImages(app, visitBody.id, [imageFile]);
    expect(uploadResponse.status).toBe(201);

    const previewResponse = await requestAsAdmin(app, '/api/year-review/2026/preview');
    const previewBody = (await previewResponse.json()) as {
      story: {
        cards: Array<
          | { kind: string }
          | {
              featuredImage: null;
              kind: 'photo-highlight';
            }
        >;
      };
    };
    const previewPhotoCard = previewBody.story.cards.find(
      (
        card
      ): card is Extract<(typeof previewBody.story.cards)[number], { kind: 'photo-highlight' }> =>
        card.kind === 'photo-highlight'
    );

    expect(previewResponse.status).toBe(200);
    expect(previewPhotoCard?.featuredImage).toBeNull();
  });

  it('returns a published preview state and reuses the share id when republishing the same year', async () => {
    const app = createAuthedApp();

    await createVisit(app, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-03-12'
    });

    const firstPublishResponse = await requestAsAdmin(app, '/api/year-review/2026/publish', {
      method: 'POST'
    });
    const firstPublishBody = (await firstPublishResponse.json()) as {
      publicUrl: string;
      publishedAt: string;
      shareId: string;
      sharePath: string;
    };
    const secondPublishResponse = await requestAsAdmin(app, '/api/year-review/2026/publish', {
      method: 'POST'
    });
    const secondPublishBody = (await secondPublishResponse.json()) as {
      publicUrl: string;
      publishedAt: string;
      shareId: string;
      sharePath: string;
    };
    const previewResponse = await requestAsAdmin(app, '/api/year-review/2026/preview');
    const previewBody = (await previewResponse.json()) as {
      publishInfo: {
        publicUrl: string | null;
        publishedAt: string | null;
        publishedShareId: string | null;
        sharePath: string | null;
      };
      status: 'draft' | 'published';
    };

    expect(firstPublishResponse.status).toBe(200);
    expect(secondPublishResponse.status).toBe(200);
    expect(secondPublishBody.shareId).toBe(firstPublishBody.shareId);
    expect(secondPublishBody.sharePath).toBe(firstPublishBody.sharePath);
    expect(previewResponse.status).toBe(200);
    expect(previewBody.status).toBe('published');
    expect(previewBody.publishInfo).toEqual({
      publicUrl: firstPublishBody.publicUrl,
      publishedAt: secondPublishBody.publishedAt,
      publishedShareId: firstPublishBody.shareId,
      sharePath: firstPublishBody.sharePath
    });
  });

  it('publishes a tokenized share snapshot and serves it to authorized callers', async () => {
    const apiKey = 'test-secret-key';
    const app = createAuthedApp({ apiKey });

    await createVisit(app, 'akasmannyn-kansallispuisto', {
      route: 'North trail',
      visitedOn: '2026-06-07'
    });

    const publishResponse = await requestAsAdmin(app, '/api/year-review/2026/publish', {
      method: 'POST'
    });
    const publishBody = (await publishResponse.json()) as {
      publicUrl: string;
      publishedAt: string;
      shareId: string;
      sharePath: string;
    };

    expect(publishResponse.status).toBe(200);
    expect(publishResponse.headers.get('cache-control')).toBe('private, no-store');
    expect(publishBody.shareId).toMatch(/^[0-9a-f-]{36}$/);
    expect(publishBody.sharePath).toBe(`/vuosikatsaus/jako/${publishBody.shareId}`);
    expect(publishBody.publicUrl).toBe(
      `http://localhost:4300/vuosikatsaus/jako/${publishBody.shareId}`
    );
    expect(publishBody.publishedAt).toMatch(/^2026-\d{2}-\d{2}T/);

    const shareResponse = await app.request(`/api/year-review/shares/${publishBody.shareId}`, {
      headers: {
        authorization: `Bearer ${apiKey}`,
        'x-forwarded-for': '203.0.113.1'
      }
    });
    const shareBody = (await shareResponse.json()) as {
      publishedAt: string;
      shareId: string;
      story: {
        summary: {
          visitCount: number;
        };
        year: number;
      };
      year: number;
    };

    expect(shareResponse.status).toBe(200);
    expect(shareResponse.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=600');
    expect(shareBody.shareId).toBe(publishBody.shareId);
    expect(shareBody.year).toBe(2026);
    expect(shareBody.publishedAt).toBe(publishBody.publishedAt);
    expect(shareBody.story.year).toBe(2026);
    expect(shareBody.story.summary.visitCount).toBe(1);
  });

  it('keeps preview and publish admin-only while requiring the api key for share reads', async () => {
    const apiKey = 'test-secret-key';
    const app = createAuthedApp({ apiKey });

    const unauthorizedPreviewResponse = await app.request('/api/year-review/2026/preview', {
      headers: {
        'x-forwarded-for': '203.0.113.1'
      }
    });
    const unauthorizedPublishResponse = await app.request('/api/year-review/2026/publish', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'x-forwarded-for': '203.0.113.1'
      }
    });
    const unauthorizedShareResponse = await app.request(
      '/api/year-review/shares/11111111-1111-4111-8111-111111111111',
      {
        headers: {
          'x-forwarded-for': '203.0.113.1'
        }
      }
    );

    expect(unauthorizedPreviewResponse.status).toBe(401);
    expect(unauthorizedPublishResponse.status).toBe(401);
    expect(unauthorizedShareResponse.status).toBe(401);
  });

  it('requires an admin session in the route handler for localhost preview and unpublish requests', async () => {
    const apiKey = 'test-secret-key';
    const app = createAuthedApp({ apiKey });

    const previewResponse = await app.request('/api/year-review/2026/preview', {
      headers: {
        host: 'localhost:3004'
      }
    });
    const unpublishResponse = await app.request('/api/year-review/2026/publish', {
      method: 'DELETE',
      headers: {
        host: 'localhost:3004'
      }
    });

    expect(previewResponse.status).toBe(401);
    expect(unpublishResponse.status).toBe(401);
  });

  it('unpublishes an existing share and makes the public token return not found', async () => {
    const app = createAuthedApp();

    await createVisit(app, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-06-07'
    });

    const publishResponse = await requestAsAdmin(app, '/api/year-review/2026/publish', {
      method: 'POST'
    });
    const published = (await publishResponse.json()) as { shareId: string };

    const unpublishResponse = await requestAsAdmin(app, '/api/year-review/2026/publish', {
      method: 'DELETE'
    });

    expect(unpublishResponse.status).toBe(204);
    expect(unpublishResponse.headers.get('cache-control')).toBe('private, no-store');

    const shareResponse = await app.request(`/api/year-review/shares/${published.shareId}`, {
      headers: {
        authorization: 'Bearer test-secret-key',
        'x-forwarded-for': '203.0.113.1'
      }
    });

    expect(shareResponse.status).toBe(404);
  });

  it('returns not found when unpublishing a year without a published share', async () => {
    const app = createAuthedApp();

    const unpublishResponse = await requestAsAdmin(app, '/api/year-review/2026/publish', {
      method: 'DELETE'
    });
    const unpublishBody = (await unpublishResponse.json()) as { error: string };

    expect(unpublishResponse.status).toBe(404);
    expect(unpublishResponse.headers.get('cache-control')).toBe('private, no-store');
    expect(unpublishBody).toEqual({
      error: 'Published year review share not found.'
    });
  });
});
