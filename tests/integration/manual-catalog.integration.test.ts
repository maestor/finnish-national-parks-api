import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getParkBySlug, listParks } from '../../src/db/repositories.js';
import { parks } from '../../src/db/schema.js';
import { importParks } from '../../src/importer/import-parks.js';
import { importSpecialParks } from '../../src/importer/import-special-parks.js';
import { createLipasPark } from '../fixtures/lipas.js';
import { createSpecialParksSource } from '../fixtures/special-parks.js';
import { createTestDatabase } from '../helpers/test-db.js';

type ExpectedLuontoonDestinationImport = {
  displayTypeName?: string;
  lipasId: number;
  name: string;
  slug: string;
  typeSlug: string;
};

const merenkurkkuSourceUrl =
  'https://geoserver.museovirasto.fi/geoserver/rajapinta_suojellut/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=rajapinta_suojellut:maailmanperinto_alue&outputFormat=application/json&srsName=EPSG:4326';

const kevoSourceUrl =
  "https://paikkatiedot.ymparisto.fi/geoserver/inspire_ps/wfs?service=WFS&request=GetFeature&version=2.0.0&typeNames=inspire_ps:PS.ProtectedSitesValtionOmistamaLuonnonsuojelualue&outputFormat=application/json&srsName=EPSG:4326&cql_filter=nimi='Kevon luonnonpuisto'";
const paistjarviSourceUrl =
  'https://www.luontoon.fi/geo/features/collections/public.destinations_details_view/items?filter=slug%3D%27paistjarvi%27&filter-lang=cql-text&limit=1000';

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

    expect(result.results).toHaveLength(129);

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
      address: 'Sammallahdentie, 27230 Rauma',
      displayTypeName: 'Maailmanperintökohde',
      lipasId: 9000899,
      locationLabel: 'Sammallahdentie',
      name: 'Sammallahdenmäki',
      postalCode: '27230',
      postalOffice: 'Rauma',
      type: { slug: 'cultural-history-area' }
    });

    const suomenlinna = await getParkBySlug(testDatabase.database, 'suomenlinna');
    expect(suomenlinna).toMatchObject({
      address: 'Suomenlinna, 00190 Helsinki',
      displayTypeName: 'Maailmanperintökohde',
      lipasId: 9000900,
      locationLabel: 'Suomenlinna',
      name: 'Suomenlinna',
      postalCode: '00190',
      postalOffice: 'Helsinki',
      type: { slug: 'cultural-history-area' }
    });

    const vanhaRauma = await getParkBySlug(testDatabase.database, 'vanha-rauma');
    expect(vanhaRauma).toMatchObject({
      address: 'Vanha Rauma, 26100 Rauma',
      displayTypeName: 'Maailmanperintökohde',
      lipasId: 9000901,
      locationLabel: 'Vanha Rauma',
      name: 'Vanha Rauma',
      postalCode: '26100',
      postalOffice: 'Rauma',
      type: { slug: 'cultural-history-area' }
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

    const paavola = await getParkBySlug(testDatabase.database, 'paavolan-luontopolku');
    expect(paavola).toMatchObject({
      address: 'Pietiläntie 23, 08800 Lohja',
      lipasId: 9004404,
      locationLabel: 'Pietiläntie 23',
      parkUrl: null,
      name: 'Paavolan luontopolku',
      postalCode: '08800',
      postalOffice: 'Lohja',
      type: { slug: 'nature-trail' }
    });
    expect(paavola?.boundaryGeoJson?.features).toHaveLength(4);
    expect(
      paavola?.boundaryGeoJson?.features.every((feature) => feature.geometry.type === 'LineString')
    ).toBe(true);
    expect(paavola?.boundingBox.minLon).toBeCloseTo(23.8836126343924);
    expect(paavola?.boundingBox.maxLon).toBeCloseTo(23.890603352384);
    expect(paavola?.boundingBox.minLat).toBeCloseTo(60.2254776367656);
    expect(paavola?.boundingBox.maxLat).toBeCloseTo(60.2277589357966);

    const santalahti = await getParkBySlug(testDatabase.database, 'santalahden-luontopolku');
    expect(santalahti).toMatchObject({
      address: 'Kipparitie 4, 48310 Kotka',
      lipasId: 9004405,
      locationLabel: 'Kipparitie 4',
      parkUrl: null,
      name: 'Santalahden luontopolku',
      postalCode: '48310',
      postalOffice: 'Kotka',
      type: { slug: 'nature-trail' }
    });
    expect(santalahti?.boundaryGeoJson?.features).toHaveLength(7);
    expect(
      santalahti?.boundaryGeoJson?.features.every(
        (feature) => feature.geometry.type === 'LineString'
      )
    ).toBe(true);
    expect(santalahti?.boundingBox.minLon).toBeCloseTo(26.8507921028238);
    expect(santalahti?.boundingBox.maxLon).toBeCloseTo(26.8592556232422);
    expect(santalahti?.boundingBox.minLat).toBeCloseTo(60.4309110325505);
    expect(santalahti?.boundingBox.maxLat).toBeCloseTo(60.4433449987787);

    const torholan = await getParkBySlug(testDatabase.database, 'torholan-luola');
    expect(torholan).toMatchObject({
      address: 'Torholan luola, Lohja',
      lipasId: 9004406,
      locationLabel: 'Torholan luola',
      parkUrl: 'https://www.luontoon.fi/fi/reitit/torholan-luolan-polku-lohja-194240',
      name: 'Torholan luola',
      postalCode: null,
      postalOffice: 'Lohja',
      type: { slug: 'nature-trail' }
    });
    expect(torholan?.boundaryGeoJson?.features).toHaveLength(1);
    expect(
      torholan?.boundaryGeoJson?.features.every((feature) => feature.geometry.type === 'LineString')
    ).toBe(true);
    expect(torholan?.boundingBox.minLon).toBeCloseTo(23.85665818);
    expect(torholan?.boundingBox.maxLon).toBeCloseTo(23.8572344);
    expect(torholan?.boundingBox.minLat).toBeCloseTo(60.252980562);
    expect(torholan?.boundingBox.maxLat).toBeCloseTo(60.254699132);

    const seili = await getParkBySlug(testDatabase.database, 'seili');
    expect(seili).toMatchObject({
      lipasId: 9001034,
      name: 'Seili',
      type: { slug: 'cultural-history-area' }
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

    const rokovallio = await getParkBySlug(testDatabase.database, 'rokokallio');
    expect(rokovallio).toMatchObject({
      address: 'Rokokallio, 03790 Vihti',
      areaKm2: 0.89,
      lipasId: 9001080,
      locationLabel: 'Rokokallio',
      parkUrl: null,
      name: 'Rokokallio',
      postalCode: '03790',
      postalOffice: 'Vihti',
      type: { slug: 'outdoor-recreation-area' }
    });
    expect(rokovallio?.boundaryGeoJson?.features).toHaveLength(3);
    expect(
      rokovallio?.boundaryGeoJson?.features.every((feature) => feature.geometry.type === 'Polygon')
    ).toBe(true);

    const dagmarinPuisto = await getParkBySlug(testDatabase.database, 'dagmarin-puisto');
    expect(dagmarinPuisto).toMatchObject({
      lipasId: 9001028,
      name: 'Dagmarin puisto',
      type: { slug: 'cultural-history-area' }
    });

    const kuhakoski = await getParkBySlug(testDatabase.database, 'kuhakoski');
    expect(kuhakoski).toMatchObject({
      address: 'Valkjärventie 604, Nurmijärvi',
      lipasId: 9001076,
      locationLabel: 'Valkjärventie 604',
      parkUrl:
        'https://www.suomenvesiputoukset.fi/vesiputoukset/suomen-vesiputoukset-luettelossa/kuhakoski/',
      name: 'Kuhakoski',
      postalCode: null,
      postalOffice: 'Nurmijärvi',
      type: { slug: 'cultural-history-area' }
    });
    expect(kuhakoski?.boundaryGeoJson?.features).toHaveLength(1);
    expect(kuhakoski?.boundaryGeoJson?.features[0]?.geometry.type).toBe('Polygon');

    const paistjarvi = await getParkBySlug(testDatabase.database, 'paistjarvi');
    expect(paistjarvi).toMatchObject({
      address: 'Sonnasentie 948, 18300 Heinola',
      lipasId: 9001044,
      locationLabel: 'Sonnasentie 948',
      parkUrl: 'https://www.luontoon.fi/fi/kohteet/paistjarvi',
      name: 'Paistjärvi',
      postalCode: '18300',
      postalOffice: 'Heinola',
      type: { slug: 'outdoor-recreation-area' }
    });
    expect(paistjarvi?.boundaryGeoJson?.features).toHaveLength(1);
    expect(paistjarvi?.boundaryGeoJson?.features[0]?.geometry.type).toBe('Polygon');

    const kalajoenHiekkasarkat = await getParkBySlug(
      testDatabase.database,
      'kalajoen-hiekkasarkat'
    );
    expect(kalajoenHiekkasarkat).toMatchObject({
      address: 'Kalajoen hiekkasärkät, Kalajoki',
      lipasId: 9002032,
      locationLabel: 'Kalajoen hiekkasärkät',
      parkUrl: null,
      name: 'Kalajoen hiekkasärkät',
      postalCode: null,
      postalOffice: 'Kalajoki',
      type: { slug: 'outdoor-recreation-area' }
    });
    expect(kalajoenHiekkasarkat?.boundaryGeoJson?.features).toHaveLength(1);
    expect(kalajoenHiekkasarkat?.boundaryGeoJson?.features[0]?.geometry.type).toBe('Polygon');
    expect(kalajoenHiekkasarkat?.boundingBox.minLon).toBeCloseTo(23.8043738, 6);
    expect(kalajoenHiekkasarkat?.boundingBox.maxLon).toBeCloseTo(23.8277159, 6);
    expect(kalajoenHiekkasarkat?.boundingBox.minLat).toBeCloseTo(64.2320993, 6);
    expect(kalajoenHiekkasarkat?.boundingBox.maxLat).toBeCloseTo(64.2464813, 6);

    const uutela = await getParkBySlug(testDatabase.database, 'uutelan-ulkoilualue');
    expect(uutela).toMatchObject({
      address: 'Uutelantie 1, 00990 Helsinki',
      lipasId: 9001070,
      locationLabel: 'Uutelantie 1',
      parkUrl:
        'https://www.hel.fi/fi/kulttuuri-ja-vapaa-aika/ulkoilu-puistot-ja-luontokohteet/ulkoilualueet/uutelan-ulkoilualue',
      name: 'Uutelan ulkoilualue',
      postalCode: '00990',
      postalOffice: 'Helsinki',
      type: { slug: 'outdoor-recreation-area' }
    });
    expect(uutela?.boundaryGeoJson?.features).toHaveLength(1);
    expect(uutela?.boundaryGeoJson?.features[0]?.geometry.type).toBe('Polygon');

    const kallahti = await getParkBySlug(testDatabase.database, 'kallahden-ulkoilualue');
    expect(kallahti).toMatchObject({
      address: 'Rantapaadentie 7, 00980 Helsinki',
      lipasId: 9001071,
      locationLabel: 'Rantapaadentie 7',
      parkUrl:
        'https://www.hel.fi/fi/kulttuuri-ja-vapaa-aika/ulkoilu-puistot-ja-luontokohteet/ulkoilualueet/kallahden-ulkoilualue',
      name: 'Kallahden ulkoilualue',
      postalCode: '00980',
      postalOffice: 'Helsinki',
      type: { slug: 'outdoor-recreation-area' }
    });
    expect(kallahti?.boundaryGeoJson?.features).toHaveLength(1);
    expect(kallahti?.boundaryGeoJson?.features[0]?.geometry.type).toBe('Polygon');

    const seurasaari = await getParkBySlug(testDatabase.database, 'seurasaari');
    expect(seurasaari).toMatchObject({
      address: 'Seurasaarentie 15, 00250 Helsinki',
      lipasId: 9001072,
      locationLabel: 'Seurasaarentie 15',
      parkUrl:
        'https://www.hel.fi/fi/kulttuuri-ja-vapaa-aika/ulkoilu-puistot-ja-luontokohteet/ulkoilualueet/seurasaari',
      name: 'Seurasaari',
      postalCode: '00250',
      postalOffice: 'Helsinki',
      type: { slug: 'outdoor-recreation-area' }
    });
    expect(seurasaari?.boundaryGeoJson?.features).toHaveLength(1);
    expect(seurasaari?.boundaryGeoJson?.features[0]?.geometry.type).toBe('Polygon');

    const mustikkamaa = await getParkBySlug(testDatabase.database, 'mustikkamaa');
    expect(mustikkamaa).toMatchObject({
      address: 'Mustikkamaantie 10, 00570 Helsinki',
      lipasId: 9001073,
      locationLabel: 'Mustikkamaantie 10',
      parkUrl:
        'https://www.hel.fi/fi/kulttuuri-ja-vapaa-aika/ulkoilu-puistot-ja-luontokohteet/ulkoilualueet/mustikkamaa',
      name: 'Mustikkamaa',
      postalCode: '00570',
      postalOffice: 'Helsinki',
      type: { slug: 'outdoor-recreation-area' }
    });
    expect(mustikkamaa?.boundaryGeoJson?.features).toHaveLength(1);
    expect(mustikkamaa?.boundaryGeoJson?.features[0]?.geometry.type).toBe('Polygon');

    const expectedLuontoonDestinationImports: ExpectedLuontoonDestinationImport[] = [
      {
        displayTypeName: 'Soidensuojelualue',
        lipasId: 9001045,
        name: 'Litokairan soidensuojelualue',
        slug: 'litokairan-soidensuojelualue',
        typeSlug: 'nature-reserve-area'
      },
      {
        displayTypeName: 'Soidensuojelualue',
        lipasId: 9001046,
        name: 'Martimoaavan soidensuojelualue',
        slug: 'martimoaavan-soidensuojelualue',
        typeSlug: 'nature-reserve-area'
      },
      {
        displayTypeName: 'Soidensuojelualue',
        lipasId: 9001047,
        name: 'Paukanevan soidensuojelualue',
        slug: 'paukanevan-soidensuojelualue',
        typeSlug: 'nature-reserve-area'
      },
      {
        lipasId: 9001048,
        name: 'Neitvuori ja Luonterin luonnonsuojelualue',
        slug: 'neitvuori-ja-luonterin-luonnonsuojelualue',
        typeSlug: 'nature-reserve-area'
      },
      {
        lipasId: 9001049,
        name: 'Koskeljärvi',
        slug: 'koskeljarvi',
        typeSlug: 'outdoor-recreation-area'
      },
      {
        lipasId: 9001050,
        name: 'Kurimonkoski',
        slug: 'kurimonkoski',
        typeSlug: 'outdoor-recreation-area'
      },
      {
        lipasId: 9001051,
        name: 'Pukala',
        slug: 'pukala',
        typeSlug: 'outdoor-recreation-area'
      },
      {
        lipasId: 9001052,
        name: 'Peurajärvi',
        slug: 'peurajarvi',
        typeSlug: 'outdoor-recreation-area'
      },
      {
        lipasId: 9001053,
        name: 'Hepoköngäs',
        slug: 'hepokongas',
        typeSlug: 'nature-reserve-area'
      },
      {
        lipasId: 9001054,
        name: 'Auttiköngäs',
        slug: 'auttikongas',
        typeSlug: 'outdoor-recreation-area'
      },
      {
        lipasId: 9001055,
        name: 'Pinkjärvi',
        slug: 'pinkjarvi',
        typeSlug: 'outdoor-recreation-area'
      },
      {
        lipasId: 9001056,
        name: 'Soiperoinen',
        slug: 'soiperoinen',
        typeSlug: 'outdoor-recreation-area'
      },
      {
        lipasId: 9001057,
        name: 'Unarinköngäs',
        slug: 'unarinkongas',
        typeSlug: 'outdoor-recreation-area'
      }
    ] as const;

    for (const expectedPark of expectedLuontoonDestinationImports) {
      const park = await getParkBySlug(testDatabase.database, expectedPark.slug);

      expect(park).toMatchObject({
        ...(expectedPark.displayTypeName ? { displayTypeName: expectedPark.displayTypeName } : {}),
        lipasId: expectedPark.lipasId,
        parkUrl: `https://www.luontoon.fi/fi/kohteet/${expectedPark.slug}`,
        name: expectedPark.name,
        type: { slug: expectedPark.typeSlug }
      });
      expect(park?.boundaryGeoJson?.features.length).toBeGreaterThan(0);
      expect(
        park?.boundaryGeoJson?.features.every((feature) => feature.geometry.type === 'Polygon')
      ).toBe(true);
    }

    const soidensuojelualueSlugs = [
      'ilmakkiaavan-soidensuojelualue',
      'juortanansalon-lapinsuon-soidensuojelualue-ystavyyden-puisto',
      'siikanevan-soidensuojelualue',
      'viiankiaavan-soidensuojelualue'
    ] as const;

    for (const slug of soidensuojelualueSlugs) {
      const park = await getParkBySlug(testDatabase.database, slug);
      expect(park).toMatchObject({ displayTypeName: 'Soidensuojelualue' });
    }

    const liimanninkoski = await getParkBySlug(
      testDatabase.database,
      'liimanninkosken-lehtojensuojelualue'
    );
    expect(liimanninkoski).toMatchObject({
      lipasId: 9001027,
      name: 'Liimanninkosken lehtojensuojelualue',
      type: { slug: 'nature-reserve-area' }
    });

    const olvassuo = await getParkBySlug(testDatabase.database, 'olvassuon-luonnonpuisto');
    expect(olvassuo).toMatchObject({
      displayTypeName: 'Luonnonpuisto',
      lipasId: 9001029,
      name: 'Olvassuon luonnonpuisto',
      type: { slug: 'nature-reserve-area' }
    });

    const korouoma = await getParkBySlug(testDatabase.database, 'korouoma');
    expect(korouoma).toMatchObject({
      lipasId: 9001037,
      name: 'Korouoma',
      type: { slug: 'nature-reserve-area' }
    });

    const lapakisto = await getParkBySlug(testDatabase.database, 'lapakisto');
    expect(lapakisto).toMatchObject({
      lipasId: 9001038,
      name: 'Lapakisto',
      type: { slug: 'nature-reserve-area' }
    });

    const sanginjoki = await getParkBySlug(testDatabase.database, 'sanginjoki');
    expect(sanginjoki).toMatchObject({
      lipasId: 9001041,
      locationLabel: 'Loppula',
      parkUrl: 'https://www.luontoon.fi/fi/kohteet/sanginjoki',
      name: 'Sanginjoki',
      type: { slug: 'nature-reserve-area' }
    });
    if (!sanginjoki) {
      throw new Error('Sanginjoki should have been imported.');
    }
    expect(sanginjoki.boundingBox.minLon).toBeLessThan(25.75);
    expect(sanginjoki.boundingBox.maxLon).toBeGreaterThan(25.9);
    expect(sanginjoki.boundingBox.maxLat).toBeGreaterThan(65.03);

    const koivusuo = await getParkBySlug(testDatabase.database, 'koivusuon-luonnonpuisto');
    expect(koivusuo).toMatchObject({
      displayTypeName: 'Luonnonpuisto',
      lipasId: 9001040,
      parkUrl: 'https://www.luontoon.fi/fi/reitit/tapion-taival-reitti-ilomantsi-47985',
      name: 'Koivusuon luonnonpuisto',
      type: { slug: 'nature-reserve-area' }
    });

    const harola = await getParkBySlug(testDatabase.database, 'harola');
    expect(harola).toMatchObject({
      lipasId: 9001030,
      name: 'Harola',
      type: { slug: 'outdoor-recreation-area' }
    });

    const kajaaninLinna = await getParkBySlug(testDatabase.database, 'kajaanin-linna');
    expect(kajaaninLinna).toMatchObject({
      lipasId: 9001031,
      name: 'Kajaanin linna',
      type: { slug: 'cultural-history-area' }
    });

    const kuusistonLinna = await getParkBySlug(testDatabase.database, 'kuusiston-linna');
    expect(kuusistonLinna).toMatchObject({
      lipasId: 9001039,
      name: 'Kuusiston linna',
      type: { slug: 'cultural-history-area' }
    });

    const latokartanonkoski = await getParkBySlug(testDatabase.database, 'latokartanonkoski');
    expect(latokartanonkoski).toMatchObject({
      lipasId: 9001042,
      parkUrl: 'https://www.luontoon.fi/fi/kohteet/latokartanonkoski',
      name: 'Latokartanonkoski',
      type: { slug: 'cultural-history-area' }
    });

    const karnakoskenLinnoitus = await getParkBySlug(
      testDatabase.database,
      'karnakosken-linnoitus'
    );
    expect(karnakoskenLinnoitus).toMatchObject({
      lipasId: 9001043,
      parkUrl: 'https://www.luontoon.fi/fi/kohteet/karnakosken-linnoitus',
      name: 'Kärnäkosken linnoitus',
      type: { slug: 'cultural-history-area' }
    });

    const expectedMuseovirastoHistoryImports = [
      {
        lipasId: 9001058,
        name: 'Bengtskärin majakka',
        slug: 'bengtskarin-majakka'
      },
      {
        lipasId: 9001059,
        name: 'Haapasaaren saaristokylä',
        slug: 'haapasaaren-saaristokyla'
      },
      {
        lipasId: 9001060,
        name: 'Kaunissaaren saaristokylä',
        slug: 'kaunissaaren-saaristokyla'
      },
      {
        lipasId: 9001061,
        name: 'Vanajanlinna',
        slug: 'vanajanlinna'
      },
      {
        lipasId: 9001062,
        name: 'Kissakosken kanava',
        slug: 'kissakosken-kanava'
      },
      {
        lipasId: 9001063,
        name: 'Jyväskylän harju',
        slug: 'harju'
      },
      {
        displayTypeName: 'Maailmanperintökohde',
        lipasId: 9001064,
        name: 'Petäjäveden vanha kirkko',
        slug: 'petajaveden-vanha-kirkko'
      },
      {
        lipasId: 9001065,
        name: 'Ylivieskan savisilta',
        slug: 'savisilta'
      },
      {
        lipasId: 9001066,
        name: 'Vääksyn kanava',
        slug: 'vaaksyn-kanava'
      },
      {
        lipasId: 9001067,
        name: 'Reposaari',
        slug: 'reposaari'
      },
      {
        lipasId: 9001068,
        name: 'Träskändan kartano',
        slug: 'traskandan-kartano'
      },
      {
        lipasId: 9001069,
        name: 'Helsingin Vanhakaupunki',
        slug: 'helsingin-vanhakaupunki'
      }
    ] as const;

    for (const expectedPark of expectedMuseovirastoHistoryImports) {
      const park = await getParkBySlug(testDatabase.database, expectedPark.slug);

      expect(park).toMatchObject({
        lipasId: expectedPark.lipasId,
        parkUrl: null,
        name: expectedPark.name,
        type: { slug: 'cultural-history-area' }
      });
    }

    const pyhamaa = await getParkBySlug(testDatabase.database, 'pyhamaa');
    expect(pyhamaa).toMatchObject({
      lipasId: 9001074,
      parkUrl: 'https://www.rky.fi/read/asp/r_kohde_det.aspx?KOHDE_ID=1840',
      name: 'Pyhämaa',
      type: { slug: 'cultural-history-area' }
    });

    const hollolanKirkonkyla = await getParkBySlug(testDatabase.database, 'hollolan-kirkonkyla');
    expect(hollolanKirkonkyla).toMatchObject({
      lipasId: 9001075,
      parkUrl: 'https://www.rky.fi/read/asp/r_kohde_det.aspx?KOHDE_ID=284',
      name: 'Hollolan kirkonkylä',
      type: { slug: 'cultural-history-area' }
    });

    const tammerkoski = await getParkBySlug(testDatabase.database, 'tammerkoski');
    expect(tammerkoski).toMatchObject({
      lipasId: 9001077,
      parkUrl: 'https://www.rky.fi/read/asp/r_kohde_det.aspx?KOHDE_ID=5021',
      name: 'Tammerkoski',
      type: { slug: 'cultural-history-area' }
    });

    const loviisanAlakaupunki = await getParkBySlug(testDatabase.database, 'loviisan-alakaupunki');
    expect(loviisanAlakaupunki).toMatchObject({
      lipasId: 9001078,
      parkUrl: 'https://www.rky.fi/read/asp/r_kohde_det.aspx?KOHDE_ID=1519',
      name: 'Loviisan alakaupunki',
      type: { slug: 'cultural-history-area' }
    });

    const louhisaarenKartano = await getParkBySlug(testDatabase.database, 'louhisaaren-kartano');
    expect(louhisaarenKartano).toMatchObject({
      lipasId: 9001081,
      parkUrl: 'https://www.rky.fi/read/asp/r_kohde_det.aspx?KOHDE_ID=1750',
      name: 'Louhisaaren kartano',
      type: { slug: 'cultural-history-area' }
    });

    const sipoonlinna = await getParkBySlug(testDatabase.database, 'sipoonlinna');
    expect(sipoonlinna).toMatchObject({
      lipasId: 9001082,
      parkUrl: 'https://www.rky.fi/read/asp/r_kohde_det.aspx?KOHDE_ID=4142',
      name: 'Sipoonlinna',
      type: { slug: 'cultural-history-area' }
    });

    const inionKirkonkyla = await getParkBySlug(testDatabase.database, 'inion-kirkonkyla');
    expect(inionKirkonkyla).toMatchObject({
      lipasId: 9001083,
      parkUrl: 'https://www.rky.fi/read/asp/r_kohde_det.aspx?KOHDE_ID=5118',
      name: 'Iniön kirkonkylä',
      type: { slug: 'cultural-history-area' }
    });

    const turunmaanKalkkilouhokset = await getParkBySlug(
      testDatabase.database,
      'turunmaan-kalkkilouhokset'
    );
    expect(turunmaanKalkkilouhokset).toMatchObject({
      lipasId: 9001079,
      parkUrl: 'https://www.rky.fi/read/asp/r_kohde_det.aspx?KOHDE_ID=1799',
      name: 'Turunmaan kalkkilouhokset',
      type: { slug: 'cultural-history-area' }
    });

    const fiskars = await getParkBySlug(testDatabase.database, 'fiskarsin-ruukki');
    expect(fiskars).toMatchObject({
      address: 'Fiskarsintie 9, 10470 Fiskars',
      displayTypeName: 'Tehdaskylä',
      lipasId: 9002003,
      locationLabel: 'Fiskarsintie 9',
      name: 'Fiskarsin ruukki',
      postalCode: '10470',
      postalOffice: 'Fiskars',
      type: { slug: 'cultural-history-area' }
    });

    const verla = await getParkBySlug(testDatabase.database, 'verla');
    expect(verla).toMatchObject({
      address: 'Verlantie 295, 47850 Verla',
      displayTypeName: 'Maailmanperintökohde',
      lipasId: 9002023,
      locationLabel: 'Verlantie 295',
      name: 'Verla',
      postalCode: '47850',
      postalOffice: 'Verla',
      type: { slug: 'cultural-history-area' }
    });

    const juankoski = await getParkBySlug(testDatabase.database, 'juankosken-ruukki');
    expect(juankoski).toMatchObject({
      displayTypeName: 'Tehdaskylä',
      lipasId: 9002024,
      name: 'Juankosken ruukki',
      type: { slug: 'cultural-history-area' }
    });

    const nuutajarvi = await getParkBySlug(testDatabase.database, 'nuutajarven-lasikyla');
    expect(nuutajarvi).toMatchObject({
      address: 'Pruukinraitti 15, 31160 Urjala',
      displayTypeName: 'Tehdaskylä',
      lipasId: 9002025,
      locationLabel: 'Pruukinraitti 15',
      name: 'Nuutajärven lasikylä',
      postalCode: '31160',
      postalOffice: 'Urjala',
      type: { slug: 'cultural-history-area' }
    });

    const expectedFactoryVillageImports = [
      {
        lipasId: 9002028,
        name: 'Lapuan patruunatehdas',
        slug: 'lapuan-patruunatehdas'
      },
      {
        lipasId: 9002029,
        name: 'Vääräkosken kartonkitehdas',
        slug: 'vaarakosken-kartonkitehdas'
      },
      {
        lipasId: 9002030,
        name: 'Riihimäen lasitehdas',
        slug: 'riihimaen-lasitehdas'
      },
      {
        lipasId: 9002031,
        name: 'Koskenkylän ruukinalue',
        slug: 'koskenkylan-ruukinalue'
      }
    ] as const;

    for (const expectedPark of expectedFactoryVillageImports) {
      const park = await getParkBySlug(testDatabase.database, expectedPark.slug);

      expect(park).toMatchObject({
        displayTypeName: 'Tehdaskylä',
        lipasId: expectedPark.lipasId,
        parkUrl: null,
        name: expectedPark.name,
        type: { slug: 'cultural-history-area' }
      });
    }
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

    expect(allParks).toHaveLength(129);
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

  it('fails when a geojson source contains an unsupported geometry type', async () => {
    await expect(
      importSpecialParks({
        database: testDatabase.database,
        fetchSource: async (sourceUrl) => {
          if (sourceUrl === 'special://seili') {
            return {
              type: 'FeatureCollection',
              features: [
                {
                  type: 'Feature',
                  geometry: {
                    type: 'Point',
                    coordinates: [22.0, 60.0]
                  }
                }
              ]
            };
          }

          return createSpecialParksSource()(sourceUrl);
        }
      })
    ).rejects.toThrow('Unsupported geometry type "Point" in special parks source.');
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

    expect(result.results).toHaveLength(129);

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
      name: 'Seili',
      type: { slug: 'cultural-history-area' }
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

    const rokovallio = await getParkBySlug(testDatabase.database, 'rokokallio');
    expect(rokovallio).toMatchObject({
      name: 'Rokokallio',
      type: { slug: 'outdoor-recreation-area' }
    });

    const kuhakoski = await getParkBySlug(testDatabase.database, 'kuhakoski');
    expect(kuhakoski).toMatchObject({
      name: 'Kuhakoski',
      type: { slug: 'cultural-history-area' }
    });

    const kallahti = await getParkBySlug(testDatabase.database, 'kallahden-ulkoilualue');
    expect(kallahti).toMatchObject({
      name: 'Kallahden ulkoilualue',
      type: { slug: 'outdoor-recreation-area' }
    });
  });

  it('can import only selected special parks by slug', async () => {
    const result = await importSpecialParks({
      database: testDatabase.database,
      fetchSource: createSpecialParksSource(),
      includeSlugs: ['loviisan-alakaupunki', 'turunmaan-kalkkilouhokset'],
      now: () => '2026-05-27T08:00:00.000Z'
    });

    expect(result.results).toEqual([
      {
        featureCount: 1,
        importRunId: 1,
        name: 'Loviisan alakaupunki',
        slug: 'loviisan-alakaupunki'
      },
      {
        featureCount: 4,
        importRunId: 2,
        name: 'Turunmaan kalkkilouhokset',
        slug: 'turunmaan-kalkkilouhokset'
      }
    ]);

    const allParks = await listParks(testDatabase.database);
    expect(allParks).toHaveLength(2);

    const loviisanAlakaupunki = await getParkBySlug(testDatabase.database, 'loviisan-alakaupunki');
    expect(loviisanAlakaupunki).toMatchObject({
      lipasId: 9001078,
      name: 'Loviisan alakaupunki',
      type: { slug: 'cultural-history-area' }
    });

    const turunmaanKalkkilouhokset = await getParkBySlug(
      testDatabase.database,
      'turunmaan-kalkkilouhokset'
    );
    expect(turunmaanKalkkilouhokset).toMatchObject({
      lipasId: 9001079,
      name: 'Turunmaan kalkkilouhokset',
      type: { slug: 'cultural-history-area' }
    });
  });

  it('treats an empty selected-slug list like a full special import', async () => {
    const result = await importSpecialParks({
      database: testDatabase.database,
      fetchSource: createSpecialParksSource(),
      includeSlugs: [],
      now: () => '2026-05-27T08:00:00.000Z'
    });

    expect(result.results).toHaveLength(129);
  });

  it('fails clearly when a selected special-park slug is unknown', async () => {
    await expect(
      importSpecialParks({
        database: testDatabase.database,
        fetchSource: createSpecialParksSource(),
        includeSlugs: ['missing-special-park'],
        now: () => '2026-05-27T08:00:00.000Z'
      })
    ).rejects.toThrow('Unknown special park slug(s): missing-special-park.');
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

  it('keeps luontoon destination area null when surface area metadata is missing', async () => {
    await importSpecialParks({
      database: testDatabase.database,
      fetchSource: async (sourceUrl) => {
        if (sourceUrl === paistjarviSourceUrl) {
          return {
            type: 'FeatureCollection',
            features: [
              {
                type: 'Feature',
                geometry: {
                  type: 'Polygon',
                  coordinates: [
                    [
                      [26.3364, 61.2622],
                      [26.3364, 61.3146],
                      [26.4688, 61.3146],
                      [26.4688, 61.2622],
                      [26.3364, 61.2622]
                    ]
                  ]
                },
                properties: {
                  name_fi: 'Paistjärvi',
                  slug: 'paistjarvi'
                }
              }
            ]
          };
        }

        return createSpecialParksSource()(sourceUrl);
      },
      now: () => '2026-05-27T08:00:00.000Z'
    });

    const paistjarvi = await testDatabase.database.query.parks.findFirst({
      where: eq(parks.slug, 'paistjarvi')
    });

    expect(paistjarvi?.areaKm2).toBeNull();
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

  it('keeps GeoJSON area metadata null when area_m2 is missing', async () => {
    await importSpecialParks({
      database: testDatabase.database,
      fetchSource: async (sourceUrl) => {
        if (sourceUrl.includes("cql_filter=nimi='Rokokallio'")) {
          return {
            type: 'FeatureCollection',
            features: [
              {
                geometry: {
                  coordinates: [
                    [
                      [
                        [24.45, 60.48],
                        [24.47, 60.48],
                        [24.47, 60.5],
                        [24.45, 60.5],
                        [24.45, 60.48]
                      ]
                    ]
                  ],
                  type: 'MultiPolygon'
                },
                properties: {
                  nimi: 'Rokokallio'
                },
                type: 'Feature'
              }
            ]
          };
        }

        return createSpecialParksSource()(sourceUrl);
      },
      now: () => '2026-05-27T08:00:00.000Z'
    });

    const rokovallio = await testDatabase.database.query.parks.findFirst({
      where: eq(parks.slug, 'rokokallio')
    });

    expect(rokovallio?.areaKm2).toBeNull();
    expect(rokovallio?.establishmentYear).toBeNull();
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
