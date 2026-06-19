import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createVisit,
  getParkBySlug,
  getParkVisitsBySlug,
  listParks
} from '../../src/db/repositories.js';
import { importRuns, parks } from '../../src/db/schema.js';
import { importParks } from '../../src/importer/import-parks.js';
import {
  createLipasHikingTrail,
  createLipasPark,
  createLipasTrail,
  createLipasWalkingTrail,
  parkTypeFixtures
} from '../fixtures/lipas.js';
import { createTestDatabase } from '../helpers/test-db.js';

const emptyLuontoonSitemap = async () =>
  '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>';

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
    ).rejects.toThrow('Expected 41 active LIPAS records but received 1.');
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
    const parkVisits = await getParkVisitsBySlug(
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
    expect(parkVisits).toMatchObject({
      visitedSummary: {
        visitCount: 1,
        visited: true,
        lastVisitedOn: '2026-04-10'
      }
    });
    expect(parkVisits?.visits).toHaveLength(1);
    expect(parkVisits?.visits[0]).toMatchObject({
      author: 'Alice',
      note: 'Snowy trail.',
      route: 'North loop',
      visitedOn: '2026-04-10'
    });
    expect(parks).toHaveLength(1);
  });

  it('preserves manually edited park details across re-imports', async () => {
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
      .set({
        areaKm2: 99.9,
        displayTypeName: 'Oma kohdelaji',
        establishmentYear: 2001,
        locationLabel: 'Oma osoite 7',
        parkUrl: null,
        name: 'Oma puistonimi',
        postalCode: '99870',
        postalOffice: 'Inari',
        slug: 'oma-puistonimi'
      })
      .where(eq(parks.slug, 'akasmannyn-kansallispuisto'));

    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 1,
      now: () => '2026-05-02T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark({
            location: {
              address: 'Tuotu tie 2',
              'postal-code': '00100',
              'postal-office': 'Helsinki'
            },
            name: 'Tuotu puistonimi',
            properties: {
              'area-km2': 13.75
            },
            www: 'https://www.luontoon.fi/tuotu-puisto',
            'construction-year': 1988
          })
        ]
      })
    });

    await expect(getParkBySlug(testDatabase.database, 'oma-puistonimi')).resolves.toMatchObject({
      address: 'Oma osoite 7, 99870 Inari',
      areaKm2: 99.9,
      displayTypeName: 'Oma kohdelaji',
      establishmentYear: 2001,
      locationLabel: 'Oma osoite 7',
      parkUrl: null,
      name: 'Oma puistonimi',
      postalCode: '99870',
      postalOffice: 'Inari',
      slug: 'oma-puistonimi'
    });
  });

  it('falls back to the current slug when importedSlug is missing on an existing row', async () => {
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
      .set({
        importedSlug: null,
        slug: 'legacy-custom-slug'
      })
      .where(eq(parks.lipasId, 12345));

    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 1,
      now: () => '2026-05-02T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [createLipasPark()]
      })
    });

    await expect(getParkBySlug(testDatabase.database, 'legacy-custom-slug')).resolves.toMatchObject(
      {
        slug: 'legacy-custom-slug'
      }
    );
  });

  it('imports hiking trails as removed catalog entries', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 2,
      now: () => '2026-05-01T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark(),
          createLipasHikingTrail({
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

    const rawPark = await testDatabase.database.query.parks.findFirst({
      where: eq(parks.slug, 'testin-retkeilyreitti')
    });

    expect(rawPark).toMatchObject({
      name: 'Testin retkeilyreitti',
      removed: true,
      catalogStatus: 'active'
    });
    await expect(getParkBySlug(testDatabase.database, 'testin-retkeilyreitti')).resolves.toBeNull();
  });

  it('preserves removed hiking trails across re-imports', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 1,
      now: () => '2026-05-01T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasHikingTrail({
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

    await testDatabase.database
      .update(parks)
      .set({ removed: false })
      .where(eq(parks.slug, 'testin-retkeilyreitti'));

    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 1,
      now: () => '2026-05-02T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasHikingTrail({
            name: 'Testin retkeilyreitti uudistettu',
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

    const rawPark = await testDatabase.database.query.parks.findFirst({
      where: eq(parks.slug, 'testin-retkeilyreitti')
    });

    expect(rawPark).toMatchObject({
      name: 'Testin retkeilyreitti uudistettu',
      removed: false
    });
  });

  it('imports walking trails as removed catalog entries', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 2,
      now: () => '2026-05-01T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark(),
          createLipasWalkingTrail({
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

    const rawPark = await testDatabase.database.query.parks.findFirst({
      where: eq(parks.slug, 'testin-ulkoilureitti')
    });

    expect(rawPark).toMatchObject({
      name: 'Testin ulkoilureitti',
      removed: true,
      catalogStatus: 'active'
    });
    await expect(getParkBySlug(testDatabase.database, 'testin-ulkoilureitti')).resolves.toBeNull();
  });

  it('skips hiking trails that are fully inside an imported area', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 2,
      now: () => '2026-05-01T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [createLipasPark(), createLipasHikingTrail()]
      })
    });

    await expect(getParkBySlug(testDatabase.database, 'testin-retkeilyreitti')).resolves.toBeNull();
    await expect(listParks(testDatabase.database)).resolves.toHaveLength(1);
  });

  it('skips walking trails when any route point overlaps an imported area', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 2,
      now: () => '2026-05-01T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark(),
          createLipasWalkingTrail({
            location: {
              geometries: {
                type: 'FeatureCollection',
                features: [
                  {
                    type: 'Feature',
                    geometry: {
                      type: 'LineString',
                      coordinates: [
                        [23.5, 59.5],
                        [24.5, 60.5],
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

    await expect(getParkBySlug(testDatabase.database, 'testin-ulkoilureitti')).resolves.toBeNull();
    await expect(listParks(testDatabase.database)).resolves.toHaveLength(1);
  });

  it('skips hiking trails whose location label and postal fields match an imported area', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 2,
      now: () => '2026-05-01T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark(),
          createLipasHikingTrail({
            location: {
              address: 'Puistotie 1',
              'postal-code': '00999',
              'postal-office': 'Testikylä',
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

    await expect(getParkBySlug(testDatabase.database, 'testin-retkeilyreitti')).resolves.toBeNull();
    await expect(listParks(testDatabase.database)).resolves.toHaveLength(1);
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
      getParkVisitsBySlug(testDatabase.database, 'akasmannyn-kansallispuisto', async () => '')
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

  it('imports standalone nature trails as catalog places', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 2,
      now: () => '2026-05-01T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark(),
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

    const trail = await getParkBySlug(testDatabase.database, 'testin-luontopolku');

    expect(trail).toMatchObject({
      lipasId: 440401,
      name: 'Testin luontopolku',
      postalOffice: 'Testikylä',
      type: {
        code: parkTypeFixtures.natureTrail.typeCode,
        id: parkTypeFixtures.natureTrail.typeCode,
        name: parkTypeFixtures.natureTrail.name,
        slug: parkTypeFixtures.natureTrail.slug
      }
    });
  });

  it('skips nature trails that are fully inside an imported area', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 2,
      now: () => '2026-05-01T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [createLipasPark(), createLipasTrail()]
      })
    });

    await expect(getParkBySlug(testDatabase.database, 'testin-luontopolku')).resolves.toBeNull();
    await expect(listParks(testDatabase.database)).resolves.toHaveLength(1);
  });

  it('skips nature trails whose location label and postal fields match an imported area', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 2,
      now: () => '2026-05-01T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark(),
          createLipasTrail({
            location: {
              address: 'Puistotie 1',
              'postal-code': '00999',
              'postal-office': 'Testikylä',
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

    await expect(getParkBySlug(testDatabase.database, 'testin-luontopolku')).resolves.toBeNull();
    await expect(listParks(testDatabase.database)).resolves.toHaveLength(1);
  });

  it('does not apply metadata-match skipping when one location field is missing', async () => {
    const trail = createLipasTrail({
      location: {
        address: 'Puistotie 1',
        'postal-code': '00999',
        'postal-office': 'Testikylä',
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
    });
    delete trail.location['postal-code'];

    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 2,
      now: () => '2026-05-01T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [createLipasPark(), trail]
      })
    });

    await expect(getParkBySlug(testDatabase.database, 'testin-luontopolku')).resolves.toMatchObject(
      {
        lipasId: 440401
      }
    );
    await expect(listParks(testDatabase.database)).resolves.toHaveLength(2);
  });

  it('prefers official luontoon sitemap urls over stale lipas www values', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 2,
      now: () => '2026-05-01T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark({
            'lipas-id': 72648,
            name: 'Aittovuoren ulkoilualue',
            type: {
              'type-code': parkTypeFixtures.outdoorRecreationArea.typeCode
            },
            www: 'https://www.luontoon.fi/aittovuoren-ulkoilualue'
          }),
          createLipasPark({
            'lipas-id': 61234,
            name: 'Langinkosken luonnonsuojelualue',
            type: {
              'type-code': parkTypeFixtures.otherNatureReserve.typeCode
            },
            www: 'https://www.luontoon.fi/langinkoski'
          })
        ]
      }),
      fetchLuontoonSitemap: async () => `
        <?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url>
            <loc>https://www.luontoon.fi/fi/kohteet/aittovuoren-ulkoilualue-jyvaskyla-72648</loc>
          </url>
          <url>
            <loc>https://www.luontoon.fi/fi/kohteet/langinkosken-luonnonsuojelualue</loc>
          </url>
        </urlset>
      `
    });

    await expect(
      getParkBySlug(testDatabase.database, 'aittovuoren-ulkoilualue')
    ).resolves.toMatchObject({
      parkUrl: 'https://www.luontoon.fi/fi/kohteet/aittovuoren-ulkoilualue-jyvaskyla-72648'
    });
    await expect(
      getParkBySlug(testDatabase.database, 'langinkosken-luonnonsuojelualue')
    ).resolves.toMatchObject({
      parkUrl: 'https://www.luontoon.fi/fi/kohteet/langinkosken-luonnonsuojelualue'
    });
  });

  it('falls back to normalized lipas www when the luontoon sitemap has no match', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 1,
      now: () => '2026-05-01T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark({
            'lipas-id': 71000,
            name: 'Tuntematon ulkoilualue',
            type: {
              'type-code': parkTypeFixtures.outdoorRecreationArea.typeCode
            },
            www: 'https://www.luontoon.fi/tuntematon-ulkoilualue'
          })
        ]
      }),
      fetchLuontoonSitemap: async () => `
        <?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url>
            <loc>https://www.luontoon.fi/fi/kohteet/jokin-toinen-kohde-12345</loc>
          </url>
        </urlset>
      `
    });

    await expect(
      getParkBySlug(testDatabase.database, 'tuntematon-ulkoilualue')
    ).resolves.toMatchObject({
      parkUrl: 'https://www.luontoon.fi/tuntematon-ulkoilualue'
    });
  });

  it('uses canonical Luontoon destination slugs for wilderness areas even when the local slug still ends with -alue', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 1,
      now: () => '2026-05-01T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark({
            'lipas-id': 81234,
            name: 'Hammastunturin erämaa-alue',
            type: {
              'type-code': parkTypeFixtures.wildernessArea.typeCode
            },
            www: 'https://www.luontoon.fi/hammastunturin-eramaa-alue'
          })
        ]
      }),
      fetchLuontoonSitemap: async () => `
        <?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url>
            <loc>https://www.luontoon.fi/fi/kohteet/hammastunturin-eramaa</loc>
          </url>
        </urlset>
      `
    });

    await expect(
      getParkBySlug(testDatabase.database, 'hammastunturin-eramaa-alue')
    ).resolves.toMatchObject({
      parkUrl: 'https://www.luontoon.fi/fi/kohteet/hammastunturin-eramaa'
    });
  });

  it('prefers official luontoon route urls over stale lipas www values for nature trails', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 2,
      now: () => '2026-05-01T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark({
            location: {
              geometries: {
                type: 'FeatureCollection',
                features: [
                  {
                    type: 'Feature',
                    geometry: {
                      type: 'Polygon',
                      coordinates: [
                        [
                          [10.0, 70.0],
                          [11.0, 70.0],
                          [11.0, 71.0],
                          [10.0, 71.0],
                          [10.0, 70.0]
                        ]
                      ]
                    }
                  }
                ]
              }
            }
          }),
          createLipasTrail({
            'lipas-id': 527072,
            name: 'Finnoon luontopolku',
            www: 'https://www.luontoon.fi/finnoon-luontopolku',
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
      }),
      fetchLuontoonSitemap: async () => `
        <?xml version="1.0" encoding="UTF-8"?>
        <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
          <url>
            <loc>https://www.luontoon.fi/fi/reitit/finnoon-luontopolku-espoo-527072</loc>
          </url>
          <url>
            <loc>https://www.luontoon.fi/fi/kohteet/finnoonlahti-espoo-123456/reitit</loc>
          </url>
        </urlset>
      `
    });

    await expect(
      getParkBySlug(testDatabase.database, 'finnoon-luontopolku')
    ).resolves.toMatchObject({
      parkUrl: 'https://www.luontoon.fi/fi/reitit/finnoon-luontopolku-espoo-527072'
    });
  });

  it('uses the generic hiking-area type with a Valtion retkeilyalue display label for type 109 imports', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 1,
      now: () => '2026-05-01T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark({
            name: 'Testin retkeilyalue',
            type: {
              'type-code': parkTypeFixtures.stateHikingArea.typeCode
            }
          })
        ]
      })
    });

    await expect(
      getParkBySlug(testDatabase.database, 'testin-retkeilyalue')
    ).resolves.toMatchObject({
      displayTypeName: 'Valtion retkeilyalue',
      type: {
        name: 'Retkeilyalue',
        slug: 'hiking-area'
      }
    });
  });

  it('promotes non-109 retkeilyalue names into hiking-area without the Valtion retkeilyalue display label', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 2,
      now: () => '2026-05-01T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark({
            name: 'Kaupungin retkeilyalue',
            type: {
              'type-code': parkTypeFixtures.outdoorRecreationArea.typeCode
            }
          }),
          createLipasPark({
            'lipas-id': 22346,
            name: 'Suojeltu retkeilyalue',
            type: {
              'type-code': parkTypeFixtures.otherNatureReserve.typeCode
            }
          })
        ]
      })
    });

    await expect(
      getParkBySlug(testDatabase.database, 'kaupungin-retkeilyalue')
    ).resolves.toMatchObject({
      type: {
        name: 'Retkeilyalue',
        slug: 'hiking-area'
      }
    });
    await expect(
      getParkBySlug(testDatabase.database, 'suojeltu-retkeilyalue')
    ).resolves.toMatchObject({
      type: {
        name: 'Retkeilyalue',
        slug: 'hiking-area'
      }
    });

    const promotedOutdoor = await testDatabase.database.query.parks.findFirst({
      where: eq(parks.slug, 'kaupungin-retkeilyalue')
    });
    const promotedReserve = await testDatabase.database.query.parks.findFirst({
      where: eq(parks.slug, 'suojeltu-retkeilyalue')
    });

    expect(promotedOutdoor?.displayTypeName).toBeNull();
    expect(promotedReserve?.displayTypeName).toBeNull();
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
        new Response(
          '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>',
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

  it('fails when the default luontoon sitemap fetch returns a non-ok response', async () => {
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
        new Response('broken sitemap', {
          status: 503
        })
      ) as typeof fetch;

    try {
      await expect(
        importParks({
          database: testDatabase.database,
          expectedActiveCount: 1,
          sourceUrl: 'https://example.test/lipas'
        })
      ).rejects.toThrow('Luontoon sitemap fetch failed with status 503.');
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
        fetchLuontoonSitemap: emptyLuontoonSitemap,
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
          fetchLuontoonSitemap: emptyLuontoonSitemap,
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
        fetchLuontoonSitemap: emptyLuontoonSitemap,
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
