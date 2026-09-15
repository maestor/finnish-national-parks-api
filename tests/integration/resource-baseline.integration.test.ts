import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { createTrip, createVisit, createVisitImage } from '../../src/db/repositories.js';
import { importParks } from '../../src/importer/import-parks.js';
import { createSlug } from '../../src/parks/park-normalization.js';
import { createMemoryStorage } from '../../src/storage/memory-storage.js';
import { createGeoapifyClient } from '../../src/trip-planner/geoapify.js';
import { createLipasPark } from '../fixtures/lipas.js';
import { createTestDatabase } from '../helpers/test-db.js';

const BASELINE_TIMESTAMP = '2026-09-15T09:00:00.000Z';
const BASELINE_TRIP_SLUG = 'synthetic-20-park-trip';
const BASELINE_IMAGE_COUNT = 13;

const RESOURCE_BUDGETS = {
  archiveBytes: 500,
  galleryPageBytes: 4_500,
  homeSummaryBytes: 3_500,
  mapSummaryBytes: 16_000,
  timelineBytes: 8_000,
  tripDetailBytes: 12_000
} as const;

const QUERY_BUDGETS = {
  conditionalHomeQueries: 5,
  galleryPageQueries: 2
} as const;

type GalleryResponse = {
  images: Array<{ thumbWidth: number | null }>;
  nextOffset: number | null;
};

const expectWithinBudget = (label: string, actual: number, budget: number) => {
  expect(
    actual,
    `${label} measured ${actual} bytes; budget is ${budget} bytes`
  ).toBeLessThanOrEqual(budget);
};

const readJsonResponse = async <T>(response: Response) => {
  const text = await response.text();

  return {
    body: JSON.parse(text) as T,
    bytes: new TextEncoder().encode(text).byteLength,
    response
  };
};

const createBaselineParks = () =>
  Array.from({ length: 20 }, (_, index) =>
    createLipasPark({
      'lipas-id': 20000 + index,
      name: `Synthetic Park ${String(index + 1).padStart(2, '0')}`,
      www: `https://www.luontoon.fi/synthetic-park-${index + 1}`
    })
  );

describe('resource baseline API', () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    testDatabase = await createTestDatabase();

    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 20,
      now: () => BASELINE_TIMESTAMP,
      sourceUrl: 'https://baseline.example/synthetic-catalog',
      fetchSource: async () => ({ items: createBaselineParks() })
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await testDatabase.dispose();
  });

  it('records bounded public payloads, cache-hit queries, and gallery derivatives', async () => {
    const storage = createMemoryStorage();
    const trip = await createTrip(testDatabase.database, {
      description: 'A deterministic trip spanning twenty synthetic parks.',
      name: 'Synthetic 20 Park Trip',
      slug: BASELINE_TRIP_SLUG,
      startingPoint: {
        coordinate: { lat: 60.1699, lon: 24.9384 },
        label: 'Synthetic starting point'
      }
    });
    const visitIds: number[] = [];

    for (const [index, park] of createBaselineParks().entries()) {
      const visit = await createVisit(testDatabase.database, createSlug(park.name), {
        location: { lat: 60 + index / 10, lon: 24 + index / 10 },
        note: `Synthetic timeline visit ${index + 1}`,
        route: `Synthetic route ${index + 1}`,
        tripId: trip.id,
        tripStopOrder: index + 1,
        visitedOn: `2026-08-${String(index + 1).padStart(2, '0')}`
      });
      visitIds.push(visit.id);
    }

    const imageVisitId = visitIds[0]!;
    const fullKeyPrefix = 'baseline/visit/full';
    const thumbKeyPrefix = 'baseline/visit/thumb';

    for (let index = 0; index < BASELINE_IMAGE_COUNT; index += 1) {
      const fullKey = `${fullKeyPrefix}-${index + 1}.jpg`;
      const thumbKey = `${thumbKeyPrefix}-${index + 1}.jpg`;
      const fullBuffer = Buffer.alloc(160_000, index);
      const thumbBuffer = Buffer.alloc(16_000, index);

      await storage.upload(fullKey, fullBuffer, 'image/jpeg');
      await storage.upload(thumbKey, thumbBuffer, 'image/jpeg');
      await createVisitImage(testDatabase.database, {
        createdAt: BASELINE_TIMESTAMP,
        displayOrder: index + 1,
        fileSizeBytes: fullBuffer.byteLength,
        fullHeight: 900,
        fullKey,
        fullWidth: 1600,
        mimeType: 'image/jpeg',
        originalName: `synthetic-${index + 1}.jpg`,
        thumbHeight: 360,
        thumbKey,
        thumbWidth: 640,
        updatedAt: BASELINE_TIMESTAMP,
        visitId: imageVisitId
      });
    }

    const app = createApp({ database: testDatabase.database, storage });
    const executeSpy = vi.spyOn(testDatabase.client, 'execute');

    const measure = async (path: string) => {
      executeSpy.mockClear();
      const result = await readJsonResponse(await app.request(path));

      return {
        bytes: result.bytes,
        queryCount: executeSpy.mock.calls.length,
        response: result.response
      };
    };

    const home = await measure('/api/home-summary');
    const map = await measure('/api/map-summary');
    const timeline = await measure('/api/visits-timeline');
    const archive = await measure('/api/trips/archive?limit=12');
    const tripDetail = await measure(`/api/trips/slug/${BASELINE_TRIP_SLUG}`);

    expect(home.response.status).toBe(200);
    expect(map.response.status).toBe(200);
    expect(timeline.response.status).toBe(200);
    expect(archive.response.status).toBe(200);
    expect(tripDetail.response.status).toBe(200);
    expectWithinBudget('home summary', home.bytes, RESOURCE_BUDGETS.homeSummaryBytes);
    expectWithinBudget('map summary', map.bytes, RESOURCE_BUDGETS.mapSummaryBytes);
    expectWithinBudget('visits timeline', timeline.bytes, RESOURCE_BUDGETS.timelineBytes);
    expectWithinBudget('trip archive', archive.bytes, RESOURCE_BUDGETS.archiveBytes);
    expectWithinBudget('trip detail', tripDetail.bytes, RESOURCE_BUDGETS.tripDetailBytes);

    const homeEtag = home.response.headers.get('etag');
    expect(homeEtag).toEqual(expect.any(String));
    executeSpy.mockClear();
    const cachedHome = await app.request('/api/home-summary', {
      headers: { 'if-none-match': homeEtag! }
    });

    expect(cachedHome.status).toBe(304);
    expect(await cachedHome.text()).toBe('');
    const conditionalHomeQueryCount = executeSpy.mock.calls.length;
    expect(conditionalHomeQueryCount).toBeLessThanOrEqual(home.queryCount);
    expect(conditionalHomeQueryCount).toBeLessThanOrEqual(QUERY_BUDGETS.conditionalHomeQueries);

    executeSpy.mockClear();
    const firstGallery = await readJsonResponse<GalleryResponse>(
      await app.request(
        `/api/trips/slug/${BASELINE_TRIP_SLUG}/visits/${imageVisitId}/images?limit=12`
      )
    );
    const firstGalleryQueryCount = executeSpy.mock.calls.length;
    executeSpy.mockClear();
    const secondGallery = await readJsonResponse<GalleryResponse>(
      await app.request(
        `/api/trips/slug/${BASELINE_TRIP_SLUG}/visits/${imageVisitId}/images?limit=12&offset=12`
      )
    );
    const secondGalleryQueryCount = executeSpy.mock.calls.length;

    expect(firstGallery.response.status).toBe(200);
    expect(secondGallery.response.status).toBe(200);
    expectWithinBudget('gallery page 1', firstGallery.bytes, RESOURCE_BUDGETS.galleryPageBytes);
    expectWithinBudget('gallery page 2', secondGallery.bytes, RESOURCE_BUDGETS.galleryPageBytes);
    expect(firstGallery.body).toMatchObject({
      images: expect.arrayContaining([expect.objectContaining({ thumbWidth: 640 })]),
      nextOffset: 12
    });
    expect(firstGallery.body.images).toHaveLength(12);
    expect(secondGallery.body.images).toHaveLength(1);
    expect(secondGallery.body.nextOffset).toBeNull();
    expect(firstGalleryQueryCount).toBeLessThanOrEqual(QUERY_BUDGETS.galleryPageQueries);
    expect(secondGalleryQueryCount).toBeLessThanOrEqual(QUERY_BUDGETS.galleryPageQueries);

    const fullBytes = storage.getStore().get(`${fullKeyPrefix}-1.jpg`)?.byteLength ?? 0;
    const thumbBytes = storage.getStore().get(`${thumbKeyPrefix}-1.jpg`)?.byteLength ?? 0;
    expect(thumbBytes).toBeLessThan(fullBytes);

    const providerFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [{ formatted: 'Synthetic Helsinki', lat: 60.1699, lon: 24.9384 }]
        }),
        { headers: { 'content-type': 'application/json' }, status: 200 }
      )
    );
    const provider = createGeoapifyClient({
      apiKey: 'synthetic-provider-key',
      fetchFn: providerFetch as typeof fetch
    });

    await Promise.all([
      provider.geocode('Synthetic Helsinki'),
      provider.geocode(' synthetic   helsinki ')
    ]);

    expect(providerFetch).toHaveBeenCalledTimes(1);

    console.info(
      'O4 resource baseline',
      JSON.stringify({
        bytes: {
          archive: archive.bytes,
          galleryPage: [firstGallery.bytes, secondGallery.bytes],
          home: home.bytes,
          map: map.bytes,
          timeline: timeline.bytes,
          tripDetail: tripDetail.bytes
        },
        queries: {
          archive: archive.queryCount,
          galleryPage: [firstGalleryQueryCount, secondGalleryQueryCount],
          home: home.queryCount,
          homeConditional: conditionalHomeQueryCount,
          map: map.queryCount,
          timeline: timeline.queryCount,
          tripDetail: tripDetail.queryCount
        },
        storage: { fullBytes, thumbBytes },
        providerCalls: providerFetch.mock.calls.length
      })
    );
  });
});
