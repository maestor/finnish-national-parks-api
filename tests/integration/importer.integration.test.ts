import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createVisit,
  getParkBySlug,
  getPersonalParkBySlug,
  listParks
} from '../../src/db/repositories.js';
import { importRuns, parks } from '../../src/db/schema.js';
import { importParks } from '../../src/importer/import-parks.js';
import { createLipasPark, parkTypeFixtures } from '../fixtures/lipas.js';
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

  it('updates catalog rows without deleting personal visit data', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 1,
      now: () => '2026-05-01T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [createLipasPark()]
      })
    });

    await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      author: 'Alice',
      note: 'Snowy trail.',
      route: 'North loop',
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
    const personalPark = await getPersonalParkBySlug(
      testDatabase.database,
      'akasmannyn-kansallispuisto',
      async () => ''
    );
    const parks = await listParks(testDatabase.database);

    expect(park).toMatchObject({
      name: 'Äkäsmännyn kansallispuisto uudistettu',
      areaKm2: 13.75,
      catalogStatus: 'active',
      type: {
        code: parkTypeFixtures.nationalPark.typeCode,
        name: parkTypeFixtures.nationalPark.name,
        slug: parkTypeFixtures.nationalPark.slug
      }
    });
    expect(personalPark).toMatchObject({
      visitedSummary: {
        visitCount: 1,
        visited: true,
        lastVisitedOn: '2026-04-10'
      }
    });
    expect(personalPark?.visits).toHaveLength(1);
    expect(personalPark?.visits[0]).toMatchObject({
      author: 'Alice',
      note: 'Snowy trail.',
      route: 'North loop',
      visitedOn: '2026-04-10'
    });
    expect(parks).toHaveLength(1);
  });

  it('preserves manually removed parks across imports', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 1,
      now: () => '2026-05-01T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [createLipasPark()]
      })
    });

    await testDatabase.database
      .update(parks)
      .set({ removed: true })
      .where(eq(parks.slug, 'akasmannyn-kansallispuisto'));

    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 1,
      now: () => '2026-05-02T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark({
            name: 'Äkäsmännyn kansallispuisto uudistettu'
          })
        ]
      })
    });

    const rawPark = await testDatabase.database.query.parks.findFirst({
      where: eq(parks.slug, 'akasmannyn-kansallispuisto')
    });

    expect(rawPark).toMatchObject({
      name: 'Äkäsmännyn kansallispuisto uudistettu',
      removed: true
    });
    await expect(
      getParkBySlug(testDatabase.database, 'akasmannyn-kansallispuisto')
    ).resolves.toBeNull();
    await expect(
      getPersonalParkBySlug(testDatabase.database, 'akasmannyn-kansallispuisto', async () => '')
    ).resolves.toBeNull();
    await expect(listParks(testDatabase.database)).resolves.toEqual([]);
  });

  it('reuses existing slugs, deduplicates new slugs, and can mark all parks inactive', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 2,
      now: () => '2026-05-01T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark(),
          createLipasPark({
            'lipas-id': 12346
          })
        ]
      })
    });

    const duplicateSlugPark = await getParkBySlug(
      testDatabase.database,
      'akasmannyn-kansallispuisto-12346'
    );
    expect(duplicateSlugPark?.lipasId).toBe(12346);

    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 0,
      now: () => '2026-05-02T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark({
            status: 'incorrect-data'
          })
        ]
      })
    });

    const originalPark = await getParkBySlug(testDatabase.database, 'akasmannyn-kansallispuisto');
    expect(originalPark?.catalogStatus).toBe('inactive');
    await expect(listParks(testDatabase.database)).resolves.toEqual([]);
  });

  it('imports supported protected-area types and persists normalized type metadata', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 4,
      now: () => '2026-05-01T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark(),
          createLipasPark({
            'lipas-id': 21000,
            name: 'Kaupunkilaakson ulkoilualue',
            type: {
              'type-code': parkTypeFixtures.outdoorRecreationArea.typeCode
            },
            www: 'https://www.luontoon.fi/kaupunkilaakso'
          }),
          createLipasPark({
            'lipas-id': 21001,
            name: 'Evon retkeilyalue',
            type: {
              'type-code': parkTypeFixtures.stateHikingArea.typeCode
            },
            www: 'https://www.luontoon.fi/evo'
          }),
          createLipasPark({
            'lipas-id': 21002,
            name: 'Koljatti',
            type: {
              'type-code': parkTypeFixtures.otherNatureReserve.typeCode
            },
            www: 'https://www.luontoon.fi/koljatti'
          })
        ]
      })
    });

    const parks = await listParks(testDatabase.database);

    expect(parks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Kaupunkilaakson ulkoilualue',
          type: {
            code: parkTypeFixtures.outdoorRecreationArea.typeCode,
            id: parkTypeFixtures.outdoorRecreationArea.typeCode,
            name: parkTypeFixtures.outdoorRecreationArea.name,
            slug: parkTypeFixtures.outdoorRecreationArea.slug
          }
        }),
        expect.objectContaining({
          name: 'Äkäsmännyn kansallispuisto',
          type: {
            code: parkTypeFixtures.nationalPark.typeCode,
            id: parkTypeFixtures.nationalPark.typeCode,
            name: parkTypeFixtures.nationalPark.name,
            slug: parkTypeFixtures.nationalPark.slug
          }
        }),
        expect.objectContaining({
          name: 'Evon retkeilyalue',
          type: {
            code: parkTypeFixtures.stateHikingArea.typeCode,
            id: parkTypeFixtures.stateHikingArea.typeCode,
            name: parkTypeFixtures.stateHikingArea.name,
            slug: parkTypeFixtures.stateHikingArea.slug
          }
        }),
        expect.objectContaining({
          name: 'Koljatti',
          type: {
            code: parkTypeFixtures.otherNatureReserve.typeCode,
            id: parkTypeFixtures.otherNatureReserve.typeCode,
            name: parkTypeFixtures.otherNatureReserve.name,
            slug: parkTypeFixtures.otherNatureReserve.slug
          }
        })
      ])
    );
  });

  it('uses the default fetcher and surfaces upstream failures', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [createLipasPark()]
          }),
          {
            status: 200
          }
        )
      )
      .mockResolvedValueOnce(
        new Response('nope', {
          status: 503
        })
      ) as typeof fetch;

    try {
      await importParks({
        database: testDatabase.database,
        expectedActiveCount: 1,
        sourceUrl: 'https://example.test/lipas'
      });

      await expect(
        importParks({
          database: testDatabase.database,
          expectedActiveCount: 1,
          sourceUrl: 'https://example.test/lipas'
        })
      ).rejects.toThrow('LIPAS import failed with status 503.');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('collects all pages from the default fetcher when the source spans multiple pages', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              createLipasPark({
                'lipas-id': 30001
              })
            ],
            pagination: {
              'current-page': 1,
              'page-size': 100,
              'total-items': 2,
              'total-pages': 2
            }
          }),
          {
            status: 200
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              createLipasPark({
                'lipas-id': 30002,
                name: 'Toinen sivu'
              })
            ],
            pagination: {
              'current-page': 2,
              'page-size': 100,
              'total-items': 2,
              'total-pages': 2
            }
          }),
          {
            status: 200
          }
        )
      ) as typeof fetch;

    try {
      await importParks({
        database: testDatabase.database,
        expectedActiveCount: 2,
        sourceUrl: 'https://example.test/lipas?page=1&page-size=100'
      });

      await expect(listParks(testDatabase.database)).resolves.toHaveLength(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('surfaces later-page fetch failures from the default fetcher', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [createLipasPark()],
            pagination: {
              'current-page': 1,
              'page-size': 100,
              'total-items': 2,
              'total-pages': 2
            }
          }),
          {
            status: 200
          }
        )
      )
      .mockResolvedValueOnce(
        new Response('broken second page', {
          status: 502
        })
      ) as typeof fetch;

    try {
      await expect(
        importParks({
          database: testDatabase.database,
          expectedActiveCount: 2,
          sourceUrl: 'https://example.test/lipas?page=1&page-size=100'
        })
      ).rejects.toThrow('LIPAS import failed with status 502 on page 2.');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('falls back to combined item counts when pagination metadata is missing on later pages', async () => {
    const originalFetch = globalThis.fetch;

    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [createLipasPark()],
            pagination: {
              'current-page': 1,
              'page-size': 100,
              'total-items': 2,
              'total-pages': 2
            }
          }),
          {
            status: 200
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              createLipasPark({
                'lipas-id': 30003,
                name: 'Kolmas sivu'
              })
            ]
          }),
          {
            status: 200
          }
        )
      ) as typeof fetch;

    try {
      const result = await importParks({
        database: testDatabase.database,
        expectedActiveCount: 2,
        sourceUrl: 'https://example.test/lipas?page=1&page-size=100'
      });

      expect(result.activeCount).toBe(2);
      await expect(listParks(testDatabase.database)).resolves.toHaveLength(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rolls back all catalog changes on mid-import failure', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 2,
      now: () => '2026-05-01T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark(),
          createLipasPark({
            'lipas-id': 99998,
            name: 'Toinen puisto'
          })
        ]
      })
    });

    const parksBefore = await listParks(testDatabase.database);
    const runsBefore = await testDatabase.database.select().from(importRuns);

    await expect(
      importParks({
        database: testDatabase.database,
        expectedActiveCount: 2,
        now: () => '2026-05-02T08:00:00.000Z',
        sourceUrl: 'https://example.test/lipas',
        fetchSource: async () => ({
          items: [
            createLipasPark({
              name: 'Päivitetty nimi'
            }),
            createLipasPark({
              'lipas-id': 99998,
              name: 'Päivitetty toinen'
            })
          ]
        }),
        beforeEachUpsert: (index) => {
          if (index === 1) {
            throw new Error('Simulated mid-import failure.');
          }
        }
      })
    ).rejects.toThrow('Simulated mid-import failure.');

    const parksAfter = await listParks(testDatabase.database);
    const runsAfter = await testDatabase.database.select().from(importRuns);

    expect(parksAfter).toEqual(parksBefore);
    expect(runsAfter).toEqual(runsBefore);
  });
});
