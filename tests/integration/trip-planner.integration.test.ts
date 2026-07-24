import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import { createVisit } from '../../src/db/repositories.js';
import { importParks } from '../../src/importer/import-parks.js';
import { createGeoapifyClient } from '../../src/trip-planner/geoapify.js';
import { createTripPlannerService } from '../../src/trip-planner/search.js';
import { createLipasPark, createLipasTrail, parkTypeFixtures } from '../fixtures/lipas.js';
import { createTestDatabase } from '../helpers/test-db.js';

const createPolygon = (minLon: number, minLat: number, maxLon: number, maxLat: number) => ({
  features: [
    {
      geometry: {
        coordinates: [
          [
            [minLon, minLat],
            [maxLon, minLat],
            [maxLon, maxLat],
            [minLon, maxLat],
            [minLon, minLat]
          ]
        ],
        type: 'Polygon' as const
      },
      type: 'Feature' as const
    }
  ],
  type: 'FeatureCollection' as const
});

const mockGeoapifyFetch = ({
  destinationFound = true,
  originFound = true,
  suggestionStatus = 200,
  suggestions = [
    {
      address_line1: 'Mannerheimintie 1',
      formatted: 'Helsinki, Finland',
      lat: 60.1699,
      lon: 24.9384,
      name: 'Lasipalatsi'
    },
    { address_line1: 'Helsingbyvagen 2', formatted: 'Helsingby, Finland', lat: 60.22, lon: 24.7 },
    { formatted: 'Helsinge, Finland', lat: 60.3, lon: 25.01 },
    { formatted: 'Ignored fourth', lat: 61, lon: 26 }
  ],
  routeStatus = 200
} = {}) => {
  return vi.fn().mockImplementation((input: string | URL) => {
    const url = new URL(String(input));

    if (url.pathname === '/v1/geocode/autocomplete') {
      return Promise.resolve(
        new Response(
          suggestionStatus === 200 ? JSON.stringify({ results: suggestions }) : 'provider down',
          {
            headers: { 'content-type': 'application/json' },
            status: suggestionStatus
          }
        )
      );
    }

    if (url.pathname === '/v1/geocode/search') {
      const text = url.searchParams.get('text');

      if (text === 'Origin') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              results: originFound
                ? [
                    {
                      address_line1: 'Origin address',
                      formatted: 'Origin label',
                      lat: 60,
                      lon: 24,
                      name: 'Origin place'
                    }
                  ]
                : []
            }),
            {
              headers: { 'content-type': 'application/json' },
              status: 200
            }
          )
        );
      }

      if (text === 'Destination') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              results: destinationFound
                ? [
                    {
                      address_line1: 'Destination address',
                      formatted: 'Destination label',
                      lat: 60,
                      lon: 24.3
                    }
                  ]
                : []
            }),
            {
              headers: { 'content-type': 'application/json' },
              status: 200
            }
          )
        );
      }
    }

    if (url.pathname === '/v1/routing') {
      return Promise.resolve(
        new Response(
          routeStatus === 200
            ? JSON.stringify({
                features: [
                  {
                    geometry: {
                      coordinates: [
                        [
                          [24, 60],
                          [24.3, 60]
                        ]
                      ],
                      type: 'MultiLineString'
                    },
                    properties: {
                      distance: 20_000,
                      time: 1_200
                    }
                  }
                ]
              })
            : 'provider down',
          {
            headers: { 'content-type': 'application/json' },
            status: routeStatus
          }
        )
      );
    }

    return Promise.resolve(new Response('not found', { status: 404 }));
  });
};

describe('trip planner route', () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    testDatabase = await createTestDatabase();

    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 4,
      now: () => '2026-07-15T18:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark({
            'lipas-id': 1001,
            location: {
              address: 'Reitinvieri 1',
              geometries: createPolygon(24.11, 60.04, 24.16, 60.06),
              'postal-office': 'Espoo'
            },
            name: 'Reitinvieri',
            www: 'https://www.luontoon.fi/reitinvieri'
          }),
          createLipasPark({
            'lipas-id': 1002,
            location: {
              address: 'Reittipuisto 2',
              geometries: createPolygon(24.2, 59.995, 24.24, 60.005),
              'postal-office': 'Vantaa'
            },
            name: 'Reittipuisto',
            type: {
              'type-code': parkTypeFixtures.otherNatureReserve.typeCode
            },
            www: 'https://www.luontoon.fi/reittipuisto'
          }),
          createLipasTrail({
            'lipas-id': 1004,
            location: {
              address: 'Reittipolku 4',
              geometries: {
                features: [
                  {
                    geometry: {
                      coordinates: [
                        [24.04, 60],
                        [24.09, 60]
                      ],
                      type: 'LineString'
                    },
                    type: 'Feature'
                  }
                ],
                type: 'FeatureCollection'
              },
              'postal-office': 'Espoo'
            },
            name: 'Reittipolku',
            www: 'https://www.luontoon.fi/reittipolku'
          }),
          createLipasPark({
            'lipas-id': 1003,
            location: {
              address: 'Kaukopuisto 3',
              geometries: createPolygon(24.1, 60.33, 24.18, 60.37),
              'postal-office': 'Lahti'
            },
            name: 'Kaukopuisto',
            type: {
              'type-code': parkTypeFixtures.outdoorRecreationArea.typeCode
            },
            www: 'https://www.luontoon.fi/kaukopuisto'
          })
        ]
      })
    });

    await createVisit(testDatabase.database, 'reittipuisto', {
      visitedOn: '2026-07-10'
    });
  });

  afterEach(async () => {
    await testDatabase.dispose();
    vi.restoreAllMocks();
  });

  const createTripPlannerApp = (fetchFn: typeof fetch) => {
    return createApp({
      apiKey: 'test-api-key',
      database: testDatabase.database,
      tripPlanner: createTripPlannerService({
        database: testDatabase.database,
        provider: createGeoapifyClient({
          apiKey: 'geoapify-test',
          fetchFn
        })
      })
    });
  };

  const requestAsRemote = (
    app: ReturnType<typeof createApp>,
    body: Record<string, unknown>,
    headers: Record<string, string> = {}
  ) => {
    return app.request('/api/trip-planner/search', {
      body: JSON.stringify(body),
      headers: {
        authorization: 'Bearer test-api-key',
        'content-type': 'application/json',
        host: 'parks.example.com',
        'x-forwarded-for': '203.0.113.1',
        ...headers
      },
      method: 'POST'
    });
  };

  const requestSuggestionsAsRemote = (
    app: ReturnType<typeof createApp>,
    body: Record<string, unknown>,
    headers: Record<string, string> = {}
  ) => {
    return app.request('/api/trip-planner/suggestions', {
      body: JSON.stringify(body),
      headers: {
        authorization: 'Bearer test-api-key',
        'content-type': 'application/json',
        host: 'parks.example.com',
        'x-forwarded-for': '203.0.113.1',
        ...headers
      },
      method: 'POST'
    });
  };

  const requestNearbyAsRemote = (
    app: ReturnType<typeof createApp>,
    body: Record<string, unknown>,
    headers: Record<string, string> = {}
  ) => {
    return app.request('/api/trip-planner/nearby', {
      body: JSON.stringify(body),
      headers: {
        authorization: 'Bearer test-api-key',
        'content-type': 'application/json',
        host: 'parks.example.com',
        'x-forwarded-for': '203.0.113.1',
        ...headers
      },
      method: 'POST'
    });
  };

  it('returns the top three trip planner suggestions', async () => {
    const app = createTripPlannerApp(mockGeoapifyFetch() as typeof fetch);
    const response = await requestSuggestionsAsRemote(app, {
      query: 'He'
    });
    const body = (await response.json()) as {
      suggestions: Array<{
        coordinate: { lat: number; lon: number };
        label: string;
      }>;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(body).toEqual({
      suggestions: [
        {
          coordinate: { lat: 60.1699, lon: 24.9384 },
          displayName: 'Lasipalatsi',
          label: 'Helsinki, Finland'
        },
        {
          coordinate: { lat: 60.22, lon: 24.7 },
          displayName: 'Helsingbyvagen 2',
          label: 'Helsingby, Finland'
        },
        {
          coordinate: { lat: 60.3, lon: 25.01 },
          displayName: 'Helsinge, Finland',
          label: 'Helsinge, Finland'
        }
      ]
    });
  });

  it('returns unvisited areas first, then unvisited trails, then visited results', async () => {
    const app = createTripPlannerApp(mockGeoapifyFetch() as typeof fetch);
    const response = await requestAsRemote(app, {
      destinationQuery: 'Destination',
      mode: 'drive',
      originQuery: 'Origin'
    });
    const body = (await response.json()) as {
      defaultDistanceKm: number;
      destination: { displayName: string; label: string };
      maxDistanceKm: number;
      origin: { displayName: string; label: string };
      parks: Array<{
        boundingBox: {
          maxLat: number;
          maxLon: number;
          minLat: number;
          minLon: number;
        };
        distanceFromRouteKm: number;
        slug: string;
        visitedSummary: { visitCount: number; visited: boolean };
      }>;
      route: {
        boundingBox: {
          maxLat: number;
          maxLon: number;
          minLat: number;
          minLon: number;
        };
        distanceMeters: number;
        durationSeconds: number;
        geometry: {
          coordinates: Array<[number, number]>;
          type: string;
        };
        mode: string;
      };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(body.maxDistanceKm).toBe(25);
    expect(body.defaultDistanceKm).toBe(20);
    expect(body.origin.displayName).toBe('Origin place');
    expect(body.origin.label).toBe('Origin label');
    expect(body.destination.displayName).toBe('Destination address');
    expect(body.destination.label).toBe('Destination label');
    expect(body.route).toEqual({
      boundingBox: {
        maxLat: 60,
        maxLon: 24.3,
        minLat: 60,
        minLon: 24
      },
      distanceMeters: 20_000,
      durationSeconds: 1_200,
      geometry: {
        coordinates: [
          [24, 60],
          [24.3, 60]
        ],
        type: 'LineString'
      },
      mode: 'drive'
    });
    expect(body.parks.map((park) => park.slug)).toEqual([
      'reitinvieri',
      'reittipolku',
      'reittipuisto'
    ]);
    expect(body.parks[0]?.visitedSummary).toEqual({
      lastVisitedOn: null,
      visitCount: 0,
      visited: false
    });
    expect(body.parks[1]?.visitedSummary).toEqual({
      lastVisitedOn: null,
      visitCount: 0,
      visited: false
    });
    expect(body.parks[2]?.visitedSummary).toEqual({
      lastVisitedOn: '2026-07-10',
      visitCount: 1,
      visited: true
    });
    expect(body.parks[0]?.distanceFromRouteKm).toBeGreaterThan(4);
    expect(body.parks[1]?.distanceFromRouteKm).toBe(0);
    expect(body.parks[2]?.distanceFromRouteKm).toBe(0);
    expect(body.parks[0]?.boundingBox).toEqual({
      maxLat: 60.06,
      maxLon: 24.16,
      minLat: 60.04,
      minLon: 24.11
    });
  });

  it('returns nearby parks around the origin with a map-ready search area', async () => {
    const app = createTripPlannerApp(mockGeoapifyFetch() as typeof fetch);
    const response = await requestNearbyAsRemote(app, {
      originQuery: 'Origin'
    });
    const body = (await response.json()) as {
      defaultDistanceKm: number;
      maxDistanceKm: number;
      origin: { displayName: string; label: string };
      parks: Array<{
        distanceFromOriginKm: number;
        slug: string;
        visitedSummary: { visitCount: number; visited: boolean };
      }>;
      searchArea: {
        boundingBox: {
          maxLat: number;
          maxLon: number;
          minLat: number;
          minLon: number;
        };
        center: { lat: number; lon: number };
        maxDistanceKm: number;
      };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(body.maxDistanceKm).toBe(25);
    expect(body.defaultDistanceKm).toBe(10);
    expect(body.origin.displayName).toBe('Origin place');
    expect(body.origin.label).toBe('Origin label');
    expect(body.searchArea.center).toEqual({ lat: 60, lon: 24 });
    expect(body.searchArea.maxDistanceKm).toBe(25);
    expect(body.searchArea.boundingBox.minLat).toBeLessThan(59.8);
    expect(body.searchArea.boundingBox.maxLat).toBeGreaterThan(60.2);
    expect(body.parks.map((park) => park.slug)).toEqual([
      'reitinvieri',
      'reittipolku',
      'reittipuisto'
    ]);
    expect(body.parks[0]?.visitedSummary).toEqual({
      lastVisitedOn: null,
      visitCount: 0,
      visited: false
    });
    expect(body.parks[1]?.distanceFromOriginKm ?? 0).toBeLessThan(
      body.parks[2]?.distanceFromOriginKm ?? 0
    );
  });

  it('publishes trip planner map fields in openapi.json', async () => {
    const app = createTripPlannerApp(mockGeoapifyFetch() as typeof fetch);
    const response = await app.request('/openapi.json');
    const body = (await response.json()) as {
      paths?: {
        '/api/trip-planner/suggestions'?: {
          post?: {
            responses?: {
              '200'?: {
                content?: {
                  'application/json'?: {
                    schema?: {
                      properties?: Record<string, unknown>;
                    };
                  };
                };
              };
            };
          };
        };
        '/api/trip-planner/search'?: {
          post?: {
            responses?: {
              '200'?: {
                content?: {
                  'application/json'?: {
                    schema?: {
                      properties?: {
                        parks?: {
                          items?: {
                            properties?: Record<string, unknown>;
                          };
                        };
                        route?: {
                          properties?: Record<string, unknown>;
                        };
                      };
                    };
                  };
                };
              };
            };
          };
        };
        '/api/trip-planner/nearby'?: {
          post?: {
            responses?: {
              '200'?: {
                content?: {
                  'application/json'?: {
                    schema?: {
                      properties?: {
                        parks?: {
                          items?: {
                            properties?: Record<string, unknown>;
                          };
                        };
                        searchArea?: {
                          properties?: Record<string, unknown>;
                        };
                      };
                    };
                  };
                };
              };
            };
          };
        };
      };
    };

    expect(response.status).toBe(200);
    expect(
      body.paths?.['/api/trip-planner/suggestions']?.post?.responses?.['200']?.content?.[
        'application/json'
      ]?.schema?.properties
    ).toMatchObject({
      suggestions: expect.any(Object)
    });
    expect(
      body.paths?.['/api/trip-planner/search']?.post?.responses?.['200']?.content?.[
        'application/json'
      ]?.schema?.properties
    ).toMatchObject({
      defaultDistanceKm: expect.any(Object),
      maxDistanceKm: expect.any(Object),
      route: expect.any(Object)
    });
    expect(
      body.paths?.['/api/trip-planner/search']?.post?.responses?.['200']?.content?.[
        'application/json'
      ]?.schema?.properties?.route?.properties
    ).toMatchObject({
      boundingBox: expect.any(Object),
      geometry: expect.any(Object)
    });
    expect(
      body.paths?.['/api/trip-planner/search']?.post?.responses?.['200']?.content?.[
        'application/json'
      ]?.schema?.properties?.parks?.items?.properties
    ).toMatchObject({
      boundingBox: expect.any(Object)
    });
    expect(
      body.paths?.['/api/trip-planner/nearby']?.post?.responses?.['200']?.content?.[
        'application/json'
      ]?.schema?.properties
    ).toMatchObject({
      defaultDistanceKm: expect.any(Object),
      maxDistanceKm: expect.any(Object),
      searchArea: expect.any(Object)
    });
    expect(
      body.paths?.['/api/trip-planner/nearby']?.post?.responses?.['200']?.content?.[
        'application/json'
      ]?.schema?.properties?.searchArea?.properties
    ).toMatchObject({
      boundingBox: expect.any(Object),
      center: expect.any(Object),
      maxDistanceKm: expect.any(Object)
    });
    expect(
      body.paths?.['/api/trip-planner/nearby']?.post?.responses?.['200']?.content?.[
        'application/json'
      ]?.schema?.properties?.parks?.items?.properties
    ).toMatchObject({
      boundingBox: expect.any(Object),
      distanceFromOriginKm: expect.any(Object)
    });
  });

  it('returns 422 when the origin cannot be geocoded', async () => {
    const app = createTripPlannerApp(mockGeoapifyFetch({ originFound: false }) as typeof fetch);
    const response = await requestAsRemote(app, {
      destinationQuery: 'Destination',
      mode: 'drive',
      originQuery: 'Origin'
    });
    const body = (await response.json()) as {
      error: string;
      errorCode: string;
    };

    expect(response.status).toBe(422);
    expect(body).toEqual({
      error: 'Origin was not found.',
      errorCode: 'origin_not_found'
    });
  });

  it('returns 503 when Geoapify routing is unavailable', async () => {
    const app = createTripPlannerApp(mockGeoapifyFetch({ routeStatus: 503 }) as typeof fetch);
    const response = await requestAsRemote(app, {
      destinationQuery: 'Destination',
      mode: 'drive',
      originQuery: 'Origin'
    });
    const body = (await response.json()) as {
      error: string;
      errorCode: string;
    };

    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: 'Trip planner provider is unavailable.',
      errorCode: 'provider_unavailable'
    });
  });

  it('returns 422 when the nearby origin cannot be geocoded', async () => {
    const app = createTripPlannerApp(mockGeoapifyFetch({ originFound: false }) as typeof fetch);
    const response = await requestNearbyAsRemote(app, {
      originQuery: 'Origin'
    });
    const body = (await response.json()) as {
      error: string;
      errorCode: string;
    };

    expect(response.status).toBe(422);
    expect(body).toEqual({
      error: 'Origin was not found.',
      errorCode: 'origin_not_found'
    });
  });

  it('returns 503 when Geoapify autocomplete is unavailable', async () => {
    const app = createTripPlannerApp(
      mockGeoapifyFetch({
        suggestionStatus: 503
      }) as typeof fetch
    );
    const response = await requestSuggestionsAsRemote(app, {
      query: 'He'
    });
    const body = (await response.json()) as {
      error: string;
      errorCode: string;
    };

    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: 'Trip planner provider is unavailable.',
      errorCode: 'provider_unavailable'
    });
  });

  it('requires bearer auth for remote requests', async () => {
    const app = createTripPlannerApp(mockGeoapifyFetch() as typeof fetch);
    const response = await app.request('/api/trip-planner/search', {
      body: JSON.stringify({
        destinationQuery: 'Destination',
        mode: 'drive',
        originQuery: 'Origin'
      }),
      headers: {
        'content-type': 'application/json',
        host: 'parks.example.com',
        'x-forwarded-for': '203.0.113.1'
      },
      method: 'POST'
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('requires bearer auth for remote suggestion requests', async () => {
    const app = createTripPlannerApp(mockGeoapifyFetch() as typeof fetch);
    const response = await app.request('/api/trip-planner/suggestions', {
      body: JSON.stringify({
        query: 'He'
      }),
      headers: {
        'content-type': 'application/json',
        host: 'parks.example.com',
        'x-forwarded-for': '203.0.113.1'
      },
      method: 'POST'
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 503 when trip planner is not configured', async () => {
    const app = createApp({
      apiKey: 'test-api-key',
      database: testDatabase.database
    });
    const response = await requestAsRemote(app, {
      destinationQuery: 'Destination',
      mode: 'drive',
      originQuery: 'Origin'
    });
    const body = (await response.json()) as {
      error: string;
      errorCode: string;
    };

    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: 'Trip planner is not configured.',
      errorCode: 'trip_planner_not_configured'
    });
  });

  it('returns 503 for nearby when trip planner is not configured', async () => {
    const app = createApp({
      apiKey: 'test-api-key',
      database: testDatabase.database
    });
    const response = await requestNearbyAsRemote(app, {
      originQuery: 'Origin'
    });
    const body = (await response.json()) as {
      error: string;
      errorCode: string;
    };

    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: 'Trip planner is not configured.',
      errorCode: 'trip_planner_not_configured'
    });
  });

  it('returns 503 for suggestions when trip planner is not configured', async () => {
    const app = createApp({
      apiKey: 'test-api-key',
      database: testDatabase.database
    });
    const response = await requestSuggestionsAsRemote(app, {
      query: 'He'
    });
    const body = (await response.json()) as {
      error: string;
      errorCode: string;
    };

    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: 'Trip planner is not configured.',
      errorCode: 'trip_planner_not_configured'
    });
  });

  it('returns 500 when the trip planner throws an unexpected error', async () => {
    const app = createApp({
      apiKey: 'test-api-key',
      database: testDatabase.database,
      tripPlanner: {
        searchNearby: async () => {
          throw new Error('unexpected');
        },
        search: async () => {
          throw new Error('unexpected');
        },
        suggest: async () => {
          throw new Error('unexpected');
        }
      }
    });
    const response = await requestAsRemote(app, {
      destinationQuery: 'Destination',
      mode: 'drive',
      originQuery: 'Origin'
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: 'Internal server error.'
    });
  });

  it('returns 500 when suggestions throw an unexpected error', async () => {
    const app = createApp({
      apiKey: 'test-api-key',
      database: testDatabase.database,
      tripPlanner: {
        searchNearby: async () => ({
          defaultDistanceKm: 25,
          maxDistanceKm: 25,
          origin: {
            coordinate: { lat: 60, lon: 24 },
            displayName: 'Origin',
            label: 'Origin'
          },
          parks: [],
          searchArea: {
            boundingBox: {
              maxLat: 60.2,
              maxLon: 24.2,
              minLat: 59.8,
              minLon: 23.8
            },
            center: {
              lat: 60,
              lon: 24
            },
            maxDistanceKm: 25
          }
        }),
        search: async () => ({
          defaultDistanceKm: 25,
          destination: {
            coordinate: { lat: 60, lon: 24.3 },
            displayName: 'Destination',
            label: 'Destination'
          },
          maxDistanceKm: 25,
          origin: {
            coordinate: { lat: 60, lon: 24 },
            displayName: 'Origin',
            label: 'Origin'
          },
          parks: [],
          route: {
            boundingBox: {
              maxLat: 60,
              maxLon: 24.3,
              minLat: 60,
              minLon: 24
            },
            distanceMeters: 20_000,
            durationSeconds: 1_200,
            geometry: {
              coordinates: [
                [24, 60],
                [24.3, 60]
              ],
              type: 'LineString'
            },
            mode: 'drive'
          }
        }),
        suggest: async () => {
          throw new Error('unexpected');
        }
      }
    });
    const response = await requestSuggestionsAsRemote(app, {
      query: 'He'
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: 'Internal server error.'
    });
  });

  it('returns 500 when nearby search throws an unexpected error', async () => {
    const app = createApp({
      apiKey: 'test-api-key',
      database: testDatabase.database,
      tripPlanner: {
        searchNearby: async () => {
          throw new Error('unexpected');
        },
        search: async () => ({
          defaultDistanceKm: 25,
          destination: {
            coordinate: { lat: 60, lon: 24.3 },
            displayName: 'Destination',
            label: 'Destination'
          },
          maxDistanceKm: 25,
          origin: {
            coordinate: { lat: 60, lon: 24 },
            displayName: 'Origin',
            label: 'Origin'
          },
          parks: [],
          route: {
            boundingBox: {
              maxLat: 60,
              maxLon: 24.3,
              minLat: 60,
              minLon: 24
            },
            distanceMeters: 20_000,
            durationSeconds: 1_200,
            geometry: {
              coordinates: [
                [24, 60],
                [24.3, 60]
              ],
              type: 'LineString'
            },
            mode: 'drive'
          }
        }),
        suggest: async () => []
      }
    });
    const response = await requestNearbyAsRemote(app, {
      originQuery: 'Origin'
    });
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: 'Internal server error.'
    });
  });
});
