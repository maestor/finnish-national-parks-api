import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createVisit,
  deleteVisit,
  getCatalogListEtagSeed,
  getParkBySlug,
  getPersonalParkBySlug,
  putParkNote,
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

  it('returns null for missing parks and can clear notes explicitly', async () => {
    await expect(getParkBySlug(testDatabase.database, 'missing-park')).resolves.toBeNull();
    await expect(getPersonalParkBySlug(testDatabase.database, 'missing-park')).resolves.toBeNull();

    await putParkNote(testDatabase.database, 'akasmannyn-kansallispuisto', 'Keep this note');
    await expect(putParkNote(testDatabase.database, 'akasmannyn-kansallispuisto', '   ')).resolves.toBeNull();
  });

  it('preserves an existing visit note when only the date changes and reports missing deletes', async () => {
    const visit = await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      note: 'First draft',
      visitedOn: '2026-04-11'
    });

    const updatedVisit = await updateVisit(testDatabase.database, visit.id, {
      visitedOn: '2026-04-12'
    });

    expect(updatedVisit).toMatchObject({
      note: 'First draft',
      visitedOn: '2026-04-12'
    });
    await expect(deleteVisit(testDatabase.database, 99999)).resolves.toBe(false);
  });

  it('supports creating visits without notes and patching only the note field', async () => {
    const visit = await createVisit(testDatabase.database, 'akasmannyn-kansallispuisto', {
      visitedOn: '2026-04-13'
    });

    expect(visit.note).toBeNull();

    const updatedVisit = await updateVisit(testDatabase.database, visit.id, {
      note: 'Added later'
    });

    expect(updatedVisit).toMatchObject({
      note: 'Added later',
      visitedOn: '2026-04-13'
    });

    const clearedVisit = await updateVisit(testDatabase.database, visit.id, {
      note: '   '
    });

    expect(clearedVisit).toMatchObject({
      note: null,
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
});
