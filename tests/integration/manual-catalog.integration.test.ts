import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getParkBySlug, listParks } from '../../src/db/repositories.js';
import { parks } from '../../src/db/schema.js';
import { importMerenkurkkuWorldHeritage } from '../../src/importer/import-merenkurkku-world-heritage.js';
import { importParks } from '../../src/importer/import-parks.js';
import { createLipasPark } from '../fixtures/lipas.js';
import { createTestDatabase } from '../helpers/test-db.js';

const createWorldHeritageSource = () => ({
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
        Nimi: 'Merenkurkun saaristo B',
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
            [20.6, 62.9],
            [20.6, 63.6],
            [21.3, 63.6],
            [21.3, 62.9],
            [20.6, 62.9]
          ]
        ],
        type: 'Polygon'
      },
      properties: {
        ID: 898,
        Nimi: 'Merenkurkun saaristo suojavyöhyke',
        URL: 'https://example.test/merenkurkku',
        aluetyyppi: 'Suoja-alue'
      },
      type: 'Feature'
    },
    {
      geometry: {
        coordinates: [
          [
            [24.0, 60.1],
            [24.0, 60.2],
            [24.1, 60.2],
            [24.1, 60.1],
            [24.0, 60.1]
          ]
        ],
        type: 'Polygon'
      },
      properties: {
        ID: 583,
        Nimi: 'Suomenlinna',
        URL: 'https://example.test/suomenlinna',
        aluetyyppi: 'Kohde'
      },
      type: 'Feature'
    }
  ]
});

describe('manual catalog imports', () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    testDatabase = await createTestDatabase();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await testDatabase.dispose();
  });

  it('imports Merenkurkku as a protected non-LIPAS-managed catalog park', async () => {
    await importMerenkurkkuWorldHeritage({
      database: testDatabase.database,
      fetchSource: async () => createWorldHeritageSource(),
      now: () => '2026-05-26T08:00:00.000Z',
      sourceUrl: 'https://example.test/world-heritage'
    });

    const park = await getParkBySlug(testDatabase.database, 'merenkurkun-maailmanperintoalue');
    const rawPark = await testDatabase.database.query.parks.findFirst({
      where: eq(parks.slug, 'merenkurkun-maailmanperintoalue')
    });

    expect(park).toMatchObject({
      displayTypeName: 'Maailmanperintökohde',
      lipasId: 9000898,
      location: 'Raippaluodontie 2, 65800 Raippaluoto',
      luontoonUrl: 'https://www.luontoon.fi/fi/kohteet/merenkurkun-maailmanperintoalue',
      name: 'Merenkurkun maailmanperintöalue',
      type: {
        slug: 'other-nature-reserve'
      }
    });
    expect(park?.boundaryGeoJson).toMatchObject({
      features: [{ geometry: { type: 'Polygon' } }, { geometry: { type: 'Polygon' } }],
      type: 'FeatureCollection'
    });
    expect(rawPark).toMatchObject({
      displayTypeName: 'Maailmanperintökohde',
      managedByLipasImport: false,
      postalCode: '65800',
      postalOffice: 'Raippaluoto'
    });
  });

  it('keeps non-LIPAS-managed parks active when a later LIPAS import deactivates managed rows', async () => {
    await importMerenkurkkuWorldHeritage({
      database: testDatabase.database,
      fetchSource: async () => createWorldHeritageSource(),
      now: () => '2026-05-26T08:00:00.000Z',
      sourceUrl: 'https://example.test/world-heritage'
    });

    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 0,
      now: () => '2026-05-27T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark({
            status: 'incorrect-data'
          })
        ]
      })
    });

    const parksAfterImport = await listParks(testDatabase.database);
    const merenkurkku = await getParkBySlug(
      testDatabase.database,
      'merenkurkun-maailmanperintoalue'
    );

    expect(parksAfterImport).toHaveLength(1);
    expect(merenkurkku).toMatchObject({
      catalogStatus: 'active',
      displayTypeName: 'Maailmanperintökohde',
      slug: 'merenkurkun-maailmanperintoalue'
    });
  });

  it('fails loudly when the official world heritage fetch returns a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503
      })
    );

    await expect(
      importMerenkurkkuWorldHeritage({
        database: testDatabase.database
      })
    ).rejects.toThrow('Merenkurkku world heritage import failed with status 503.');
  });

  it('fails when the source payload has no matching Merenkurkku area features', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({ features: [] }),
        ok: true
      })
    );

    await expect(
      importMerenkurkkuWorldHeritage({
        database: testDatabase.database
      })
    ).rejects.toThrow('No Merenkurkku world heritage area features were found in the source.');
  });

  it('supports the default fetch path used by the CLI importer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({
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
        ok: true
      })
    );

    const result = await importMerenkurkkuWorldHeritage({
      database: testDatabase.database
    });
    const park = await getParkBySlug(testDatabase.database, 'merenkurkun-maailmanperintoalue');

    expect(result.featureCount).toBe(2);
    expect(result.importedAt).toBeTruthy();
    expect(park).toMatchObject({
      displayTypeName: 'Maailmanperintökohde',
      slug: 'merenkurkun-maailmanperintoalue'
    });
  });

  it('sorts Merenkurkku polygons predictably even when some source names are missing', async () => {
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
              Nimi: 'Merenkurkun saaristo B',
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
              URL: 'https://example.test/merenkurkku',
              aluetyyppi: 'Kohde'
            },
            type: 'Feature'
          }
        ]
      }),
      now: () => '2026-05-26T08:00:00.000Z',
      sourceUrl: 'https://example.test/world-heritage'
    });

    const park = await getParkBySlug(testDatabase.database, 'merenkurkun-maailmanperintoalue');
    const boundaryFeatures = (
      park?.boundaryGeoJson as
        | { features: Array<{ geometry: { coordinates: number[][][] } }> }
        | undefined
    )?.features;

    expect(park?.boundaryGeoJson?.type).toBe('FeatureCollection');
    expect(boundaryFeatures?.[0]?.geometry.coordinates[0]?.[0]).toEqual([20.7, 63.3]);
    expect(boundaryFeatures?.[1]?.geometry.coordinates[0]?.[0]).toEqual([21.0, 63.0]);
  });
});
