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
import { importParks } from '../../src/importer/import-parks.js';
import { createLipasPark, parkTypeFixtures } from '../fixtures/lipas.js';
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
    expect(body.parks[0]).toHaveProperty('type');
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
      totalVisits: number;
      uniqueVisitedParks: number;
      updatedAt: string | null;
      version: number;
    };

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400'
    );
    expect(response.headers.get('etag')).toBeTruthy();
    expect(body.totalVisits).toBe(3);
    expect(body.uniqueVisitedParks).toBe(2);
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
      'akasmannyn-kansallispuisto',
      'seitsemisen-kansallispuisto',
      'akasmannyn-kansallispuisto'
    ]);
    expect(body.latestVisitEntries[0]).not.toHaveProperty('note');
    expect(body.latestVisitEntries[0]).not.toHaveProperty('route');
    expect(body.latestVisitEntries[0]).not.toHaveProperty('images');
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
    expect(response.headers.get('cache-control')).toBe(
      'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400'
    );
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
        name: 'Äkäsmännyn kansallispuisto',
        removed: true,
        slug: 'akasmannyn-kansallispuisto'
      })
    ]);
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
