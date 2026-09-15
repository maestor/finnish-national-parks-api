import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { createTrip, createVisit } from '../../src/db/repositories.js';
import { visitImages } from '../../src/db/schema.js';
import { createSessionToken } from '../../src/http/session.js';
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

const IMAGE_SOURCE_BYTES_LIMIT = 15 * 1024 * 1024;
const THUMBNAIL_MAX_DIMENSION = 480;
const FULL_MAX_DIMENSION = 2560;
const THUMBNAIL_MAX_BYTES = 150 * 1024;

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

const createBaselineImageBuffer = async (index: number) => {
  const dimensions =
    index === 0
      ? { height: 900, width: 1600 }
      : index === 1
        ? { height: 1600, width: 900 }
        : index === 2
          ? { height: 240, width: 320 }
          : { height: 800, width: 1200 };
  const pixels = Buffer.alloc(dimensions.width * dimensions.height * 3);

  for (let pixel = 0; pixel < pixels.length; pixel += 3) {
    const position = pixel / 3;
    const x = position % dimensions.width;
    const y = Math.floor(position / dimensions.width);
    pixels[pixel] = (x * 17 + y * 3 + index * 11) % 256;
    pixels[pixel + 1] = (x * 5 + y * 19 + index * 7) % 256;
    pixels[pixel + 2] = (x * 13 + y * 11 + index * 3) % 256;
  }

  return sharp(pixels, {
    raw: {
      channels: 3,
      height: dimensions.height,
      width: dimensions.width
    }
  })
    .jpeg({ quality: 88 })
    .toBuffer();
};

const assertDerivativeBudget = async (fullBuffer: Buffer, thumbBuffer: Buffer) => {
  const [fullMetadata, thumbMetadata] = await Promise.all([
    sharp(fullBuffer).metadata(),
    sharp(thumbBuffer).metadata()
  ]);

  expect(fullMetadata.width).toBeLessThanOrEqual(FULL_MAX_DIMENSION);
  expect(fullMetadata.height).toBeLessThanOrEqual(FULL_MAX_DIMENSION);
  expect(thumbMetadata.width).toBeLessThanOrEqual(THUMBNAIL_MAX_DIMENSION);
  expect(thumbMetadata.height).toBeLessThanOrEqual(THUMBNAIL_MAX_DIMENSION);
  expect(thumbBuffer.byteLength).toBeLessThanOrEqual(THUMBNAIL_MAX_BYTES);
  expect(fullBuffer.byteLength).toBeLessThanOrEqual(IMAGE_SOURCE_BYTES_LIMIT);
};

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
    const auth = {
      cookieName: '__session',
      frontendUrl: 'http://localhost:4300',
      googleClientId: 'baseline-client-id',
      googleClientSecret: 'baseline-client-secret',
      jwtSecret: 'baseline-secret-at-least-32-characters-long'
    };
    const adminSession = await createSessionToken(
      {
        email: 'admin@example.com',
        name: 'Baseline Admin',
        picture: 'https://example.com/admin.jpg',
        role: 'admin',
        sub: 'baseline-admin'
      },
      new TextEncoder().encode(auth.jwtSecret)
    );
    const app = createApp({ auth, database: testDatabase.database, storage });

    for (let index = 0; index < BASELINE_IMAGE_COUNT; index += 1) {
      const key = `visits/${imageVisitId}/staged/baseline-${index + 1}.jpg`;
      await storage.upload(key, await createBaselineImageBuffer(index), 'image/jpeg');
      const response = await app.request(`/api/visits/${imageVisitId}/images/complete`, {
        body: JSON.stringify({ key, originalName: `synthetic-${index + 1}.jpg` }),
        headers: {
          'content-type': 'application/json',
          cookie: `__session=${adminSession}`
        },
        method: 'POST'
      });

      expect(response.status).toBe(201);
    }
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
      images: expect.arrayContaining([expect.objectContaining({ thumbWidth: 480 })]),
      nextOffset: 12
    });
    expect(firstGallery.body.images).toHaveLength(12);
    expect(secondGallery.body.images).toHaveLength(1);
    expect(secondGallery.body.nextOffset).toBeNull();
    expect(firstGalleryQueryCount).toBeLessThanOrEqual(QUERY_BUDGETS.galleryPageQueries);
    expect(secondGalleryQueryCount).toBeLessThanOrEqual(QUERY_BUDGETS.galleryPageQueries);

    const imageRows = await testDatabase.database
      .select()
      .from(visitImages)
      .where(eq(visitImages.visitId, imageVisitId));
    expect(imageRows).toHaveLength(BASELINE_IMAGE_COUNT);
    const firstImage = imageRows[0]!;
    const fullBuffer = storage.getStore().get(firstImage.fullKey)!;
    const thumbBuffer = storage.getStore().get(firstImage.thumbKey)!;
    await assertDerivativeBudget(fullBuffer, thumbBuffer);
    const fullBytes = fullBuffer.byteLength;
    const thumbBytes = thumbBuffer.byteLength;
    expect(thumbBytes).toBeLessThan(fullBytes);
    await expect(assertDerivativeBudget(fullBuffer, fullBuffer)).rejects.toThrow();

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
