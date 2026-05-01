import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createVisit, getParkBySlug, getPersonalParkBySlug, listParks, putParkNote } from '../../src/db/repositories.js';
import { importParks } from '../../src/importer/import-parks.js';
import { createLipasPark } from '../fixtures/lipas.js';
import { createTestDatabase } from '../helpers/test-db.js';

describe('importParks', () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    testDatabase = await createTestDatabase();
  });

  afterEach(async () => {
    await testDatabase.dispose();
  });

  it('imports only active parks and rejects unexpected active counts', async () => {
    await expect(
      importParks({
        database: testDatabase.database,
        expectedActiveCount: 41,
        now: () => '2026-05-01T08:00:00.000Z',
        sourceUrl: 'https://example.test/lipas',
        fetchSource: async () => ({
          items: [
            createLipasPark(),
            createLipasPark({
              'lipas-id': 99999,
              name: 'Virheellinen kohde',
              status: 'incorrect-data'
            })
          ]
        })
      })
    ).rejects.toThrow('Expected 41 active parks but received 1.');
  });

  it('updates catalog rows without deleting personal note or visit data', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 1,
      now: () => '2026-05-01T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [createLipasPark()]
      })
    });

    await putParkNote(testDatabase.database, 'akasmannyn-kansallispuisto', 'Bring coffee.');
    await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      note: 'Snowy trail.',
      visitedOn: '2026-04-10'
    });

    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 1,
      now: () => '2026-05-02T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark({
            name: 'Äkäsmännyn kansallispuisto uudistettu',
            properties: {
              'area-km2': 13.75
            }
          })
        ]
      })
    });

    const park = await getParkBySlug(testDatabase.database, 'akasmannyn-kansallispuisto');
    const personalPark = await getPersonalParkBySlug(testDatabase.database, 'akasmannyn-kansallispuisto');
    const parks = await listParks(testDatabase.database);

    expect(park).toMatchObject({
      name: 'Äkäsmännyn kansallispuisto uudistettu',
      areaKm2: 13.75,
      catalogStatus: 'active'
    });
    expect(personalPark).toMatchObject({
      note: {
        note: 'Bring coffee.'
      },
      visitedSummary: {
        visitCount: 1,
        visited: true,
        lastVisitedOn: '2026-04-10'
      }
    });
    expect(personalPark?.visits).toHaveLength(1);
    expect(parks).toHaveLength(1);
  });
});
