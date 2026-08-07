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

describe('date range review routes', () => {
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

  it('rejects previews when the named overview range has fewer than three visits', async () => {
    const app = createAuthedApp();

    await createVisit(app, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-06-10'
    });
    await createVisit(app, 'seitsemisen-kansallispuisto', {
      visitedOn: '2026-06-12'
    });

    const response = await requestAsAdmin(
      app,
      '/api/date-range-review/preview?name=November%20Overview&startDate=2026-06-01&endDate=2026-06-30'
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(422);
    expect(body).toEqual({
      error: 'At least 3 visits are required to build a date range review.'
    });
  });

  it('rejects previews when the named overview range has no in-range visits', async () => {
    const app = createAuthedApp();

    const response = await requestAsAdmin(
      app,
      '/api/date-range-review/preview?name=Empty%20Overview&startDate=2026-06-01&endDate=2026-06-30'
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(422);
    expect(body).toEqual({
      error: 'At least 3 visits are required to build a date range review.'
    });
  });

  it('rejects publishing when the named overview range has fewer than three visits', async () => {
    const app = createAuthedApp();

    await createVisit(app, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-06-10'
    });
    await createVisit(app, 'seitsemisen-kansallispuisto', {
      visitedOn: '2026-06-12'
    });

    const response = await requestAsAdmin(app, '/api/date-range-review/publish', {
      method: 'POST',
      body: JSON.stringify({
        endDate: '2026-06-30',
        name: 'November Overview',
        startDate: '2026-06-01'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(422);
    expect(body).toEqual({
      error: 'At least 3 visits are required to build a date range review.'
    });
  });

  it('requires an admin session and validates publish payloads', async () => {
    const app = createAuthedApp();

    const unauthenticatedPublishResponse = await app.request('/api/date-range-review/publish', {
      method: 'POST',
      body: JSON.stringify({
        endDate: '2026-06-30',
        name: 'Summer Vacation',
        startDate: '2026-06-01'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const unauthenticatedUnpublishResponse = await app.request(
      '/api/date-range-review/publish?name=Summer%20Vacation',
      {
        method: 'DELETE'
      }
    );
    const invalidPublishResponse = await requestAsAdmin(app, '/api/date-range-review/publish', {
      method: 'POST',
      body: JSON.stringify({
        endDate: '2026-06-01',
        name: 'Backwards Overview',
        startDate: '2026-06-30'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const invalidPublishBody = (await invalidPublishResponse.json()) as { error: string };

    expect(unauthenticatedPublishResponse.status).toBe(401);
    expect(unauthenticatedUnpublishResponse.status).toBe(401);
    expect(invalidPublishResponse.status).toBe(422);
    expect(invalidPublishBody).toEqual({
      error: 'Start date must be on or before end date.'
    });
  });

  it('requires an admin session and validates preview date ranges', async () => {
    const app = createAuthedApp();

    const unauthenticatedPreviewResponse = await app.request(
      '/api/date-range-review/preview?name=Summer%20Vacation&startDate=2026-06-01&endDate=2026-06-30'
    );
    const invalidPreviewResponse = await requestAsAdmin(
      app,
      '/api/date-range-review/preview?name=Too%20Long&startDate=2026-01-01&endDate=2026-07-10'
    );
    const malformedPreviewResponse = await requestAsAdmin(
      app,
      '/api/date-range-review/preview?name=Malformed&startDate=2026/01/01&endDate=2026-06-30'
    );
    const invalidMonthPreviewResponse = await requestAsAdmin(
      app,
      '/api/date-range-review/preview?name=Invalid%20Month&startDate=2026-13-01&endDate=2026-06-30'
    );
    const impossibleDatePreviewResponse = await requestAsAdmin(
      app,
      '/api/date-range-review/preview?name=Impossible%20Date&startDate=2026-02-30&endDate=2026-06-30'
    );
    const invalidPreviewBody = (await invalidPreviewResponse.json()) as { error: string };
    const invalidMonthPreviewBody = (await invalidMonthPreviewResponse.json()) as {
      error: string;
    };
    const impossibleDatePreviewBody = (await impossibleDatePreviewResponse.json()) as {
      error: string;
    };

    expect(unauthenticatedPreviewResponse.status).toBe(401);
    expect(invalidPreviewResponse.status).toBe(422);
    expect(invalidPreviewBody).toEqual({
      error: 'Date range review supports at most 184 days.'
    });
    expect(malformedPreviewResponse.status).toBe(400);
    expect(invalidMonthPreviewResponse.status).toBe(422);
    expect(invalidMonthPreviewBody).toEqual({
      error: 'Start date and end date must be valid calendar dates.'
    });
    expect(impossibleDatePreviewResponse.status).toBe(422);
    expect(impossibleDatePreviewBody).toEqual({
      error: 'Start date and end date must be valid calendar dates.'
    });
  });

  it('builds, publishes, and shares a named overview with fresh image urls', async () => {
    const apiKey = 'test-secret-key';
    const storage = createMemoryStorage();
    const app = createAuthedApp({ apiKey, storage });
    type StoryImage = {
      alt: string | null;
      fullHeight: number | null;
      fullUrl: string;
      fullWidth: number | null;
      thumbHeight: number | null;
      thumbUrl: string;
      thumbWidth: number | null;
    };
    type StoryCard =
      | {
          dateRange: {
            endDate: string;
            startDate: string;
          };
          kind: 'intro';
          name: string;
          tripCount: number;
        }
      | {
          featuredImage: StoryImage | null;
          kind: 'photo-highlight';
        }
      | {
          kind: 'new-parks';
          parks: Array<{
            featuredImage: StoryImage | null;
            park: {
              name: string;
              slug: string;
            };
            visitedOn: string;
          }>;
        }
      | {
          kind: 'revisited-parks';
          parks: Array<{
            featuredImage: StoryImage | null;
            park: {
              name: string;
              slug: string;
            };
            previousVisitDate: string;
            revisitCount: number;
            visitedOn: string;
          }>;
        }
      | {
          featuredImage: StoryImage | null;
          kind: 'trip-summary';
          trip: {
            id: number;
            slug: string;
          };
        };

    const tripResponse = await createTrip(app, {
      description: 'Named overview trip',
      name: 'Summer Escape 2026'
    });
    const trip = (await tripResponse.json()) as { id: number };

    const oldVisitResponse = await createVisit(app, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-05-29'
    });
    const oldVisit = (await oldVisitResponse.json()) as { id: number };

    const revisitResponse = await createVisit(app, 'akasmannyn-kansallispuisto', {
      tripId: trip.id,
      tripStopOrder: 1,
      visitedOn: '2026-06-10'
    });
    const revisitVisit = (await revisitResponse.json()) as { id: number };

    const photoVisitResponse = await createVisit(app, 'seitsemisen-kansallispuisto', {
      tripId: trip.id,
      tripStopOrder: 2,
      visitedOn: '2026-06-12'
    });
    const photoVisit = (await photoVisitResponse.json()) as { id: number };

    const thirdVisitResponse = await createVisit(app, 'evon-retkeilyalue', {
      visitedOn: '2026-06-18'
    });
    const thirdVisit = (await thirdVisitResponse.json()) as { id: number };

    const imageBuffer = await createTestImageBuffer();
    const firstImageFile = new File([imageBuffer], 'revisit.jpg', { type: 'image/jpeg' });
    const photoLeadImageFile = new File([imageBuffer], 'photo-lead.jpg', { type: 'image/jpeg' });
    const photoExtraImageFile = new File([imageBuffer], 'photo-extra.jpg', { type: 'image/jpeg' });
    const thirdImageFile = new File([imageBuffer], 'third.jpg', { type: 'image/jpeg' });

    expect(await uploadImages(app, oldVisit.id, [firstImageFile])).toMatchObject({ status: 201 });
    expect(await uploadImages(app, revisitVisit.id, [firstImageFile])).toMatchObject({
      status: 201
    });
    expect(
      await uploadImages(app, photoVisit.id, [photoLeadImageFile, photoExtraImageFile])
    ).toMatchObject({
      status: 201
    });
    expect(await uploadImages(app, thirdVisit.id, [thirdImageFile])).toMatchObject({
      status: 201
    });

    const previewResponse = await requestAsAdmin(
      app,
      '/api/date-range-review/preview?name=Summer%20Vacation&startDate=2026-06-01&endDate=2026-06-30'
    );
    const previewBody = (await previewResponse.json()) as {
      overview: {
        endDate: string;
        name: string;
        shareSlug: string;
        startDate: string;
      };
      publishInfo: {
        publicUrl: string | null;
        publishedAt: string | null;
        publishedShareId: string | null;
        sharePath: string | null;
      };
      status: 'draft' | 'published';
      story: {
        cards: StoryCard[];
        summary: {
          imageCount: number;
          newNationalParkCount: number;
          revisitedParkCount: number;
          tripCount: number;
          visitCount: number;
        };
      };
    };

    expect(previewResponse.status).toBe(200);
    expect(previewBody.overview).toEqual({
      endDate: '2026-06-30',
      name: 'Summer Vacation',
      shareSlug: 'summer-vacation',
      startDate: '2026-06-01'
    });
    expect(previewBody.status).toBe('draft');
    expect(previewBody.publishInfo).toEqual({
      publicUrl: null,
      publishedAt: null,
      publishedShareId: null,
      sharePath: null
    });
    expect(previewBody.story.summary).toMatchObject({
      imageCount: 4,
      newNationalParkCount: 1,
      revisitedParkCount: 1,
      tripCount: 1,
      visitCount: 3
    });
    expect(previewBody.story.cards.map((card) => card.kind)).toEqual([
      'intro',
      'photo-highlight',
      'new-parks',
      'revisited-parks',
      'trip-summary'
    ]);

    const previewPhotoCard = previewBody.story.cards.find(
      (
        card
      ): card is Extract<(typeof previewBody.story.cards)[number], { kind: 'photo-highlight' }> =>
        card.kind === 'photo-highlight'
    );
    const previewNewParksCard = previewBody.story.cards.find(
      (card): card is Extract<(typeof previewBody.story.cards)[number], { kind: 'new-parks' }> =>
        card.kind === 'new-parks'
    );
    const previewRevisitedCard = previewBody.story.cards.find(
      (
        card
      ): card is Extract<(typeof previewBody.story.cards)[number], { kind: 'revisited-parks' }> =>
        card.kind === 'revisited-parks'
    );
    const previewTripCard = previewBody.story.cards.find(
      (card): card is Extract<(typeof previewBody.story.cards)[number], { kind: 'trip-summary' }> =>
        card.kind === 'trip-summary'
    );

    expect(previewPhotoCard?.featuredImage?.fullUrl).toContain('https://memory-storage.test/');
    expect(previewNewParksCard?.parks[0]?.featuredImage?.thumbUrl).toContain(
      'https://memory-storage.test/'
    );
    expect(previewRevisitedCard?.parks[0]).toMatchObject({
      previousVisitDate: '2026-05-29',
      revisitCount: 1,
      visitedOn: '2026-06-10'
    });
    expect(previewTripCard?.featuredImage?.fullUrl).toContain('https://memory-storage.test/');

    const publishResponse = await requestAsAdmin(app, '/api/date-range-review/publish', {
      method: 'POST',
      body: JSON.stringify({
        endDate: '2026-06-30',
        name: 'Summer Vacation',
        startDate: '2026-06-01'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const publishBody = (await publishResponse.json()) as {
      shareId: string;
      sharePath: string;
    };

    expect(publishResponse.status).toBe(200);
    expect(publishBody.sharePath).toContain('/ajanjaksokatsaus/jako/');

    const publishedPreviewResponse = await requestAsAdmin(
      app,
      '/api/date-range-review/preview?name=Summer%20Vacation&startDate=2026-06-01&endDate=2026-06-30'
    );
    const publishedPreviewBody = (await publishedPreviewResponse.json()) as {
      publishInfo: {
        publicUrl: string | null;
        publishedAt: string | null;
        publishedShareId: string | null;
        sharePath: string | null;
      };
      status: 'draft' | 'published';
    };

    expect(publishedPreviewResponse.status).toBe(200);
    expect(publishedPreviewBody.status).toBe('published');
    expect(publishedPreviewBody.publishInfo).toEqual({
      publicUrl: `http://localhost:4300${publishBody.sharePath}`,
      publishedAt: expect.any(String),
      publishedShareId: publishBody.shareId,
      sharePath: publishBody.sharePath
    });

    const shareResponse = await app.request(
      `/api/date-range-review/shares/${publishBody.shareId}`,
      {
        headers: {
          authorization: `Bearer ${apiKey}`,
          'x-forwarded-for': '203.0.113.1'
        }
      }
    );
    const shareBody = (await shareResponse.json()) as {
      overview: {
        name: string;
        shareSlug: string;
      };
      story: {
        cards: StoryCard[];
      };
    };
    const shareTripCard = shareBody.story.cards.find(
      (card): card is Extract<(typeof shareBody.story.cards)[number], { kind: 'trip-summary' }> =>
        card.kind === 'trip-summary'
    );

    expect(shareResponse.status).toBe(200);
    expect(shareBody.overview).toEqual({
      endDate: '2026-06-30',
      name: 'Summer Vacation',
      shareSlug: 'summer-vacation',
      startDate: '2026-06-01'
    });
    expect(shareTripCard?.featuredImage?.thumbUrl).toContain('https://memory-storage.test/');

    const unpublishResponse = await requestAsAdmin(
      app,
      '/api/date-range-review/publish?name=Summer%20Vacation',
      {
        method: 'DELETE'
      }
    );

    expect(unpublishResponse.status).toBe(204);

    const removedShareResponse = await app.request(
      `/api/date-range-review/shares/${publishBody.shareId}`,
      {
        headers: {
          authorization: `Bearer ${apiKey}`,
          'x-forwarded-for': '203.0.113.1'
        }
      }
    );
    const removedShareBody = (await removedShareResponse.json()) as { error: string };

    expect(removedShareResponse.status).toBe(404);
    expect(removedShareBody).toEqual({
      error: 'Published date range review share not found.'
    });
  });

  it('returns not found when unpublishing a missing named overview', async () => {
    const app = createAuthedApp();

    const response = await requestAsAdmin(
      app,
      '/api/date-range-review/publish?name=Missing%20Overview',
      {
        method: 'DELETE'
      }
    );
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(body).toEqual({
      error: 'Published date range review share not found.'
    });
  });
});
