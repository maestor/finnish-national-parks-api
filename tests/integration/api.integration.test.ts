import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authConfig = {
  cookieName: '__session',
  frontendUrl: 'http://localhost:4300',
  googleClientId: 'test-google-client-id',
  googleClientSecret: 'test-google-client-secret',
  jwtSecret: 'test-jwt-secret-at-least-32-characters-long'
};

import { createApp } from '../../src/app.js';
import * as repositories from '../../src/db/repositories.js';
import { createVisitImage, getParkBySlug } from '../../src/db/repositories.js';
import { parks } from '../../src/db/schema.js';
import { createSessionToken } from '../../src/http/session.js';
import { importParks } from '../../src/importer/import-parks.js';
import { importSpecialParks } from '../../src/importer/import-special-parks.js';
import { createMemoryStorage } from '../../src/storage/memory-storage.js';
import { TripPlannerError } from '../../src/trip-planner/search.js';
import type {
  TripPlannerRoundTripRoute,
  TripPlannerService
} from '../../src/trip-planner/types.js';
import { createLipasPark, createLipasTrail, parkTypeFixtures } from '../fixtures/lipas.js';
import { createTestDatabase } from '../helpers/test-db.js';

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

describe('API routes', () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;
  let adminSessionCookie: string;

  beforeEach(async () => {
    testDatabase = await createTestDatabase();
    adminSessionCookie = await createAdminSessionCookie();

    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 4,
      now: () => '2026-05-01T09:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark(),
          createLipasPark({
            'lipas-id': 67889,
            name: 'Kaupunkilaakson ulkoilualue',
            type: {
              'type-code': parkTypeFixtures.outdoorRecreationArea.typeCode
            },
            location: {
              address: 'Laaksopolku 1',
              'postal-office': 'Espoo'
            },
            properties: {
              'area-km2': 22.4
            },
            www: 'https://www.luontoon.fi/kaupunkilaakso'
          }),
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

    return app.request(input, {
      ...init,
      headers
    });
  };

  const createVisit = async (
    app: ReturnType<typeof createApp>,
    slug: string,
    body: {
      author?: string;
      excludeFromRoute?: boolean;
      note?: string;
      route?: string;
      tripId?: number | null;
      tripStopOrder?: number;
      visitedOn: string;
    }
  ) => {
    const response = await requestAsAdmin(app, `/api/parks/${slug}/visits`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json'
      }
    });

    return {
      body: (await response.json()) as { excludeFromRoute: boolean; id: number },
      response
    };
  };

  const createTrip = async (
    app: ReturnType<typeof createApp>,
    body: {
      description?: string | null;
      name: string;
      slug?: string;
      startingPoint?: {
        coordinate: {
          lat: number;
          lon: number;
        };
        label: string;
      } | null;
    }
  ) => {
    const response = await requestAsAdmin(app, '/api/trips', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json'
      }
    });

    return {
      body: (await response.json()) as {
        dateRange: { end: string; start: string } | null;
        description: string | null;
        id: number;
        name: string;
        slug: string;
        startingPoint: {
          coordinate: {
            lat: number;
            lon: number;
          };
          displayName: string;
          label: string;
        } | null;
        visitCount: number;
      },
      response
    };
  };

  const createTripStop = async (
    app: ReturnType<typeof createApp>,
    tripId: number,
    body: {
      location: {
        coordinate: {
          lat: number;
          lon: number;
        };
        label: string;
      };
      note?: string | null;
      tripStopOrder?: number;
      visitedOn: string;
    }
  ) => {
    const response = await requestAsAdmin(app, `/api/trips/${tripId}/stops`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json'
      }
    });

    return {
      body: (await response.json()) as {
        id: number;
        location: {
          coordinate: {
            lat: number;
            lon: number;
          };
          label: string;
        };
        note: string | null;
        tripStopOrder: number;
        visitedOn: string;
      },
      response
    };
  };

  it('serves the public park list without boundary geometry and with cache validators', async () => {
    const app = createAuthedApp();
    const response = await app.request('/api/parks');
    const body = (await response.json()) as {
      parks: Array<Record<string, unknown>>;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('public');
    expect(response.headers.get('etag')).toBeTruthy();
    expect(body.parks).toHaveLength(4);
    expect(body.parks[0]).not.toHaveProperty('boundaryGeoJson');
    expect(body.parks[0]).not.toHaveProperty('location');
    expect(body.parks[0]).toHaveProperty('category');
    expect(body.parks[0]).toHaveProperty('type');
    expect(body.parks[0]).toHaveProperty('address');
    expect(body.parks[0]).toHaveProperty('locationLabel');
    expect(body.parks[0]).toHaveProperty('postalCode');
    expect(body.parks[0]).toHaveProperty('postalOffice');
  });

  it('serves lightweight park search results with cache validators', async () => {
    const app = createAuthedApp();
    const firstResponse = await app.request('/api/parks/search');
    const firstBody = (await firstResponse.json()) as {
      parks: Array<Record<string, unknown>>;
    };
    const etag = firstResponse.headers.get('etag');

    expect(firstResponse.status).toBe(200);
    expect(firstResponse.headers.get('cache-control')).toContain('public');
    expect(etag).toBeTruthy();
    expect(firstBody.parks).toHaveLength(4);
    expect(firstBody.parks[0]).toHaveProperty('slug');
    expect(firstBody.parks[0]).toHaveProperty('name');
    expect(firstBody.parks[0]).toHaveProperty('address');
    expect(firstBody.parks[0]).toHaveProperty('locationLabel');
    expect(firstBody.parks[0]).toHaveProperty('postalCode');
    expect(firstBody.parks[0]).toHaveProperty('postalOffice');
    expect(firstBody.parks[0]).toHaveProperty('type');
    expect(firstBody.parks[0]).not.toHaveProperty('areaKm2');
    expect(firstBody.parks[0]).not.toHaveProperty('boundingBox');
    expect(firstBody.parks[0]).not.toHaveProperty('category');
    expect(firstBody.parks[0]).not.toHaveProperty('logo');
    expect(firstBody.parks[0]).not.toHaveProperty('parkUrl');
    expect(firstBody.parks[0]).not.toHaveProperty('map');
    expect(firstBody.parks[0]).not.toHaveProperty('markerPoint');

    const secondResponse = await app.request('/api/parks/search', {
      headers: {
        'if-none-match': etag!
      }
    });

    expect(secondResponse.status).toBe(304);
  });

  it('filters lightweight park search results by type and category', async () => {
    const app = createAuthedApp();

    const typeResponse = await app.request('/api/parks/search?type=outdoor-recreation-area');
    const typeBody = (await typeResponse.json()) as {
      parks: Array<{ slug: string }>;
    };
    const categoryResponse = await app.request(
      '/api/parks/search?category=hiking-and-wilderness-areas'
    );
    const categoryBody = (await categoryResponse.json()) as {
      parks: Array<{ slug: string }>;
    };

    expect(typeResponse.status).toBe(200);
    expect(typeBody.parks.map((park) => park.slug)).toEqual(['kaupunkilaakson-ulkoilualue']);
    expect(categoryResponse.status).toBe(200);
    expect(categoryBody.parks.map((park) => park.slug)).toEqual(['evon-retkeilyalue']);
  });

  it('exposes logo details in park list and park detail responses when a logo is set', async () => {
    await testDatabase.database
      .update(parks)
      .set({
        logoKey: 'logos/akasmannyn-kansallispuisto.png',
        logoUpdatedAt: '2026-05-02T08:00:00.000Z',
        updatedAt: '2026-05-02T08:00:00.000Z'
      })
      .where(eq(parks.slug, 'akasmannyn-kansallispuisto'));

    const app = createApp({
      database: testDatabase.database,
      storage: createMemoryStorage()
    });
    const listResponse = await app.request('/api/parks');
    const detailResponse = await app.request('/api/parks/akasmannyn-kansallispuisto');
    const listBody = (await listResponse.json()) as {
      parks: Array<Record<string, unknown>>;
    };
    const detailBody = (await detailResponse.json()) as Record<string, unknown>;
    const park = listBody.parks.find((entry) => entry.slug === 'akasmannyn-kansallispuisto');

    expect(listResponse.status).toBe(200);
    expect(detailResponse.status).toBe(200);
    expect(park).toMatchObject({
      logo: {
        key: 'logos/akasmannyn-kansallispuisto.png',
        updatedAt: '2026-05-02T08:00:00.000Z',
        url: 'https://memory-storage.test/logos/akasmannyn-kansallispuisto.png'
      }
    });
    expect(detailBody).toMatchObject({
      logo: {
        key: 'logos/akasmannyn-kansallispuisto.png',
        updatedAt: '2026-05-02T08:00:00.000Z',
        url: 'https://memory-storage.test/logos/akasmannyn-kansallispuisto.png'
      }
    });
  });

  it('exposes map details in park list and park detail responses when a map is set', async () => {
    await testDatabase.database
      .update(parks)
      .set({
        mapKey: 'pdf-maps/akasmannyn-kansallispuisto.pdf',
        mapUpdatedAt: '2026-05-02T08:00:00.000Z',
        updatedAt: '2026-05-02T08:00:00.000Z'
      })
      .where(eq(parks.slug, 'akasmannyn-kansallispuisto'));

    const app = createApp({
      database: testDatabase.database,
      storage: createMemoryStorage()
    });
    const listResponse = await app.request('/api/parks');
    const detailResponse = await app.request('/api/parks/akasmannyn-kansallispuisto');
    const listBody = (await listResponse.json()) as {
      parks: Array<Record<string, unknown>>;
    };
    const detailBody = (await detailResponse.json()) as Record<string, unknown>;
    const park = listBody.parks.find((entry) => entry.slug === 'akasmannyn-kansallispuisto');

    expect(listResponse.status).toBe(200);
    expect(detailResponse.status).toBe(200);
    expect(park).toMatchObject({
      map: {
        key: 'pdf-maps/akasmannyn-kansallispuisto.pdf',
        updatedAt: '2026-05-02T08:00:00.000Z',
        url: 'https://memory-storage.test/pdf-maps/akasmannyn-kansallispuisto.pdf'
      }
    });
    expect(detailBody).toMatchObject({
      map: {
        key: 'pdf-maps/akasmannyn-kansallispuisto.pdf',
        updatedAt: '2026-05-02T08:00:00.000Z',
        url: 'https://memory-storage.test/pdf-maps/akasmannyn-kansallispuisto.pdf'
      }
    });
  });

  it('includes an optional display type name for manual catalog parks', async () => {
    const { createSpecialParksSource } = await import('../fixtures/special-parks.js');
    await importSpecialParks({
      database: testDatabase.database,
      fetchSource: createSpecialParksSource(),
      now: () => '2026-05-01T10:00:00.000Z'
    });

    const app = createAuthedApp();
    const listResponse = await app.request('/api/parks?type=nature-reserve-area');
    const detailResponse = await app.request('/api/parks/merenkurkun-maailmanperintoalue');
    const listBody = (await listResponse.json()) as {
      parks: Array<Record<string, unknown>>;
    };
    const detailBody = (await detailResponse.json()) as Record<string, unknown>;
    const merenkurkku = listBody.parks.find(
      (park) => park.slug === 'merenkurkun-maailmanperintoalue'
    );

    expect(listResponse.status).toBe(200);
    expect(detailResponse.status).toBe(200);
    expect(merenkurkku).toMatchObject({
      address: 'Raippaluodontie 2, 65800 Raippaluoto',
      displayTypeName: 'Maailmanperintökohde',
      locationLabel: 'Raippaluodontie 2',
      postalCode: '65800',
      postalOffice: 'Raippaluoto',
      slug: 'merenkurkun-maailmanperintoalue',
      type: {
        slug: 'nature-reserve-area'
      }
    });
    expect(detailBody).toMatchObject({
      displayTypeName: 'Maailmanperintökohde',
      slug: 'merenkurkun-maailmanperintoalue'
    });
  });

  it('filters manual cultural history areas by the normalized type slug', async () => {
    const { createSpecialParksSource } = await import('../fixtures/special-parks.js');
    await importSpecialParks({
      database: testDatabase.database,
      fetchSource: createSpecialParksSource(),
      now: () => '2026-05-01T10:00:00.000Z'
    });

    const app = createAuthedApp();
    const response = await app.request('/api/parks?type=cultural-history-area');
    const body = (await response.json()) as {
      parks: Array<Record<string, unknown>>;
    };

    expect(response.status).toBe(200);
    expect(body.parks.some((park) => park.slug === 'fiskarsin-ruukki')).toBe(true);
    expect(body.parks.some((park) => park.slug === 'verla')).toBe(true);
    expect(body.parks.some((park) => park.slug === 'kajaanin-linna')).toBe(true);
    expect(
      body.parks.every(
        (park) => park.type && (park.type as { slug: string }).slug === 'cultural-history-area'
      )
    ).toBe(true);
  }, 15_000);

  it('filters the public park list by the derived category slug', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 1,
      now: () => '2026-05-02T10:00:00.000Z',
      sourceUrl: 'https://example.test/lipas-trails',
      fetchSource: async () => ({
        items: [
          createLipasTrail({
            location: {
              geometries: {
                type: 'FeatureCollection',
                features: [
                  {
                    type: 'Feature',
                    geometry: {
                      type: 'LineString',
                      coordinates: [
                        [35.2, 66.2],
                        [35.4, 66.4],
                        [35.6, 66.6]
                      ]
                    }
                  }
                ]
              }
            }
          })
        ]
      })
    });

    const app = createAuthedApp();
    const response = await app.request('/api/parks?category=trails-and-routes');
    const body = (await response.json()) as {
      parks: Array<{
        category: { slug: string };
        type: { slug: string };
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.parks).toHaveLength(1);
    expect(body.parks[0]).toMatchObject({
      category: { slug: 'trails-and-routes' },
      type: { slug: 'nature-trail' }
    });
    expect(response.headers.get('etag')).toContain('category:trails-and-routes');
  });

  it('filters hiking and wilderness parks through the combined derived category slug', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 2,
      now: () => '2026-05-02T10:30:00.000Z',
      sourceUrl: 'https://example.test/lipas-combined-areas',
      fetchSource: async () => ({
        items: [
          createLipasPark({
            'lipas-id': 80001,
            name: 'Pisavaaran retkeilyalue',
            type: {
              'type-code': parkTypeFixtures.stateHikingArea.typeCode
            },
            www: 'https://www.luontoon.fi/pisavaara'
          }),
          createLipasPark({
            'lipas-id': 80002,
            name: 'Muotkatunturin erämaa-alue',
            type: {
              'type-code': parkTypeFixtures.wildernessArea.typeCode
            },
            www: 'https://www.luontoon.fi/muotkatunturi'
          })
        ]
      })
    });

    const app = createAuthedApp();
    const response = await app.request('/api/parks?category=hiking-and-wilderness-areas');
    const body = (await response.json()) as {
      parks: Array<{
        category: { slug: string };
        slug: string;
        type: { slug: string };
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.parks).toHaveLength(2);
    expect(body.parks.every((park) => park.category.slug === 'hiking-and-wilderness-areas')).toBe(
      true
    );
    expect(body.parks.map((park) => park.type.slug).sort()).toEqual([
      'hiking-area',
      'wilderness-area'
    ]);
    expect(body.parks.map((park) => park.slug).sort()).toEqual([
      'muotkatunturin-eramaa-alue',
      'pisavaaran-retkeilyalue'
    ]);
    expect(response.headers.get('etag')).toContain('category:hiking-and-wilderness-areas');
  });

  it('returns 304 when the public list ETag matches', async () => {
    const app = createAuthedApp();
    const firstResponse = await app.request('/api/parks');
    const etag = firstResponse.headers.get('etag');

    expect(etag).toBeTruthy();

    const secondResponse = await app.request('/api/parks', {
      headers: {
        'if-none-match': etag ?? ''
      }
    });

    expect(secondResponse.status).toBe(304);
  });

  it('changes the public list ETag after catalog data changes', async () => {
    const app = createAuthedApp();
    const firstResponse = await app.request('/api/parks');
    const firstEtag = firstResponse.headers.get('etag');

    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 4,
      now: () => '2026-05-02T09:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark({
            properties: {
              'area-km2': 14.25
            }
          }),
          createLipasPark({
            'lipas-id': 67889,
            name: 'Kaupunkilaakson ulkoilualue',
            type: {
              'type-code': parkTypeFixtures.outdoorRecreationArea.typeCode
            },
            location: {
              address: 'Laaksopolku 1',
              'postal-office': 'Espoo'
            },
            properties: {
              'area-km2': 22.4
            },
            www: 'https://www.luontoon.fi/kaupunkilaakso'
          }),
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

    const secondResponse = await app.request('/api/parks');
    const secondEtag = secondResponse.headers.get('etag');

    expect(secondEtag).toBeTruthy();
    expect(secondEtag).not.toBe(firstEtag);
  });

  it('serves park detail with optional boundary geometry and no personal state', async () => {
    const app = createAuthedApp();
    const summaryResponse = await app.request('/api/parks/akasmannyn-kansallispuisto');
    const summaryBody = (await summaryResponse.json()) as Record<string, unknown>;
    const etag = summaryResponse.headers.get('etag');
    const response = await app.request(
      '/api/parks/akasmannyn-kansallispuisto?includeBoundary=true'
    );
    const body = (await response.json()) as Record<string, unknown>;
    const cachedResponse = await app.request('/api/parks/akasmannyn-kansallispuisto', {
      headers: {
        'if-none-match': etag ?? ''
      }
    });

    expect(summaryResponse.status).toBe(200);
    expect(summaryBody).not.toHaveProperty('boundaryGeoJson');
    expect(summaryBody).not.toHaveProperty('location');
    expect(summaryBody).toHaveProperty('address', 'Puistotie 1, 00999 Testikylä');
    expect(summaryBody).toHaveProperty('locationLabel', 'Puistotie 1');
    expect(summaryBody).toHaveProperty('postalCode', '00999');
    expect(summaryBody).toHaveProperty('postalOffice', 'Testikylä');
    expect(response.status).toBe(200);
    expect(body).toHaveProperty('boundaryGeoJson');
    expect(body).not.toHaveProperty('note');
    expect(body).not.toHaveProperty('visits');
    expect(body).toMatchObject({
      type: {
        code: parkTypeFixtures.nationalPark.typeCode,
        slug: parkTypeFixtures.nationalPark.slug
      }
    });
    expect(cachedResponse.status).toBe(304);
  });

  it('returns raw and derived location fields consistently in park detail', async () => {
    const app = createAuthedApp();
    const publicResponse = await app.request('/api/parks/akasmannyn-kansallispuisto');
    const publicBody = (await publicResponse.json()) as Record<string, unknown>;
    const adminResponse = await app.request('/api/parks/akasmannyn-kansallispuisto', {
      headers: {
        cookie: await createAdminSessionCookie()
      }
    });
    const adminBody = (await adminResponse.json()) as Record<string, unknown>;

    expect(publicResponse.status).toBe(200);
    expect(publicBody).not.toHaveProperty('location');
    expect(adminResponse.status).toBe(200);
    expect(adminResponse.headers.get('cache-control')).toContain('public');
    expect(publicBody).toMatchObject({
      address: 'Puistotie 1, 00999 Testikylä',
      locationLabel: 'Puistotie 1',
      postalCode: '00999',
      postalOffice: 'Testikylä'
    });
    expect(adminBody).toMatchObject({
      address: 'Puistotie 1, 00999 Testikylä',
      locationLabel: 'Puistotie 1',
      postalCode: '00999',
      postalOffice: 'Testikylä'
    });
  });

  it('allows admin park edits and auto-generates a slug when the name changes', async () => {
    const app = createAuthedApp();
    const sessionCookie = await createAdminSessionCookie();

    const response = await app.request('/api/parks/akasmannyn-kansallispuisto', {
      method: 'PATCH',
      body: JSON.stringify({
        areaKm2: 14.75,
        displayTypeName: 'Ystävyyden puisto',
        establishmentYear: 1990,
        locationLabel: 'Korjattu puistotie 9',
        parkUrl: '/fi/kohteet/korjattu-puisto',
        name: 'Korjattu puisto',
        postalCode: '99130',
        postalOffice: 'Kittilä'
      }),
      headers: {
        cookie: sessionCookie,
        'content-type': 'application/json'
      }
    });
    const body = (await response.json()) as Record<string, unknown>;
    const adminDetailResponse = await app.request('/api/parks/korjattu-puisto', {
      headers: {
        cookie: sessionCookie
      }
    });
    const adminDetailBody = (await adminDetailResponse.json()) as Record<string, unknown>;
    const updatedPark = await getParkBySlug(testDatabase.database, 'korjattu-puisto');
    const oldSlugResponse = await app.request('/api/parks/akasmannyn-kansallispuisto');

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(body).toMatchObject({
      address: 'Korjattu puistotie 9, 99130 Kittilä',
      areaKm2: 14.75,
      displayTypeName: 'Ystävyyden puisto',
      establishmentYear: 1990,
      locationLabel: 'Korjattu puistotie 9',
      parkUrl: 'https://www.luontoon.fi/fi/kohteet/korjattu-puisto',
      name: 'Korjattu puisto',
      postalCode: '99130',
      postalOffice: 'Kittilä',
      slug: 'korjattu-puisto'
    });
    expect(adminDetailResponse.status).toBe(200);
    expect(adminDetailResponse.headers.get('cache-control')).toContain('public');
    expect(adminDetailBody).toMatchObject({
      address: 'Korjattu puistotie 9, 99130 Kittilä',
      locationLabel: 'Korjattu puistotie 9',
      postalCode: '99130',
      postalOffice: 'Kittilä'
    });
    expect(updatedPark).toMatchObject({
      address: 'Korjattu puistotie 9, 99130 Kittilä',
      areaKm2: 14.75,
      displayTypeName: 'Ystävyyden puisto',
      establishmentYear: 1990,
      locationLabel: 'Korjattu puistotie 9',
      parkUrl: 'https://www.luontoon.fi/fi/kohteet/korjattu-puisto',
      name: 'Korjattu puisto',
      postalCode: '99130',
      postalOffice: 'Kittilä',
      slug: 'korjattu-puisto'
    });
    expect(oldSlugResponse.status).toBe(404);
  });

  it('requires an admin session for park edits and reports missing, invalid, and conflicting updates', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 5,
      now: () => '2026-05-02T09:00:00.000Z',
      sourceUrl: 'https://example.test/lipas-expanded',
      fetchSource: async () => ({
        items: [
          createLipasPark(),
          createLipasPark({
            'lipas-id': 67889,
            name: 'Kaupunkilaakson ulkoilualue',
            type: {
              'type-code': parkTypeFixtures.outdoorRecreationArea.typeCode
            },
            location: {
              address: 'Laaksopolku 1',
              'postal-office': 'Espoo'
            },
            properties: {
              'area-km2': 22.4
            },
            www: 'https://www.luontoon.fi/kaupunkilaakso'
          }),
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
          }),
          createLipasPark({
            'lipas-id': 70001,
            name: 'Vallisaari',
            www: 'https://www.luontoon.fi/vallisaari'
          })
        ]
      })
    });

    const app = createAuthedApp();
    const unauthorizedResponse = await app.request('/api/parks/akasmannyn-kansallispuisto', {
      method: 'PATCH',
      body: JSON.stringify({
        name: 'Unauthorized change'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const missingResponse = await app.request('/api/parks/missing-park', {
      method: 'PATCH',
      body: JSON.stringify({
        name: 'Missing park'
      }),
      headers: {
        cookie: await createAdminSessionCookie(),
        'content-type': 'application/json'
      }
    });
    const invalidUrlResponse = await app.request('/api/parks/akasmannyn-kansallispuisto', {
      method: 'PATCH',
      body: JSON.stringify({
        parkUrl: 'bad url'
      }),
      headers: {
        cookie: await createAdminSessionCookie(),
        'content-type': 'application/json'
      }
    });
    const conflictingSlugResponse = await app.request('/api/parks/akasmannyn-kansallispuisto', {
      method: 'PATCH',
      body: JSON.stringify({
        slug: 'vallisaari'
      }),
      headers: {
        cookie: await createAdminSessionCookie(),
        'content-type': 'application/json'
      }
    });

    expect(unauthorizedResponse.status).toBe(401);
    expect(missingResponse.status).toBe(404);
    expect(invalidUrlResponse.status).toBe(422);
    expect(conflictingSlugResponse.status).toBe(409);
  });

  it('returns 503 for admin routes when OAuth session auth is not configured', async () => {
    const app = createApp({ database: testDatabase.database });

    const createVisitResponse = await app.request('/api/parks/akasmannyn-kansallispuisto/visits', {
      method: 'POST',
      body: JSON.stringify({
        visitedOn: '2026-04-20'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const createVisitBody = (await createVisitResponse.json()) as { error: string };
    const visibilityResponse = await app.request('/api/admin/parks/visibility');
    const visibilityBody = (await visibilityResponse.json()) as { error: string };

    expect(createVisitResponse.status).toBe(503);
    expect(createVisitBody.error).toBe('OAuth not configured.');
    expect(visibilityResponse.status).toBe(503);
    expect(visibilityBody.error).toBe('OAuth not configured.');
  });

  it('serves standalone nature trails through the HTTP contract', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 5,
      now: () => '2026-05-02T09:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark(),
          createLipasPark({
            'lipas-id': 67889,
            name: 'Kaupunkilaakson ulkoilualue',
            type: {
              'type-code': parkTypeFixtures.outdoorRecreationArea.typeCode
            },
            location: {
              address: 'Laaksopolku 1',
              'postal-office': 'Espoo'
            },
            properties: {
              'area-km2': 22.4
            },
            www: 'https://www.luontoon.fi/kaupunkilaakso'
          }),
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
          }),
          createLipasTrail({
            location: {
              geometries: {
                type: 'FeatureCollection',
                features: [
                  {
                    type: 'Feature',
                    geometry: {
                      type: 'LineString',
                      coordinates: [
                        [35.2, 66.2],
                        [35.4, 66.4],
                        [35.6, 66.6]
                      ]
                    }
                  }
                ]
              }
            }
          })
        ]
      })
    });

    const app = createAuthedApp();
    const listResponse = await app.request('/api/parks?type=nature-trail');
    const listBody = (await listResponse.json()) as {
      parks: Array<Record<string, unknown>>;
    };
    const detailResponse = await app.request('/api/parks/testin-luontopolku?includeBoundary=true');
    const detailBody = (await detailResponse.json()) as {
      boundaryGeoJson: {
        features: Array<{
          geometry: {
            type: string;
          };
        }>;
      };
      type: {
        slug: string;
      };
    };

    expect(listResponse.status).toBe(200);
    expect(listBody.parks).toHaveLength(1);
    expect(listBody.parks[0]).toMatchObject({
      name: 'Testin luontopolku',
      type: {
        slug: 'nature-trail'
      }
    });
    expect(detailResponse.status).toBe(200);
    expect(detailBody.type.slug).toBe('nature-trail');
    expect(detailBody.boundaryGeoJson.features[0]?.geometry.type).toBe('LineString');
  });

  it('normalizes API address values when postal fields duplicate or replace the address', async () => {
    const app = createAuthedApp();

    await testDatabase.database
      .update(parks)
      .set({ postalOffice: 'Puistotie 1' })
      .where(eq(parks.slug, 'akasmannyn-kansallispuisto'));

    const duplicatedResponse = await app.request('/api/parks/akasmannyn-kansallispuisto');
    const duplicatedBody = (await duplicatedResponse.json()) as Record<string, unknown>;

    expect(duplicatedBody).toHaveProperty('address', 'Puistotie 1, 00999');

    await testDatabase.database
      .update(parks)
      .set({ locationLabel: '', postalOffice: 'Testikylä' })
      .where(eq(parks.slug, 'akasmannyn-kansallispuisto'));

    const postalOnlyResponse = await app.request('/api/parks/akasmannyn-kansallispuisto');
    const postalOnlyBody = (await postalOnlyResponse.json()) as Record<string, unknown>;

    expect(postalOnlyBody).toHaveProperty('address', '00999 Testikylä');
  });

  it('explicitly omits boundary geometry when includeBoundary=false', async () => {
    const app = createAuthedApp();
    const response = await app.request(
      '/api/parks/akasmannyn-kansallispuisto?includeBoundary=false'
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).not.toHaveProperty('boundaryGeoJson');
  });

  it('filters the public park list by type slug', async () => {
    const app = createAuthedApp();
    const response = await app.request('/api/parks?type=outdoor-recreation-area');
    const body = (await response.json()) as {
      parks: Array<{
        name: string;
        type: {
          slug: string;
        };
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.parks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Kaupunkilaakson ulkoilualue',
          type: expect.objectContaining({
            slug: parkTypeFixtures.outdoorRecreationArea.slug
          })
        })
      ])
    );
    expect(body.parks).toHaveLength(1);
    expect(response.headers.get('etag')).toContain(parkTypeFixtures.outdoorRecreationArea.slug);
  });

  it('serves lightweight frontend home summary data with shared-cache validators', async () => {
    const app = createAuthedApp();

    await createVisit(app, 'akasmannyn-kansallispuisto', {
      author: 'Hiker One',
      note: 'Keep private note out of the home summary response.',
      route: 'North trail',
      visitedOn: '2026-04-20'
    });
    await createVisit(app, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-04-22'
    });
    await createVisit(app, 'seitsemisen-kansallispuisto', {
      visitedOn: '2026-04-21'
    });

    const response = await app.request('/api/home-summary');
    const body = (await response.json()) as {
      latestVisitEntries: Array<{
        id: number;
        park: { slug: string };
        visitedOn: string;
      }>;
      mostVisitedParks: Array<{
        lastVisitedOn: string | null;
        park: { slug: string };
        visitCount: number;
      }>;
      progressByCategory: Array<{
        category: { slug: string };
        totalParks: number;
        totalVisits: number;
        visitedParks: number;
      }>;
      progressByType: Array<{
        totalParks: number;
        totalVisits: number;
        type: { slug: string };
        visible: boolean;
        visitedParks: number;
      }>;
      recentVisits: Array<{
        park: { slug: string };
        visitedSummary: {
          lastVisitedOn: string | null;
          visitCount: number;
          visited: boolean;
        };
      }>;
      seasonalVisitCounts: {
        autumn: number;
        spring: number;
        summer: number;
        winter: number;
      };
      totalVisits: number;
      uniqueVisitedParks: number;
      updatedAt: string | null;
      version: number;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=600');
    expect(response.headers.get('etag')).toBeTruthy();
    expect(body.totalVisits).toBe(3);
    expect(body.uniqueVisitedParks).toBe(2);
    expect(body.seasonalVisitCounts).toEqual({ autumn: 0, spring: 3, summer: 0, winter: 0 });
    expect(body.version).toBeGreaterThan(0);
    expect(body.updatedAt).toBeTruthy();
    expect(body.progressByType).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          totalParks: 2,
          totalVisits: 3,
          type: expect.objectContaining({
            slug: parkTypeFixtures.nationalPark.slug
          }),
          visible: true,
          visitedParks: 2
        })
      ])
    );
    expect(body.progressByCategory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: expect.objectContaining({
            slug: parkTypeFixtures.nationalPark.slug
          }),
          totalParks: 2,
          totalVisits: 3,
          visitedParks: 2
        })
      ])
    );
    expect(body.mostVisitedParks[0]).toEqual(
      expect.objectContaining({
        lastVisitedOn: '2026-04-22',
        park: expect.objectContaining({
          slug: 'akasmannyn-kansallispuisto'
        }),
        visitCount: 2
      })
    );
    expect(body.recentVisits[0]).toEqual(
      expect.objectContaining({
        park: expect.objectContaining({
          slug: 'akasmannyn-kansallispuisto'
        }),
        visitedSummary: {
          lastVisitedOn: '2026-04-22',
          visitCount: 2,
          visited: true
        }
      })
    );
    expect(body.latestVisitEntries.map((entry) => entry.park.slug)).toEqual([
      'seitsemisen-kansallispuisto',
      'akasmannyn-kansallispuisto',
      'akasmannyn-kansallispuisto'
    ]);
    expect(body.latestVisitEntries[0]).not.toHaveProperty('note');
    expect(body.latestVisitEntries[0]).not.toHaveProperty('route');
    expect(body.latestVisitEntries[0]).not.toHaveProperty('images');
  });

  it('orders latest visit entries by addition time instead of visit date', async () => {
    const app = createAuthedApp();

    await createVisit(app, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-04-22'
    });
    await createVisit(app, 'seitsemisen-kansallispuisto', {
      visitedOn: '2026-04-10'
    });

    const response = await app.request('/api/home-summary');
    const body = (await response.json()) as {
      latestVisitEntries: Array<{
        park: { slug: string };
        visitedOn: string;
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.latestVisitEntries.map((entry) => entry.park.slug)).toEqual([
      'seitsemisen-kansallispuisto',
      'akasmannyn-kansallispuisto'
    ]);
    expect(body.latestVisitEntries.map((entry) => entry.visitedOn)).toEqual([
      '2026-04-10',
      '2026-04-22'
    ]);
  });

  it('marks trail progress types hidden while exposing combined trail category progress', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 1,
      now: () => '2026-05-02T11:00:00.000Z',
      sourceUrl: 'https://example.test/lipas-nature-trail',
      fetchSource: async () => ({
        items: [
          createLipasTrail({
            location: {
              geometries: {
                type: 'FeatureCollection',
                features: [
                  {
                    type: 'Feature',
                    geometry: {
                      type: 'LineString',
                      coordinates: [
                        [35.2, 66.2],
                        [35.4, 66.4],
                        [35.6, 66.6]
                      ]
                    }
                  }
                ]
              }
            }
          })
        ]
      })
    });

    const app = createAuthedApp();
    await createVisit(app, 'testin-luontopolku', {
      visitedOn: '2026-05-01'
    });

    const response = await app.request('/api/home-summary');
    const body = (await response.json()) as {
      progressByCategory: Array<{
        category: { slug: string };
        totalParks: number;
        totalVisits: number;
        visitedParks: number;
      }>;
      progressByType: Array<{
        type: { slug: string };
        totalParks: number;
        totalVisits: number;
        visible: boolean;
        visitedParks: number;
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.progressByType[0]).toMatchObject({
      type: { slug: 'nature-trail' },
      totalParks: 1,
      totalVisits: 1,
      visible: false,
      visitedParks: 1
    });
    expect(body.progressByCategory[0]).toMatchObject({
      category: { slug: 'trails-and-routes' },
      totalParks: 1,
      totalVisits: 1,
      visitedParks: 1
    });
  });

  it('aggregates hiking and wilderness parks under one frontend category while keeping separate types', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 2,
      now: () => '2026-05-02T11:30:00.000Z',
      sourceUrl: 'https://example.test/lipas-combined-areas-summary',
      fetchSource: async () => ({
        items: [
          createLipasPark({
            'lipas-id': 81001,
            name: 'Pisavaaran retkeilyalue',
            type: {
              'type-code': parkTypeFixtures.stateHikingArea.typeCode
            },
            www: 'https://www.luontoon.fi/pisavaara'
          }),
          createLipasPark({
            'lipas-id': 81002,
            name: 'Muotkatunturin erämaa-alue',
            type: {
              'type-code': parkTypeFixtures.wildernessArea.typeCode
            },
            www: 'https://www.luontoon.fi/muotkatunturi'
          })
        ]
      })
    });

    const app = createAuthedApp();
    await createVisit(app, 'pisavaaran-retkeilyalue', {
      visitedOn: '2026-05-01'
    });
    await createVisit(app, 'muotkatunturin-eramaa-alue', {
      visitedOn: '2026-05-02'
    });

    const response = await app.request('/api/home-summary');
    const body = (await response.json()) as {
      progressByCategory: Array<{
        category: { slug: string };
        totalParks: number;
        totalVisits: number;
        visitedParks: number;
      }>;
      progressByType: Array<{
        type: { slug: string };
        totalParks: number;
        totalVisits: number;
        visible: boolean;
        visitedParks: number;
      }>;
    };

    expect(response.status).toBe(200);
    expect(body.progressByType).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: expect.objectContaining({ slug: 'hiking-area' }),
          totalParks: 1,
          totalVisits: 1,
          visible: false,
          visitedParks: 1
        }),
        expect.objectContaining({
          type: expect.objectContaining({ slug: 'wilderness-area' }),
          totalParks: 1,
          totalVisits: 1,
          visible: false,
          visitedParks: 1
        })
      ])
    );
    expect(body.progressByCategory).toEqual([
      expect.objectContaining({
        category: expect.objectContaining({ slug: 'hiking-and-wilderness-areas' }),
        totalParks: 2,
        totalVisits: 2,
        visitedParks: 2
      })
    ]);
  });

  it('serves lightweight frontend map summary data with per-park visited summaries', async () => {
    const app = createAuthedApp();

    await createVisit(app, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-04-20'
    });

    const response = await app.request('/api/map-summary');
    const body = (await response.json()) as {
      parks: Array<{
        slug: string;
        visitedSummary: {
          lastVisitedOn: string | null;
          visitCount: number;
          visited: boolean;
        };
      }>;
      updatedAt: string | null;
      version: number;
    };
    const akasmanty = body.parks.find((park) => park.slug === 'akasmannyn-kansallispuisto');

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=600');
    expect(response.headers.get('etag')).toBeTruthy();
    expect(body.parks).toHaveLength(4);
    expect(body.version).toBeGreaterThan(0);
    expect(body.updatedAt).toBeTruthy();
    expect(akasmanty).toBeDefined();
    expect(akasmanty?.visitedSummary).toEqual({
      lastVisitedOn: '2026-04-20',
      visitCount: 1,
      visited: true
    });
    expect(akasmanty).toHaveProperty('address', 'Puistotie 1, 00999 Testikylä');
    expect(akasmanty).toHaveProperty('locationLabel', 'Puistotie 1');
    expect(akasmanty).toHaveProperty('postalCode', '00999');
    expect(akasmanty).toHaveProperty('postalOffice', 'Testikylä');
    expect(akasmanty).not.toHaveProperty('location');
    expect(akasmanty).not.toHaveProperty('boundaryGeoJson');
    expect(akasmanty).not.toHaveProperty('visits');
    expect(akasmanty).not.toHaveProperty('note');
  });

  it('returns 304 for matching map summary ETags', async () => {
    const app = createAuthedApp();
    const firstResponse = await app.request('/api/map-summary');
    const etag = firstResponse.headers.get('etag');

    expect(etag).toBeTruthy();

    const cachedResponse = await app.request('/api/map-summary', {
      headers: {
        'if-none-match': etag ?? ''
      }
    });

    expect(cachedResponse.status).toBe(304);
  });

  it('returns 304 for matching home summary ETags and changes them when visit data changes', async () => {
    const app = createAuthedApp();

    const firstResponse = await app.request('/api/home-summary');
    const firstEtag = firstResponse.headers.get('etag');
    const firstBody = (await firstResponse.json()) as {
      version: number;
    };
    const cachedResponse = await app.request('/api/home-summary', {
      headers: {
        'if-none-match': firstEtag ?? ''
      }
    });

    expect(firstEtag).toBeTruthy();
    expect(firstBody.version).toBe(0);
    expect(cachedResponse.status).toBe(304);

    const { body: createdVisit } = await createVisit(app, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-04-20'
    });

    const secondResponse = await app.request('/api/home-summary');
    const secondEtag = secondResponse.headers.get('etag');
    const secondBody = (await secondResponse.json()) as {
      version: number;
    };

    expect(secondEtag).toBeTruthy();
    expect(secondEtag).not.toBe(firstEtag);
    expect(secondBody.version).toBeGreaterThan(firstBody.version);

    await requestAsAdmin(app, `/api/visits/${createdVisit.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        visitedOn: '2026-04-21'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });

    const thirdResponse = await app.request('/api/home-summary');
    const thirdEtag = thirdResponse.headers.get('etag');
    const thirdBody = (await thirdResponse.json()) as {
      version: number;
    };

    expect(thirdEtag).toBeTruthy();
    expect(thirdEtag).not.toBe(secondEtag);
    expect(thirdBody.version).toBeGreaterThan(secondBody.version);

    await requestAsAdmin(app, `/api/visits/${createdVisit.id}`, {
      method: 'DELETE'
    });

    const fourthResponse = await app.request('/api/home-summary');
    const fourthEtag = fourthResponse.headers.get('etag');
    const fourthBody = (await fourthResponse.json()) as {
      totalVisits: number;
      version: number;
    };

    expect(fourthEtag).toBeTruthy();
    expect(fourthEtag).not.toBe(thirdEtag);
    expect(fourthBody.totalVisits).toBe(0);
    expect(fourthBody.version).toBeGreaterThan(thirdBody.version);
  });

  it('serves a lightweight visits timeline with resolved type labels and image counts', async () => {
    const app = createAuthedApp();
    const { body: firstVisit } = await createVisit(app, 'akasmannyn-kansallispuisto', {
      note: 'Keep note out of the timeline response.',
      route: 'North trail',
      visitedOn: '2026-06-07'
    });
    const { body: secondVisit } = await createVisit(app, 'seitsemisen-kansallispuisto', {
      route: 'Haltian polku',
      visitedOn: '2026-06-07'
    });
    const { body: thirdVisit } = await createVisit(app, 'kaupunkilaakson-ulkoilualue', {
      visitedOn: '2026-05-01'
    });

    await testDatabase.database
      .update(parks)
      .set({
        displayTypeName: 'Erityiskohde',
        updatedAt: '2026-05-03T08:00:00.000Z'
      })
      .where(eq(parks.slug, 'seitsemisen-kansallispuisto'));

    await createVisitImage(testDatabase.database, {
      createdAt: '2026-06-08T09:00:00.000Z',
      displayOrder: 0,
      fullKey: 'visits/second/full-1.jpg',
      mimeType: 'image/jpeg',
      originalName: 'first.jpg',
      thumbKey: 'visits/second/thumb-1.jpg',
      updatedAt: '2026-06-08T09:00:00.000Z',
      visitId: secondVisit.id
    });
    await createVisitImage(testDatabase.database, {
      createdAt: '2026-06-08T09:01:00.000Z',
      displayOrder: 1,
      fullKey: 'visits/second/full-2.jpg',
      mimeType: 'image/jpeg',
      originalName: 'second.jpg',
      thumbKey: 'visits/second/thumb-2.jpg',
      updatedAt: '2026-06-08T09:01:00.000Z',
      visitId: secondVisit.id
    });

    const response = await app.request('/api/visits-timeline');
    const body = (await response.json()) as {
      visits: Array<{
        createdAt: string;
        id: number;
        imageCount: number;
        park: {
          name: string;
          slug: string;
          typeLabel: string;
        };
        route: string | null;
        visitedOn: string;
      }>;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=600');
    expect(response.headers.get('etag')).toBeTruthy();
    expect(body.visits.map((visit) => visit.id)).toEqual([
      secondVisit.id,
      firstVisit.id,
      thirdVisit.id
    ]);
    expect(body.visits[0]).toEqual(
      expect.objectContaining({
        id: secondVisit.id,
        imageCount: 2,
        park: {
          name: 'Seitsemisen kansallispuisto',
          slug: 'seitsemisen-kansallispuisto',
          typeLabel: 'Erityiskohde'
        },
        route: 'Haltian polku',
        visitedOn: '2026-06-07'
      })
    );
    expect(body.visits[1]?.park.typeLabel).toBe(parkTypeFixtures.nationalPark.name);
    expect(body.visits[2]).toEqual(
      expect.objectContaining({
        id: thirdVisit.id,
        imageCount: 0,
        park: expect.objectContaining({
          slug: 'kaupunkilaakson-ulkoilualue',
          typeLabel: parkTypeFixtures.outdoorRecreationArea.name
        }),
        route: null
      })
    );
    expect(body.visits[0]).not.toHaveProperty('author');
    expect(body.visits[0]).not.toHaveProperty('images');
    expect(body.visits[0]).not.toHaveProperty('note');
    expect(body.visits[0]).not.toHaveProperty('updatedAt');
  });

  it('returns 304 for matching visits timeline ETags and changes them when park labels change', async () => {
    const app = createAuthedApp();

    await createVisit(app, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-06-07'
    });

    const firstResponse = await app.request('/api/visits-timeline');
    const firstEtag = firstResponse.headers.get('etag');
    const cachedResponse = await app.request('/api/visits-timeline', {
      headers: {
        'if-none-match': firstEtag ?? ''
      }
    });

    expect(firstEtag).toBeTruthy();
    expect(cachedResponse.status).toBe(304);

    await requestAsAdmin(app, '/api/parks/akasmannyn-kansallispuisto', {
      method: 'PATCH',
      body: JSON.stringify({
        displayTypeName: 'Oma kansallispuisto'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });

    const secondResponse = await app.request('/api/visits-timeline');
    const secondEtag = secondResponse.headers.get('etag');
    const secondBody = (await secondResponse.json()) as {
      visits: Array<{
        park: {
          typeLabel: string;
        };
      }>;
    };

    expect(secondEtag).toBeTruthy();
    expect(secondEtag).not.toBe(firstEtag);
    expect(secondBody.visits[0]?.park.typeLabel).toBe('Oma kansallispuisto');
  });

  it('supports trip CRUD and exposes visit trip assignments in public and admin payloads', async () => {
    const app = createAuthedApp();
    const { body: createdTrip, response: createTripResponse } = await createTrip(app, {
      description: 'Lapin puistoja ja yksi yllätys.',
      name: 'Kesäreissu 2026',
      startingPoint: {
        coordinate: {
          lat: 60.1699,
          lon: 24.9384
        },
        label: 'Helsinki'
      }
    });
    const { body: firstVisit } = await createVisit(app, 'akasmannyn-kansallispuisto', {
      route: 'North trail',
      tripId: createdTrip.id,
      tripStopOrder: 1,
      visitedOn: '2026-06-07'
    });
    const { body: secondVisit } = await createVisit(app, 'seitsemisen-kansallispuisto', {
      visitedOn: '2026-06-07'
    });

    expect(createTripResponse.status).toBe(201);
    expect(createTripResponse.headers.get('cache-control')).toBe('private, no-store');
    expect(firstVisit.excludeFromRoute).toBe(false);
    expect(createdTrip).toMatchObject({
      dateRange: null,
      description: 'Lapin puistoja ja yksi yllätys.',
      name: 'Kesäreissu 2026',
      slug: 'kesareissu-2026',
      startingPoint: {
        coordinate: {
          lat: 60.1699,
          lon: 24.9384
        },
        label: 'Helsinki'
      },
      visitCount: 0
    });

    const assignTripResponse = await requestAsAdmin(app, `/api/visits/${secondVisit.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        tripId: createdTrip.id,
        tripStopOrder: 2
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const assignTripBody = (await assignTripResponse.json()) as {
      excludeFromRoute: boolean;
      tripStopOrder: number | null;
      trip: {
        id: number;
        name: string;
        slug: string;
      } | null;
    };

    expect(assignTripResponse.status).toBe(200);
    expect(assignTripBody.trip).toEqual({
      id: createdTrip.id,
      name: 'Kesäreissu 2026',
      slug: 'kesareissu-2026'
    });
    expect(assignTripBody.excludeFromRoute).toBe(false);
    expect(assignTripBody.tripStopOrder).toBe(2);

    const excludeVisitResponse = await requestAsAdmin(app, `/api/visits/${secondVisit.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        excludeFromRoute: true
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const excludeVisitBody = (await excludeVisitResponse.json()) as {
      excludeFromRoute: boolean;
    };

    expect(excludeVisitResponse.status).toBe(200);
    expect(excludeVisitBody.excludeFromRoute).toBe(true);

    const tripsResponse = await app.request('/api/trips');
    const tripsBody = (await tripsResponse.json()) as {
      trips: Array<{
        dateRange: { end: string; start: string } | null;
        description: string | null;
        id: number;
        name: string;
        slug: string;
        startingPoint: {
          coordinate: {
            lat: number;
            lon: number;
          };
          label: string;
        } | null;
        visitCount: number;
      }>;
    };

    expect(tripsResponse.status).toBe(200);
    expect(tripsResponse.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=600');
    expect(tripsResponse.headers.get('etag')).toBeTruthy();
    const cachedTripsResponse = await app.request('/api/trips', {
      headers: {
        'if-none-match': tripsResponse.headers.get('etag') ?? ''
      }
    });
    expect(cachedTripsResponse.status).toBe(304);
    expect(tripsBody.trips).toContainEqual(
      expect.objectContaining({
        dateRange: {
          end: '2026-06-07',
          start: '2026-06-07'
        },
        description: 'Lapin puistoja ja yksi yllätys.',
        id: createdTrip.id,
        name: 'Kesäreissu 2026',
        slug: 'kesareissu-2026',
        startingPoint: expect.objectContaining({
          coordinate: {
            lat: 60.1699,
            lon: 24.9384
          },
          displayName: 'Helsinki',
          label: 'Helsinki'
        }),
        visitCount: 2
      })
    );

    const timelineResponse = await app.request('/api/visits-timeline');
    const timelineBody = (await timelineResponse.json()) as {
      visits: Array<{
        id: number;
        tripStopOrder: number | null;
        trip: {
          id: number;
          name: string;
          slug: string;
        } | null;
      }>;
    };
    const visitsResponse = await app.request('/api/visits');
    const visitsBody = (await visitsResponse.json()) as {
      visits: Array<{
        excludeFromRoute: boolean;
        id: number;
        tripStopOrder: number | null;
        trip: {
          id: number;
          name: string;
          slug: string;
        } | null;
      }>;
    };
    const visitDetailResponse = await app.request(`/api/visits/${firstVisit.id}`);
    const visitDetailBody = (await visitDetailResponse.json()) as {
      excludeFromRoute: boolean;
      tripStopOrder: number | null;
      trip: {
        id: number;
        name: string;
        slug: string;
      } | null;
    };

    expect(timelineResponse.status).toBe(200);
    expect(timelineBody.visits.slice(0, 2).map((visit) => visit.id)).toEqual([
      firstVisit.id,
      secondVisit.id
    ]);
    expect(timelineBody.visits.find((visit) => visit.id === firstVisit.id)?.trip).toEqual({
      id: createdTrip.id,
      name: 'Kesäreissu 2026',
      slug: 'kesareissu-2026'
    });
    expect(timelineBody.visits.find((visit) => visit.id === firstVisit.id)?.tripStopOrder).toBe(1);
    expect(timelineBody.visits.find((visit) => visit.id === secondVisit.id)?.trip).toEqual({
      id: createdTrip.id,
      name: 'Kesäreissu 2026',
      slug: 'kesareissu-2026'
    });
    expect(timelineBody.visits.find((visit) => visit.id === secondVisit.id)?.tripStopOrder).toBe(2);
    expect(visitsResponse.status).toBe(200);
    expect(visitsBody.visits.find((visit) => visit.id === firstVisit.id)?.trip).toEqual({
      id: createdTrip.id,
      name: 'Kesäreissu 2026',
      slug: 'kesareissu-2026'
    });
    expect(visitsBody.visits.find((visit) => visit.id === firstVisit.id)?.tripStopOrder).toBe(1);
    expect(visitsBody.visits.find((visit) => visit.id === secondVisit.id)?.excludeFromRoute).toBe(
      true
    );
    expect(visitDetailResponse.status).toBe(200);
    expect(visitDetailBody.trip).toEqual({
      id: createdTrip.id,
      name: 'Kesäreissu 2026',
      slug: 'kesareissu-2026'
    });
    expect(visitDetailBody.excludeFromRoute).toBe(false);
    expect(visitDetailBody.tripStopOrder).toBe(1);

    const renameTripResponse = await requestAsAdmin(app, `/api/trips/${createdTrip.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        description: 'Päivitetty kuvaus.',
        name: 'Kesäreissu 2026 v2',
        startingPoint: {
          coordinate: {
            lat: 61.4978,
            lon: 23.761
          },
          label: 'Tampere'
        }
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const renameTripBody = (await renameTripResponse.json()) as {
      description: string | null;
      id: number;
      name: string;
      slug: string;
      startingPoint: {
        coordinate: {
          lat: number;
          lon: number;
        };
        label: string;
      } | null;
    };

    expect(renameTripResponse.status).toBe(200);
    expect(renameTripBody).toMatchObject({
      description: 'Päivitetty kuvaus.',
      id: createdTrip.id,
      name: 'Kesäreissu 2026 v2',
      slug: 'kesareissu-2026-v2',
      startingPoint: {
        coordinate: {
          lat: 61.4978,
          lon: 23.761
        },
        label: 'Tampere'
      }
    });

    const clearTripResponse = await requestAsAdmin(app, `/api/visits/${secondVisit.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        tripId: null
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const clearTripBody = (await clearTripResponse.json()) as {
      tripStopOrder: number | null;
      trip: {
        id: number;
        name: string;
      } | null;
    };

    expect(clearTripResponse.status).toBe(200);
    expect(clearTripBody.trip).toBeNull();
    expect(clearTripBody.tripStopOrder).toBeNull();

    const renamedTimelineResponse = await app.request('/api/visits-timeline');
    const renamedTimelineBody = (await renamedTimelineResponse.json()) as {
      visits: Array<{
        id: number;
        trip: {
          id: number;
          name: string;
          slug: string;
        } | null;
      }>;
    };

    expect(renamedTimelineBody.visits.find((visit) => visit.id === firstVisit.id)?.trip).toEqual({
      id: createdTrip.id,
      name: 'Kesäreissu 2026 v2',
      slug: 'kesareissu-2026-v2'
    });
    expect(
      renamedTimelineBody.visits.find((visit) => visit.id === secondVisit.id)?.trip
    ).toBeNull();

    const clearStartingPointResponse = await requestAsAdmin(app, `/api/trips/${createdTrip.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        startingPoint: null
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const clearStartingPointBody = (await clearStartingPointResponse.json()) as {
      startingPoint: {
        coordinate: {
          lat: number;
          lon: number;
        };
        label: string;
      } | null;
    };

    expect(clearStartingPointResponse.status).toBe(200);
    expect(clearStartingPointBody.startingPoint).toBeNull();

    const deleteTripResponse = await requestAsAdmin(app, `/api/trips/${createdTrip.id}`, {
      method: 'DELETE'
    });
    const clearedTimelineResponse = await app.request('/api/visits-timeline');
    const clearedTimelineBody = (await clearedTimelineResponse.json()) as {
      visits: Array<{
        id: number;
        trip: {
          id: number;
          name: string;
        } | null;
      }>;
    };
    const clearedVisitsResponse = await app.request('/api/visits');
    const clearedVisitsBody = (await clearedVisitsResponse.json()) as {
      visits: Array<{
        id: number;
        trip: {
          id: number;
          name: string;
        } | null;
      }>;
    };
    const clearedTripsResponse = await app.request('/api/trips');
    const clearedTripsBody = (await clearedTripsResponse.json()) as {
      trips: unknown[];
    };

    expect(deleteTripResponse.status).toBe(204);
    expect(clearedTimelineBody.visits.find((visit) => visit.id === firstVisit.id)?.trip).toBeNull();
    expect(clearedVisitsResponse.status).toBe(200);
    expect(clearedVisitsBody.visits.find((visit) => visit.id === firstVisit.id)?.trip).toBeNull();
    expect(clearedTripsResponse.status).toBe(200);
    expect(clearedTripsBody.trips).toEqual([]);
  });

  it('suffixes duplicate trip slugs through the trip API', async () => {
    const app = createAuthedApp();
    const { body: firstTrip } = await createTrip(app, {
      name: 'Kesäreissu 2026'
    });
    const { body: secondTrip, response: secondTripResponse } = await createTrip(app, {
      slug: firstTrip.slug,
      name: 'Talvireissu 2026'
    });

    expect(secondTripResponse.status).toBe(201);
    expect(firstTrip.slug).toBe('kesareissu-2026');
    expect(secondTrip.slug).toBe('kesareissu-2026-2');
  });

  it('supports trip stops between visits and exposes a merged trip itinerary', async () => {
    const app = createAuthedApp();
    const { body: trip } = await createTrip(app, {
      name: 'Kesäreissu 2026',
      startingPoint: {
        coordinate: {
          lat: 60.1699,
          lon: 24.9384
        },
        label: 'Helsinki'
      }
    });
    const { body: firstVisit } = await createVisit(app, 'akasmannyn-kansallispuisto', {
      tripId: trip.id,
      tripStopOrder: 1,
      visitedOn: '2026-06-07'
    });
    const { body: secondVisit } = await createVisit(app, 'seitsemisen-kansallispuisto', {
      tripId: trip.id,
      tripStopOrder: 2,
      visitedOn: '2026-06-07'
    });
    const { body: stop, response: createStopResponse } = await createTripStop(app, trip.id, {
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
    });

    expect(createStopResponse.status).toBe(201);
    expect(stop.tripStopOrder).toBe(2);
    expect(stop.visitedOn).toBe('2026-06-07');

    const tripDetailResponse = await app.request(`/api/trips/${trip.id}`);
    const tripDetailBody = (await tripDetailResponse.json()) as {
      itinerary: Array<
        | {
            kind: 'stop';
            tripStopOrder: number;
            stop: {
              id: number;
              note: string | null;
            };
          }
        | {
            kind: 'visit';
            tripStopOrder: number;
            visit: {
              id: number;
            };
          }
      >;
    };

    expect(tripDetailResponse.status).toBe(200);
    expect(tripDetailBody.itinerary).toEqual([
      {
        kind: 'visit',
        tripStopOrder: 1,
        visit: expect.objectContaining({
          id: firstVisit.id
        })
      },
      {
        kind: 'stop',
        tripStopOrder: 2,
        stop: expect.objectContaining({
          id: stop.id,
          note: 'Lunch break',
          visitedOn: '2026-06-07'
        })
      },
      {
        kind: 'visit',
        tripStopOrder: 3,
        visit: expect.objectContaining({
          id: secondVisit.id
        })
      }
    ]);

    const updateStopResponse = await requestAsAdmin(app, `/api/trip-stops/${stop.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        note: 'Coffee break',
        tripStopOrder: 1
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const updateStopBody = (await updateStopResponse.json()) as {
      note: string | null;
      tripStopOrder: number;
    };
    const visitsTimelineResponse = await app.request('/api/visits-timeline');
    const visitsTimelineBody = (await visitsTimelineResponse.json()) as {
      visits: Array<{
        id: number;
        tripStopOrder: number | null;
      }>;
    };

    expect(updateStopResponse.status).toBe(200);
    expect(updateStopBody).toMatchObject({
      note: 'Coffee break',
      tripStopOrder: 1
    });
    expect(
      visitsTimelineBody.visits.find((visit) => visit.id === firstVisit.id)?.tripStopOrder
    ).toBe(2);
    expect(
      visitsTimelineBody.visits.find((visit) => visit.id === secondVisit.id)?.tripStopOrder
    ).toBe(3);

    const deleteStopResponse = await requestAsAdmin(app, `/api/trip-stops/${stop.id}`, {
      method: 'DELETE'
    });
    const clearedTripDetailResponse = await app.request(`/api/trips/${trip.id}`);
    const clearedTripDetailBody = (await clearedTripDetailResponse.json()) as {
      itinerary: Array<{
        kind: 'visit' | 'stop';
        tripStopOrder: number;
      }>;
    };

    expect(deleteStopResponse.status).toBe(204);
    expect(clearedTripDetailResponse.status).toBe(200);
    expect(clearedTripDetailBody.itinerary).toEqual([
      expect.objectContaining({
        kind: 'visit',
        tripStopOrder: 1
      }),
      expect.objectContaining({
        kind: 'visit',
        tripStopOrder: 2
      })
    ]);
  });

  it('returns page-ready trip detail by slug with derived counts and route data', async () => {
    const buildRoundTripRoute: NonNullable<TripPlannerService['buildRoundTripRoute']> = vi.fn(
      async (): Promise<TripPlannerRoundTripRoute> => ({
        distanceMeters: 482_500,
        durationSeconds: 21_600,
        geometry: {
          coordinates: [
            [24.9384, 60.1699] as [number, number],
            [24.5, 61.5] as [number, number],
            [22.1333, 61.3167] as [number, number],
            [23.7, 61.9] as [number, number],
            [24.9384, 60.1699] as [number, number]
          ],
          type: 'LineString' as const
        },
        returnsToStart: true,
        waypointCount: 5
      })
    );
    const app = createAuthedApp({
      tripPlanner: {
        buildRoundTripRoute,
        search: vi.fn(async () => {
          throw new Error('not used in this test');
        }),
        searchNearby: vi.fn(async () => {
          throw new Error('not used in this test');
        }),
        suggest: vi.fn(async () => {
          throw new Error('not used in this test');
        })
      }
    });
    const { body: trip } = await createTrip(app, {
      description: 'Lapin puistoja ja yksi tauko matkalla.',
      name: 'Kesäreissu 2026',
      startingPoint: {
        coordinate: {
          lat: 60.1699,
          lon: 24.9384
        },
        label: 'Helsinki'
      }
    });
    const { body: firstVisit } = await createVisit(app, 'akasmannyn-kansallispuisto', {
      route: 'North trail',
      tripId: trip.id,
      tripStopOrder: 1,
      visitedOn: '2026-06-07'
    });
    const { body: secondVisit } = await createVisit(app, 'seitsemisen-kansallispuisto', {
      route: 'Haltian polku',
      tripId: trip.id,
      tripStopOrder: 2,
      visitedOn: '2026-06-08'
    });
    const { body: stop } = await createTripStop(app, trip.id, {
      location: {
        coordinate: {
          lat: 61.3167,
          lon: 22.1333
        },
        label: 'Neste Vantaa Koivukyla, Halmekuja 1, 01360 Vantaa, Finland'
      },
      note: 'Lunch break',
      tripStopOrder: 2,
      visitedOn: '2026-06-08'
    });
    const firstPark = await getParkBySlug(testDatabase.database, 'akasmannyn-kansallispuisto');
    const secondPark = await getParkBySlug(testDatabase.database, 'seitsemisen-kansallispuisto');

    await testDatabase.database
      .update(parks)
      .set({
        displayTypeName: 'Erityiskohde',
        updatedAt: '2026-06-10T08:00:00.000Z'
      })
      .where(eq(parks.slug, 'seitsemisen-kansallispuisto'));

    await createVisitImage(testDatabase.database, {
      createdAt: '2026-06-08T09:00:00.000Z',
      displayOrder: 0,
      fullKey: 'visits/second/full-1.jpg',
      mimeType: 'image/jpeg',
      originalName: 'first.jpg',
      thumbKey: 'visits/second/thumb-1.jpg',
      updatedAt: '2026-06-08T09:00:00.000Z',
      visitId: secondVisit.id
    });
    await createVisitImage(testDatabase.database, {
      createdAt: '2026-06-08T09:01:00.000Z',
      displayOrder: 1,
      fullKey: 'visits/second/full-2.jpg',
      mimeType: 'image/jpeg',
      originalName: 'second.jpg',
      thumbKey: 'visits/second/thumb-2.jpg',
      updatedAt: '2026-06-08T09:01:00.000Z',
      visitId: secondVisit.id
    });

    const response = await app.request('/api/trips/slug/kesareissu-2026');
    const body = (await response.json()) as {
      dateRange: { end: string; start: string } | null;
      description: string | null;
      id: number;
      imageCount: number;
      itinerary: Array<
        | {
            kind: 'stop';
            stop: {
              id: number;
              location: {
                coordinate: {
                  lat: number;
                  lon: number;
                };
                displayName: string;
                label: string;
              };
              note: string | null;
              visitedOn: string;
            };
            tripStopOrder: number;
          }
        | {
            kind: 'visit';
            tripStopOrder: number;
            visit: {
              id: number;
              imageCount: number;
              park: {
                markerPoint: {
                  lat: number;
                  lon: number;
                };
                name: string;
                slug: string;
                typeLabel: string;
              };
              route: string | null;
              visitedOn: string;
            };
          }
      >;
      route: {
        data: {
          distanceMeters: number;
          durationSeconds: number;
          geometry: {
            coordinates: number[][];
            type: 'LineString';
          };
          returnsToStart: boolean;
          waypointCount: number;
        } | null;
        error: null;
        success: boolean;
      };
      slug: string;
      startingPoint: {
        coordinate: {
          lat: number;
          lon: number;
        };
        label: string;
      } | null;
      stopCount: number;
      visitCount: number;
    };

    expect(firstPark).not.toBeNull();
    expect(secondPark).not.toBeNull();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(body).toMatchObject({
      dateRange: {
        end: '2026-06-08',
        start: '2026-06-07'
      },
      description: 'Lapin puistoja ja yksi tauko matkalla.',
      id: trip.id,
      imageCount: 2,
      slug: 'kesareissu-2026',
      startingPoint: {
        coordinate: {
          lat: 60.1699,
          lon: 24.9384
        },
        displayName: 'Helsinki',
        label: 'Helsinki'
      },
      stopCount: 1,
      visitCount: 2
    });
    expect(body.itinerary).toEqual([
      {
        kind: 'visit',
        tripStopOrder: 1,
        visit: expect.objectContaining({
          id: firstVisit.id,
          imageCount: 0,
          park: {
            markerPoint: firstPark!.markerPoint,
            name: 'Äkäsmännyn kansallispuisto',
            slug: 'akasmannyn-kansallispuisto',
            typeLabel: parkTypeFixtures.nationalPark.name
          },
          route: 'North trail',
          visitedOn: '2026-06-07'
        })
      },
      {
        kind: 'stop',
        tripStopOrder: 2,
        stop: expect.objectContaining({
          id: stop.id,
          location: {
            coordinate: {
              lat: 61.3167,
              lon: 22.1333
            },
            displayName: 'Neste Vantaa Koivukyla',
            label: 'Neste Vantaa Koivukyla, Halmekuja 1, 01360 Vantaa, Finland'
          },
          note: 'Lunch break',
          visitedOn: '2026-06-08'
        })
      },
      {
        kind: 'visit',
        tripStopOrder: 3,
        visit: expect.objectContaining({
          id: secondVisit.id,
          imageCount: 2,
          park: {
            markerPoint: secondPark!.markerPoint,
            name: 'Seitsemisen kansallispuisto',
            slug: 'seitsemisen-kansallispuisto',
            typeLabel: 'Erityiskohde'
          },
          route: 'Haltian polku',
          visitedOn: '2026-06-08'
        })
      }
    ]);
    expect(body.route).toEqual({
      data: {
        distanceMeters: 482_500,
        durationSeconds: 21_600,
        geometry: {
          coordinates: [
            [24.9384, 60.1699],
            [24.5, 61.5],
            [22.1333, 61.3167],
            [23.7, 61.9],
            [24.9384, 60.1699]
          ],
          type: 'LineString'
        },
        returnsToStart: true,
        waypointCount: 5
      },
      error: null,
      success: true
    });
    expect(buildRoundTripRoute).toHaveBeenCalledTimes(1);
    expect(buildRoundTripRoute).toHaveBeenCalledWith({
      mode: 'drive',
      waypoints: [
        expect.objectContaining({
          coordinate: {
            lat: 60.1699,
            lon: 24.9384
          },
          routeFallbackQueries: ['Helsinki']
        }),
        expect.objectContaining({
          coordinate: firstPark!.markerPoint,
          displayName: 'Äkäsmännyn kansallispuisto',
          label: 'Äkäsmännyn kansallispuisto',
          routeFallbackQueries: expect.arrayContaining([
            firstPark!.address,
            firstPark!.locationLabel
          ])
        }),
        expect.objectContaining({
          coordinate: {
            lat: 61.3167,
            lon: 22.1333
          },
          routeFallbackQueries: ['Neste Vantaa Koivukyla, Halmekuja 1, 01360 Vantaa, Finland']
        }),
        expect.objectContaining({
          coordinate: secondPark!.markerPoint,
          displayName: 'Seitsemisen kansallispuisto',
          label: 'Seitsemisen kansallispuisto',
          routeFallbackQueries: expect.arrayContaining([
            secondPark!.address,
            secondPark!.locationLabel
          ])
        }),
        expect.objectContaining({
          coordinate: {
            lat: 60.1699,
            lon: 24.9384
          },
          routeFallbackQueries: ['Helsinki']
        })
      ]
    });
  });

  it('returns a successful empty route state by slug when the trip does not meet route prerequisites', async () => {
    const buildRoundTripRoute: NonNullable<TripPlannerService['buildRoundTripRoute']> = vi.fn(
      async (): Promise<TripPlannerRoundTripRoute> => ({
        distanceMeters: 1,
        durationSeconds: 1,
        geometry: {
          coordinates: [
            [24.9384, 60.1699] as [number, number],
            [24.9384, 60.1699] as [number, number]
          ],
          type: 'LineString' as const
        },
        returnsToStart: true,
        waypointCount: 2
      })
    );
    const app = createAuthedApp({
      tripPlanner: {
        buildRoundTripRoute,
        search: vi.fn(async () => {
          throw new Error('not used in this test');
        }),
        searchNearby: vi.fn(async () => {
          throw new Error('not used in this test');
        }),
        suggest: vi.fn(async () => {
          throw new Error('not used in this test');
        })
      }
    });
    const { body: trip } = await createTrip(app, {
      name: 'Yksinainen retki'
    });

    await createVisit(app, 'akasmannyn-kansallispuisto', {
      tripId: trip.id,
      tripStopOrder: 1,
      visitedOn: '2026-06-07'
    });

    const response = await app.request('/api/trips/slug/yksinainen-retki');
    const body = (await response.json()) as {
      route: {
        data: {
          distanceMeters: number;
        } | null;
        error: null;
        success: boolean;
      };
      stopCount: number;
      visitCount: number;
    };

    expect(response.status).toBe(200);
    expect(body.visitCount).toBe(1);
    expect(body.stopCount).toBe(0);
    expect(body.route).toEqual({
      data: null,
      error: null,
      success: true
    });
    expect(buildRoundTripRoute).not.toHaveBeenCalled();
  });

  it('keeps excluded visits in the trip payload but omits them from route calculation', async () => {
    const routeData: TripPlannerRoundTripRoute = {
      distanceMeters: 11_100,
      durationSeconds: 1_800,
      geometry: {
        coordinates: [
          [24.9384, 60.1699] as [number, number],
          [23.7, 61.9] as [number, number],
          [24.4, 61.7] as [number, number],
          [24.9384, 60.1699] as [number, number]
        ],
        type: 'LineString'
      },
      returnsToStart: true,
      waypointCount: 4
    };
    const buildRoundTripRoute: NonNullable<TripPlannerService['buildRoundTripRoute']> = vi.fn(
      async (): Promise<TripPlannerRoundTripRoute> => routeData
    );
    const app = createAuthedApp({
      tripPlanner: {
        buildRoundTripRoute,
        search: vi.fn(async () => {
          throw new Error('not used in this test');
        }),
        searchNearby: vi.fn(async () => {
          throw new Error('not used in this test');
        }),
        suggest: vi.fn(async () => {
          throw new Error('not used in this test');
        })
      }
    });
    const { body: trip } = await createTrip(app, {
      name: 'Marker only visit',
      startingPoint: {
        coordinate: {
          lat: 60.1699,
          lon: 24.9384
        },
        label: 'Helsinki'
      }
    });

    await createVisit(app, 'akasmannyn-kansallispuisto', {
      tripId: trip.id,
      tripStopOrder: 1,
      visitedOn: '2026-06-07'
    });
    const { body: excludedVisit } = await createVisit(app, 'kaupunkilaakson-ulkoilualue', {
      excludeFromRoute: true,
      tripId: trip.id,
      tripStopOrder: 2,
      visitedOn: '2026-06-08'
    });
    const secondPark = await getParkBySlug(testDatabase.database, 'seitsemisen-kansallispuisto');

    await createVisit(app, 'seitsemisen-kansallispuisto', {
      tripId: trip.id,
      tripStopOrder: 3,
      visitedOn: '2026-06-08'
    });

    const response = await app.request('/api/trips/slug/marker-only-visit');
    const body = (await response.json()) as {
      itinerary: Array<{
        kind: 'visit';
        tripStopOrder: number;
        visit: {
          excludeFromRoute: boolean;
          id: number;
        };
      }>;
      route: {
        data: TripPlannerRoundTripRoute | null;
        error: null;
        success: boolean;
      };
    };

    expect(secondPark).not.toBeNull();
    expect(response.status).toBe(200);
    expect(body.itinerary).toEqual([
      expect.objectContaining({
        kind: 'visit',
        tripStopOrder: 1
      }),
      {
        kind: 'visit',
        tripStopOrder: 2,
        visit: expect.objectContaining({
          excludeFromRoute: true,
          id: excludedVisit.id
        })
      },
      expect.objectContaining({
        kind: 'visit',
        tripStopOrder: 3
      })
    ]);
    expect(body.route).toEqual({
      data: routeData,
      error: null,
      success: true
    });
    expect(buildRoundTripRoute).toHaveBeenCalledWith({
      mode: 'drive',
      waypoints: [
        expect.objectContaining({
          displayName: 'Helsinki'
        }),
        expect.objectContaining({
          displayName: 'Äkäsmännyn kansallispuisto'
        }),
        expect.objectContaining({
          coordinate: secondPark!.markerPoint,
          displayName: 'Seitsemisen kansallispuisto'
        }),
        expect.objectContaining({
          displayName: 'Helsinki'
        })
      ]
    });
  });

  it('builds a route by slug when the trip has two itinerary entries across visits and stops', async () => {
    const routeData: TripPlannerRoundTripRoute = {
      distanceMeters: 12_345,
      durationSeconds: 2_345,
      geometry: {
        coordinates: [
          [24.9384, 60.1699] as [number, number],
          [24.5, 61.5] as [number, number],
          [25.1, 61.8] as [number, number],
          [24.9384, 60.1699] as [number, number]
        ],
        type: 'LineString'
      },
      returnsToStart: true,
      waypointCount: 4
    };
    const buildRoundTripRoute: NonNullable<TripPlannerService['buildRoundTripRoute']> = vi.fn(
      async (): Promise<TripPlannerRoundTripRoute> => routeData
    );
    const app = createAuthedApp({
      tripPlanner: {
        buildRoundTripRoute,
        search: vi.fn(async () => {
          throw new Error('not used in this test');
        }),
        searchNearby: vi.fn(async () => {
          throw new Error('not used in this test');
        }),
        suggest: vi.fn(async () => {
          throw new Error('not used in this test');
        })
      }
    });
    const { body: trip } = await createTrip(app, {
      name: 'Sekalainen retki',
      startingPoint: {
        coordinate: {
          lat: 60.1699,
          lon: 24.9384
        },
        label: 'Helsinki'
      }
    });

    await createVisit(app, 'akasmannyn-kansallispuisto', {
      tripId: trip.id,
      tripStopOrder: 1,
      visitedOn: '2026-06-07'
    });
    await createTripStop(app, trip.id, {
      location: {
        coordinate: {
          lat: 61.5,
          lon: 24.5
        },
        label: 'Matkan varsi 1, 11111 Testila, Finland'
      },
      tripStopOrder: 2,
      visitedOn: '2026-06-08'
    });

    const response = await app.request('/api/trips/slug/sekalainen-retki');
    const body = (await response.json()) as {
      route: {
        data: TripPlannerRoundTripRoute | null;
        error: null;
        success: boolean;
      };
      stopCount: number;
      visitCount: number;
    };

    expect(response.status).toBe(200);
    expect(body.visitCount).toBe(1);
    expect(body.stopCount).toBe(1);
    expect(body.route).toEqual({
      data: routeData,
      error: null,
      success: true
    });
    expect(buildRoundTripRoute).toHaveBeenCalledWith({
      mode: 'drive',
      waypoints: expect.arrayContaining([
        expect.objectContaining({
          displayName: 'Helsinki',
          label: 'Helsinki'
        }),
        expect.objectContaining({
          displayName: 'Äkäsmännyn kansallispuisto',
          label: 'Äkäsmännyn kansallispuisto'
        }),
        expect.objectContaining({
          displayName: 'Matkan varsi 1',
          label: 'Matkan varsi 1, 11111 Testila, Finland'
        })
      ])
    });
  });

  it('returns a failed route state by slug when the trip planner is not configured', async () => {
    const app = createAuthedApp();
    const { body: trip } = await createTrip(app, {
      name: 'Konfiguroimaton reitti',
      startingPoint: {
        coordinate: {
          lat: 60.1699,
          lon: 24.9384
        },
        label: 'Helsinki'
      }
    });

    await createVisit(app, 'akasmannyn-kansallispuisto', {
      tripId: trip.id,
      tripStopOrder: 1,
      visitedOn: '2026-06-07'
    });
    await createVisit(app, 'seitsemisen-kansallispuisto', {
      tripId: trip.id,
      tripStopOrder: 2,
      visitedOn: '2026-06-08'
    });

    const response = await app.request('/api/trips/slug/konfiguroimaton-reitti');
    const body = (await response.json()) as {
      route: {
        data: null;
        error: {
          error: string;
          errorCode: string;
        };
        success: boolean;
      };
    };

    expect(response.status).toBe(200);
    expect(body.route).toEqual({
      data: null,
      error: {
        error: 'Trip planner is not configured.',
        errorCode: 'trip_planner_not_configured'
      },
      success: false
    });
  });

  it('returns route_not_found by slug when trip routing returns null and omits empty fallback queries', async () => {
    const buildRoundTripRoute: NonNullable<TripPlannerService['buildRoundTripRoute']> = vi.fn(
      async () => null
    );
    const originalGetParkBySlug = repositories.getParkBySlug;
    const getParkBySlugSpy = vi
      .spyOn(repositories, 'getParkBySlug')
      .mockImplementation(async (database, slug) => {
        if (slug === 'akasmannyn-kansallispuisto') {
          return null;
        }

        return originalGetParkBySlug(database, slug);
      });
    const app = createAuthedApp({
      tripPlanner: {
        buildRoundTripRoute,
        search: vi.fn(async () => {
          throw new Error('not used in this test');
        }),
        searchNearby: vi.fn(async () => {
          throw new Error('not used in this test');
        }),
        suggest: vi.fn(async () => {
          throw new Error('not used in this test');
        })
      }
    });
    const { body: trip } = await createTrip(app, {
      name: 'Tyhja reitti',
      startingPoint: {
        coordinate: {
          lat: 60.1699,
          lon: 24.9384
        },
        label: 'Helsinki'
      }
    });

    await createVisit(app, 'akasmannyn-kansallispuisto', {
      tripId: trip.id,
      tripStopOrder: 1,
      visitedOn: '2026-06-07'
    });
    await createVisit(app, 'seitsemisen-kansallispuisto', {
      tripId: trip.id,
      tripStopOrder: 2,
      visitedOn: '2026-06-08'
    });

    try {
      const response = await app.request('/api/trips/slug/tyhja-reitti');
      const body = (await response.json()) as {
        route: {
          data: null;
          error: {
            error: string;
            errorCode: string;
          };
          success: boolean;
        };
      };

      expect(response.status).toBe(200);
      expect(body.route).toEqual({
        data: null,
        error: {
          error: 'Driving route could not be found.',
          errorCode: 'route_not_found'
        },
        success: false
      });
      expect(buildRoundTripRoute).toHaveBeenCalledWith({
        mode: 'drive',
        waypoints: expect.arrayContaining([
          expect.objectContaining({
            displayName: 'Äkäsmännyn kansallispuisto',
            routeFallbackQueries: undefined
          })
        ])
      });
    } finally {
      getParkBySlugSpy.mockRestore();
    }
  });

  it('returns a failed route state by slug when a trip route leg cannot be routed', async () => {
    const buildRoundTripRoute: NonNullable<TripPlannerService['buildRoundTripRoute']> = vi.fn(
      async () => {
        throw new TripPlannerError(
          'route_not_found',
          'Driving route could not be found from A to B.',
          422,
          {
            routeFailure: {
              destination: {
                coordinate: {
                  lat: 61,
                  lon: 25
                },
                displayName: 'B',
                label: 'B'
              },
              origin: {
                coordinate: {
                  lat: 60,
                  lon: 24
                },
                displayName: 'A',
                label: 'A'
              },
              waypointIndex: 1
            }
          }
        );
      }
    );
    const app = createAuthedApp({
      tripPlanner: {
        buildRoundTripRoute,
        search: vi.fn(async () => {
          throw new Error('not used in this test');
        }),
        searchNearby: vi.fn(async () => {
          throw new Error('not used in this test');
        }),
        suggest: vi.fn(async () => {
          throw new Error('not used in this test');
        })
      }
    });
    const { body: trip } = await createTrip(app, {
      name: 'Retki virhepolulla',
      startingPoint: {
        coordinate: {
          lat: 60.1699,
          lon: 24.9384
        },
        label: 'Helsinki'
      }
    });

    await createVisit(app, 'akasmannyn-kansallispuisto', {
      tripId: trip.id,
      tripStopOrder: 1,
      visitedOn: '2026-06-07'
    });
    await createVisit(app, 'seitsemisen-kansallispuisto', {
      tripId: trip.id,
      tripStopOrder: 2,
      visitedOn: '2026-06-08'
    });

    const response = await app.request('/api/trips/slug/retki-virhepolulla');
    const body = (await response.json()) as {
      route: {
        data: null;
        error: {
          error: string;
          errorCode: string;
          routeFailure: {
            destination: {
              displayName: string;
              label: string;
            };
            origin: {
              displayName: string;
              label: string;
            };
            waypointIndex: number;
          };
        };
        success: boolean;
      };
    };

    expect(response.status).toBe(200);
    expect(body.route).toEqual({
      data: null,
      error: {
        error: 'Driving route could not be found from A to B.',
        errorCode: 'route_not_found',
        routeFailure: {
          destination: {
            coordinate: {
              lat: 61,
              lon: 25
            },
            displayName: 'B',
            label: 'B'
          },
          origin: {
            coordinate: {
              lat: 60,
              lon: 24
            },
            displayName: 'A',
            label: 'A'
          },
          waypointIndex: 1
        }
      },
      success: false
    });
    expect(buildRoundTripRoute).toHaveBeenCalledTimes(1);
  });

  it('returns 500 for an unexpected public trip route failure by slug', async () => {
    const app = createAuthedApp({
      tripPlanner: {
        buildRoundTripRoute: vi.fn(async () => {
          throw new Error('boom');
        }),
        search: vi.fn(async () => {
          throw new Error('not used in this test');
        }),
        searchNearby: vi.fn(async () => {
          throw new Error('not used in this test');
        }),
        suggest: vi.fn(async () => {
          throw new Error('not used in this test');
        })
      }
    });
    const { body: trip } = await createTrip(app, {
      name: 'Rikkoutuva julkinen reitti',
      startingPoint: {
        coordinate: {
          lat: 60.1699,
          lon: 24.9384
        },
        label: 'Helsinki'
      }
    });

    await createVisit(app, 'akasmannyn-kansallispuisto', {
      tripId: trip.id,
      tripStopOrder: 1,
      visitedOn: '2026-06-07'
    });
    await createVisit(app, 'seitsemisen-kansallispuisto', {
      tripId: trip.id,
      tripStopOrder: 2,
      visitedOn: '2026-06-08'
    });

    const response = await app.request('/api/trips/slug/rikkoutuva-julkinen-reitti');

    expect(response.status).toBe(500);
  });

  it('returns a failed public route state for provider_unavailable errors by slug', async () => {
    const app = createAuthedApp({
      tripPlanner: {
        buildRoundTripRoute: vi.fn(async () => {
          throw new TripPlannerError(
            'provider_unavailable',
            'Trip planner provider is unavailable.',
            503
          );
        }),
        search: vi.fn(async () => {
          throw new Error('not used in this test');
        }),
        searchNearby: vi.fn(async () => {
          throw new Error('not used in this test');
        }),
        suggest: vi.fn(async () => {
          throw new Error('not used in this test');
        })
      }
    });
    const { body: trip } = await createTrip(app, {
      name: 'Palvelu poissa kaytosta',
      startingPoint: {
        coordinate: {
          lat: 60.1699,
          lon: 24.9384
        },
        label: 'Helsinki'
      }
    });

    await createVisit(app, 'akasmannyn-kansallispuisto', {
      tripId: trip.id,
      tripStopOrder: 1,
      visitedOn: '2026-06-07'
    });
    await createVisit(app, 'seitsemisen-kansallispuisto', {
      tripId: trip.id,
      tripStopOrder: 2,
      visitedOn: '2026-06-08'
    });

    const response = await app.request('/api/trips/slug/palvelu-poissa-kaytosta');
    const body = (await response.json()) as {
      route: {
        data: null;
        error: {
          error: string;
          errorCode: string;
        };
        success: boolean;
      };
    };

    expect(response.status).toBe(200);
    expect(body.route).toEqual({
      data: null,
      error: {
        error: 'Trip planner provider is unavailable.',
        errorCode: 'provider_unavailable'
      },
      success: false
    });
  });

  it('returns 500 for unsupported public trip route planner error codes by slug', async () => {
    const app = createAuthedApp({
      tripPlanner: {
        buildRoundTripRoute: vi.fn(async () => {
          throw new TripPlannerError('origin_not_found', 'Origin could not be resolved.', 422);
        }),
        search: vi.fn(async () => {
          throw new Error('not used in this test');
        }),
        searchNearby: vi.fn(async () => {
          throw new Error('not used in this test');
        }),
        suggest: vi.fn(async () => {
          throw new Error('not used in this test');
        })
      }
    });
    const { body: trip } = await createTrip(app, {
      name: 'Vaaraehto reitilla',
      startingPoint: {
        coordinate: {
          lat: 60.1699,
          lon: 24.9384
        },
        label: 'Helsinki'
      }
    });

    await createVisit(app, 'akasmannyn-kansallispuisto', {
      tripId: trip.id,
      tripStopOrder: 1,
      visitedOn: '2026-06-07'
    });
    await createVisit(app, 'seitsemisen-kansallispuisto', {
      tripId: trip.id,
      tripStopOrder: 2,
      visitedOn: '2026-06-08'
    });

    const response = await app.request('/api/trips/slug/vaaraehto-reitilla');

    expect(response.status).toBe(500);
  });

  it('returns 404 for an unknown trip slug', async () => {
    const app = createAuthedApp();
    const response = await app.request('/api/trips/slug/missing-trip');
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(404);
    expect(body.error).toBe('Trip not found.');
  });

  it('handles trip stop not-found and unexpected failure paths', async () => {
    const app = createAuthedApp();
    const missingTripDetailResponse = await app.request('/api/trips/99999');
    const missingTripDetailBody = (await missingTripDetailResponse.json()) as { error: string };
    const missingTripStopCreateResponse = await requestAsAdmin(app, '/api/trips/99999/stops', {
      method: 'POST',
      body: JSON.stringify({
        location: {
          coordinate: {
            lat: 61.3167,
            lon: 22.1333
          },
          label: 'ABC Huittinen'
        },
        visitedOn: '2026-06-07'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const missingTripStopCreateBody = (await missingTripStopCreateResponse.json()) as {
      error: string;
    };

    expect(missingTripDetailResponse.status).toBe(404);
    expect(missingTripDetailBody.error).toBe('Trip not found.');
    expect(missingTripStopCreateResponse.status).toBe(404);
    expect(missingTripStopCreateBody.error).toBe('Trip not found.');

    const { body: trip } = await createTrip(app, {
      name: 'Kesäreissu 2026'
    });
    await createVisit(app, 'akasmannyn-kansallispuisto', {
      tripId: trip.id,
      visitedOn: '2026-06-07'
    });
    const { body: stop } = await createTripStop(app, trip.id, {
      location: {
        coordinate: {
          lat: 61.3167,
          lon: 22.1333
        },
        label: 'ABC Huittinen'
      },
      visitedOn: '2026-06-07'
    });
    const relocateTripStopResponse = await requestAsAdmin(app, `/api/trip-stops/${stop.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        location: {
          coordinate: {
            lat: 61.451,
            lon: 23.856
          },
          label: 'Yöpyminen Tampereella'
        }
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const relocateTripStopBody = (await relocateTripStopResponse.json()) as {
      location: {
        coordinate: {
          lat: number;
          lon: number;
        };
        label: string;
      };
      note: string | null;
    };
    const missingTripStopUpdateResponse = await requestAsAdmin(app, '/api/trip-stops/99999', {
      method: 'PATCH',
      body: JSON.stringify({
        note: 'Missing stop'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const missingTripStopUpdateBody = (await missingTripStopUpdateResponse.json()) as {
      error: string;
    };
    const missingTripStopDeleteResponse = await requestAsAdmin(app, '/api/trip-stops/99999', {
      method: 'DELETE'
    });
    const missingTripStopDeleteBody = (await missingTripStopDeleteResponse.json()) as {
      error: string;
    };

    expect(relocateTripStopResponse.status).toBe(200);
    expect(relocateTripStopBody).toMatchObject({
      location: {
        coordinate: {
          lat: 61.451,
          lon: 23.856
        },
        label: 'Yöpyminen Tampereella'
      },
      note: null
    });
    expect(missingTripStopUpdateResponse.status).toBe(404);
    expect(missingTripStopUpdateBody.error).toBe('Trip stop not found.');
    expect(missingTripStopDeleteResponse.status).toBe(404);
    expect(missingTripStopDeleteBody.error).toBe('Trip stop not found.');

    const brokenStopCreateDatabase = await createTestDatabase();

    await importParks({
      database: brokenStopCreateDatabase.database,
      expectedActiveCount: 1,
      now: () => '2026-05-01T09:00:00.000Z',
      sourceUrl: 'https://example.test/lipas-broken-trip-stop-create',
      fetchSource: async () => ({
        items: [createLipasPark()]
      })
    });

    const brokenStopCreateApp = createApp({
      auth: authConfig,
      database: brokenStopCreateDatabase.database
    });
    const { body: brokenCreateTrip } = await createTrip(brokenStopCreateApp, {
      name: 'Rikkoutuva pysahdysreissu'
    });

    await brokenStopCreateDatabase.dispose();

    const brokenTripStopCreateResponse = await requestAsAdmin(
      brokenStopCreateApp,
      `/api/trips/${brokenCreateTrip.id}/stops`,
      {
        method: 'POST',
        body: JSON.stringify({
          location: {
            coordinate: {
              lat: 61.3167,
              lon: 22.1333
            },
            label: 'ABC Huittinen'
          },
          visitedOn: '2026-06-07'
        }),
        headers: {
          'content-type': 'application/json'
        }
      }
    );

    const brokenStopUpdateDatabase = await createTestDatabase();

    await importParks({
      database: brokenStopUpdateDatabase.database,
      expectedActiveCount: 1,
      now: () => '2026-05-01T09:00:00.000Z',
      sourceUrl: 'https://example.test/lipas-broken-trip-stop-update',
      fetchSource: async () => ({
        items: [createLipasPark()]
      })
    });

    const brokenStopUpdateApp = createApp({
      auth: authConfig,
      database: brokenStopUpdateDatabase.database
    });
    const { body: brokenTrip } = await createTrip(brokenStopUpdateApp, {
      name: 'Rikkoutuva kesäreissu'
    });
    await createVisit(brokenStopUpdateApp, 'akasmannyn-kansallispuisto', {
      tripId: brokenTrip.id,
      visitedOn: '2026-06-07'
    });
    const { body: brokenStop } = await createTripStop(brokenStopUpdateApp, brokenTrip.id, {
      location: {
        coordinate: {
          lat: 61.3167,
          lon: 22.1333
        },
        label: 'ABC Huittinen'
      },
      visitedOn: '2026-06-07'
    });

    await brokenStopUpdateDatabase.dispose();

    const brokenTripStopUpdateResponse = await requestAsAdmin(
      brokenStopUpdateApp,
      `/api/trip-stops/${brokenStop.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          note: 'Should fail'
        }),
        headers: {
          'content-type': 'application/json'
        }
      }
    );

    expect(stop.id).toBeGreaterThan(0);
    expect(brokenTripStopCreateResponse.status).toBe(500);
    expect(brokenTripStopUpdateResponse.status).toBe(500);
  });

  it('rejects trip stop order changes when no trip is assigned', async () => {
    const app = createAuthedApp();

    const createResponse = await requestAsAdmin(
      app,
      '/api/parks/akasmannyn-kansallispuisto/visits',
      {
        method: 'POST',
        body: JSON.stringify({
          tripStopOrder: 1,
          visitedOn: '2026-06-07'
        }),
        headers: {
          'content-type': 'application/json'
        }
      }
    );
    const createBody = (await createResponse.json()) as {
      error: string;
    };

    expect(createResponse.status).toBe(422);
    expect(createBody.error).toBe('Trip stop order requires an assigned trip.');

    const { body: visit } = await createVisit(app, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-06-07'
    });
    const updateResponse = await requestAsAdmin(app, `/api/visits/${visit.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        tripStopOrder: 1
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const updateBody = (await updateResponse.json()) as {
      error: string;
    };

    expect(updateResponse.status).toBe(422);
    expect(updateBody.error).toBe('Trip stop order requires an assigned trip.');
  });

  it('lets new end stops extend from the latest trip place through the trip stop API', async () => {
    const app = createAuthedApp();
    const { body: trip } = await createTrip(app, {
      name: 'Kesäreissu 2026'
    });

    const missingVisitResponse = await requestAsAdmin(app, `/api/trips/${trip.id}/stops`, {
      method: 'POST',
      body: JSON.stringify({
        location: {
          coordinate: {
            lat: 61.3167,
            lon: 22.1333
          },
          label: 'ABC Huittinen'
        },
        visitedOn: '2026-06-07'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const missingVisitBody = (await missingVisitResponse.json()) as {
      error: string;
    };

    expect(missingVisitResponse.status).toBe(422);
    expect(missingVisitBody.error).toBe('Trip stop requires at least one visit in the trip.');

    await createVisit(app, 'akasmannyn-kansallispuisto', {
      tripId: trip.id,
      visitedOn: '2026-06-07'
    });
    await createVisit(app, 'seitsemisen-kansallispuisto', {
      tripId: trip.id,
      visitedOn: '2026-06-09'
    });

    const beforeRangeResponse = await requestAsAdmin(app, `/api/trips/${trip.id}/stops`, {
      method: 'POST',
      body: JSON.stringify({
        location: {
          coordinate: {
            lat: 61.3167,
            lon: 22.1333
          },
          label: 'ABC Huittinen'
        },
        visitedOn: '2026-06-05'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const beforeRangeBody = (await beforeRangeResponse.json()) as {
      error: string;
    };

    expect(beforeRangeResponse.status).toBe(422);
    expect(beforeRangeBody.error).toBe('Trip stop date must be within the trip date range.');

    const { body: outboundStop } = await createTripStop(app, trip.id, {
      location: {
        coordinate: {
          lat: 61.3167,
          lon: 22.1333
        },
        label: 'ABC Huittinen'
      },
      visitedOn: '2026-06-06'
    });
    const { body: returnStop } = await createTripStop(app, trip.id, {
      location: {
        coordinate: {
          lat: 61.45,
          lon: 23.85
        },
        label: 'Tampereen kautta kotiin'
      },
      visitedOn: '2026-06-10'
    });
    const { body: overnightStop } = await createTripStop(app, trip.id, {
      location: {
        coordinate: {
          lat: 61.4981,
          lon: 23.761
        },
        label: 'Yopyminen matkan varrella'
      },
      visitedOn: '2026-06-11'
    });
    const tripResponse = await app.request('/api/trips');
    const tripBody = (await tripResponse.json()) as {
      trips: Array<{
        dateRange: { end: string; start: string } | null;
        id: number;
      }>;
    };

    expect(outboundStop.visitedOn).toBe('2026-06-06');
    expect(returnStop.visitedOn).toBe('2026-06-10');
    expect(overnightStop.visitedOn).toBe('2026-06-11');
    expect(tripBody.trips).toContainEqual(
      expect.objectContaining({
        dateRange: {
          end: '2026-06-11',
          start: '2026-06-06'
        },
        id: trip.id
      })
    );

    const updateStopResponse = await requestAsAdmin(app, `/api/trip-stops/${overnightStop.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        note: 'Late arrival'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const updateStopBody = (await updateStopResponse.json()) as {
      error: string;
    };

    expect(updateStopResponse.status).toBe(200);
    expect(updateStopBody).toMatchObject({
      id: overnightStop.id,
      note: 'Late arrival',
      visitedOn: '2026-06-11'
    });

    const beyondRangeResponse = await requestAsAdmin(app, `/api/trip-stops/${overnightStop.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        visitedOn: '2026-06-13'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const beyondRangeBody = (await beyondRangeResponse.json()) as {
      error: string;
    };

    expect(beyondRangeResponse.status).toBe(422);
    expect(beyondRangeBody.error).toBe('Trip stop date must be within the trip date range.');
  });

  it('returns 500 for unexpected visit write failures', async () => {
    const brokenCreateDatabase = await createTestDatabase();

    await importParks({
      database: brokenCreateDatabase.database,
      expectedActiveCount: 1,
      now: () => '2026-05-01T09:00:00.000Z',
      sourceUrl: 'https://example.test/lipas-broken-create',
      fetchSource: async () => ({
        items: [createLipasPark()]
      })
    });

    const brokenCreateApp = createApp({
      auth: authConfig,
      database: brokenCreateDatabase.database
    });

    await brokenCreateDatabase.dispose();

    const createResponse = await requestAsAdmin(
      brokenCreateApp,
      '/api/parks/akasmannyn-kansallispuisto/visits',
      {
        method: 'POST',
        body: JSON.stringify({
          visitedOn: '2026-04-20'
        }),
        headers: {
          'content-type': 'application/json'
        }
      }
    );

    expect(createResponse.status).toBe(500);

    const brokenUpdateDatabase = await createTestDatabase();

    await importParks({
      database: brokenUpdateDatabase.database,
      expectedActiveCount: 1,
      now: () => '2026-05-01T09:00:00.000Z',
      sourceUrl: 'https://example.test/lipas-broken-update',
      fetchSource: async () => ({
        items: [createLipasPark()]
      })
    });

    const brokenUpdateApp = createApp({
      auth: authConfig,
      database: brokenUpdateDatabase.database
    });
    const { body: createdVisit } = await createVisit(
      brokenUpdateApp,
      'akasmannyn-kansallispuisto',
      {
        visitedOn: '2026-04-20'
      }
    );

    await brokenUpdateDatabase.dispose();

    const updateResponse = await requestAsAdmin(brokenUpdateApp, `/api/visits/${createdVisit.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        note: 'Should fail'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });

    expect(updateResponse.status).toBe(500);
  });

  it('supports visit workflows with private cache policy', async () => {
    const app = createAuthedApp();

    const createVisitResponse = await requestAsAdmin(
      app,
      '/api/parks/akasmannyn-kansallispuisto/visits',
      {
        method: 'POST',
        body: JSON.stringify({
          author: 'Hiker One',
          note: 'Windy but sunny.',
          route: 'North trail',
          visitedOn: '2026-04-20'
        }),
        headers: {
          'content-type': 'application/json'
        }
      }
    );
    const createdVisit = (await createVisitResponse.json()) as { id: number };

    expect(createVisitResponse.status).toBe(201);

    const patchVisitResponse = await requestAsAdmin(app, `/api/visits/${createdVisit.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        author: 'Hiker Two',
        note: 'Windy and bright.',
        route: 'South trail',
        visitedOn: '2026-04-21'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });

    expect(patchVisitResponse.status).toBe(200);

    const parkVisitsResponse = await app.request('/api/parks/akasmannyn-kansallispuisto/visits');
    const parkVisitsBody = (await parkVisitsResponse.json()) as {
      visitedSummary: {
        lastVisitedOn: string | null;
        visitCount: number;
        visited: boolean;
      };
      visits: Array<{
        author: string | null;
        note: string | null;
        route: string | null;
        visitedOn: string;
      }>;
    };
    const visitsResponse = await app.request('/api/visits');
    const visitsBody = (await visitsResponse.json()) as {
      visits: Array<{
        park: {
          name: string;
          slug: string;
        };
      }>;
    };
    const visitResponse = await app.request(`/api/visits/${createdVisit.id}`);
    const visitBody = (await visitResponse.json()) as {
      park: {
        name: string;
        slug: string;
      };
    };

    expect(parkVisitsResponse.status).toBe(200);
    expect(parkVisitsResponse.headers.get('cache-control')).toBe('private, no-store');
    expect(parkVisitsBody.visitedSummary).toEqual({
      lastVisitedOn: '2026-04-21',
      visitCount: 1,
      visited: true
    });
    expect(parkVisitsBody.visits[0]).toMatchObject({
      author: 'Hiker Two',
      note: 'Windy and bright.',
      route: 'South trail',
      visitedOn: '2026-04-21'
    });
    expect(visitsResponse.status).toBe(200);
    expect(visitsResponse.headers.get('cache-control')).toBe('private, no-store');
    expect(visitsBody.visits[0]).toMatchObject({
      park: {
        name: 'Äkäsmännyn kansallispuisto',
        slug: 'akasmannyn-kansallispuisto'
      }
    });
    expect(visitResponse.status).toBe(200);
    expect(visitResponse.headers.get('cache-control')).toBe('private, no-store');
    expect(visitBody.park).toEqual({
      name: 'Äkäsmännyn kansallispuisto',
      slug: 'akasmannyn-kansallispuisto'
    });

    const deleteResponse = await requestAsAdmin(app, `/api/visits/${createdVisit.id}`, {
      method: 'DELETE'
    });

    expect(deleteResponse.status).toBe(204);
    expect(deleteResponse.headers.get('cache-control')).toBe('private, no-store');
  });

  it('serves visit resources and returns 404s for missing resources', async () => {
    const app = createAuthedApp();

    const parkVisitsResponse = await app.request('/api/parks/akasmannyn-kansallispuisto/visits');
    const parkVisitsBody = (await parkVisitsResponse.json()) as {
      visits: unknown[];
      visitedSummary: {
        visited: boolean;
      };
    };
    const visitsResponse = await app.request('/api/visits');
    const visitsBody = (await visitsResponse.json()) as {
      visits: unknown[];
    };

    expect(parkVisitsResponse.status).toBe(200);
    expect(parkVisitsResponse.headers.get('cache-control')).toBe('private, no-store');
    expect(parkVisitsBody.visitedSummary).toEqual({
      visited: false,
      visitCount: 0,
      lastVisitedOn: null
    });
    expect(parkVisitsBody.visits).toEqual([]);
    expect(visitsResponse.status).toBe(200);
    expect(visitsResponse.headers.get('cache-control')).toBe('private, no-store');
    expect(visitsBody.visits).toEqual([]);

    const missingCatalog = await app.request('/api/parks/missing-park');
    const missingParkVisits = await app.request('/api/parks/missing-park/visits');
    const missingVisitCreate = await requestAsAdmin(app, '/api/parks/missing-park/visits', {
      method: 'POST',
      body: JSON.stringify({
        visitedOn: '2026-04-20'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const missingVisitGet = await app.request('/api/visits/99999');
    const missingVisitPatch = await requestAsAdmin(app, '/api/visits/99999', {
      method: 'PATCH',
      body: JSON.stringify({
        note: 'No visit'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const missingVisitDelete = await requestAsAdmin(app, '/api/visits/99999', {
      method: 'DELETE'
    });
    const missingTripCreate = await requestAsAdmin(app, '/api/trips/99999', {
      method: 'PATCH',
      body: JSON.stringify({
        name: 'Missing trip'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const missingTripDelete = await requestAsAdmin(app, '/api/trips/99999', {
      method: 'DELETE'
    });
    const missingTripAssignment = await requestAsAdmin(
      app,
      '/api/parks/akasmannyn-kansallispuisto/visits',
      {
        method: 'POST',
        body: JSON.stringify({
          tripId: 99999,
          visitedOn: '2026-04-20'
        }),
        headers: {
          'content-type': 'application/json'
        }
      }
    );
    const { body: visitForMissingTripUpdate } = await createVisit(
      app,
      'akasmannyn-kansallispuisto',
      {
        visitedOn: '2026-04-22'
      }
    );
    const missingTripUpdateAssignment = await requestAsAdmin(app, '/api/visits/99999', {
      method: 'PATCH',
      body: JSON.stringify({
        tripId: 99999
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const missingTripUpdateOnExistingVisit = await requestAsAdmin(
      app,
      `/api/visits/${visitForMissingTripUpdate.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          tripId: 99999
        }),
        headers: {
          'content-type': 'application/json'
        }
      }
    );

    expect(missingCatalog.status).toBe(404);
    expect(missingParkVisits.status).toBe(404);
    expect(missingVisitCreate.status).toBe(404);
    expect(missingVisitGet.status).toBe(404);
    expect(missingVisitPatch.status).toBe(404);
    expect(missingVisitDelete.status).toBe(404);
    expect(missingTripCreate.status).toBe(404);
    expect(missingTripDelete.status).toBe(404);
    expect(missingTripAssignment.status).toBe(404);
    expect(missingTripUpdateAssignment.status).toBe(404);
    expect(missingTripUpdateOnExistingVisit.status).toBe(404);
  });

  it('hides removed parks from catalog and visit responses', async () => {
    const app = createAuthedApp();
    const createVisitResponse = await requestAsAdmin(
      app,
      '/api/parks/akasmannyn-kansallispuisto/visits',
      {
        method: 'POST',
        body: JSON.stringify({
          visitedOn: '2026-04-20'
        }),
        headers: {
          'content-type': 'application/json'
        }
      }
    );
    const createdVisit = (await createVisitResponse.json()) as { id: number };

    await testDatabase.database
      .update(parks)
      .set({ removed: true })
      .where(eq(parks.slug, 'akasmannyn-kansallispuisto'));

    const publicListResponse = await app.request('/api/parks');
    const publicListBody = (await publicListResponse.json()) as {
      parks: Array<{ slug: string }>;
    };
    const publicDetailResponse = await app.request('/api/parks/akasmannyn-kansallispuisto');
    const parkVisitsResponse = await app.request('/api/parks/akasmannyn-kansallispuisto/visits');
    const visitsResponse = await app.request('/api/visits');
    const visitsBody = (await visitsResponse.json()) as {
      visits: Array<{ id: number }>;
    };
    const visitDetailResponse = await app.request(`/api/visits/${createdVisit.id}`);
    const createRemovedVisitResponse = await requestAsAdmin(
      app,
      '/api/parks/akasmannyn-kansallispuisto/visits',
      {
        method: 'POST',
        body: JSON.stringify({
          visitedOn: '2026-04-21'
        }),
        headers: {
          'content-type': 'application/json'
        }
      }
    );

    expect(publicListResponse.status).toBe(200);
    expect(publicListBody.parks).toHaveLength(3);
    expect(publicListBody.parks.map((park) => park.slug)).not.toContain(
      'akasmannyn-kansallispuisto'
    );
    expect(publicDetailResponse.status).toBe(404);
    expect(parkVisitsResponse.status).toBe(404);
    expect(visitsResponse.status).toBe(200);
    expect(visitsBody.visits).toEqual([]);
    expect(visitDetailResponse.status).toBe(404);
    expect(createRemovedVisitResponse.status).toBe(404);
  });

  it('shows removed park detail only to an authenticated admin session', async () => {
    await testDatabase.database
      .update(parks)
      .set({ removed: true })
      .where(eq(parks.slug, 'akasmannyn-kansallispuisto'));

    const app = createAuthedApp();
    const unauthorizedResponse = await app.request('/api/parks/akasmannyn-kansallispuisto');
    const invalidCookieResponse = await app.request('/api/parks/akasmannyn-kansallispuisto', {
      headers: {
        cookie: `${authConfig.cookieName}=invalid-token`
      }
    });
    const authorizedResponse = await requestAsAdmin(app, '/api/parks/akasmannyn-kansallispuisto');
    const authorizedBoundaryResponse = await requestAsAdmin(
      app,
      '/api/parks/akasmannyn-kansallispuisto?includeBoundary=true',
      {}
    );
    const authorizedBody = (await authorizedResponse.json()) as Record<string, unknown>;
    const authorizedBoundaryBody = (await authorizedBoundaryResponse.json()) as Record<
      string,
      unknown
    >;

    expect(unauthorizedResponse.status).toBe(404);
    expect(invalidCookieResponse.status).toBe(404);
    expect(authorizedResponse.status).toBe(200);
    expect(authorizedBoundaryResponse.status).toBe(200);
    expect(authorizedResponse.headers.get('cache-control')).toBe('private, no-store');
    expect(authorizedBody).toMatchObject({
      name: 'Äkäsmännyn kansallispuisto',
      slug: 'akasmannyn-kansallispuisto'
    });
    expect(authorizedBoundaryBody).toHaveProperty('boundaryGeoJson');
  });

  it('allows authenticated UI to disable and restore a park by slug', async () => {
    const app = createAuthedApp();

    const disableResponse = await requestAsAdmin(
      app,
      '/api/parks/akasmannyn-kansallispuisto/removed',
      {
        method: 'PATCH',
        body: JSON.stringify({
          removed: true
        }),
        headers: {
          'content-type': 'application/json'
        }
      }
    );

    expect(disableResponse.status).toBe(204);
    await expect(
      getParkBySlug(testDatabase.database, 'akasmannyn-kansallispuisto')
    ).resolves.toBeNull();

    const restoreResponse = await requestAsAdmin(
      app,
      '/api/parks/akasmannyn-kansallispuisto/removed',
      {
        method: 'PATCH',
        body: JSON.stringify({
          removed: false
        }),
        headers: {
          'content-type': 'application/json'
        }
      }
    );

    expect(restoreResponse.status).toBe(204);
    await expect(
      getParkBySlug(testDatabase.database, 'akasmannyn-kansallispuisto')
    ).resolves.toMatchObject({
      slug: 'akasmannyn-kansallispuisto'
    });

    const missingResponse = await requestAsAdmin(app, '/api/parks/missing-park/removed', {
      method: 'PATCH',
      body: JSON.stringify({
        removed: true
      }),
      headers: {
        'content-type': 'application/json'
      }
    });

    expect(missingResponse.status).toBe(404);
  });

  it('requires an admin session for park removal and visit mutations', async () => {
    const app = createAuthedApp();
    const { body: createdVisit } = await createVisit(app, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-04-20'
    });
    const { body: createdTrip } = await createTrip(app, {
      name: 'Valvottu retki'
    });
    await createVisit(app, 'akasmannyn-kansallispuisto', {
      tripId: createdTrip.id,
      visitedOn: '2026-04-20'
    });
    const { body: createdTripStop } = await createTripStop(app, createdTrip.id, {
      location: {
        coordinate: {
          lat: 60.1699,
          lon: 24.9384
        },
        label: 'Helsinki'
      },
      visitedOn: '2026-04-20'
    });

    const removeParkResponse = await app.request('/api/parks/akasmannyn-kansallispuisto/removed', {
      method: 'PATCH',
      body: JSON.stringify({
        removed: true
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const updateVisitResponse = await app.request(`/api/visits/${createdVisit.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        note: 'Unauthorized edit'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const deleteVisitResponse = await app.request(`/api/visits/${createdVisit.id}`, {
      method: 'DELETE'
    });
    const createTripResponse = await app.request('/api/trips', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Luvaton retki'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const updateTripResponse = await app.request(`/api/trips/${createdTrip.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: 'Unauthorized rename'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const deleteTripResponse = await app.request(`/api/trips/${createdTrip.id}`, {
      method: 'DELETE'
    });
    const createTripStopResponse = await app.request(`/api/trips/${createdTrip.id}/stops`, {
      method: 'POST',
      body: JSON.stringify({
        location: {
          coordinate: {
            lat: 61.3167,
            lon: 22.1333
          },
          label: 'ABC Huittinen'
        },
        visitedOn: '2026-04-20'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const updateTripStopResponse = await app.request(`/api/trip-stops/${createdTripStop.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        note: 'Unauthorized stop edit'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const deleteTripStopResponse = await app.request(`/api/trip-stops/${createdTripStop.id}`, {
      method: 'DELETE'
    });
    const removeParkBody = (await removeParkResponse.json()) as { error: string };
    const updateVisitBody = (await updateVisitResponse.json()) as { error: string };
    const deleteVisitBody = (await deleteVisitResponse.json()) as { error: string };
    const createTripBody = (await createTripResponse.json()) as { error: string };
    const updateTripBody = (await updateTripResponse.json()) as { error: string };
    const deleteTripBody = (await deleteTripResponse.json()) as { error: string };
    const createTripStopBody = (await createTripStopResponse.json()) as { error: string };
    const updateTripStopBody = (await updateTripStopResponse.json()) as { error: string };
    const deleteTripStopBody = (await deleteTripStopResponse.json()) as { error: string };

    expect(removeParkResponse.status).toBe(401);
    expect(removeParkBody.error).toBe('Unauthorized');
    expect(updateVisitResponse.status).toBe(401);
    expect(updateVisitBody.error).toBe('Unauthorized');
    expect(deleteVisitResponse.status).toBe(401);
    expect(deleteVisitBody.error).toBe('Unauthorized');
    expect(createTripResponse.status).toBe(401);
    expect(createTripBody.error).toBe('Unauthorized');
    expect(updateTripResponse.status).toBe(401);
    expect(updateTripBody.error).toBe('Unauthorized');
    expect(deleteTripResponse.status).toBe(401);
    expect(deleteTripBody.error).toBe('Unauthorized');
    expect(createTripStopResponse.status).toBe(401);
    expect(createTripStopBody.error).toBe('Unauthorized');
    expect(updateTripStopResponse.status).toBe(401);
    expect(updateTripStopBody.error).toBe('Unauthorized');
    expect(deleteTripStopResponse.status).toBe(401);
    expect(deleteTripStopBody.error).toBe('Unauthorized');
  });

  it('serves lightweight admin park visibility data for visible and removed parks', async () => {
    const app = createAuthedApp();

    const unauthorizedResponse = await app.request('/api/admin/parks/visibility');

    await requestAsAdmin(app, '/api/parks/akasmannyn-kansallispuisto/removed', {
      method: 'PATCH',
      body: JSON.stringify({
        removed: true
      }),
      headers: {
        'content-type': 'application/json'
      }
    });

    const response = await requestAsAdmin(app, '/api/admin/parks/visibility');
    const body = (await response.json()) as {
      removedParks: Array<Record<string, unknown>>;
      visibleParks: Array<Record<string, unknown>>;
    };

    expect(unauthorizedResponse.status).toBe(401);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(body.visibleParks).toHaveLength(3);
    expect(body.removedParks).toEqual([
      expect.objectContaining({
        address: 'Puistotie 1, 00999 Testikylä',
        boundingBox: {
          maxLat: 65,
          maxLon: 31,
          minLat: 60,
          minLon: 24
        },
        locationLabel: 'Puistotie 1',
        markerPoint: {
          lat: 62.5,
          lon: 27.5
        },
        name: 'Äkäsmännyn kansallispuisto',
        postalCode: '00999',
        postalOffice: 'Testikylä',
        slug: 'akasmannyn-kansallispuisto'
      })
    ]);
    expect(body.visibleParks.map((park) => park.slug)).not.toContain('akasmannyn-kansallispuisto');
    expect(body.visibleParks[0]).toHaveProperty('type');
    expect(body.visibleParks[0]).not.toHaveProperty('areaKm2');
    expect(body.visibleParks[0]).not.toHaveProperty('logo');
    expect(body.visibleParks[0]).not.toHaveProperty('parkUrl');
    expect(body.visibleParks[0]).not.toHaveProperty('map');
  });

  it('returns CORS headers for preflight requests on API routes', async () => {
    const app = createAuthedApp();
    const response = await app.request('/api/parks/akasmannyn-kansallispuisto/visits', {
      headers: {
        'access-control-request-headers': 'content-type',
        'access-control-request-method': 'POST',
        origin: authConfig.frontendUrl
      },
      method: 'OPTIONS'
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(authConfig.frontendUrl);
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
  });

  it('returns CORS headers for actual cross-origin API requests', async () => {
    const app = createAuthedApp();
    const response = await requestAsAdmin(app, '/api/parks/akasmannyn-kansallispuisto/visits', {
      body: JSON.stringify({ visitedOn: '2026-04-20' }),
      headers: {
        'content-type': 'application/json',
        origin: authConfig.frontendUrl
      },
      method: 'POST'
    });

    expect(response.status).toBe(201);
    expect(response.headers.get('access-control-allow-origin')).toBe(authConfig.frontendUrl);
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('returns CORS headers for catalog API routes', async () => {
    const app = createAuthedApp();
    const response = await app.request('/api/parks', {
      headers: {
        origin: authConfig.frontendUrl
      }
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(authConfig.frontendUrl);
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
  });
});
