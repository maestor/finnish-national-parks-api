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
import { importMerenkurkkuWorldHeritage } from '../../src/importer/import-merenkurkku-world-heritage.js';
import { importParks } from '../../src/importer/import-parks.js';
import { createMemoryStorage } from '../../src/storage/memory-storage.js';
import { createLipasPark, createLipasTrail, parkTypeFixtures } from '../fixtures/lipas.js';
import { createTestDatabase } from '../helpers/test-db.js';

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
    expect(body.parks[0]).not.toHaveProperty('locationLabel');
    expect(body.parks[0]).toHaveProperty('type');
    expect(body.parks[0]).toHaveProperty('location');
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
    await importMerenkurkkuWorldHeritage({
      database: testDatabase.database,
      fetchSource: async () => ({
        features: [
          {
            geometry: {
              coordinates: [
                [
                  [21.0, 63.0],
                  [21.0, 63.2],
                  [21.2, 63.2],
                  [21.2, 63.0],
                  [21.0, 63.0]
                ]
              ],
              type: 'Polygon'
            },
            properties: {
              ID: 898,
              Nimi: 'Merenkurkun saaristo A',
              URL: 'https://example.test/merenkurkku',
              aluetyyppi: 'Kohde'
            },
            type: 'Feature'
          },
          {
            geometry: {
              coordinates: [
                [
                  [20.7, 63.3],
                  [20.7, 63.5],
                  [21.1, 63.5],
                  [21.1, 63.3],
                  [20.7, 63.3]
                ]
              ],
              type: 'Polygon'
            },
            properties: {
              ID: 898,
              Nimi: 'Merenkurkun saaristo B',
              URL: 'https://example.test/merenkurkku',
              aluetyyppi: 'Kohde'
            },
            type: 'Feature'
          }
        ]
      }),
      now: () => '2026-05-01T10:00:00.000Z',
      sourceUrl: 'https://example.test/world-heritage'
    });

    const app = createApp({ database: testDatabase.database });
    const listResponse = await app.request('/api/parks?type=other-nature-reserve');
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
      displayTypeName: 'Maailmanperintökohde',
      location: 'Raippaluodontie 2, 65800 Raippaluoto',
      slug: 'merenkurkun-maailmanperintoalue',
      type: {
        slug: 'other-nature-reserve'
      }
    });
    expect(detailBody).toMatchObject({
      displayTypeName: 'Maailmanperintökohde',
      slug: 'merenkurkun-maailmanperintoalue'
    });
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
    expect(summaryBody).not.toHaveProperty('locationLabel');
    expect(summaryBody).toHaveProperty('location', 'Puistotie 1, 00999 Testikylä');
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

  it('normalizes API location values when postal fields duplicate or replace the address', async () => {
    const app = createApp({ database: testDatabase.database });

    await testDatabase.database
      .update(parks)
      .set({ postalOffice: 'Puistotie 1' })
      .where(eq(parks.slug, 'akasmannyn-kansallispuisto'));

    const duplicatedResponse = await app.request('/api/parks/akasmannyn-kansallispuisto');
    const duplicatedBody = (await duplicatedResponse.json()) as Record<string, unknown>;

    expect(duplicatedBody).toHaveProperty('location', 'Puistotie 1, 00999');

    await testDatabase.database
      .update(parks)
      .set({ locationLabel: '', postalOffice: 'Testikylä' })
      .where(eq(parks.slug, 'akasmannyn-kansallispuisto'));

    const postalOnlyResponse = await app.request('/api/parks/akasmannyn-kansallispuisto');
    const postalOnlyBody = (await postalOnlyResponse.json()) as Record<string, unknown>;

    expect(postalOnlyBody).toHaveProperty('location', '00999 Testikylä');
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
      progressByType: Array<{
        totalParks: number;
        totalVisits: number;
        type: { slug: string };
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
    expect(akasmanty).toHaveProperty('location', 'Puistotie 1, 00999 Testikylä');
    expect(akasmanty).not.toHaveProperty('locationLabel');
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
        catalogStatus: 'active',
        location: 'Puistotie 1, 00999 Testikylä',
        name: 'Äkäsmännyn kansallispuisto',
        removed: true,
        slug: 'akasmannyn-kansallispuisto'
      })
    ]);
    expect(body.parks[0]).not.toHaveProperty('locationLabel');
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
