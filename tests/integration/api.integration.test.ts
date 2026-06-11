import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const authConfig = {
  cookieName: '__session',
  frontendUrl: 'http://localhost:4300',
  googleClientId: 'test-google-client-id',
  googleClientSecret: 'test-google-client-secret',
  jwtSecret: 'test-jwt-secret-at-least-32-characters-long'
};

import { createApp } from '../../src/app.js';
import { getParkBySlug } from '../../src/db/repositories.js';
import { parks } from '../../src/db/schema.js';
import { createSessionToken } from '../../src/http/session.js';
import { importParks } from '../../src/importer/import-parks.js';
import { importSpecialParks } from '../../src/importer/import-special-parks.js';
import { createMemoryStorage } from '../../src/storage/memory-storage.js';
import { createLipasPark, createLipasTrail, parkTypeFixtures } from '../fixtures/lipas.js';
import { createTestDatabase } from '../helpers/test-db.js';

const createAdminSessionCookie = async () => {
  const token = await createSessionToken(
    {
      email: 'admin@example.com',
      name: 'Admin User',
      picture: 'https://example.com/photo.jpg',
      sub: 'google-user-id'
    },
    new TextEncoder().encode(authConfig.jwtSecret)
  );

  return `${authConfig.cookieName}=${token}`;
};

describe('API routes', () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    testDatabase = await createTestDatabase();

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

  const createVisit = async (
    app: ReturnType<typeof createApp>,
    slug: string,
    body: {
      author?: string;
      note?: string;
      route?: string;
      visitedOn: string;
    }
  ) => {
    const response = await app.request(`/api/parks/${slug}/visits`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json'
      }
    });

    return {
      body: (await response.json()) as { id: number },
      response
    };
  };

  it('serves the public park list without boundary geometry and with cache validators', async () => {
    const app = createApp({ database: testDatabase.database });
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
    const app = createApp({ database: testDatabase.database });
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
    expect(firstBody.parks[0]).not.toHaveProperty('luontoonUrl');
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
    const app = createApp({ database: testDatabase.database });

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

    const app = createApp({ database: testDatabase.database });
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

  it('filters manual factory villages by the normalized type slug', async () => {
    const { createSpecialParksSource } = await import('../fixtures/special-parks.js');
    await importSpecialParks({
      database: testDatabase.database,
      fetchSource: createSpecialParksSource(),
      now: () => '2026-05-01T10:00:00.000Z'
    });

    const app = createApp({ database: testDatabase.database });
    const response = await app.request('/api/parks?type=factory-village');
    const body = (await response.json()) as {
      parks: Array<Record<string, unknown>>;
    };

    expect(response.status).toBe(200);
    expect(body.parks.some((park) => park.slug === 'fiskarsin-ruukki')).toBe(true);
    expect(body.parks.some((park) => park.slug === 'verla')).toBe(true);
    expect(
      body.parks.every(
        (park) => park.type && (park.type as { slug: string }).slug === 'factory-village'
      )
    ).toBe(true);
  });

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

    const app = createApp({ database: testDatabase.database });
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

    const app = createApp({ database: testDatabase.database });
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
    const app = createApp({ database: testDatabase.database });
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
    const app = createApp({ database: testDatabase.database });
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
    const app = createApp({ database: testDatabase.database });
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
    const app = createApp({ auth: authConfig, database: testDatabase.database });
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
    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const sessionCookie = await createAdminSessionCookie();

    const response = await app.request('/api/parks/akasmannyn-kansallispuisto', {
      method: 'PATCH',
      body: JSON.stringify({
        areaKm2: 14.75,
        displayTypeName: 'Ystävyyden puisto',
        establishmentYear: 1990,
        locationLabel: 'Korjattu puistotie 9',
        luontoonUrl: '/fi/kohteet/korjattu-puisto',
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
      luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/korjattu-puisto',
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
      luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/korjattu-puisto',
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

    const app = createApp({ auth: authConfig, database: testDatabase.database });
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
        luontoonUrl: 'bad url'
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

    const app = createApp({ database: testDatabase.database });
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
    const app = createApp({ database: testDatabase.database });

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
    const app = createApp({ database: testDatabase.database });
    const response = await app.request(
      '/api/parks/akasmannyn-kansallispuisto?includeBoundary=false'
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).not.toHaveProperty('boundaryGeoJson');
  });

  it('filters the public park list by type slug', async () => {
    const app = createApp({ database: testDatabase.database });
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

  it('serves lightweight public home summary data with shared-cache validators', async () => {
    const app = createApp({ database: testDatabase.database });

    await createVisit(app, 'akasmannyn-kansallispuisto', {
      author: 'Hiker One',
      note: 'Keep private note out of public summary.',
      route: 'North trail',
      visitedOn: '2026-04-20'
    });
    await createVisit(app, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-04-22'
    });
    await createVisit(app, 'seitsemisen-kansallispuisto', {
      visitedOn: '2026-04-21'
    });

    const response = await app.request('/api/public/home-summary');
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
    const app = createApp({ database: testDatabase.database });

    await createVisit(app, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-04-22'
    });
    await createVisit(app, 'seitsemisen-kansallispuisto', {
      visitedOn: '2026-04-10'
    });

    const response = await app.request('/api/public/home-summary');
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

    const app = createApp({ database: testDatabase.database });
    await createVisit(app, 'testin-luontopolku', {
      visitedOn: '2026-05-01'
    });

    const response = await app.request('/api/public/home-summary');
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

  it('aggregates hiking and wilderness parks under one public category while keeping separate types', async () => {
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

    const app = createApp({ database: testDatabase.database });
    await createVisit(app, 'pisavaaran-retkeilyalue', {
      visitedOn: '2026-05-01'
    });
    await createVisit(app, 'muotkatunturin-eramaa-alue', {
      visitedOn: '2026-05-02'
    });

    const response = await app.request('/api/public/home-summary');
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

  it('serves lightweight public map summary data with per-park visited summaries', async () => {
    const app = createApp({ database: testDatabase.database });

    await createVisit(app, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-04-20'
    });

    const response = await app.request('/api/public/map-summary');
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

  it('returns 304 for matching public map summary ETags', async () => {
    const app = createApp({ database: testDatabase.database });
    const firstResponse = await app.request('/api/public/map-summary');
    const etag = firstResponse.headers.get('etag');

    expect(etag).toBeTruthy();

    const cachedResponse = await app.request('/api/public/map-summary', {
      headers: {
        'if-none-match': etag ?? ''
      }
    });

    expect(cachedResponse.status).toBe(304);
  });

  it('returns 304 for matching public summary ETags and changes them when public visit data changes', async () => {
    const app = createApp({ database: testDatabase.database });

    const firstResponse = await app.request('/api/public/home-summary');
    const firstEtag = firstResponse.headers.get('etag');
    const firstBody = (await firstResponse.json()) as {
      version: number;
    };
    const cachedResponse = await app.request('/api/public/home-summary', {
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

    const secondResponse = await app.request('/api/public/home-summary');
    const secondEtag = secondResponse.headers.get('etag');
    const secondBody = (await secondResponse.json()) as {
      version: number;
    };

    expect(secondEtag).toBeTruthy();
    expect(secondEtag).not.toBe(firstEtag);
    expect(secondBody.version).toBeGreaterThan(firstBody.version);

    await app.request(`/api/visits/${createdVisit.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        visitedOn: '2026-04-21'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });

    const thirdResponse = await app.request('/api/public/home-summary');
    const thirdEtag = thirdResponse.headers.get('etag');
    const thirdBody = (await thirdResponse.json()) as {
      version: number;
    };

    expect(thirdEtag).toBeTruthy();
    expect(thirdEtag).not.toBe(secondEtag);
    expect(thirdBody.version).toBeGreaterThan(secondBody.version);

    await app.request(`/api/visits/${createdVisit.id}`, {
      method: 'DELETE'
    });

    const fourthResponse = await app.request('/api/public/home-summary');
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

  it('supports visit workflows with private cache policy', async () => {
    const app = createApp({ database: testDatabase.database });

    const createVisitResponse = await app.request('/api/parks/akasmannyn-kansallispuisto/visits', {
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
    });
    const createdVisit = (await createVisitResponse.json()) as { id: number };

    expect(createVisitResponse.status).toBe(201);

    const patchVisitResponse = await app.request(`/api/visits/${createdVisit.id}`, {
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

    const deleteResponse = await app.request(`/api/visits/${createdVisit.id}`, {
      method: 'DELETE'
    });

    expect(deleteResponse.status).toBe(204);
    expect(deleteResponse.headers.get('cache-control')).toBe('private, no-store');
  });

  it('serves visit resources and returns 404s for missing resources', async () => {
    const app = createApp({ database: testDatabase.database });

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
    const missingVisitCreate = await app.request('/api/parks/missing-park/visits', {
      method: 'POST',
      body: JSON.stringify({
        visitedOn: '2026-04-20'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const missingVisitGet = await app.request('/api/visits/99999');
    const missingVisitPatch = await app.request('/api/visits/99999', {
      method: 'PATCH',
      body: JSON.stringify({
        note: 'No visit'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const missingVisitDelete = await app.request('/api/visits/99999', {
      method: 'DELETE'
    });

    expect(missingCatalog.status).toBe(404);
    expect(missingParkVisits.status).toBe(404);
    expect(missingVisitCreate.status).toBe(404);
    expect(missingVisitGet.status).toBe(404);
    expect(missingVisitPatch.status).toBe(404);
    expect(missingVisitDelete.status).toBe(404);
  });

  it('hides removed parks from catalog and visit responses', async () => {
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
    const createRemovedVisitResponse = await app.request(
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

    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const unauthorizedResponse = await app.request('/api/parks/akasmannyn-kansallispuisto');
    const invalidCookieResponse = await app.request('/api/parks/akasmannyn-kansallispuisto', {
      headers: {
        cookie: `${authConfig.cookieName}=invalid-token`
      }
    });
    const authorizedResponse = await app.request('/api/parks/akasmannyn-kansallispuisto', {
      headers: {
        cookie: await createAdminSessionCookie()
      }
    });
    const authorizedBoundaryResponse = await app.request(
      '/api/parks/akasmannyn-kansallispuisto?includeBoundary=true',
      {
        headers: {
          cookie: await createAdminSessionCookie()
        }
      }
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
    const app = createApp({ database: testDatabase.database });

    const disableResponse = await app.request('/api/parks/akasmannyn-kansallispuisto/removed', {
      method: 'PATCH',
      body: JSON.stringify({
        removed: true
      }),
      headers: {
        'content-type': 'application/json'
      }
    });

    expect(disableResponse.status).toBe(204);
    await expect(
      getParkBySlug(testDatabase.database, 'akasmannyn-kansallispuisto')
    ).resolves.toBeNull();

    const restoreResponse = await app.request('/api/parks/akasmannyn-kansallispuisto/removed', {
      method: 'PATCH',
      body: JSON.stringify({
        removed: false
      }),
      headers: {
        'content-type': 'application/json'
      }
    });

    expect(restoreResponse.status).toBe(204);
    await expect(
      getParkBySlug(testDatabase.database, 'akasmannyn-kansallispuisto')
    ).resolves.toMatchObject({
      slug: 'akasmannyn-kansallispuisto'
    });

    const missingResponse = await app.request('/api/parks/missing-park/removed', {
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

  it('lists removed parks for admin restore usage', async () => {
    const app = createApp({ database: testDatabase.database });

    await app.request('/api/parks/akasmannyn-kansallispuisto/removed', {
      method: 'PATCH',
      body: JSON.stringify({
        removed: true
      }),
      headers: {
        'content-type': 'application/json'
      }
    });

    const response = await app.request('/api/parks/removed');
    const body = (await response.json()) as {
      parks: Array<{
        catalogStatus: 'active' | 'inactive';
        name: string;
        removed: true;
        slug: string;
      }>;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(body.parks).toEqual([
      expect.objectContaining({
        address: 'Puistotie 1, 00999 Testikylä',
        catalogStatus: 'active',
        locationLabel: 'Puistotie 1',
        name: 'Äkäsmännyn kansallispuisto',
        postalCode: '00999',
        postalOffice: 'Testikylä',
        removed: true,
        slug: 'akasmannyn-kansallispuisto'
      })
    ]);
    expect(body.parks[0]).not.toHaveProperty('location');
  });

  it('serves lightweight admin park visibility data for visible and removed parks', async () => {
    const app = createApp({ database: testDatabase.database });

    await app.request('/api/parks/akasmannyn-kansallispuisto/removed', {
      method: 'PATCH',
      body: JSON.stringify({
        removed: true
      }),
      headers: {
        'content-type': 'application/json'
      }
    });

    const response = await app.request('/api/admin/parks/visibility');
    const body = (await response.json()) as {
      removedParks: Array<Record<string, unknown>>;
      visibleParks: Array<Record<string, unknown>>;
    };

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
    expect(body.visibleParks[0]).not.toHaveProperty('luontoonUrl');
    expect(body.visibleParks[0]).not.toHaveProperty('map');
  });

  it('returns CORS headers for preflight requests on API routes', async () => {
    const app = createApp({ auth: authConfig, database: testDatabase.database });
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
    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const response = await app.request('/api/parks/akasmannyn-kansallispuisto/visits', {
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
    const app = createApp({ auth: authConfig, database: testDatabase.database });
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
