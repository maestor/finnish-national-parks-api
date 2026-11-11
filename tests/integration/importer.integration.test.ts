import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createVisit,
  getParkBySlug,
  getParkVisitsBySlug,
  listParks,
  updateParkRemoved
} from '../../src/db/repositories.js';
import { importRuns, parks, trailAreaLinks } from '../../src/db/schema.js';
import { importParks } from '../../src/importer/import-parks.js';
import {
  createLipasHikingTrail,
  createLipasPark,
  createLipasTrail,
  createLipasWalkingTrail,
  parkTypeFixtures
} from '../fixtures/lipas.js';
import { importPublishedParkFixtures } from '../helpers/import-published-park-fixtures.js';
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

  it('imports and refreshes a trail length, retaining a local override', async () => {
    const run = async (length: number | undefined) =>
      importPublishedParkFixtures({
        database: testDatabase.database,
        sourceUrl: 'https://example.test/lipas',
        fetchSource: async () => ({
          items: [
            {
              ...createLipasTrail(),
              properties: length === undefined ? {} : { 'route-length-km': length }
            }
          ]
        })
      });
    await run(2.4);
    const [trail] = await testDatabase.database.select().from(parks);
    expect(trail?.lengthKm).toBe(2.4);
    await run(3.1);
    expect((await testDatabase.database.select().from(parks))[0]?.lengthKm).toBe(3.1);
    await run(undefined);
    expect((await testDatabase.database.select().from(parks))[0]?.lengthKm).toBeNull();
    await run(3.1);
    await testDatabase.database.update(parks).set({ lengthKm: 4 }).where(eq(parks.id, trail!.id));
    await run(undefined);
    expect((await testDatabase.database.select().from(parks))[0]).toMatchObject({
      lengthKm: 4,
      importedLengthKm: null
    });
  });

  it('imports active rows without blocking on source count drift and reports newly added parks', async () => {
    const result = await importParks({
      database: testDatabase.database,
      now: () => '2026-05-02T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark(),
          createLipasPark({
            'lipas-id': 99999,
            location: {
              address: 'Uusi polku 2',
              'postal-code': '33100',
              'postal-office': 'Tampere'
            },
            name: 'Uusi luontopolku',
            type: {
              'type-code': parkTypeFixtures.natureTrail.typeCode
            }
          }),
          createLipasPark({
            'lipas-id': 100000,
            name: 'Virheellinen kohde',
            status: 'incorrect-data'
          })
        ]
      })
    });

    const parks = await listParks(testDatabase.database);

    expect(result.sourceActiveCount).toBe(2);
    expect(result.activeCount).toBe(2);
    expect(result.newParks).toEqual([
      {
        lipasId: 12345,
        name: 'Äkäsmännyn kansallispuisto',
        removed: true,
        slug: 'akasmannyn-kansallispuisto',
        typeCode: parkTypeFixtures.nationalPark.typeCode,
        typeName: parkTypeFixtures.nationalPark.name
      },
      {
        lipasId: 99999,
        name: 'Uusi luontopolku',
        removed: true,
        slug: 'uusi-luontopolku',
        typeCode: parkTypeFixtures.natureTrail.typeCode,
        typeName: parkTypeFixtures.natureTrail.name
      }
    ]);
    expect(parks).toHaveLength(0);
  });

  it('can import newly discovered parks as removed until an admin explicitly enables them', async () => {
    await importPublishedParkFixtures({
      database: testDatabase.database,
      now: () => '2026-05-01T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [createLipasPark()]
      })
    });

    const result = await importParks({
      database: testDatabase.database,
      now: () => '2026-05-02T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark(),
          createLipasPark({
            'lipas-id': 99999,
            location: {
              address: 'Uusi puistotie 2',
              'postal-code': '33100',
              'postal-office': 'Tampere'
            },
            name: 'Uusi kansallispuisto'
          })
        ]
      })
    });

    const newPark = await testDatabase.database.query.parks.findFirst({
      where: eq(parks.lipasId, 99999)
    });
    const visibleParks = await listParks(testDatabase.database);

    expect(result.newParks).toEqual([
      {
        lipasId: 99999,
        name: 'Uusi kansallispuisto',
        removed: true,
        slug: 'uusi-kansallispuisto',
        typeCode: parkTypeFixtures.nationalPark.typeCode,
        typeName: parkTypeFixtures.nationalPark.name
      }
    ]);
    expect(newPark).toMatchObject({
      name: 'Uusi kansallispuisto',
      removed: true
    });
    expect(visibleParks).toHaveLength(1);
    expect(visibleParks[0]).toMatchObject({
      slug: 'akasmannyn-kansallispuisto'
    });
  });

  it('supports dry-run previews without persisting imported parks or import runs', async () => {
    const runsBefore = await testDatabase.database.select().from(importRuns);

    const result = await importParks({
      database: testDatabase.database,
      dryRun: true,
      now: () => '2026-05-02T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark(),
          createLipasPark({
            'lipas-id': 99999,
            location: {
              address: 'Kuivaharjuntie 4',
              'postal-code': '33500',
              'postal-office': 'Tampere'
            },
            name: 'Kuivaharjun kansallispuisto'
          })
        ]
      })
    });

    const runsAfter = await testDatabase.database.select().from(importRuns);
    const parksAfter = await listParks(testDatabase.database);

    expect(result).toMatchObject({
      activeCount: 2,
      dryRun: true,
      importRunId: null,
      sourceActiveCount: 2
    });
    expect(result.newParks).toEqual([
      {
        lipasId: 12345,
        name: 'Äkäsmännyn kansallispuisto',
        removed: true,
        slug: 'akasmannyn-kansallispuisto',
        typeCode: parkTypeFixtures.nationalPark.typeCode,
        typeName: parkTypeFixtures.nationalPark.name
      },
      {
        lipasId: 99999,
        name: 'Kuivaharjun kansallispuisto',
        removed: true,
        slug: 'kuivaharjun-kansallispuisto',
        typeCode: parkTypeFixtures.nationalPark.typeCode,
        typeName: parkTypeFixtures.nationalPark.name
      }
    ]);
    expect(runsAfter).toEqual(runsBefore);
    expect(parksAfter).toEqual([]);
  });

  it('updates catalog rows without deleting personal visit data', async () => {
    await importPublishedParkFixtures({
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
      status: 'published',
      visitedOn: '2026-04-10'
    });

    await importPublishedParkFixtures({
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
    await importPublishedParkFixtures({
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
        description: '**Oma kuvaus**\n\nSäilyy tuonnissa.',
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

    await importPublishedParkFixtures({
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
      description: '**Oma kuvaus**\n\nSäilyy tuonnissa.',
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

  it('preserves a manually overridden park marker point across re-imports', async () => {
    await importPublishedParkFixtures({
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
        markerLat: 60.3141,
        markerLon: 24.2718
      })
      .where(eq(parks.slug, 'akasmannyn-kansallispuisto'));

    await importPublishedParkFixtures({
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
            }
          })
        ]
      })
    });

    await expect(
      getParkBySlug(testDatabase.database, 'akasmannyn-kansallispuisto')
    ).resolves.toMatchObject({
      markerPoint: {
        lat: 60.3141,
        lon: 24.2718
      }
    });
  });

  it('falls back to the current slug when importedSlug is missing on an existing row', async () => {
    await importPublishedParkFixtures({
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

    await importPublishedParkFixtures({
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

  it('retains a source-active nested trail disabled and records its area relationship', async () => {
    const source = [
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
                    [24.5, 60.5],
                    [25, 61]
                  ]
                }
              }
            ]
          }
        }
      })
    ];
    const options = {
      database: testDatabase.database,
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({ items: source })
    };
    await importParks(options);
    const firstTrail = await testDatabase.database.query.parks.findFirst({
      where: eq(parks.lipasId, createLipasHikingTrail()['lipas-id'])
    });
    expect(firstTrail).toMatchObject({
      removed: true,
      catalogStatus: 'active',
      trailPublicationRole: 'area_member'
    });
    await testDatabase.database
      .update(parks)
      .set({ removed: false })
      .where(eq(parks.id, firstTrail!.id));
    await expect(getParkBySlug(testDatabase.database, firstTrail!.slug)).resolves.toBeNull();
    const links = await testDatabase.database.select().from(trailAreaLinks);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ trailId: firstTrail?.id, automaticMatch: true });
    await importParks(options);
    expect(await testDatabase.database.select().from(trailAreaLinks)).toHaveLength(1);
    expect(
      (await testDatabase.database.query.parks.findFirst({ where: eq(parks.id, firstTrail!.id) }))
        ?.id
    ).toBe(firstTrail?.id);
    const inactiveSource = [source[0]!, { ...source[1]!, status: 'inactive' }];
    await importParks({ ...options, fetchSource: async () => ({ items: inactiveSource }) });
    const inactive = await testDatabase.database.query.parks.findFirst({
      where: eq(parks.id, firstTrail!.id)
    });
    expect(inactive).toMatchObject({
      catalogStatus: 'inactive',
      removed: false,
      trailPublicationRole: 'area_member'
    });
    expect(await testDatabase.database.select().from(trailAreaLinks)).toHaveLength(0);
    await expect(getParkBySlug(testDatabase.database, firstTrail!.slug)).resolves.toBeNull();
    await importParks(options);
    const restored = await testDatabase.database.query.parks.findFirst({
      where: eq(parks.id, firstTrail!.id)
    });
    expect(restored).toMatchObject({
      catalogStatus: 'active',
      removed: false,
      trailPublicationRole: 'area_member'
    });
    expect((await testDatabase.database.select().from(trailAreaLinks))[0]?.automaticMatch).toBe(
      true
    );
  });

  it('keeps a geographically separate hiking trail independent', async () => {
    await importPublishedParkFixtures({
      database: testDatabase.database,
      expectedActiveCount: 2,
      now: () => '2026-05-01T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [createLipasPark(), createLipasHikingTrail()]
      })
    });

    await expect(
      getParkBySlug(testDatabase.database, 'testin-retkeilyreitti')
    ).resolves.toMatchObject({ slug: 'testin-retkeilyreitti' });
    expect(await testDatabase.database.select().from(trailAreaLinks)).toHaveLength(0);
    await expect(listParks(testDatabase.database)).resolves.toHaveLength(2);
  });

  it('links walking trails when measured overlap qualifies', async () => {
    await importPublishedParkFixtures({
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

  it('does not link a hiking trail by matching address alone', async () => {
    await importPublishedParkFixtures({
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

    await expect(
      getParkBySlug(testDatabase.database, 'testin-retkeilyreitti')
    ).resolves.toMatchObject({ slug: 'testin-retkeilyreitti' });
    expect(await testDatabase.database.select().from(trailAreaLinks)).toHaveLength(0);
    await expect(listParks(testDatabase.database)).resolves.toHaveLength(2);
  });

  it('preserves manually removed parks across imports', async () => {
    await importPublishedParkFixtures({
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

    await importPublishedParkFixtures({
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
    await importPublishedParkFixtures({
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

    await importPublishedParkFixtures({
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
    await importPublishedParkFixtures({
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
    await importPublishedParkFixtures({
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

  it('retains and links nature trails fully inside an area', async () => {
    await importPublishedParkFixtures({
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

  it('does not link a nature trail by matching address alone', async () => {
    await importPublishedParkFixtures({
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

    await expect(getParkBySlug(testDatabase.database, 'testin-luontopolku')).resolves.toMatchObject(
      { slug: 'testin-luontopolku' }
    );
    expect(await testDatabase.database.select().from(trailAreaLinks)).toHaveLength(0);
    await expect(listParks(testDatabase.database)).resolves.toHaveLength(2);
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

    await importPublishedParkFixtures({
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
    await importPublishedParkFixtures({
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
    await importPublishedParkFixtures({
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
    await importPublishedParkFixtures({
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
    await importPublishedParkFixtures({
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
    await importPublishedParkFixtures({
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
    await importPublishedParkFixtures({
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
      await importPublishedParkFixtures({
        database: testDatabase.database,
        expectedActiveCount: 1,
        sourceUrl: 'https://example.test/lipas'
      });

      await expect(
        importPublishedParkFixtures({
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
        importPublishedParkFixtures({
          database: testDatabase.database,
          expectedActiveCount: 1,
          sourceUrl: 'https://example.test/lipas'
        })
      ).rejects.toThrow('Luontoon sitemap fetch failed with status 503.');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it.each([
    [
      {
        items: [createLipasPark()],
        pagination: { 'current-page': 2, 'page-size': 100, 'total-items': 1, 'total-pages': 1 }
      },
      null,
      'first catalog page'
    ],
    [
      {
        items: [createLipasPark()],
        pagination: { 'current-page': 1, 'page-size': 100, 'total-items': 2, 'total-pages': 1 }
      },
      null,
      'incomplete catalog'
    ],
    [
      {
        items: [createLipasPark()],
        pagination: { 'current-page': 1, 'page-size': 100, 'total-items': 2, 'total-pages': 2 }
      },
      {
        items: [],
        pagination: { 'current-page': 2, 'page-size': 100, 'total-items': 3, 'total-pages': 2 }
      },
      'inconsistent pagination'
    ],
    [
      {
        items: [createLipasPark()],
        pagination: { 'current-page': 1, 'page-size': 100, 'total-items': 2, 'total-pages': 2 }
      },
      { items: [] },
      'incomplete catalog'
    ]
  ])(
    'rejects an incomplete or inconsistent source before cleanup',
    async (first, second, error) => {
      await importParks({
        database: testDatabase.database,
        sourceUrl: 'https://example.test',
        fetchSource: async () => ({ items: [createLipasPark()] })
      });
      const before = await testDatabase.database.select().from(parks);
      const originalFetch = globalThis.fetch;
      const stub = vi.fn().mockResolvedValueOnce(Response.json(first));
      if (second) stub.mockResolvedValueOnce(Response.json(second));
      globalThis.fetch = stub as typeof fetch;
      try {
        await expect(
          importParks({ database: testDatabase.database, sourceUrl: 'https://example.test' })
        ).rejects.toThrow(error);
        expect(await testDatabase.database.select().from(parks)).toEqual(before);
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  );

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
      await importPublishedParkFixtures({
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
        importPublishedParkFixtures({
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
      const result = await importPublishedParkFixtures({
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

  it('imports and links multipart source lines and polygons as one trail–area pair', async () => {
    const park = createLipasPark();
    const area = {
      ...park,
      location: {
        ...park.location,
        geometries: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: {
                type: 'MultiPolygon',
                coordinates: [
                  [
                    [
                      [24, 60],
                      [24.01, 60],
                      [24.01, 60.01],
                      [24, 60.01],
                      [24, 60]
                    ]
                  ],
                  [
                    [
                      [24.02, 60],
                      [24.03, 60],
                      [24.03, 60.01],
                      [24.02, 60.01],
                      [24.02, 60]
                    ]
                  ]
                ]
              }
            }
          ]
        }
      }
    };
    const source = createLipasTrail();
    const trail = {
      ...source,
      location: {
        ...source.location,
        geometries: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: {
                type: 'MultiLineString',
                coordinates: [
                  [
                    [24.001, 60.005],
                    [24.009, 60.005]
                  ],
                  [
                    [24.021, 60.005],
                    [24.029, 60.005]
                  ]
                ]
              }
            }
          ]
        }
      }
    };
    await importParks({
      database: testDatabase.database,
      sourceUrl: 'https://example.test',
      fetchSource: async () => ({ items: [area, trail] })
    });
    const links = await testDatabase.database.select().from(trailAreaLinks);
    expect(links).toHaveLength(1);
    expect(links[0]?.overlapRatio).toBeCloseTo(1, 5);
    expect(
      (await testDatabase.database.select().from(parks).where(eq(parks.lipasId, 440401)))[0]
    ).toMatchObject({ removed: true, trailPublicationRole: 'area_member' });
  });

  it('keeps a former member unpublished when an updated route falls below the threshold', async () => {
    const route = (coordinates: [number, number][]) =>
      createLipasTrail({
        location: {
          geometries: {
            type: 'FeatureCollection',
            features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates } }]
          }
        }
      });
    const options = {
      database: testDatabase.database,
      sourceUrl: 'https://example.test',
      fetchSource: async () => ({
        items: [
          createLipasPark(),
          route([
            [24.5, 61],
            [25, 61]
          ])
        ]
      })
    };
    await importParks(options);
    const trail = (
      await testDatabase.database.select().from(parks).where(eq(parks.lipasId, 440401))
    )[0]!;
    await testDatabase.database.update(parks).set({ removed: false }).where(eq(parks.id, trail.id));
    await importParks({
      ...options,
      fetchSource: async () => ({
        items: [
          createLipasPark(),
          route([
            [25.9, 61],
            [27, 61]
          ])
        ]
      })
    });
    expect(await testDatabase.database.select().from(trailAreaLinks)).toHaveLength(0);
    expect(
      (await testDatabase.database.select().from(parks).where(eq(parks.id, trail.id)))[0]
    ).toMatchObject({ removed: false, trailPublicationRole: 'area_member' });
    await expect(getParkBySlug(testDatabase.database, trail.slug)).resolves.toBeNull();
  });

  it('rolls back an import that would newly suppress a visited trail', async () => {
    const outside = createLipasTrail({
      location: {
        geometries: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: [
                  [35, 66],
                  [35.1, 66.1]
                ]
              }
            }
          ]
        }
      }
    });
    await importPublishedParkFixtures({
      database: testDatabase.database,
      sourceUrl: 'https://example.test',
      fetchSource: async () => ({ items: [createLipasPark(), outside] })
    });
    await createVisit(testDatabase.database, 'testin-luontopolku', {
      author: 'Admin',
      note: 'Walk',
      route: 'Loop',
      status: 'published',
      visitedOn: '2026-11-10'
    });
    const before = await testDatabase.database.select().from(parks);
    await expect(
      importParks({
        database: testDatabase.database,
        sourceUrl: 'https://example.test',
        fetchSource: async () => ({ items: [createLipasPark(), createLipasTrail()] })
      })
    ).rejects.toThrow('preservation decision');
    expect(await testDatabase.database.select().from(parks)).toEqual(before);
    expect(await testDatabase.database.select().from(trailAreaLinks)).toHaveLength(0);
    expect(
      await getParkVisitsBySlug(testDatabase.database, 'testin-luontopolku', async () => '')
    ).toMatchObject({ visits: [expect.objectContaining({ route: 'Loop' })] });
  });

  it('rolls back the source batch if an area has no coordinates', async () => {
    const area = createLipasPark({
      location: { geometries: { type: 'FeatureCollection', features: [] } }
    });
    await expect(
      importParks({
        database: testDatabase.database,
        sourceUrl: 'https://example.test',
        fetchSource: async () => ({ items: [createLipasTrail(), area] })
      })
    ).rejects.toThrow('Area 12345 has no usable coordinates');
    expect(await testDatabase.database.select().from(parks)).toHaveLength(0);
  });

  it('retains a source-active trail with no geometry disabled and reports it for review', async () => {
    const source = createLipasTrail({
      location: { geometries: { type: 'FeatureCollection', features: [] } }
    });
    const result = await importParks({
      database: testDatabase.database,
      sourceUrl: 'https://example.test',
      fetchSource: async () => ({ items: [source] })
    });
    const trail = await testDatabase.database.query.parks.findFirst({
      where: eq(parks.lipasId, source['lipas-id'])
    });
    expect(trail).toMatchObject({ removed: true, catalogStatus: 'active' });
    await expect(updateParkRemoved(testDatabase.database, trail!.slug, false)).rejects.toThrow(
      'without coordinates'
    );
    expect(result.trailAreaResult?.unresolved).toContainEqual({
      trailId: trail!.id,
      areaId: null,
      status: 'missing-line'
    });
    await importParks({
      database: testDatabase.database,
      sourceUrl: 'https://example.test',
      fetchSource: async () => ({ items: [createLipasTrail()] })
    });
    expect(await updateParkRemoved(testDatabase.database, trail!.slug, false)).toBe(true);
    expect((await getParkBySlug(testDatabase.database, trail!.slug))?.markerPoint).toMatchObject({
      lon: expect.any(Number),
      lat: expect.any(Number)
    });
  });

  it('retains an out-of-range trail privately and reports invalid coordinates', async () => {
    const source = createLipasTrail({
      location: {
        geometries: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: [
                  [24, 60],
                  [24, 999]
                ]
              }
            }
          ]
        }
      }
    });
    const result = await importParks({
      database: testDatabase.database,
      sourceUrl: 'https://example.test',
      fetchSource: async () => ({ items: [source] })
    });
    const trail = (
      await testDatabase.database.select().from(parks).where(eq(parks.lipasId, 440401))
    )[0]!;
    expect(trail).toMatchObject({ removed: true, markerLon: 0, markerLat: 0 });
    expect(result.trailAreaResult?.unresolved).toContainEqual({
      trailId: trail.id,
      areaId: null,
      status: 'invalid-line'
    });
    await expect(updateParkRemoved(testDatabase.database, trail.slug, false)).rejects.toThrow(
      'without coordinates'
    );
  });

  it('preserves the last known location and visibility when an existing trail loses all geometry', async () => {
    const options = {
      database: testDatabase.database,
      sourceUrl: 'https://example.test',
      fetchSource: async () => ({ items: [createLipasTrail()] })
    };
    await importPublishedParkFixtures(options);
    const before = (
      await testDatabase.database.select().from(parks).where(eq(parks.lipasId, 440401))
    )[0]!;
    await testDatabase.database
      .update(parks)
      .set({ markerLat: 61, markerLon: 25 })
      .where(eq(parks.id, before.id));
    const empty = createLipasTrail({
      location: { geometries: { type: 'FeatureCollection', features: [] } }
    });
    const result = await importParks({ ...options, fetchSource: async () => ({ items: [empty] }) });
    const after = (
      await testDatabase.database.select().from(parks).where(eq(parks.id, before.id))
    )[0]!;
    expect(after).toMatchObject({
      id: before.id,
      removed: false,
      markerLat: 61,
      markerLon: 25,
      bboxMinLon: before.bboxMinLon,
      bboxMaxLon: before.bboxMaxLon
    });
    expect(result.trailAreaResult?.unresolved).toContainEqual({
      trailId: before.id,
      areaId: null,
      status: 'missing-line'
    });
  });

  it('links usable line parts while reporting a degenerate part for review', async () => {
    const source = createLipasTrail({
      location: {
        geometries: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: [
                  [24.5, 61],
                  [25, 61]
                ]
              }
            },
            {
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: [
                  [24.5, 61],
                  [24.5, 61]
                ]
              }
            }
          ]
        }
      }
    });
    const result = await importParks({
      database: testDatabase.database,
      sourceUrl: 'https://example.test',
      fetchSource: async () => ({ items: [createLipasPark(), source] })
    });
    const trail = (
      await testDatabase.database.select().from(parks).where(eq(parks.lipasId, 440401))
    )[0]!;
    expect(result.trailAreaResult?.unresolved).toContainEqual({
      trailId: trail.id,
      areaId: null,
      status: 'degenerate-line-part'
    });
    expect(await testDatabase.database.select().from(trailAreaLinks)).toMatchObject([
      { trailId: trail.id, geometryQuality: 'degenerate-line-parts', automaticMatch: true }
    ]);
  });

  it('retains and reports a degenerate trail even when no area overlaps its bounding box', async () => {
    const source = createLipasTrail({
      location: {
        geometries: {
          type: 'FeatureCollection',
          features: [
            {
              type: 'Feature',
              geometry: {
                type: 'LineString',
                coordinates: [
                  [35, 66],
                  [35, 66]
                ]
              }
            }
          ]
        }
      }
    });
    const result = await importParks({
      database: testDatabase.database,
      sourceUrl: 'https://example.test',
      fetchSource: async () => ({ items: [source] })
    });
    const trail = await testDatabase.database.query.parks.findFirst({
      where: eq(parks.lipasId, source['lipas-id'])
    });
    expect(trail).toMatchObject({
      removed: true,
      catalogStatus: 'active',
      trailPublicationRole: 'independent'
    });
    expect(result.trailAreaResult?.unresolved).toEqual([
      { trailId: trail!.id, areaId: null, status: 'invalid-line' }
    ]);
  });

  it('rejects duplicate source IDs before changing stored records', async () => {
    await importParks({
      database: testDatabase.database,
      sourceUrl: 'https://example.test',
      fetchSource: async () => ({ items: [createLipasPark()] })
    });
    const before = await testDatabase.database.select().from(parks);
    await expect(
      importParks({
        database: testDatabase.database,
        sourceUrl: 'https://example.test',
        fetchSource: async () => ({
          items: [createLipasPark(), { ...createLipasPark(), status: 'inactive' }]
        })
      })
    ).rejects.toThrow('duplicate source IDs');
    expect(await testDatabase.database.select().from(parks)).toEqual(before);
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
