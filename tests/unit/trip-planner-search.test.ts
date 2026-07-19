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

const longRouteGeometry: GeoJsonFeatureCollection = {
  features: [
    {
      geometry: {
        coordinates: [
          [24, 60],
          [27, 60]
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
  suggest: vi.fn(async (query: string) => [
    {
      coordinate: { lat: 60.1699, lon: 24.9384 },
      label: `${query} label`
    }
  ]),
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

  it('returns provider suggestions unchanged for valid suggestion queries', async () => {
    const suggest = vi.fn(async () => [
      {
        coordinate: { lat: 60.1699, lon: 24.9384 },
        label: 'Helsinki, Finland'
      },
      {
        coordinate: { lat: 60.2055, lon: 24.6559 },
        label: 'Espoo, Finland'
      }
    ]);
    const service = createTripPlannerService({
      database: {} as Database,
      provider: createProvider({
        suggest
      })
    });

    await expect(service.suggest('He')).resolves.toEqual([
      {
        coordinate: { lat: 60.1699, lon: 24.9384 },
        label: 'Helsinki, Finland'
      },
      {
        coordinate: { lat: 60.2055, lon: 24.6559 },
        label: 'Espoo, Finland'
      }
    ]);
    expect(suggest).toHaveBeenCalledWith('He');
  });

  it('returns default and max distance metadata for route search', async () => {
    listTripPlannerCandidateParks.mockResolvedValue([]);
    const service = createTripPlannerService({
      database: {} as Database,
      provider: createProvider()
    });

    const result = await service.search({
      destinationQuery: 'Destination',
      mode: 'drive',
      originQuery: 'Origin'
    });

    expect(result.maxDistanceKm).toBe(25);
    expect(result.defaultDistanceKm).toBe(13);
  });

  it('caps the route-based default distance by the requested max distance', async () => {
    listTripPlannerCandidateParks.mockResolvedValue([]);
    const service = createTripPlannerService({
      database: {} as Database,
      provider: createProvider()
    });

    const result = await service.search({
      destinationQuery: 'Destination',
      maxDistanceKm: 10,
      mode: 'drive',
      originQuery: 'Origin'
    });

    expect(result.maxDistanceKm).toBe(10);
    expect(result.defaultDistanceKm).toBe(10);
  });

  it('wraps provider failures from suggestions as provider_unavailable errors', async () => {
    const service = createTripPlannerService({
      database: {} as Database,
      provider: createProvider({
        suggest: vi.fn(async () => {
          throw new Error('provider down');
        })
      })
    });

    await expect(service.suggest('He')).rejects.toMatchObject({
      code: 'provider_unavailable',
      message: 'Trip planner provider is unavailable.',
      status: 503
    });
  });

  it('rethrows existing trip planner errors from suggestions unchanged', async () => {
    const service = createTripPlannerService({
      database: {} as Database,
      provider: createProvider({
        suggest: vi.fn(async () => {
          throw new TripPlannerError(
            'trip_planner_not_configured',
            'Trip planner is not configured.',
            503
          );
        })
      })
    });

    await expect(service.suggest('He')).rejects.toMatchObject({
      code: 'trip_planner_not_configured',
      message: 'Trip planner is not configured.',
      status: 503
    });
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

  it('searches nearby parks around the origin without routing and returns a map-ready search area', async () => {
    listTripPlannerCandidateParks.mockResolvedValue([
      createTrailCandidate({
        boundaryGeoJson: null,
        boundingBox: {
          maxLat: 60.001,
          maxLon: 24.07,
          minLat: 59.999,
          minLon: 24.05
        },
        name: 'Nearby Trail',
        slug: 'nearby-trail'
      }),
      createCandidate({
        boundaryGeoJson: null,
        boundingBox: {
          maxLat: 60.02,
          maxLon: 24.16,
          minLat: 60.01,
          minLon: 24.12
        },
        name: 'National Park Nearby',
        slug: 'national-park-nearby',
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
          maxLon: 24.23,
          minLat: 59.99,
          minLon: 24.2
        },
        name: 'Visited Nearby Area',
        slug: 'visited-nearby-area',
        visitedSummary: {
          lastVisitedOn: '2026-07-10',
          visitCount: 1,
          visited: true
        }
      }),
      createCandidate({
        boundaryGeoJson: null,
        boundingBox: {
          maxLat: 60.01,
          maxLon: 24.5,
          minLat: 59.99,
          minLon: 24.45
        },
        name: 'Far Away Area',
        slug: 'far-away-area'
      })
    ]);
    const route = vi.fn();
    const service = createTripPlannerService({
      database: {} as Database,
      provider: createProvider({
        route
      })
    });

    const result = await service.searchNearby({
      originQuery: 'Origin'
    });

    expect(route).not.toHaveBeenCalled();
    expect(result.origin).toEqual({
      coordinate: { lat: 60, lon: 24 },
      label: 'Origin label'
    });
    expect(result.defaultDistanceKm).toBe(10);
    expect(result.maxDistanceKm).toBe(25);
    expect(result.searchArea.center).toEqual({ lat: 60, lon: 24 });
    expect(result.searchArea.maxDistanceKm).toBe(25);
    expect(result.searchArea.boundingBox.minLat).toBeLessThan(59.8);
    expect(result.searchArea.boundingBox.maxLat).toBeGreaterThan(60.2);
    expect(result.parks.map((park) => park.slug)).toEqual([
      'national-park-nearby',
      'nearby-trail',
      'visited-nearby-area'
    ]);
    expect(result.parks[0]?.distanceFromOriginKm).toBeGreaterThan(6);
    expect(result.parks[1]?.distanceFromOriginKm).toBeLessThan(4);
    expect(result.parks[2]?.distanceFromOriginKm).toBeGreaterThan(10);
  });

  it('sorts nearby same-group parks by shorter origin distance before name', async () => {
    listTripPlannerCandidateParks.mockResolvedValue([
      createCandidate({
        boundaryGeoJson: null,
        boundingBox: {
          maxLat: 60.02,
          maxLon: 24.2,
          minLat: 60.01,
          minLon: 24.18
        },
        name: 'Far Nearby Area',
        slug: 'far-nearby-area'
      }),
      createCandidate({
        boundaryGeoJson: null,
        boundingBox: {
          maxLat: 60.005,
          maxLon: 24.08,
          minLat: 60.001,
          minLon: 24.06
        },
        name: 'Near Nearby Area',
        slug: 'near-nearby-area'
      })
    ]);
    const service = createTripPlannerService({
      database: {} as Database,
      provider: createProvider()
    });

    const result = await service.searchNearby({
      originQuery: 'Origin'
    });

    expect(result.parks.map((park) => park.slug)).toEqual(['near-nearby-area', 'far-nearby-area']);
    expect(result.parks[0]?.distanceFromOriginKm).toBeLessThan(
      result.parks[1]?.distanceFromOriginKm ?? 0
    );
  });

  it('returns matching default and max distance metadata for nearby search', async () => {
    listTripPlannerCandidateParks.mockResolvedValue([]);
    const service = createTripPlannerService({
      database: {} as Database,
      provider: createProvider()
    });

    const result = await service.searchNearby({
      maxDistanceKm: 7,
      originQuery: 'Origin'
    });

    expect(result.maxDistanceKm).toBe(7);
    expect(result.defaultDistanceKm).toBe(7);
    expect(result.searchArea.maxDistanceKm).toBe(7);
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

  it('applies stricter start-zone filtering only on long routes', async () => {
    listTripPlannerCandidateParks.mockResolvedValue([
      createCandidate({
        boundaryGeoJson: null,
        boundingBox: {
          maxLat: 60.14,
          maxLon: 24.12,
          minLat: 60.1,
          minLon: 24.08
        },
        markerPoint: {
          lat: 60.12,
          lon: 24.1
        },
        name: 'Start Zone Wide Detour',
        slug: 'start-zone-wide-detour'
      }),
      createCandidate({
        boundaryGeoJson: null,
        boundingBox: {
          maxLat: 60.14,
          maxLon: 25.52,
          minLat: 60.1,
          minLon: 25.48
        },
        markerPoint: {
          lat: 60.12,
          lon: 25.5
        },
        name: 'Farther Along Route',
        slug: 'farther-along-route'
      })
    ]);
    const service = createTripPlannerService({
      database: {} as Database,
      provider: createProvider({
        route: vi.fn(async () => ({
          boundingBox: {
            maxLat: 60,
            maxLon: 27,
            minLat: 60,
            minLon: 24
          },
          distanceMeters: 160_000,
          durationSeconds: 9_000,
          geometry: longRouteGeometry,
          mode: 'drive' as const
        }))
      })
    });

    const result = await service.search({
      destinationQuery: 'Destination',
      mode: 'drive',
      originQuery: 'Origin'
    });

    expect(result.parks.map((park) => park.slug)).toEqual(['farther-along-route']);
  });

  it('pushes remaining start-zone parks behind later route matches on long trips', async () => {
    listTripPlannerCandidateParks.mockResolvedValue([
      createCandidate({
        boundaryGeoJson: null,
        boundingBox: {
          maxLat: 60.05,
          maxLon: 24.07,
          minLat: 60.03,
          minLon: 24.05
        },
        markerPoint: {
          lat: 60.04,
          lon: 24.06
        },
        name: 'Start Zone Close Park',
        slug: 'start-zone-close-park'
      }),
      createCandidate({
        boundaryGeoJson: null,
        boundingBox: {
          maxLat: 60.07,
          maxLon: 24.72,
          minLat: 60.05,
          minLon: 24.7
        },
        markerPoint: {
          lat: 60.06,
          lon: 24.71
        },
        name: 'Later Route Park',
        slug: 'later-route-park'
      })
    ]);
    const service = createTripPlannerService({
      database: {} as Database,
      provider: createProvider({
        route: vi.fn(async () => ({
          boundingBox: {
            maxLat: 60,
            maxLon: 27,
            minLat: 60,
            minLon: 24
          },
          distanceMeters: 160_000,
          durationSeconds: 9_000,
          geometry: longRouteGeometry,
          mode: 'drive' as const
        }))
      })
    });

    const result = await service.search({
      destinationQuery: 'Destination',
      mode: 'drive',
      originQuery: 'Origin'
    });

    expect(result.parks.map((park) => park.slug)).toEqual([
      'later-route-park',
      'start-zone-close-park'
    ]);
  });

  it('breaks same-distance ties on long trips by earlier route progress before name', async () => {
    listTripPlannerCandidateParks.mockResolvedValue([
      createCandidate({
        boundaryGeoJson: null,
        boundingBox: {
          maxLat: 60.09,
          maxLon: 25.42,
          minLat: 60.07,
          minLon: 25.38
        },
        markerPoint: {
          lat: 60.08,
          lon: 25.4
        },
        name: 'Zulu Later Park',
        slug: 'zulu-later-park'
      }),
      createCandidate({
        boundaryGeoJson: null,
        boundingBox: {
          maxLat: 60.09,
          maxLon: 24.82,
          minLat: 60.07,
          minLon: 24.78
        },
        markerPoint: {
          lat: 60.08,
          lon: 24.8
        },
        name: 'Alpha Earlier Park',
        slug: 'alpha-earlier-park'
      })
    ]);
    const service = createTripPlannerService({
      database: {} as Database,
      provider: createProvider({
        route: vi.fn(async () => ({
          boundingBox: {
            maxLat: 60,
            maxLon: 27,
            minLat: 60,
            minLon: 24
          },
          distanceMeters: 160_000,
          durationSeconds: 9_000,
          geometry: longRouteGeometry,
          mode: 'drive' as const
        }))
      })
    });

    const result = await service.search({
      destinationQuery: 'Destination',
      mode: 'drive',
      originQuery: 'Origin'
    });

    expect(result.parks.map((park) => park.slug)).toEqual([
      'alpha-earlier-park',
      'zulu-later-park'
    ]);
    expect(result.parks[0]?.distanceFromRouteKm).toBe(result.parks[1]?.distanceFromRouteKm);
  });

  it('keeps current near-start behavior on shorter routes', async () => {
    listTripPlannerCandidateParks.mockResolvedValue([
      createCandidate({
        boundaryGeoJson: null,
        boundingBox: {
          maxLat: 60.06,
          maxLon: 24.12,
          minLat: 60.02,
          minLon: 24.08
        },
        markerPoint: {
          lat: 60.04,
          lon: 24.1
        },
        name: 'Short Trip Start Zone Park',
        slug: 'short-trip-start-zone-park'
      }),
      createCandidate({
        boundaryGeoJson: null,
        boundingBox: {
          maxLat: 60.14,
          maxLon: 24.5,
          minLat: 60.1,
          minLon: 24.46
        },
        markerPoint: {
          lat: 60.12,
          lon: 24.48
        },
        name: 'Short Trip Later Park',
        slug: 'short-trip-later-park'
      })
    ]);
    const service = createTripPlannerService({
      database: {} as Database,
      provider: createProvider({
        route: vi.fn(async () => ({
          boundingBox: {
            maxLat: 60,
            maxLon: 24.6,
            minLat: 60,
            minLon: 24
          },
          distanceMeters: 60_000,
          durationSeconds: 4_000,
          geometry: {
            features: [
              {
                geometry: {
                  coordinates: [[24, 60] as [number, number], [24.6, 60] as [number, number]],
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

    expect(result.parks.map((park) => park.slug)).toEqual([
      'short-trip-start-zone-park',
      'short-trip-later-park'
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

  it('falls back to marker point distance for nearby search when bounds are not finite', async () => {
    listTripPlannerCandidateParks.mockResolvedValue([
      createCandidate({
        boundingBox: {
          maxLat: Number.POSITIVE_INFINITY,
          maxLon: Number.POSITIVE_INFINITY,
          minLat: Number.NEGATIVE_INFINITY,
          minLon: Number.NEGATIVE_INFINITY
        },
        boundaryGeoJson: null,
        markerPoint: {
          lat: 60,
          lon: 24.01
        },
        slug: 'marker-fallback-nearby'
      })
    ]);
    const service = createTripPlannerService({
      database: {} as Database,
      provider: createProvider()
    });

    const result = await service.searchNearby({
      originQuery: 'Origin'
    });

    expect(result.parks).toHaveLength(1);
    expect(result.parks[0]?.slug).toBe('marker-fallback-nearby');
    expect(result.parks[0]?.distanceFromOriginKm).toBeLessThan(1);
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
    expect(result.maxDistanceKm).toBe(25);
    expect(result.defaultDistanceKm).toBe(13);
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

  it('returns origin_not_found when the nearby origin geocode misses', async () => {
    listTripPlannerCandidateParks.mockResolvedValue([]);
    const service = createTripPlannerService({
      database: {} as Database,
      provider: createProvider({
        geocode: vi.fn(async () => null)
      })
    });

    await expect(
      service.searchNearby({
        originQuery: 'Origin'
      })
    ).rejects.toMatchObject({
      code: 'origin_not_found',
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

  it('wraps unexpected nearby provider errors as provider_unavailable', async () => {
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
      service.searchNearby({
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
