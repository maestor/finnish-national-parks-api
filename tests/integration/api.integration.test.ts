import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../src/app.js';
import { importParks } from '../../src/importer/import-parks.js';
import { createLipasPark } from '../fixtures/lipas.js';
import { createTestDatabase } from '../helpers/test-db.js';

describe('API routes', () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    testDatabase = await createTestDatabase();

    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 2,
      now: () => '2026-05-01T09:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark(),
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
    expect(body.parks).toHaveLength(2);
    expect(body.parks[0]).not.toHaveProperty('boundaryGeoJson');
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
      expectedActiveCount: 2,
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
    const response = await app.request('/api/parks/akasmannyn-kansallispuisto?includeBoundary=true');
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
    expect(cachedResponse.status).toBe(304);
  });

  it('supports personal note and visit workflows with private cache policy', async () => {
    const app = createApp({ database: testDatabase.database });

    const noteResponse = await app.request('/api/me/parks/akasmannyn-kansallispuisto/note', {
      method: 'PUT',
      body: JSON.stringify({
        note: 'Pack lunch.'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });

    expect(noteResponse.status).toBe(200);
    expect(noteResponse.headers.get('cache-control')).toBe('private, no-store');

    const createVisitResponse = await app.request('/api/me/parks/akasmannyn-kansallispuisto/visits', {
      method: 'POST',
      body: JSON.stringify({
        note: 'Windy but sunny.',
        visitedOn: '2026-04-20'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const createdVisit = (await createVisitResponse.json()) as { id: number };

    expect(createVisitResponse.status).toBe(201);

    const patchVisitResponse = await app.request(`/api/me/visits/${createdVisit.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        note: 'Windy and bright.',
        visitedOn: '2026-04-21'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });

    expect(patchVisitResponse.status).toBe(200);

    const personalResponse = await app.request('/api/me/parks/akasmannyn-kansallispuisto');
    const personalBody = (await personalResponse.json()) as {
      note: { note: string } | null;
      visitedSummary: {
        lastVisitedOn: string | null;
        visitCount: number;
        visited: boolean;
      };
      visits: Array<{
        note: string | null;
        visitedOn: string;
      }>;
    };

    expect(personalResponse.status).toBe(200);
    expect(personalResponse.headers.get('cache-control')).toBe('private, no-store');
    expect(personalBody.note).toEqual({
      note: 'Pack lunch.',
      updatedAt: expect.any(String)
    });
    expect(personalBody.visitedSummary).toEqual({
      lastVisitedOn: '2026-04-21',
      visitCount: 1,
      visited: true
    });
    expect(personalBody.visits[0]).toMatchObject({
      note: 'Windy and bright.',
      visitedOn: '2026-04-21'
    });

    const deleteResponse = await app.request(`/api/me/visits/${createdVisit.id}`, {
      method: 'DELETE'
    });

    expect(deleteResponse.status).toBe(204);
    expect(deleteResponse.headers.get('cache-control')).toBe('private, no-store');

    const clearNoteResponse = await app.request('/api/me/parks/akasmannyn-kansallispuisto/note', {
      method: 'PUT',
      body: JSON.stringify({
        note: '   '
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
    const clearedNoteBody = (await clearNoteResponse.json()) as {
      note: null;
    };

    expect(clearNoteResponse.status).toBe(200);
    expect(clearedNoteBody.note).toBeNull();
  });

  it('serves personal park lists and returns 404s for missing resources', async () => {
    const app = createApp({ database: testDatabase.database });

    const listResponse = await app.request('/api/me/parks');
    const listBody = (await listResponse.json()) as {
      parks: Array<{
        note: null;
        visits: unknown[];
      }>;
    };

    expect(listResponse.status).toBe(200);
    expect(listResponse.headers.get('cache-control')).toBe('private, no-store');
    expect(listBody.parks).toHaveLength(2);
    expect(listBody.parks[0]?.note).toBeNull();
    expect(listBody.parks[0]?.visits).toEqual([]);

    const missingCatalog = await app.request('/api/parks/missing-park');
    const missingPersonal = await app.request('/api/me/parks/missing-park');
    const missingNote = await app.request('/api/me/parks/missing-park/note', {
      method: 'PUT',
      body: JSON.stringify({
        note: 'Missing'
      }),
      headers: {
        'content-type': 'application/json'
      }
    });
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
    expect(missingNote.status).toBe(404);
    expect(missingVisit.status).toBe(404);
    expect(missingVisitPatch.status).toBe(404);
    expect(missingVisitDelete.status).toBe(404);
  });
});
