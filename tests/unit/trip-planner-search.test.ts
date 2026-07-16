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

const createTrailCandidate = (
  overrides: Partial<TripPlannerParkCandidate> = {}
): TripPlannerParkCandidate =>
  createCandidate({
    category: {
      name: 'Polut/Reitit',
      slug: 'trails-and-routes'
    },
    type: {
      code: 4404,
      id: 4404,
      name: 'Luontopolku',
      slug: 'nature-trail'
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

const createDeferred = <T>() => {
  let reject!: (reason?: unknown) => void;
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    reject = promiseReject;
    resolve = promiseResolve;
  });

  return {
    promise,
    reject,
    resolve
  };
};

describe('trip planner service', () => {
  beforeEach(() => {
    listTripPlannerCandidateParks.mockReset();
  });

  it('starts origin and destination geocoding in parallel', async () => {
    listTripPlannerCandidateParks.mockResolvedValue([]);
    const originDeferred = createDeferred<{
      coordinate: { lat: number; lon: number };
      label: string;
    } | null>();
    const destinationDeferred = createDeferred<{
      coordinate: { lat: number; lon: number };
      label: string;
    } | null>();
    const geocode = vi.fn((query: string) => {
      return query === 'Origin' ? originDeferred.promise : destinationDeferred.promise;
    });
    const service = createTripPlannerService({
      database: {} as Database,
      provider: createProvider({
        geocode
      })
    });

    const searchPromise = service.search({
      destinationQuery: 'Destination',
      mode: 'drive',
      originQuery: 'Origin'
    });

    expect(geocode.mock.calls).toEqual([['Origin'], ['Destination']]);

    originDeferred.resolve({
      coordinate: { lat: 60, lon: 24 },
      label: 'Origin label'
    });
    destinationDeferred.resolve({
      coordinate: { lat: 60, lon: 24.2 },
      label: 'Destination label'
    });

    await expect(searchPromise).resolves.toMatchObject({
      destination: {
        label: 'Destination label'
      },
      origin: {
        label: 'Origin label'
      }
    });
  });

  it('groups unvisited areas first, then unvisited trails, then visited results', async () => {
    listTripPlannerCandidateParks.mockResolvedValue([
      createTrailCandidate({
        boundaryGeoJson: null,
        boundingBox: {
          maxLat: 60.005,
          maxLon: 24.12,
          minLat: 60.001,
          minLon: 24.1
        },
        name: 'Trail First By Distance',
        slug: 'trail-first'
      }),
      createCandidate({
        name: 'A Park',
        slug: 'visited-park',
        visitedSummary: {
          lastVisitedOn: '2026-07-10',
          visitCount: 2,
          visited: true
        }
      }),
      createCandidate({
        boundaryGeoJson: null,
        boundingBox: {
          maxLat: 60.04,
          maxLon: 24.18,
          minLat: 60.03,
          minLon: 24.16
        },
        name: 'Far Area',
        slug: 'far-area'
      }),
      createCandidate({
        boundaryGeoJson: null,
        boundingBox: {
          maxLat: 60.003,
          maxLon: 24.08,
          minLat: 60.001,
          minLon: 24.06
        },
        name: 'Near Area',
        slug: 'near-area'
      }),
      createTrailCandidate({
        boundaryGeoJson: null,
        boundingBox: {
          maxLat: 60.006,
          maxLon: 24.19,
          minLat: 60.004,
          minLon: 24.17
        },
        name: 'Trail Second By Distance',
        slug: 'trail-second'
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

    expect(result.parks.map((park) => park.slug)).toEqual([
      'near-area',
      'far-area',
      'trail-first',
      'trail-second',
      'visited-park'
    ]);
  });

  it('keeps national parks first and sorts other unvisited areas by distance', async () => {
    listTripPlannerCandidateParks.mockResolvedValue([
      createCandidate({
        boundaryGeoJson: null,
        boundingBox: {
          maxLat: 60.003,
          maxLon: 24.08,
          minLat: 60.001,
          minLon: 24.06
        },
        name: 'Nearby Outdoor Area',
        slug: 'nearby-outdoor-area'
      }),
      createCandidate({
        boundaryGeoJson: null,
        boundingBox: {
          maxLat: 60.02,
          maxLon: 24.12,
          minLat: 60.01,
          minLon: 24.1
        },
        name: 'Far National Park',
        slug: 'far-national-park',
        type: {
          code: 111,
          id: 111,
          name: 'Kansallispuisto',
          slug: 'national-park'
        }
      }),
      createCandidate({
        boundaryGeoJson: null,
        boundingBox: {
          maxLat: 60.01,
          maxLon: 24.1,
          minLat: 60.008,
          minLon: 24.09
        },
        name: 'Mid Hiking Area',
        slug: 'mid-hiking-area',
        type: {
          code: 109,
          id: 109,
          name: 'Retkeilyalue',
          slug: 'hiking-area'
        }
      }),
      createCandidate({
        boundaryGeoJson: null,
        boundingBox: {
          maxLat: 60.005,
          maxLon: 24.09,
          minLat: 60.003,
          minLon: 24.08
        },
        name: 'Near Wilderness Area',
        slug: 'near-wilderness-area',
        type: {
          code: 110,
          id: 110,
          name: 'Erämaa-alue',
          slug: 'wilderness-area'
        }
      }),
      createTrailCandidate({
        boundaryGeoJson: null,
        boundingBox: {
          maxLat: 60.006,
          maxLon: 24.19,
          minLat: 60.004,
          minLon: 24.17
        },
        name: 'Trail Result',
        slug: 'trail-result'
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

    expect(result.parks.map((park) => park.slug)).toEqual([
      'far-national-park',
      'nearby-outdoor-area',
      'near-wilderness-area',
      'mid-hiking-area',
      'trail-result'
    ]);
  });

  it('limits unvisited trails to the 10 nearest results', async () => {
    listTripPlannerCandidateParks.mockResolvedValue([
      createCandidate({
        boundaryGeoJson: null,
        boundingBox: {
          maxLat: 60.003,
          maxLon: 24.08,
          minLat: 60.001,
          minLon: 24.06
        },
        name: 'Area Result',
        slug: 'area-result'
      }),
      ...Array.from({ length: 12 }, (_, index) =>
        createTrailCandidate({
          boundaryGeoJson: null,
          boundingBox: {
            maxLat: 60.001 + (index + 1) * 0.002,
            maxLon: 24.06 + (index + 1) * 0.01,
            minLat: 60 + (index + 1) * 0.002,
            minLon: 24.05 + (index + 1) * 0.01
          },
          name: `Trail ${index + 1}`,
          slug: `trail-${index + 1}`
        })
      )
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
      'area-result',
      'trail-1',
      'trail-2',
      'trail-3',
      'trail-4',
      'trail-5',
      'trail-6',
      'trail-7',
      'trail-8',
      'trail-9',
      'trail-10'
    ]);
  });

  it('sorts same-distance trails by name inside the unvisited trail group', async () => {
    listTripPlannerCandidateParks.mockResolvedValue([
      createTrailCandidate({
        boundaryGeoJson: null,
        boundingBox: {
          maxLat: 60.02,
          maxLon: 24.12,
          minLat: 60.01,
          minLon: 24.1
        },
        name: 'Zoo Trail',
        slug: 'zoo-trail'
      }),
      createTrailCandidate({
        boundaryGeoJson: null,
        boundingBox: {
          maxLat: 60.02,
          maxLon: 24.12,
          minLat: 60.01,
          minLon: 24.1
        },
        name: 'Alpha Trail',
        slug: 'alpha-trail'
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

    expect(result.parks.map((park) => park.slug)).toEqual(['alpha-trail', 'zoo-trail']);
    expect(result.parks[0]?.distanceFromRouteKm).toBe(result.parks[1]?.distanceFromRouteKm);
  });

  it('sorts same-distance areas by name inside the unvisited area group', async () => {
    listTripPlannerCandidateParks.mockResolvedValue([
      createCandidate({
        boundaryGeoJson: null,
        boundingBox: {
          maxLat: 60.02,
          maxLon: 24.12,
          minLat: 60.01,
          minLon: 24.1
        },
        name: 'Zoo Area',
        slug: 'zoo-area'
      }),
      createCandidate({
        boundaryGeoJson: null,
        boundingBox: {
          maxLat: 60.02,
          maxLon: 24.12,
          minLat: 60.01,
          minLon: 24.1
        },
        name: 'Alpha Area',
        slug: 'alpha-area'
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

    expect(result.parks.map((park) => park.slug)).toEqual(['alpha-area', 'zoo-area']);
    expect(result.parks[0]?.distanceFromRouteKm).toBe(result.parks[1]?.distanceFromRouteKm);
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

  it('returns map-ready route geometry and park bounding boxes', async () => {
    listTripPlannerCandidateParks.mockResolvedValue([
      createCandidate({
        boundingBox: {
          maxLat: 60.01,
          maxLon: 24.05,
          minLat: 59.99,
          minLon: 24.02
        }
      })
    ]);
    const service = createTripPlannerService({
      database: {} as Database,
      provider: createProvider({
        route: vi.fn(async () => ({
          boundingBox: {
            maxLat: 60.01,
            maxLon: 24.2,
            minLat: 59.99,
            minLon: 24
          },
          distanceMeters: 12_345,
          durationSeconds: 1_234,
          geometry: {
            features: [
              {
                geometry: {
                  coordinates: [[24, 60] as [number, number], [24.1, 60] as [number, number]],
                  type: 'LineString' as const
                },
                type: 'Feature' as const
              },
              {
                geometry: {
                  coordinates: [[24.1, 60] as [number, number], [24.2, 60.01] as [number, number]],
                  type: 'LineString' as const
                },
                type: 'Feature' as const
              }
            ],
            type: 'FeatureCollection' as const
          },
          mode: 'drive' as const
        }))
      })
    });

    const result = await service.search({
      destinationQuery: 'Destination',
      mode: 'drive',
      originQuery: 'Origin'
    });

    expect(result.route).toEqual({
      boundingBox: {
        maxLat: 60.01,
        maxLon: 24.2,
        minLat: 59.99,
        minLon: 24
      },
      distanceMeters: 12_345,
      durationSeconds: 1_234,
      geometry: {
        coordinates: [
          [24, 60],
          [24.1, 60],
          [24.2, 60.01]
        ],
        type: 'LineString'
      },
      mode: 'drive'
    });
    expect(result.parks[0]?.boundingBox).toEqual({
      maxLat: 60.01,
      maxLon: 24.05,
      minLat: 59.99,
      minLon: 24.02
    });
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

  it('returns route_not_found when routing geometry cannot produce a displayable line', async () => {
    listTripPlannerCandidateParks.mockResolvedValue([]);
    const service = createTripPlannerService({
      database: {} as Database,
      provider: createProvider({
        route: vi.fn(async () => ({
          boundingBox: {
            maxLat: 60,
            maxLon: 24,
            minLat: 60,
            minLon: 24
          },
          distanceMeters: 12_345,
          durationSeconds: 1_234,
          geometry: {
            features: [
              {
                geometry: {
                  coordinates: [[24, 60] as [number, number], [24, 60] as [number, number]],
                  type: 'LineString' as const
                },
                type: 'Feature' as const
              }
            ],
            type: 'FeatureCollection' as const
          },
          mode: 'drive' as const
        }))
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
