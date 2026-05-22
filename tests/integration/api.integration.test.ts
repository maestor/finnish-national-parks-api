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

  it('supports personal visit workflows with private cache policy', async () => {
    const app = createApp({ database: testDatabase.database });

    const createVisitResponse = await app.request(
      '/api/me/parks/akasmannyn-kansallispuisto/visits',
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

    const patchVisitResponse = await app.request(`/api/me/visits/${createdVisit.id}`, {
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

    const personalResponse = await app.request('/api/me/parks/akasmannyn-kansallispuisto');
    const personalBody = (await personalResponse.json()) as {
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

    expect(personalResponse.status).toBe(200);
    expect(personalResponse.headers.get('cache-control')).toBe('private, no-store');
    expect(personalBody.visitedSummary).toEqual({
      lastVisitedOn: '2026-04-21',
      visitCount: 1,
      visited: true
    });
    expect(personalBody.visits[0]).toMatchObject({
      author: 'Hiker Two',
      note: 'Windy and bright.',
      route: 'South trail',
      visitedOn: '2026-04-21'
    });

    const deleteResponse = await app.request(`/api/me/visits/${createdVisit.id}`, {
      method: 'DELETE'
    });

    expect(deleteResponse.status).toBe(204);
    expect(deleteResponse.headers.get('cache-control')).toBe('private, no-store');
  });

  it('serves personal park lists and returns 404s for missing resources', async () => {
    const app = createApp({ database: testDatabase.database });

    const listResponse = await app.request('/api/me/parks');
    const listBody = (await listResponse.json()) as {
      parks: Array<{
        visits: unknown[];
      }>;
    };

    expect(listResponse.status).toBe(200);
    expect(listResponse.headers.get('cache-control')).toBe('private, no-store');
    expect(listBody.parks).toHaveLength(4);
    expect(listBody.parks[0]?.visits).toEqual([]);

    const missingCatalog = await app.request('/api/parks/missing-park');
    const missingPersonal = await app.request('/api/me/parks/missing-park');
    const missingVisit = await app.request('/api/me/parks/missing-park/visits', {
      method: 'POST',
      body: JSON.stringify({
        visitedOn: '2026-04-20'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const missingVisitPatch = await app.request('/api/me/visits/99999', {
      method: 'PATCH',
      body: JSON.stringify({
        note: 'No visit'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const missingVisitDelete = await app.request('/api/me/visits/99999', {
      method: 'DELETE'
    });

    expect(missingCatalog.status).toBe(404);
    expect(missingPersonal.status).toBe(404);
    expect(missingVisit.status).toBe(404);
    expect(missingVisitPatch.status).toBe(404);
    expect(missingVisitDelete.status).toBe(404);
  });

  it('hides removed parks from catalog and personal park endpoints', async () => {
    await testDatabase.database
      .update(parks)
      .set({ removed: true })
      .where(eq(parks.slug, 'akasmannyn-kansallispuisto'));

    const app = createApp({ database: testDatabase.database });
    const publicListResponse = await app.request('/api/parks');
    const publicListBody = (await publicListResponse.json()) as {
      parks: Array<{ slug: string }>;
    };
    const publicDetailResponse = await app.request('/api/parks/akasmannyn-kansallispuisto');
    const personalListResponse = await app.request('/api/me/parks');
    const personalListBody = (await personalListResponse.json()) as {
      parks: Array<{ slug: string }>;
    };
    const personalDetailResponse = await app.request('/api/me/parks/akasmannyn-kansallispuisto');
    const createVisitResponse = await app.request(
      '/api/me/parks/akasmannyn-kansallispuisto/visits',
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

    expect(publicListResponse.status).toBe(200);
    expect(publicListBody.parks).toHaveLength(3);
    expect(publicListBody.parks.map((park) => park.slug)).not.toContain(
      'akasmannyn-kansallispuisto'
    );
    expect(publicDetailResponse.status).toBe(404);
    expect(personalListResponse.status).toBe(200);
    expect(personalListBody.parks).toHaveLength(3);
    expect(personalListBody.parks.map((park) => park.slug)).not.toContain(
      'akasmannyn-kansallispuisto'
    );
    expect(personalDetailResponse.status).toBe(404);
    expect(createVisitResponse.status).toBe(404);
  });

  it('allows authenticated UI to disable and restore a park by slug', async () => {
    const app = createApp({ database: testDatabase.database });

    const disableResponse = await app.request('/api/me/parks/akasmannyn-kansallispuisto/removed', {
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

    const restoreResponse = await app.request('/api/me/parks/akasmannyn-kansallispuisto/removed', {
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

    const missingResponse = await app.request('/api/me/parks/missing-park/removed', {
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

  it('returns CORS headers for preflight requests on API routes', async () => {
    const app = createApp({ auth: authConfig, database: testDatabase.database });
    const response = await app.request('/api/me/parks/akasmannyn-kansallispuisto/visits', {
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
    const response = await app.request('/api/me/parks/akasmannyn-kansallispuisto/visits', {
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
