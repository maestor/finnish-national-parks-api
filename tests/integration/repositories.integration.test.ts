import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createVisit,
  createVisitImage,
  deleteVisit,
  getCatalogListEtagSeed,
  getParkBySlug,
  getParkVisitsBySlug,
  getPublicHomeSummary,
  getVisitById,
  listVisits,
  reorderVisitImages,
  updateVisit
} from '../../src/db/repositories.js';
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
      latestImportRunId: null,
      latestUpdatedAt: null,
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

  it('builds public home summary ordering from lightweight public visit data', async () => {
    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 3,
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
          })
        ]
      })
    });

    await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-04-22'
    });
    await createVisit(testDatabase.database, 'toinen-puisto', {
      visitedOn: '2026-04-21'
    });
    await createVisit(testDatabase.database, 'kolmas-puisto', {
      visitedOn: '2026-04-21'
    });

    const summary = await getPublicHomeSummary(testDatabase.database);

    expect(summary.mostVisitedParks.map((park) => park.park.slug)).toEqual([
      'akasmannyn-kansallispuisto',
      'kolmas-puisto',
      'toinen-puisto'
    ]);
    expect(summary.recentVisits.map((park) => park.park.slug)).toEqual([
      'akasmannyn-kansallispuisto',
      'kolmas-puisto',
      'toinen-puisto'
    ]);
    expect(summary.latestVisitEntries[0]).not.toHaveProperty('note');
    expect(summary.latestVisitEntries[0]).not.toHaveProperty('route');
    expect(summary.version).toBeGreaterThan(0);
  });
});
