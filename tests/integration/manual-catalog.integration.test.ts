import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getParkBySlug, listParks } from '../../src/db/repositories.js';
import { parks } from '../../src/db/schema.js';
import { importParks } from '../../src/importer/import-parks.js';
import { importSpecialParks } from '../../src/importer/import-special-parks.js';
import { createLipasPark } from '../fixtures/lipas.js';
import { createSpecialParksSource } from '../fixtures/special-parks.js';
import { createTestDatabase } from '../helpers/test-db.js';

const merenkurkkuSourceUrl =
  'https://geoserver.museovirasto.fi/geoserver/rajapinta_suojellut/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=rajapinta_suojellut:maailmanperinto_alue&outputFormat=application/json&srsName=EPSG:4326';

const kevoSourceUrl =
  "https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=inspire_ps:PS.ProtectedSitesValtionOmistamaLuonnonsuojelualue&outputFormat=application/json&srsName=EPSG:4326&cql_filter=nimi='Kevon luonnonpuisto'";

describe('manual catalog imports', () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    testDatabase = await createTestDatabase();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await testDatabase.dispose();
  });

  it('imports all special parks with correct metadata', async () => {
    const result = await importSpecialParks({
      database: testDatabase.database,
      fetchSource: createSpecialParksSource(),
      now: () => '2026-05-27T08:00:00.000Z'
    });

    expect(result.results).toHaveLength(74);

    const merenkurkku = await getParkBySlug(
      testDatabase.database,
      'merenkurkun-maailmanperintoalue'
    );
    expect(merenkurkku).toMatchObject({
      displayTypeName: 'Maailmanperintökohde',
      lipasId: 9000898,
      name: 'Merenkurkun maailmanperintöalue',
      type: { slug: 'nature-reserve-area' }
    });
    const rawMerenkurkku = await testDatabase.database.query.parks.findFirst({
      where: eq(parks.slug, 'merenkurkun-maailmanperintoalue')
    });
    expect(rawMerenkurkku).toMatchObject({
      managedByLipasImport: false,
      postalCode: '65800',
      postalOffice: 'Raippaluoto'
    });

    const sammallahdenmaki = await getParkBySlug(testDatabase.database, 'sammallahdenmaki');
    expect(sammallahdenmaki).toMatchObject({
      displayTypeName: 'Maailmanperintökohde',
      lipasId: 9000899,
      location: 'Sammallahdentie, 27230 Rauma',
      name: 'Sammallahdenmäki',
      type: { slug: 'outdoor-recreation-area' }
    });

    const suomenlinna = await getParkBySlug(testDatabase.database, 'suomenlinna');
    expect(suomenlinna).toMatchObject({
      displayTypeName: 'Maailmanperintökohde',
      lipasId: 9000900,
      location: 'Suomenlinna, 00190 Helsinki',
      name: 'Suomenlinna',
      type: { slug: 'outdoor-recreation-area' }
    });

    const vanhaRauma = await getParkBySlug(testDatabase.database, 'vanha-rauma');
    expect(vanhaRauma).toMatchObject({
      displayTypeName: 'Maailmanperintökohde',
      lipasId: 9000901,
      location: 'Vanha Rauma, 26100 Rauma',
      name: 'Vanha Rauma',
      type: { slug: 'outdoor-recreation-area' }
    });

    const kevo = await getParkBySlug(testDatabase.database, 'kevon-luonnonpuisto');
    expect(kevo).toMatchObject({
      displayTypeName: 'Luonnonpuisto',
      lipasId: 9000915,
      name: 'Kevon luonnonpuisto',
      type: { slug: 'nature-reserve-area' }
    });
    expect(rawMerenkurkku).toMatchObject({ managedByLipasImport: false });

    const laajalahti = await getParkBySlug(testDatabase.database, 'laajalahden-luonnonsuojelualue');
    expect(laajalahti).toMatchObject({
      lipasId: 9000824,
      name: 'Laajalahden luonnonsuojelualue',
      type: { slug: 'nature-reserve-area' }
    });

    const liminganlahti = await getParkBySlug(testDatabase.database, 'liminganlahti');
    expect(liminganlahti).toMatchObject({
      displayTypeName: 'Lintuvesi',
      lipasId: 900070433,
      name: 'Liminganlahti',
      type: { slug: 'nature-reserve-area' }
    });

    const malla = await getParkBySlug(testDatabase.database, 'mallan-luonnonpuisto');
    expect(malla).toMatchObject({
      displayTypeName: 'Luonnonpuisto',
      lipasId: 900042160,
      name: 'Mallan luonnonpuisto',
      type: { slug: 'nature-reserve-area' }
    });

    const siikalahti = await getParkBySlug(testDatabase.database, 'siikalahden-luonnonsuojelualue');
    expect(siikalahti).toMatchObject({
      lipasId: 9000102829,
      name: 'Siikalahden luonnonsuojelualue',
      type: { slug: 'nature-reserve-area' }
    });

    const napapiiri = await getParkBySlug(testDatabase.database, 'napapiirin-retkeilyalue');
    expect(napapiiri).toMatchObject({
      lipasId: 9000126313,
      name: 'Napapiirin retkeilyalue',
      displayTypeName: 'Valtion retkeilyalue',
      type: { slug: 'hiking-area' }
    });
    const rawNapapiiri = await testDatabase.database.query.parks.findFirst({
      where: eq(parks.slug, 'napapiirin-retkeilyalue')
    });
    expect(rawNapapiiri).toMatchObject({
      locationLabel: 'Vaattunkikönkääntie',
      managedByLipasImport: false,
      postalCode: '96930',
      postalOffice: 'Rovaniemi'
    });

    const inari = await getParkBySlug(testDatabase.database, 'inarin-retkeilyalue');
    expect(inari).toMatchObject({
      lipasId: 606689,
      name: 'Inarin retkeilyalue',
      displayTypeName: 'Valtion retkeilyalue',
      type: { slug: 'hiking-area' }
    });
    const rawInari = await testDatabase.database.query.parks.findFirst({
      where: eq(parks.slug, 'inarin-retkeilyalue')
    });
    expect(rawInari).toMatchObject({
      locationLabel: 'Inarintie 46',
      managedByLipasImport: false,
      postalCode: '99870',
      postalOffice: 'Inari'
    });

    const seili = await getParkBySlug(testDatabase.database, 'seili');
    expect(seili).toMatchObject({
      displayTypeName: 'Historia-alue',
      lipasId: 9001034,
      name: 'Seili',
      type: { slug: 'outdoor-recreation-area' }
    });

    const vallisaari = await getParkBySlug(testDatabase.database, 'vallisaari');
    expect(vallisaari).toMatchObject({
      lipasId: 9001035,
      name: 'Vallisaari',
      type: { slug: 'outdoor-recreation-area' }
    });

    const hailuoto = await getParkBySlug(testDatabase.database, 'hailuoto');
    expect(hailuoto).toMatchObject({
      lipasId: 9001036,
      name: 'Hailuoto',
      type: { slug: 'outdoor-recreation-area' }
    });

    const dagmarinPuisto = await getParkBySlug(testDatabase.database, 'dagmarin-puisto');
    expect(dagmarinPuisto).toMatchObject({
      displayTypeName: 'Historia-alue',
      lipasId: 9001028,
      name: 'Dagmarin puisto',
      type: { slug: 'outdoor-recreation-area' }
    });

    const liimanninkoski = await getParkBySlug(
      testDatabase.database,
      'liimanninkosken-lehtojensuojelualue'
    );
    expect(liimanninkoski).toMatchObject({
      lipasId: 9001027,
      name: 'Liimanninkosken lehtojensuojelualue',
      type: { slug: 'nature-reserve-area' }
    });

    const olvassuo = await getParkBySlug(testDatabase.database, 'olvassuo');
    expect(olvassuo).toMatchObject({
      lipasId: 9001029,
      name: 'Olvassuo',
      type: { slug: 'outdoor-recreation-area' }
    });

    const harola = await getParkBySlug(testDatabase.database, 'harola');
    expect(harola).toMatchObject({
      lipasId: 9001030,
      name: 'Harola',
      type: { slug: 'outdoor-recreation-area' }
    });

    const kajaaninLinna = await getParkBySlug(testDatabase.database, 'kajaanin-linna');
    expect(kajaaninLinna).toMatchObject({
      displayTypeName: 'Historia-alue',
      lipasId: 9001031,
      name: 'Kajaanin linna',
      type: { slug: 'outdoor-recreation-area' }
    });

    const fiskars = await getParkBySlug(testDatabase.database, 'fiskarsin-ruukki');
    expect(fiskars).toMatchObject({
      lipasId: 9002003,
      location: 'Fiskarsintie 9, 10470 Fiskars',
      name: 'Fiskarsin ruukki',
      type: { slug: 'factory-village' }
    });

    const verla = await getParkBySlug(testDatabase.database, 'verla');
    expect(verla).toMatchObject({
      displayTypeName: 'Maailmanperintökohde',
      lipasId: 9002023,
      location: 'Verlantie 295, 47850 Verla',
      name: 'Verla',
      type: { slug: 'factory-village' }
    });

    const juankoski = await getParkBySlug(testDatabase.database, 'juankosken-ruukki');
    expect(juankoski).toMatchObject({
      lipasId: 9002024,
      name: 'Juankosken ruukki',
      type: { slug: 'factory-village' }
    });

    const nuutajarvi = await getParkBySlug(testDatabase.database, 'nuutajarven-lasikyla');
    expect(nuutajarvi).toMatchObject({
      lipasId: 9002025,
      location: 'Pruukinraitti 15, 31160 Urjala',
      name: 'Nuutajärven lasikylä',
      type: { slug: 'factory-village' }
    });
  });

  it('keeps non-LIPAS-managed parks active when a later LIPAS import deactivates managed rows', async () => {
    await importSpecialParks({
      database: testDatabase.database,
      fetchSource: createSpecialParksSource(),
      now: () => '2026-05-27T08:00:00.000Z'
    });

    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 0,
      now: () => '2026-05-28T08:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark({
            status: 'incorrect-data'
          })
        ]
      })
    });

    const allParks = await listParks(testDatabase.database);
    const merenkurkku = await getParkBySlug(
      testDatabase.database,
      'merenkurkun-maailmanperintoalue'
    );
    const kevo = await getParkBySlug(testDatabase.database, 'kevon-luonnonpuisto');

    expect(allParks).toHaveLength(74);
    expect(merenkurkku).toMatchObject({ catalogStatus: 'active' });
    expect(kevo).toMatchObject({ catalogStatus: 'active' });
  });

  it('fails loudly when a source fetch returns a non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503
      })
    );

    await expect(
      importSpecialParks({
        database: testDatabase.database
      })
    ).rejects.toThrow('Special parks import failed with status 503');
  });

  it('fails when a source payload has no matching features', async () => {
    await expect(
      importSpecialParks({
        database: testDatabase.database,
        fetchSource: async (sourceUrl) => {
          if (sourceUrl === kevoSourceUrl) {
            return { type: 'FeatureCollection', features: [] };
          }

          return createSpecialParksSource()(sourceUrl);
        }
      })
    ).rejects.toThrow('No features found for Kevon luonnonpuisto in the SYKE source.');
  });

  it('supports the default fetch path used by the CLI importer', async () => {
    const fetchSource = createSpecialParksSource();

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async (url: string) => ({
        json: async () => fetchSource(url),
        ok: true
      }))
    );

    const result = await importSpecialParks({
      database: testDatabase.database
    });

    expect(result.results).toHaveLength(74);

    const merenkurkku = await getParkBySlug(
      testDatabase.database,
      'merenkurkun-maailmanperintoalue'
    );
    expect(merenkurkku).toMatchObject({
      displayTypeName: 'Maailmanperintökohde',
      name: 'Merenkurkun maailmanperintöalue'
    });

    const napapiiri = await getParkBySlug(testDatabase.database, 'napapiirin-retkeilyalue');
    expect(napapiiri).toMatchObject({
      name: 'Napapiirin retkeilyalue',
      displayTypeName: 'Valtion retkeilyalue',
      type: { slug: 'hiking-area' }
    });

    const inari = await getParkBySlug(testDatabase.database, 'inarin-retkeilyalue');
    expect(inari).toMatchObject({
      name: 'Inarin retkeilyalue',
      displayTypeName: 'Valtion retkeilyalue',
      type: { slug: 'hiking-area' }
    });

    const seili = await getParkBySlug(testDatabase.database, 'seili');
    expect(seili).toMatchObject({
      displayTypeName: 'Historia-alue',
      name: 'Seili',
      type: { slug: 'outdoor-recreation-area' }
    });

    const vallisaari = await getParkBySlug(testDatabase.database, 'vallisaari');
    expect(vallisaari).toMatchObject({
      name: 'Vallisaari',
      type: { slug: 'outdoor-recreation-area' }
    });

    const hailuoto = await getParkBySlug(testDatabase.database, 'hailuoto');
    expect(hailuoto).toMatchObject({
      name: 'Hailuoto',
      type: { slug: 'outdoor-recreation-area' }
    });
  });

  it('derives area and establishment year from SYKE features', async () => {
    await importSpecialParks({
      database: testDatabase.database,
      fetchSource: createSpecialParksSource(),
      now: () => '2026-05-27T08:00:00.000Z'
    });

    const kevo = await testDatabase.database.query.parks.findFirst({
      where: eq(parks.slug, 'kevon-luonnonpuisto')
    });

    expect(kevo?.areaKm2).toBe(710.65);
    expect(kevo?.establishmentYear).toBe(1956);

    const liminganlahti = await testDatabase.database.query.parks.findFirst({
      where: eq(parks.slug, 'liminganlahti')
    });

    expect(liminganlahti?.areaKm2).toBe(3.7);
    expect(liminganlahti?.establishmentYear).toBe(1998);
  });

  it('filters Laajalahti by ELY to pick the Espoo feature', async () => {
    await importSpecialParks({
      database: testDatabase.database,
      fetchSource: createSpecialParksSource(),
      now: () => '2026-05-27T08:00:00.000Z'
    });

    const laajalahti = await testDatabase.database.query.parks.findFirst({
      where: eq(parks.slug, 'laajalahden-luonnonsuojelualue')
    });

    expect(laajalahti?.areaKm2).toBe(1.89);
    expect(laajalahti?.establishmentYear).toBe(1989);
  });

  it('fails when Merenkurkku source has no matching features', async () => {
    await expect(
      importSpecialParks({
        database: testDatabase.database,
        fetchSource: async (sourceUrl) => {
          if (sourceUrl === merenkurkkuSourceUrl) {
            return { type: 'FeatureCollection', features: [] };
          }

          return createSpecialParksSource()(sourceUrl);
        }
      })
    ).rejects.toThrow('No Merenkurkku world heritage area features were found in the source.');
  });

  it('fails when a non-Merenkurkku world heritage source has no matching kohde feature', async () => {
    await expect(
      importSpecialParks({
        database: testDatabase.database,
        fetchSource: async (sourceUrl) => {
          if (sourceUrl === merenkurkkuSourceUrl) {
            return {
              type: 'FeatureCollection',
              features: [
                {
                  type: 'Feature',
                  geometry: {
                    type: 'Polygon',
                    coordinates: [
                      [
                        [21.0, 63.0],
                        [21.0, 63.1],
                        [21.1, 63.1],
                        [21.1, 63.0],
                        [21.0, 63.0]
                      ]
                    ]
                  },
                  properties: {
                    ID: 898,
                    Nimi: 'Merenkurkun saaristo A',
                    URL: 'https://example.test/merenkurkku',
                    aluetyyppi: 'Kohde'
                  }
                }
              ]
            };
          }

          return createSpecialParksSource()(sourceUrl);
        }
      })
    ).rejects.toThrow(
      'No world heritage area features were found for Sammallahdenmäki in the source.'
    );
  });

  it('handles MultiPolygon geometries from SYKE', async () => {
    await importSpecialParks({
      database: testDatabase.database,
      fetchSource: async (sourceUrl) => {
        if (sourceUrl === kevoSourceUrl) {
          return {
            type: 'FeatureCollection',
            features: [
              {
                geometry: {
                  coordinates: [
                    [
                      [
                        [27.0, 69.5],
                        [27.0, 69.7],
                        [27.3, 69.7],
                        [27.3, 69.5],
                        [27.0, 69.5]
                      ]
                    ],
                    [
                      [
                        [27.4, 69.5],
                        [27.4, 69.6],
                        [27.5, 69.6],
                        [27.5, 69.5],
                        [27.4, 69.5]
                      ]
                    ]
                  ],
                  type: 'MultiPolygon'
                },
                properties: {
                  nimi: 'Kevon luonnonpuisto',
                  paatpvm: '1956-12-21T00:00:00Z',
                  shape_area: 710_648_647
                },
                type: 'Feature'
              }
            ]
          };
        }

        return createSpecialParksSource()(sourceUrl);
      }
    });

    const kevo = await getParkBySlug(testDatabase.database, 'kevon-luonnonpuisto');
    const boundaryFeatures = (kevo?.boundaryGeoJson as { features: unknown[] } | undefined)
      ?.features;

    expect(boundaryFeatures).toHaveLength(2);
  });

  it('derives area from GeoJSON shapefile features for hiking areas', async () => {
    await importSpecialParks({
      database: testDatabase.database,
      fetchSource: createSpecialParksSource(),
      now: () => '2026-05-27T08:00:00.000Z'
    });

    const napapiiri = await testDatabase.database.query.parks.findFirst({
      where: eq(parks.slug, 'napapiirin-retkeilyalue')
    });

    expect(napapiiri?.areaKm2).toBe(26.16);
    expect(napapiiri?.establishmentYear).toBeNull();

    const inari = await testDatabase.database.query.parks.findFirst({
      where: eq(parks.slug, 'inarin-retkeilyalue')
    });

    expect(inari?.areaKm2).toBeNull();
    expect(inari?.establishmentYear).toBeNull();
  });

  it('fails when a special:// source has no matching features', async () => {
    await expect(
      importSpecialParks({
        database: testDatabase.database,
        fetchSource: async (sourceUrl) => {
          if (sourceUrl === 'special://napapiirin-retkeilyalue') {
            return { type: 'FeatureCollection', features: [] };
          }

          return createSpecialParksSource()(sourceUrl);
        }
      })
    ).rejects.toThrow('No features found for Napapiirin retkeilyalue in the source.');
  });

  it('handles missing SYKE metadata fields gracefully', async () => {
    await importSpecialParks({
      database: testDatabase.database,
      fetchSource: async (sourceUrl) => {
        if (sourceUrl === kevoSourceUrl) {
          return {
            type: 'FeatureCollection',
            features: [
              {
                geometry: {
                  coordinates: [
                    [
                      [
                        [27.0, 69.5],
                        [27.0, 69.7],
                        [27.3, 69.7],
                        [27.3, 69.5],
                        [27.0, 69.5]
                      ]
                    ]
                  ],
                  type: 'MultiPolygon'
                },
                properties: { nimi: 'Kevon luonnonpuisto' },
                type: 'Feature'
              }
            ]
          };
        }

        return createSpecialParksSource()(sourceUrl);
      }
    });

    const kevo = await testDatabase.database.query.parks.findFirst({
      where: eq(parks.slug, 'kevon-luonnonpuisto')
    });

    expect(kevo?.areaKm2).toBeNull();
    expect(kevo?.establishmentYear).toBeNull();
  });
});
