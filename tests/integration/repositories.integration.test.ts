import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createVisit,
  createVisitImage,
  deleteVisit,
  deleteVisitImage,
  getCatalogListEtagSeed,
  getParkBySlug,
  getParkBySlugIncludingRemoved,
  getParkVisitsBySlug,
  getPublicHomeSummary,
  getVisitById,
  listParkRecordsIncludingRemoved,
  listRemovedParks,
  listVisits,
  reassignParkVisits,
  reorderVisitImages,
  updateParkDetails,
  updateParkLogo,
  updateParkMap,
  updateVisit
} from '../../src/db/repositories.js';
import { parks } from '../../src/db/schema.js';
import { importParks } from '../../src/importer/import-parks.js';
import { createLipasPark } from '../fixtures/lipas.js';
import { createTestDatabase } from '../helpers/test-db.js';

describe('repositories', () => {
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    testDatabase = await createTestDatabase();

    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 1,
      now: () => '2026-05-01T10:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [createLipasPark()]
      })
    });
  });

  afterEach(async () => {
    await testDatabase.dispose();
  });

  it('returns null for missing parks', async () => {
    await expect(getParkBySlug(testDatabase.database, 'missing-park')).resolves.toBeNull();
    await expect(
      getParkBySlugIncludingRemoved(testDatabase.database, 'missing-park')
    ).resolves.toBeNull();
    await expect(
      getParkVisitsBySlug(testDatabase.database, 'missing-park', async () => '')
    ).resolves.toBeNull();
    await expect(getVisitById(testDatabase.database, 99999, async () => '')).resolves.toBeNull();

    const parkVisits = await getParkVisitsBySlug(
      testDatabase.database,
      'akasmannyn-kansallispuisto',
      async () => ''
    );
    expect(parkVisits?.visits).toEqual([]);
  });

  it('returns null when updating logo for a missing park', async () => {
    const result = await updateParkLogo(testDatabase.database, 'missing-park', {
      key: 'logos/test.png',
      updatedAt: '2026-05-01T10:00:00.000Z'
    });

    expect(result).toBeNull();
  });

  it('returns null when updating map for a missing park', async () => {
    const result = await updateParkMap(testDatabase.database, 'missing-park', {
      key: 'pdf-maps/test.pdf',
      updatedAt: '2026-05-01T10:00:00.000Z'
    });

    expect(result).toBeNull();
  });

  it('returns null when updating details for a missing park', async () => {
    await expect(
      updateParkDetails(testDatabase.database, 'missing-park', {
        name: 'Missing park'
      })
    ).resolves.toBeNull();
  });

  it('updates editable park details and resolves removed parks when requested explicitly', async () => {
    await testDatabase.database
      .update(parks)
      .set({ removed: true })
      .where(eq(parks.slug, 'akasmannyn-kansallispuisto'));

    const updated = await updateParkDetails(testDatabase.database, 'akasmannyn-kansallispuisto', {
      areaKm2: null,
      displayTypeName: null,
      establishmentYear: 1999,
      locationLabel: 'Oma osoite 4',
      luontoonUrl: 'www.luontoon.fi/oma-kohde',
      name: 'Oma kohde',
      postalCode: null,
      postalOffice: 'Muonio'
    });

    expect(updated).toMatchObject({
      address: 'Oma osoite 4, Muonio',
      areaKm2: null,
      establishmentYear: 1999,
      locationLabel: 'Oma osoite 4',
      luontoonUrl: 'https://www.luontoon.fi/oma-kohde',
      name: 'Oma kohde',
      postalCode: null,
      postalOffice: 'Muonio',
      slug: 'oma-kohde'
    });
    expect(updated).not.toHaveProperty('displayTypeName');
    await expect(getParkBySlug(testDatabase.database, 'oma-kohde')).resolves.toBeNull();
    await expect(
      getParkBySlugIncludingRemoved(testDatabase.database, 'oma-kohde')
    ).resolves.toMatchObject({
      name: 'Oma kohde',
      slug: 'oma-kohde'
    });
  });

  it('rejects invalid luontoon urls and conflicting park slugs', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 2,
      now: () => '2026-05-02T10:00:00.000Z',
      sourceUrl: 'https://example.test/lipas-second-park',
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
            www: 'https://www.luontoon.fi/seitseminen'
          })
        ]
      })
    });

    await expect(
      updateParkDetails(testDatabase.database, 'akasmannyn-kansallispuisto', {
        luontoonUrl: 'not a real url'
      })
    ).rejects.toThrow('Invalid Luontoon URL.');

    await expect(
      updateParkDetails(testDatabase.database, 'akasmannyn-kansallispuisto', {
        slug: 'seitsemisen-kansallispuisto'
      })
    ).rejects.toThrow('Park slug "seitsemisen-kansallispuisto" is already in use.');

    await expect(
      updateParkDetails(testDatabase.database, 'akasmannyn-kansallispuisto', {
        name: '   '
      })
    ).rejects.toThrow('Name is required.');
  });

  it('can clear luontoon url while leaving other editable fields unchanged', async () => {
    const updated = await updateParkDetails(testDatabase.database, 'akasmannyn-kansallispuisto', {
      luontoonUrl: null,
      name: 'Päivitetty puisto'
    });

    expect(updated).toMatchObject({
      address: 'Puistotie 1, 00999 Testikylä',
      areaKm2: 12.5,
      establishmentYear: 1982,
      locationLabel: 'Puistotie 1',
      luontoonUrl: null,
      name: 'Päivitetty puisto',
      postalCode: '00999',
      postalOffice: 'Testikylä',
      slug: 'paivitetty-puisto'
    });
    expect(updated).not.toHaveProperty('displayTypeName');
  });

  it('lists park records including removed rows with display type names', async () => {
    await testDatabase.database
      .update(parks)
      .set({
        displayTypeName: 'Ystävyyden puisto',
        removed: true
      })
      .where(eq(parks.slug, 'akasmannyn-kansallispuisto'));

    await expect(listParkRecordsIncludingRemoved(testDatabase.database)).resolves.toEqual([
      {
        displayTypeName: 'Ystävyyden puisto',
        slug: 'akasmannyn-kansallispuisto'
      }
    ]);
  });

  it('normalizes park location values for address, postal code, and postal office combinations', async () => {
    await expect(
      getParkBySlug(testDatabase.database, 'akasmannyn-kansallispuisto')
    ).resolves.toMatchObject({
      address: 'Puistotie 1, 00999 Testikylä'
    });

    await testDatabase.database
      .update(parks)
      .set({ postalOffice: 'Puistotie 1' })
      .where(eq(parks.slug, 'akasmannyn-kansallispuisto'));

    await expect(
      getParkBySlug(testDatabase.database, 'akasmannyn-kansallispuisto')
    ).resolves.toMatchObject({
      address: 'Puistotie 1, 00999'
    });

    await testDatabase.database
      .update(parks)
      .set({ postalCode: null })
      .where(eq(parks.slug, 'akasmannyn-kansallispuisto'));

    await expect(
      getParkBySlug(testDatabase.database, 'akasmannyn-kansallispuisto')
    ).resolves.toMatchObject({
      address: 'Puistotie 1'
    });

    await testDatabase.database
      .update(parks)
      .set({ locationLabel: '', postalCode: '00999', postalOffice: 'Testikylä' })
      .where(eq(parks.slug, 'akasmannyn-kansallispuisto'));

    await expect(
      getParkBySlug(testDatabase.database, 'akasmannyn-kansallispuisto')
    ).resolves.toMatchObject({
      address: '00999 Testikylä'
    });

    await testDatabase.database
      .update(parks)
      .set({ locationLabel: 'Puistotie 1', postalOffice: null, postalCode: null })
      .where(eq(parks.slug, 'akasmannyn-kansallispuisto'));

    await expect(
      getParkBySlug(testDatabase.database, 'akasmannyn-kansallispuisto')
    ).resolves.toMatchObject({
      address: 'Puistotie 1'
    });
  });

  it('preserves existing visit fields when only the date changes and reports missing deletes', async () => {
    const visit = await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      author: 'Alice',
      note: 'First draft',
      route: 'Loop A',
      visitedOn: '2026-04-11'
    });

    const updatedVisit = await updateVisit(testDatabase.database, visit.id, {
      visitedOn: '2026-04-12'
    });

    expect(updatedVisit).toMatchObject({
      author: 'Alice',
      note: 'First draft',
      route: 'Loop A',
      visitedOn: '2026-04-12'
    });
    await expect(deleteVisit(testDatabase.database, 99999)).resolves.toBe(false);
    await expect(deleteVisitImage(testDatabase.database, 99999)).resolves.toBe(false);
  });

  it('supports creating visits without optional fields and patching individual fields', async () => {
    const visit = await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-04-13'
    });

    expect(visit.author).toBeNull();
    expect(visit.note).toBeNull();
    expect(visit.route).toBeNull();

    const updatedVisit = await updateVisit(testDatabase.database, visit.id, {
      author: 'Bob',
      note: 'Added later',
      route: 'Loop B'
    });

    expect(updatedVisit).toMatchObject({
      author: 'Bob',
      note: 'Added later',
      route: 'Loop B',
      visitedOn: '2026-04-13'
    });

    const clearedVisit = await updateVisit(testDatabase.database, visit.id, {
      author: '   ',
      note: '   ',
      route: '   '
    });

    expect(clearedVisit).toMatchObject({
      author: null,
      note: null,
      route: null,
      visitedOn: '2026-04-13'
    });
  });

  it('returns an empty catalog etag seed when no active parks remain', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 0,
      now: () => '2026-05-02T10:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark({
            status: 'incorrect-data'
          })
        ]
      })
    });

    await expect(getCatalogListEtagSeed(testDatabase.database)).resolves.toEqual({
      activeCount: 0,
      filterKey: null,
      latestImportRunId: null,
      latestUpdatedAt: null,
      typeSlug: null
    });
  });

  it('builds a catalog etag seed for a non-trail category filter', async () => {
    await expect(
      getCatalogListEtagSeed(testDatabase.database, {
        categorySlug: 'national-park'
      })
    ).resolves.toMatchObject({
      activeCount: 1,
      filterKey: 'category:national-park',
      typeSlug: null
    });
  });

  it('builds a catalog etag seed for the combined hiking and wilderness category filter', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 2,
      now: () => '2026-05-02T10:15:00.000Z',
      sourceUrl: 'https://example.test/lipas-combined-areas',
      fetchSource: async () => ({
        items: [
          createLipasPark({
            'lipas-id': 70001,
            name: 'Evon retkeilyalue',
            type: {
              'type-code': 109
            }
          }),
          createLipasPark({
            'lipas-id': 70002,
            name: 'Käsivarren erämaa-alue',
            type: {
              'type-code': 110
            }
          })
        ]
      })
    });

    await expect(
      getCatalogListEtagSeed(testDatabase.database, {
        categorySlug: 'hiking-and-wilderness-areas'
      })
    ).resolves.toMatchObject({
      activeCount: 2,
      filterKey: 'category:hiking-and-wilderness-areas',
      typeSlug: null
    });
  });

  it('returns empty visit list when no active parks remain', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 0,
      now: () => '2026-05-02T10:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark({
            status: 'incorrect-data'
          })
        ]
      })
    });

    await expect(listVisits(testDatabase.database, async () => '')).resolves.toEqual([]);
  });

  it('lists flat visits and park-scoped visit history across multiple parks', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 2,
      now: () => '2026-05-01T10:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark(),
          createLipasPark({
            'lipas-id': 99999,
            name: 'Toinen puisto'
          })
        ]
      })
    });

    await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      author: 'Alice',
      note: 'Visit A1',
      route: 'North',
      visitedOn: '2026-04-10'
    });
    await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      note: 'Visit A2',
      visitedOn: '2026-04-11'
    });
    await createVisit(testDatabase.database, 'toinen-puisto', {
      visitedOn: '2026-03-20'
    });

    const visits = await listVisits(testDatabase.database, async () => '');
    const firstParkVisits = await getParkVisitsBySlug(
      testDatabase.database,
      'akasmannyn-kansallispuisto',
      async () => ''
    );
    const secondParkVisits = await getParkVisitsBySlug(
      testDatabase.database,
      'toinen-puisto',
      async () => ''
    );

    expect(visits).toHaveLength(3);
    expect(visits[0]).toMatchObject({
      note: 'Visit A2',
      park: {
        name: 'Äkäsmännyn kansallispuisto',
        slug: 'akasmannyn-kansallispuisto'
      },
      visitedOn: '2026-04-11'
    });
    expect(visits[2]).toMatchObject({
      park: {
        name: 'Toinen puisto',
        slug: 'toinen-puisto'
      },
      visitedOn: '2026-03-20'
    });

    expect(firstParkVisits).toMatchObject({
      visitedSummary: {
        visited: true,
        visitCount: 2,
        lastVisitedOn: '2026-04-11'
      }
    });
    expect(firstParkVisits?.visits).toHaveLength(2);
    expect(firstParkVisits?.visits[0]).toMatchObject({
      author: null,
      note: 'Visit A2',
      route: null,
      visitedOn: '2026-04-11'
    });

    expect(secondParkVisits).toMatchObject({
      visitedSummary: {
        visited: true,
        visitCount: 1,
        lastVisitedOn: '2026-03-20'
      }
    });
    expect(secondParkVisits?.visits).toHaveLength(1);
    expect(secondParkVisits?.visits[0]).toMatchObject({
      author: null,
      note: null,
      route: null,
      visitedOn: '2026-03-20'
    });
  });

  it('includes empty images array for visits without images', async () => {
    const visitWithImage = await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-04-10'
    });
    const visitWithoutImage = await createVisit(
      testDatabase.database,
      'akasmannyn-kansallispuisto',
      {
        visitedOn: '2026-04-11'
      }
    );

    await createVisitImage(testDatabase.database, {
      createdAt: new Date().toISOString(),
      displayOrder: 0,
      fullHeight: 100,
      fullKey: 'k1',
      fullWidth: 100,
      mimeType: 'image/jpeg',
      thumbHeight: 50,
      thumbKey: 't1',
      thumbWidth: 50,
      updatedAt: new Date().toISOString(),
      visitId: visitWithImage.id
    });

    const parkVisits = await getParkVisitsBySlug(
      testDatabase.database,
      'akasmannyn-kansallispuisto',
      async () => ''
    );

    expect(parkVisits?.visits).toHaveLength(2);
    const withImage = parkVisits?.visits.find((visit) => visit.id === visitWithImage.id);
    const withoutImage = parkVisits?.visits.find((visit) => visit.id === visitWithoutImage.id);
    expect(withImage?.images).toHaveLength(1);
    expect(withoutImage?.images).toEqual([]);
  });

  it('reorders visit images and rejects invalid order', async () => {
    const visit = await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-04-10'
    });

    const timestamp = new Date().toISOString();
    const img1 = await createVisitImage(testDatabase.database, {
      createdAt: timestamp,
      displayOrder: 0,
      fullHeight: 100,
      fullKey: 'k1',
      fullWidth: 100,
      mimeType: 'image/jpeg',
      thumbHeight: 50,
      thumbKey: 't1',
      thumbWidth: 50,
      updatedAt: timestamp,
      visitId: visit.id
    });
    const img2 = await createVisitImage(testDatabase.database, {
      createdAt: timestamp,
      displayOrder: 0,
      fullHeight: 100,
      fullKey: 'k2',
      fullWidth: 100,
      mimeType: 'image/jpeg',
      thumbHeight: 50,
      thumbKey: 't2',
      thumbWidth: 50,
      updatedAt: timestamp,
      visitId: visit.id
    });

    await reorderVisitImages(testDatabase.database, visit.id, [img2.id, img1.id]);

    const parkVisits = await getParkVisitsBySlug(
      testDatabase.database,
      'akasmannyn-kansallispuisto',
      async () => ''
    );

    expect(parkVisits?.visits[0]?.images[0]?.id).toBe(img2.id);
    expect(parkVisits?.visits[0]?.images[1]?.id).toBe(img1.id);

    await expect(reorderVisitImages(testDatabase.database, visit.id, [img1.id])).rejects.toThrow(
      'Invalid image order'
    );

    await expect(
      reorderVisitImages(testDatabase.database, visit.id, [99999, img1.id])
    ).rejects.toThrow('Invalid image order');
  });

  it('reassigns visits and keeps visit images attached under the target park', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 3,
      now: () => '2026-05-01T10:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark(),
          createLipasPark({
            'lipas-id': 99999,
            name: 'Vallisaari',
            type: { 'type-code': 103 },
            www: 'https://www.luontoon.fi/vallisaari'
          }),
          createLipasPark({
            'lipas-id': 440499,
            name: 'Aleksanterin kierros',
            type: { 'type-code': 103 },
            www: 'https://www.luontoon.fi/aleksanterin-kierros'
          })
        ]
      })
    });

    const sourceVisit = await createVisit(testDatabase.database, 'aleksanterin-kierros', {
      note: 'Route visit note',
      route: 'Aleksanterin kierros',
      visitedOn: '2026-04-10'
    });
    await createVisit(testDatabase.database, 'vallisaari', {
      note: 'Destination visit note',
      visitedOn: '2026-04-11'
    });

    await createVisitImage(testDatabase.database, {
      createdAt: '2026-05-01T10:00:00.000Z',
      displayOrder: 0,
      fullHeight: 100,
      fullKey: 'visits/1/full.jpg',
      fullWidth: 100,
      mimeType: 'image/jpeg',
      thumbHeight: 50,
      thumbKey: 'visits/1/thumb.jpg',
      thumbWidth: 50,
      updatedAt: '2026-05-01T10:00:00.000Z',
      visitId: sourceVisit.id
    });

    const beforeSummary = await getPublicHomeSummary(testDatabase.database);

    const result = await reassignParkVisits(testDatabase.database, {
      fromSlug: 'aleksanterin-kierros',
      toSlug: 'vallisaari'
    });

    const sourceParkVisits = await getParkVisitsBySlug(
      testDatabase.database,
      'aleksanterin-kierros',
      async () => ''
    );
    const targetParkVisits = await getParkVisitsBySlug(
      testDatabase.database,
      'vallisaari',
      async () => ''
    );
    const flatVisits = await listVisits(testDatabase.database, async () => '');
    const movedVisit = flatVisits.find((visit) => visit.id === sourceVisit.id);
    const afterSummary = await getPublicHomeSummary(testDatabase.database);

    expect(result).toMatchObject({
      dryRun: false,
      fromPark: {
        name: 'Aleksanterin kierros',
        slug: 'aleksanterin-kierros'
      },
      movedImageCount: 1,
      movedVisitCount: 1,
      movedVisitIds: [sourceVisit.id],
      toPark: {
        name: 'Vallisaari',
        slug: 'vallisaari'
      }
    });
    expect(sourceParkVisits?.visitedSummary).toEqual({
      lastVisitedOn: null,
      visitCount: 0,
      visited: false
    });
    expect(sourceParkVisits?.visits).toEqual([]);
    expect(targetParkVisits?.visitedSummary).toEqual({
      lastVisitedOn: '2026-04-11',
      visitCount: 2,
      visited: true
    });
    expect(targetParkVisits?.visits).toHaveLength(2);
    const movedParkVisit = targetParkVisits?.visits.find((visit) => visit.id === sourceVisit.id);
    expect(movedParkVisit).toMatchObject({
      note: 'Route visit note',
      route: 'Aleksanterin kierros'
    });
    expect(movedParkVisit?.images).toHaveLength(1);
    expect(movedVisit).toMatchObject({
      park: {
        name: 'Vallisaari',
        slug: 'vallisaari'
      }
    });
    expect(afterSummary.version).toBeGreaterThan(beforeSummary.version);
  });

  it('supports dry-run previews for visit reassignment without changing stored visits', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 3,
      now: () => '2026-05-01T10:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark(),
          createLipasPark({
            'lipas-id': 99999,
            name: 'Vallisaari',
            type: { 'type-code': 103 },
            www: 'https://www.luontoon.fi/vallisaari'
          }),
          createLipasPark({
            'lipas-id': 440499,
            name: 'Aleksanterin kierros',
            type: { 'type-code': 103 },
            www: 'https://www.luontoon.fi/aleksanterin-kierros'
          })
        ]
      })
    });

    const sourceVisit = await createVisit(testDatabase.database, 'aleksanterin-kierros', {
      visitedOn: '2026-04-10'
    });

    const result = await reassignParkVisits(testDatabase.database, {
      dryRun: true,
      fromSlug: 'aleksanterin-kierros',
      toSlug: 'vallisaari'
    });

    const sourceParkVisits = await getParkVisitsBySlug(
      testDatabase.database,
      'aleksanterin-kierros',
      async () => ''
    );
    const targetParkVisits = await getParkVisitsBySlug(
      testDatabase.database,
      'vallisaari',
      async () => ''
    );

    expect(result).toMatchObject({
      dryRun: true,
      movedImageCount: 0,
      movedVisitCount: 1,
      movedVisitIds: [sourceVisit.id]
    });
    expect(sourceParkVisits?.visits).toHaveLength(1);
    expect(targetParkVisits?.visits).toEqual([]);
  });

  it('returns a zero-move result when the source park has no visits', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 2,
      now: () => '2026-05-01T10:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark(),
          createLipasPark({
            'lipas-id': 99999,
            name: 'Vallisaari',
            type: { 'type-code': 103 },
            www: 'https://www.luontoon.fi/vallisaari'
          })
        ]
      })
    });

    const result = await reassignParkVisits(testDatabase.database, {
      fromSlug: 'akasmannyn-kansallispuisto',
      toSlug: 'vallisaari'
    });

    expect(result).toMatchObject({
      dryRun: false,
      movedImageCount: 0,
      movedVisitCount: 0,
      movedVisitIds: []
    });
  });

  it('rejects invalid visit reassignment requests', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 2,
      now: () => '2026-05-01T10:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark(),
          createLipasPark({
            'lipas-id': 99999,
            name: 'Vallisaari',
            type: { 'type-code': 103 },
            www: 'https://www.luontoon.fi/vallisaari'
          })
        ]
      })
    });

    await expect(
      reassignParkVisits(testDatabase.database, {
        fromSlug: '   ',
        toSlug: 'vallisaari'
      })
    ).rejects.toThrow('Both fromSlug and toSlug are required.');

    await expect(
      reassignParkVisits(testDatabase.database, {
        fromSlug: 'missing-source',
        toSlug: 'vallisaari'
      })
    ).rejects.toThrow('Source park not found');

    await expect(
      reassignParkVisits(testDatabase.database, {
        fromSlug: 'akasmannyn-kansallispuisto',
        toSlug: 'missing-target'
      })
    ).rejects.toThrow('Target park not found');

    await expect(
      reassignParkVisits(testDatabase.database, {
        fromSlug: 'vallisaari',
        toSlug: 'vallisaari'
      })
    ).rejects.toThrow('Source and target park slugs must be different.');

    await testDatabase.database
      .update(parks)
      .set({ removed: true })
      .where(eq(parks.slug, 'vallisaari'));

    await expect(
      reassignParkVisits(testDatabase.database, {
        fromSlug: 'akasmannyn-kansallispuisto',
        toSlug: 'vallisaari'
      })
    ).rejects.toThrow('Target park "vallisaari" is removed and cannot receive visits.');
  });

  it('builds public home summary ordering from lightweight public visit data', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 4,
      now: () => '2026-05-02T10:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark(),
          createLipasPark({
            'lipas-id': 99999,
            name: 'Toinen puisto'
          }),
          createLipasPark({
            'lipas-id': 99998,
            name: 'Kolmas puisto'
          }),
          createLipasPark({
            'lipas-id': 99997,
            name: 'Neljäs puisto'
          })
        ]
      })
    });

    await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-01-15'
    });
    await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-04-22'
    });
    await createVisit(testDatabase.database, 'toinen-puisto', {
      visitedOn: '2026-07-10'
    });
    await createVisit(testDatabase.database, 'kolmas-puisto', {
      visitedOn: '2026-07-10'
    });
    await createVisit(testDatabase.database, 'neljas-puisto', {
      visitedOn: '2026-10-05'
    });

    const summary = await getPublicHomeSummary(testDatabase.database);

    expect(summary.mostVisitedParks.map((park) => park.park.slug)).toEqual([
      'akasmannyn-kansallispuisto',
      'neljas-puisto',
      'kolmas-puisto',
      'toinen-puisto'
    ]);
    expect(summary.recentVisits.map((park) => park.park.slug)).toEqual([
      'neljas-puisto',
      'kolmas-puisto',
      'toinen-puisto',
      'akasmannyn-kansallispuisto'
    ]);
    expect(summary.seasonalVisitCounts).toEqual({ autumn: 1, spring: 1, summer: 2, winter: 1 });
    expect(summary.latestVisitEntries[0]).not.toHaveProperty('note');
    expect(summary.latestVisitEntries[0]).not.toHaveProperty('route');
    expect(summary.version).toBeGreaterThan(0);
  });

  it('lists only removed parks for admin restore workflows', async () => {
    await testDatabase.database
      .update(parks)
      .set({ removed: true })
      .where(eq(parks.slug, 'akasmannyn-kansallispuisto'));

    const removedParks = await listRemovedParks(testDatabase.database);

    expect(removedParks).toEqual([
      expect.objectContaining({
        address: 'Puistotie 1, 00999 Testikylä',
        catalogStatus: 'active',
        locationLabel: 'Puistotie 1',
        name: 'Äkäsmännyn kansallispuisto',
        postalCode: '00999',
        postalOffice: 'Testikylä',
        removed: true,
        slug: 'akasmannyn-kansallispuisto'
      })
    ]);
  });
});
