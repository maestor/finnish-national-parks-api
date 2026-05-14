import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createVisit,
  deleteVisit,
  getCatalogListEtagSeed,
  getParkBySlug,
  getPersonalParkBySlug,
  listPersonalParks,
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
    await expect(getPersonalParkBySlug(testDatabase.database, 'missing-park')).resolves.toBeNull();

    const personalPark = await getPersonalParkBySlug(
      testDatabase.database,
      'akasmannyn-kansallispuisto'
    );
    expect(personalPark?.visits).toEqual([]);
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

  it('returns empty personal parks list when no active parks remain', async () => {
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

    await expect(listPersonalParks(testDatabase.database)).resolves.toEqual([]);
  });

  it('batch-aggregates visits across multiple parks', async () => {
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

    const result = await listPersonalParks(testDatabase.database);

    expect(result).toHaveLength(2);

    const first = result.find((p) => p.slug === 'akasmannyn-kansallispuisto');
    const second = result.find((p) => p.slug === 'toinen-puisto');

    expect(first).toMatchObject({
      visitedSummary: {
        visited: true,
        visitCount: 2,
        lastVisitedOn: '2026-04-11'
      }
    });
    expect(first?.visits).toHaveLength(2);
    expect(first?.visits[0]).toMatchObject({
      author: null,
      note: 'Visit A2',
      route: null,
      visitedOn: '2026-04-11'
    });

    expect(second).toMatchObject({
      visitedSummary: {
        visited: true,
        visitCount: 1,
        lastVisitedOn: '2026-03-20'
      }
    });
    expect(second?.visits).toHaveLength(1);
    expect(second?.visits[0]).toMatchObject({
      author: null,
      note: null,
      route: null,
      visitedOn: '2026-03-20'
    });
  });
});
