import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as repositories from '../../src/db/repositories.js';
import { getParkBySlug } from '../../src/db/repositories.js';
import { importParks } from '../../src/importer/import-parks.js';
import { uploadParkMap } from '../../src/parks/upload-park-map.js';
import { createLipasPark } from '../fixtures/lipas.js';
import { createTestDatabase } from '../helpers/test-db.js';

describe('uploadParkMap', () => {
  let mapsDirectory: string;
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    mapsDirectory = await mkdtemp(join(tmpdir(), 'park-maps-'));
    await mkdir(mapsDirectory, { recursive: true });

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

  it('uploads the local pdf into the pdf-maps folder and persists the map reference on the park', async () => {
    const uploads: Array<{ buffer: Buffer; contentType: string; key: string }> = [];
    const localMapPath = join(mapsDirectory, 'akasmannyn-kansallispuisto.pdf');

    await writeFile(localMapPath, Buffer.from('fake-pdf-data'));

    const result = await uploadParkMap({
      database: testDatabase.database,
      mapsDirectory,
      now: () => '2026-05-03T12:34:56.000Z',
      slug: 'akasmannyn-kansallispuisto',
      storage: {
        getObjectMetadata: async () => null,
        upload: async (key, buffer, contentType) => {
          uploads.push({ buffer, contentType, key });
        }
      }
    });

    expect(result).toEqual({
      action: 'uploaded',
      mapKey: 'pdf-maps/akasmannyn-kansallispuisto.pdf',
      parkName: 'Äkäsmännyn kansallispuisto',
      slug: 'akasmannyn-kansallispuisto'
    });
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({
      contentType: 'application/pdf',
      key: 'pdf-maps/akasmannyn-kansallispuisto.pdf'
    });
    expect(uploads[0]?.buffer.equals(Buffer.from('fake-pdf-data'))).toBe(true);
    await expect(
      getParkBySlug(
        testDatabase.database,
        'akasmannyn-kansallispuisto',
        undefined,
        (key, updatedAt) => {
          return `https://assets.example.com/${key}?v=${encodeURIComponent(updatedAt)}`;
        }
      )
    ).resolves.toMatchObject({
      map: {
        key: 'pdf-maps/akasmannyn-kansallispuisto.pdf',
        updatedAt: '2026-05-03T12:34:56.000Z',
        url: 'https://assets.example.com/pdf-maps/akasmannyn-kansallispuisto.pdf?v=2026-05-03T12%3A34%3A56.000Z'
      }
    });
  });

  it('skips upload when both storage and db already have the map', async () => {
    const uploads: Array<{ buffer: Buffer; contentType: string; key: string }> = [];
    const localMapPath = join(mapsDirectory, 'akasmannyn-kansallispuisto.pdf');

    await writeFile(localMapPath, Buffer.from('fake-pdf-data'));

    await uploadParkMap({
      database: testDatabase.database,
      mapsDirectory,
      now: () => '2026-05-03T12:34:56.000Z',
      slug: 'akasmannyn-kansallispuisto',
      storage: {
        getObjectMetadata: async () => null,
        upload: async (key, buffer, contentType) => {
          uploads.push({ buffer, contentType, key });
        }
      }
    });

    uploads.length = 0;

    const result = await uploadParkMap({
      database: testDatabase.database,
      mapsDirectory,
      slug: 'akasmannyn-kansallispuisto',
      storage: {
        getObjectMetadata: async () => ({ contentLength: 100, contentType: 'application/pdf' }),
        upload: async (key, buffer, contentType) => {
          uploads.push({ buffer, contentType, key });
        }
      }
    });

    expect(result).toEqual({
      action: 'skipped',
      mapKey: 'pdf-maps/akasmannyn-kansallispuisto.pdf',
      parkName: 'Äkäsmännyn kansallispuisto',
      slug: 'akasmannyn-kansallispuisto'
    });
    expect(uploads).toHaveLength(0);
  });

  it('recovers storage when db has the key but storage is missing', async () => {
    const uploads: Array<{ buffer: Buffer; contentType: string; key: string }> = [];
    const localMapPath = join(mapsDirectory, 'akasmannyn-kansallispuisto.pdf');

    await writeFile(localMapPath, Buffer.from('fake-pdf-data'));

    await uploadParkMap({
      database: testDatabase.database,
      mapsDirectory,
      now: () => '2026-05-03T12:34:56.000Z',
      slug: 'akasmannyn-kansallispuisto',
      storage: {
        getObjectMetadata: async () => null,
        upload: async (key, buffer, contentType) => {
          uploads.push({ buffer, contentType, key });
        }
      }
    });

    uploads.length = 0;

    const result = await uploadParkMap({
      database: testDatabase.database,
      mapsDirectory,
      now: () => '2026-05-04T12:34:56.000Z',
      slug: 'akasmannyn-kansallispuisto',
      storage: {
        getObjectMetadata: async () => null,
        upload: async (key, buffer, contentType) => {
          uploads.push({ buffer, contentType, key });
        }
      }
    });

    expect(result.action).toBe('uploaded');
    expect(uploads).toHaveLength(1);
  });

  it('writes only to db when storage has the file but db is missing the key', async () => {
    const uploads: Array<{ buffer: Buffer; contentType: string; key: string }> = [];
    const localMapPath = join(mapsDirectory, 'akasmannyn-kansallispuisto.pdf');

    await writeFile(localMapPath, Buffer.from('fake-pdf-data'));

    const result = await uploadParkMap({
      database: testDatabase.database,
      mapsDirectory,
      now: () => '2026-05-04T12:34:56.000Z',
      slug: 'akasmannyn-kansallispuisto',
      storage: {
        getObjectMetadata: async () => ({ contentLength: 100, contentType: 'application/pdf' }),
        upload: async (key, buffer, contentType) => {
          uploads.push({ buffer, contentType, key });
        }
      }
    });

    expect(result).toEqual({
      action: 'db-only',
      mapKey: 'pdf-maps/akasmannyn-kansallispuisto.pdf',
      parkName: 'Äkäsmännyn kansallispuisto',
      slug: 'akasmannyn-kansallispuisto'
    });
    expect(uploads).toHaveLength(0);
    await expect(
      getParkBySlug(
        testDatabase.database,
        'akasmannyn-kansallispuisto',
        undefined,
        (key, updatedAt) => {
          return `https://assets.example.com/${key}?v=${encodeURIComponent(updatedAt)}`;
        }
      )
    ).resolves.toMatchObject({
      map: {
        key: 'pdf-maps/akasmannyn-kansallispuisto.pdf',
        updatedAt: '2026-05-04T12:34:56.000Z'
      }
    });
  });

  it('forces upload and db write when force is true even if both exist', async () => {
    const uploads: Array<{ buffer: Buffer; contentType: string; key: string }> = [];
    const localMapPath = join(mapsDirectory, 'akasmannyn-kansallispuisto.pdf');

    await writeFile(localMapPath, Buffer.from('fake-pdf-data'));

    const result = await uploadParkMap({
      database: testDatabase.database,
      force: true,
      mapsDirectory,
      now: () => '2026-05-03T12:34:56.000Z',
      slug: 'akasmannyn-kansallispuisto',
      storage: {
        getObjectMetadata: async () => ({ contentLength: 100, contentType: 'application/pdf' }),
        upload: async (key, buffer, contentType) => {
          uploads.push({ buffer, contentType, key });
        }
      }
    });

    expect(result.action).toBe('uploaded');
    expect(uploads).toHaveLength(1);
  });

  it('fails when the local pdf file does not exist or the slug is unknown', async () => {
    await expect(
      uploadParkMap({
        database: testDatabase.database,
        mapsDirectory,
        slug: 'akasmannyn-kansallispuisto',
        storage: {
          getObjectMetadata: async () => null,
          upload: async () => {}
        }
      })
    ).rejects.toThrow('Map PDF not found');

    await writeFile(join(mapsDirectory, 'missing-park.pdf'), Buffer.from('fake-pdf-data'));

    await expect(
      uploadParkMap({
        database: testDatabase.database,
        mapsDirectory,
        slug: 'missing-park',
        storage: {
          getObjectMetadata: async () => null,
          upload: async () => {}
        }
      })
    ).rejects.toThrow('Park not found');
  });

  it('re-throws non-ENOENT readFile errors', async () => {
    await mkdir(join(mapsDirectory, 'akasmannyn-kansallispuisto.pdf'), { recursive: true });

    await expect(
      uploadParkMap({
        database: testDatabase.database,
        mapsDirectory,
        slug: 'akasmannyn-kansallispuisto',
        storage: {
          getObjectMetadata: async () => null,
          upload: async () => {}
        }
      })
    ).rejects.toThrow();
  });

  it('throws when the park disappears between find and update', async () => {
    await writeFile(
      join(mapsDirectory, 'akasmannyn-kansallispuisto.pdf'),
      Buffer.from('fake-pdf-data')
    );

    const spy = vi.spyOn(repositories, 'updateParkMap').mockResolvedValue(null);

    await expect(
      uploadParkMap({
        database: testDatabase.database,
        mapsDirectory,
        slug: 'akasmannyn-kansallispuisto',
        storage: {
          getObjectMetadata: async () => null,
          upload: async () => {}
        }
      })
    ).rejects.toThrow('Park not found');

    spy.mockRestore();
  });
});
