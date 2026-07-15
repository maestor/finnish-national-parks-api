import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../../src/db/database.js';
import type { GeoJsonFeatureCollection } from '../../src/importer/geometry.js';
import type {
  TripPlannerParkCandidate,
  TripPlannerProvider
} from '../../src/trip-planner/types.js';

const listTripPlannerCandidateParks = vi.fn();

vi.mock('../../src/db/repositories.js', () => ({
  listTripPlannerCandidateParks
}));

const { TripPlannerError, createTripPlannerService } = await import(
  '../../src/trip-planner/search.js'
);

const routeGeometry: GeoJsonFeatureCollection = {
  features: [
    {
      geometry: {
        coordinates: [
          [24, 60],
          [24.2, 60]
        ],
        type: 'LineString'
      },
      type: 'Feature'
    }
  ],
  type: 'FeatureCollection'
};

const createCandidate = (
  overrides: Partial<TripPlannerParkCandidate> = {}
): TripPlannerParkCandidate => ({
  address: 'Testitie 1, 00100 Helsinki',
  boundingBox: {
    maxLat: 60.01,
    maxLon: 24.05,
    minLat: 59.99,
    minLon: 24.02
  },
  boundaryGeoJson: {
    features: [
      {
        geometry: {
          coordinates: [
            [
              [24.02, 59.99],
              [24.05, 59.99],
              [24.05, 60.01],
              [24.02, 60.01],
              [24.02, 59.99]
            ]
          ],
          type: 'Polygon'
        },
        type: 'Feature'
      }
    ],
    type: 'FeatureCollection'
  },
  category: {
    name: 'Ulkoilu-/virkistysalue',
    slug: 'outdoor-recreation-area'
  },
  locationLabel: 'Testitie 1',
  markerPoint: {
    lat: 60,
    lon: 24.03
  },
  name: 'A Park',
  postalCode: '00100',
  postalOffice: 'Helsinki',
  slug: 'a-park',
  type: {
    code: 103,
    id: 103,
    name: 'Ulkoilu-/virkistysalue',
    slug: 'outdoor-recreation-area'
  },
  visitedSummary: {
    lastVisitedOn: null,
    visitCount: 0,
    visited: false
  },
  ...overrides
});

const createProvider = (overrides: Partial<TripPlannerProvider> = {}): TripPlannerProvider => ({
  geocode: vi.fn(async (query: string) => ({
    coordinate: query === 'Origin' ? { lat: 60, lon: 24 } : { lat: 60, lon: 24.2 },
    label: `${query} label`
  })),
  route: vi.fn(async () => ({
    boundingBox: {
      maxLat: 60.01,
      maxLon: 24.2,
      minLat: 59.99,
      minLon: 24
    },
    distanceMeters: 12_345,
    durationSeconds: 1_234,
    geometry: routeGeometry,
    mode: 'drive' as const
  })),
  ...overrides
});

describe('trip planner service', () => {
  beforeEach(() => {
    listTripPlannerCandidateParks.mockReset();
  });

  it('sorts unvisited parks first, then distance, then name', async () => {
    listTripPlannerCandidateParks.mockResolvedValue([
      createCandidate({ name: 'Zoo Park', slug: 'zoo-park' }),
      createCandidate({
        name: 'A Park',
        slug: 'visited-park',
        visitedSummary: {
          lastVisitedOn: '2026-07-10',
          visitCount: 2,
          visited: true
        }
      }),
      createCandidate({ name: 'Alpha Park', slug: 'alpha-park' })
    ]);
    const service = createTripPlannerService({
      database: {} as Database,
      provider: createProvider()
    });

    const result = await service.search({
      destinationQuery: 'Destination',
      mode: 'drive',
      originQuery: 'Origin'
    });

    expect(result.parks.map((park) => park.slug)).toEqual([
      'alpha-park',
      'zoo-park',
      'visited-park'
    ]);
  });

  it('omits displayTypeName when it is missing and falls back to marker point distance', async () => {
    listTripPlannerCandidateParks.mockResolvedValue([
      createCandidate({
        boundingBox: {
          maxLat: Number.POSITIVE_INFINITY,
          maxLon: Number.POSITIVE_INFINITY,
          minLat: Number.NEGATIVE_INFINITY,
          minLon: Number.NEGATIVE_INFINITY
        },
        boundaryGeoJson: null,
        displayTypeName: null,
        markerPoint: {
          lat: 60,
          lon: 24.01
        }
      })
    ]);
    const service = createTripPlannerService({
      database: {} as Database,
      provider: createProvider()
    });

    const result = await service.search({
      destinationQuery: 'Destination',
      mode: 'drive',
      originQuery: 'Origin'
    });

    expect(result.parks).toHaveLength(1);
    expect(result.parks[0]).not.toHaveProperty('displayTypeName');
    expect(result.parks[0]?.distanceFromRouteKm).toBe(0);
  });

  it('includes displayTypeName when it is present', async () => {
    listTripPlannerCandidateParks.mockResolvedValue([
      createCandidate({
        displayTypeName: 'Retkikohde'
      })
    ]);
    const service = createTripPlannerService({
      database: {} as Database,
      provider: createProvider()
    });

    const result = await service.search({
      destinationQuery: 'Destination',
      mode: 'drive',
      originQuery: 'Origin'
    });

    expect(result.parks[0]?.displayTypeName).toBe('Retkikohde');
  });

  it('uses bounding box distance when geometry is missing but bounds are finite', async () => {
    listTripPlannerCandidateParks.mockResolvedValue([
      createCandidate({
        boundaryGeoJson: null,
        boundingBox: {
          maxLat: 60.01,
          maxLon: 24.07,
          minLat: 59.99,
          minLon: 24.03
        },
        markerPoint: {
          lat: 61,
          lon: 26
        }
      })
    ]);
    const service = createTripPlannerService({
      database: {} as Database,
      provider: createProvider()
    });

    const result = await service.search({
      destinationQuery: 'Destination',
      mode: 'drive',
      originQuery: 'Origin'
    });

    expect(result.parks[0]?.distanceFromRouteKm).toBe(0);
  });

  it('sorts same-visit-state parks by shorter distance before name', async () => {
    listTripPlannerCandidateParks.mockResolvedValue([
      createCandidate({
        boundaryGeoJson: null,
        boundingBox: {
          maxLat: 60.003,
          maxLon: 24.12,
          minLat: 60.001,
          minLon: 24.1
        },
        name: 'Near Park',
        slug: 'near-park'
      }),
      createCandidate({
        boundaryGeoJson: null,
        boundingBox: {
          maxLat: 60.06,
          maxLon: 24.19,
          minLat: 60.05,
          minLon: 24.17
        },
        name: 'Far Park',
        slug: 'far-park'
      })
    ]);
    const service = createTripPlannerService({
      database: {} as Database,
      provider: createProvider()
    });

    const result = await service.search({
      destinationQuery: 'Destination',
      mode: 'drive',
      originQuery: 'Origin'
    });

    expect(result.parks.map((park) => park.slug)).toEqual(['near-park', 'far-park']);
    expect(result.parks[0]?.distanceFromRouteKm).toBeLessThan(
      result.parks[1]?.distanceFromRouteKm ?? 0
    );
  });

  it('returns destination_not_found when the destination geocode misses', async () => {
    listTripPlannerCandidateParks.mockResolvedValue([]);
    const provider = createProvider({
      geocode: vi.fn(async (query: string) =>
        query === 'Destination'
          ? null
          : {
              coordinate: { lat: 60, lon: 24 },
              label: 'Origin label'
            }
      )
    });
    const service = createTripPlannerService({
      database: {} as Database,
      provider
    });

    await expect(
      service.search({
        destinationQuery: 'Destination',
        mode: 'drive',
        originQuery: 'Origin'
      })
    ).rejects.toMatchObject({
      code: 'destination_not_found',
      status: 422
    });
  });

  it('returns route_not_found when routing produces no path', async () => {
    listTripPlannerCandidateParks.mockResolvedValue([]);
    const service = createTripPlannerService({
      database: {} as Database,
      provider: createProvider({
        route: vi.fn(async () => null)
      })
    });

    await expect(
      service.search({
        destinationQuery: 'Destination',
        mode: 'drive',
        originQuery: 'Origin'
      })
    ).rejects.toMatchObject({
      code: 'route_not_found',
      status: 422
    });
  });

  it('wraps unexpected provider errors as provider_unavailable', async () => {
    listTripPlannerCandidateParks.mockResolvedValue([]);
    const service = createTripPlannerService({
      database: {} as Database,
      provider: createProvider({
        geocode: vi.fn(async () => {
          throw new Error('boom');
        })
      })
    });

    await expect(
      service.search({
        destinationQuery: 'Destination',
        mode: 'drive',
        originQuery: 'Origin'
      })
    ).rejects.toMatchObject({
      code: 'provider_unavailable',
      status: 503
    });
  });

  it('rejects unsupported travel modes defensively', async () => {
    listTripPlannerCandidateParks.mockResolvedValue([]);
    const service = createTripPlannerService({
      database: {} as Database,
      provider: createProvider()
    });

    await expect(
      service.search({
        destinationQuery: 'Destination',
        mode: 'walk' as never,
        originQuery: 'Origin'
      })
    ).rejects.toMatchObject({
      code: 'provider_unavailable',
      message: 'Unsupported travel mode.',
      status: 503
    });
    expect(listTripPlannerCandidateParks).not.toHaveBeenCalled();
  });

  it('preserves explicit TripPlannerError failures', async () => {
    listTripPlannerCandidateParks.mockResolvedValue([]);
    const service = createTripPlannerService({
      database: {} as Database,
      provider: createProvider({
        geocode: vi.fn(async () => {
          throw new TripPlannerError('origin_not_found', 'Origin was not found.', 422);
        })
      })
    });

    await expect(
      service.search({
        destinationQuery: 'Destination',
        mode: 'drive',
        originQuery: 'Origin'
      })
    ).rejects.toMatchObject({
      code: 'origin_not_found',
      status: 422
    });
  });
});
