import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as repositories from '../../src/db/repositories.js';
import { getParkBySlug } from '../../src/db/repositories.js';
import { parks } from '../../src/db/schema.js';
import { importParks } from '../../src/importer/import-parks.js';
import { uploadParkLogo } from '../../src/parks/upload-park-logo.js';
import { createLipasPark, parkTypeFixtures } from '../fixtures/lipas.js';
import { createTestDatabase } from '../helpers/test-db.js';

describe('uploadParkLogo', () => {
  let logosDirectory: string;
  let testDatabase: Awaited<ReturnType<typeof createTestDatabase>>;

  beforeEach(async () => {
    logosDirectory = await mkdtemp(join(tmpdir(), 'park-logos-'));
    await mkdir(logosDirectory, { recursive: true });

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

  it('uploads the local png into the logos folder and persists the logo reference on the park', async () => {
    const uploads: Array<{ buffer: Buffer; contentType: string; key: string }> = [];
    const localLogoPath = join(logosDirectory, 'akasmannyn-kansallispuisto.png');

    await writeFile(localLogoPath, Buffer.from('fake-png-data'));

    const result = await uploadParkLogo({
      database: testDatabase.database,
      logosDirectory,
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
      logoKey: 'logos/akasmannyn-kansallispuisto.png',
      parkName: 'Äkäsmännyn kansallispuisto',
      slug: 'akasmannyn-kansallispuisto'
    });
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({
      contentType: 'image/png',
      key: 'logos/akasmannyn-kansallispuisto.png'
    });
    expect(uploads[0]?.buffer.equals(Buffer.from('fake-png-data'))).toBe(true);
    await expect(
      getParkBySlug(testDatabase.database, 'akasmannyn-kansallispuisto', (key, updatedAt) => {
        return `https://assets.example.com/${key}?v=${encodeURIComponent(updatedAt)}`;
      })
    ).resolves.toMatchObject({
      logo: {
        key: 'logos/akasmannyn-kansallispuisto.png',
        updatedAt: '2026-05-03T12:34:56.000Z',
        url: 'https://assets.example.com/logos/akasmannyn-kansallispuisto.png?v=2026-05-03T12%3A34%3A56.000Z'
      }
    });
  });

  it('reuses one shared display-type logo object for multiple parks with the same displayTypeName', async () => {
    const uploads: Array<{ buffer: Buffer; contentType: string; key: string }> = [];
    const sharedLogoDirectory = join(logosDirectory, 'display-types');
    const sharedLogoPath = join(sharedLogoDirectory, 'ystavyyden-puisto.png');
    const existingKeys = new Set<string>();

    await mkdir(sharedLogoDirectory, { recursive: true });
    await writeFile(sharedLogoPath, Buffer.from('shared-png-data'));

    await importParks({
      database: testDatabase.database,
      expectedActiveCount: 2,
      now: () => '2026-05-01T11:00:00.000Z',
      sourceUrl: 'https://example.test/lipas',
      fetchSource: async () => ({
        items: [
          createLipasPark({
            'lipas-id': 20001,
            name: 'Elimyssalon luonnonsuojelualue Ystävyyden puisto',
            type: {
              'type-code': parkTypeFixtures.otherNatureReserve.typeCode
            }
          }),
          createLipasPark({
            'lipas-id': 20002,
            name: 'Lentuan luonnonsuojelualue Ystävyyden puisto',
            type: {
              'type-code': parkTypeFixtures.otherNatureReserve.typeCode
            }
          })
        ]
      })
    });

    for (const slug of [
      'elimyssalon-luonnonsuojelualue-ystavyyden-puisto',
      'lentuan-luonnonsuojelualue-ystavyyden-puisto'
    ]) {
      await testDatabase.database
        .update(parks)
        .set({ displayTypeName: 'Ystävyyden puisto' })
        .where(eq(parks.slug, slug));
    }

    const storage = {
      getObjectMetadata: async (key: string) => {
        return existingKeys.has(key) ? { contentLength: 100, contentType: 'image/png' } : null;
      },
      upload: async (key: string, buffer: Buffer, contentType: string) => {
        existingKeys.add(key);
        uploads.push({ buffer, contentType, key });
      }
    };

    const firstResult = await uploadParkLogo({
      database: testDatabase.database,
      logosDirectory,
      now: () => '2026-05-03T12:34:56.000Z',
      slug: 'elimyssalon-luonnonsuojelualue-ystavyyden-puisto',
      storage
    });

    const secondResult = await uploadParkLogo({
      database: testDatabase.database,
      logosDirectory,
      now: () => '2026-05-04T12:34:56.000Z',
      slug: 'lentuan-luonnonsuojelualue-ystavyyden-puisto',
      storage
    });

    expect(firstResult).toEqual({
      action: 'uploaded',
      logoKey: 'logos/display-types/ystavyyden-puisto.png',
      parkName: 'Elimyssalon luonnonsuojelualue Ystävyyden puisto',
      slug: 'elimyssalon-luonnonsuojelualue-ystavyyden-puisto'
    });
    expect(secondResult).toEqual({
      action: 'db-only',
      logoKey: 'logos/display-types/ystavyyden-puisto.png',
      parkName: 'Lentuan luonnonsuojelualue Ystävyyden puisto',
      slug: 'lentuan-luonnonsuojelualue-ystavyyden-puisto'
    });
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toMatchObject({
      contentType: 'image/png',
      key: 'logos/display-types/ystavyyden-puisto.png'
    });
    expect(uploads[0]?.buffer.equals(Buffer.from('shared-png-data'))).toBe(true);
    await expect(
      getParkBySlug(
        testDatabase.database,
        'elimyssalon-luonnonsuojelualue-ystavyyden-puisto',
        (key, updatedAt) => `https://assets.example.com/${key}?v=${encodeURIComponent(updatedAt)}`
      )
    ).resolves.toMatchObject({
      logo: {
        key: 'logos/display-types/ystavyyden-puisto.png',
        updatedAt: '2026-05-03T12:34:56.000Z'
      }
    });
    await expect(
      getParkBySlug(
        testDatabase.database,
        'lentuan-luonnonsuojelualue-ystavyyden-puisto',
        (key, updatedAt) => `https://assets.example.com/${key}?v=${encodeURIComponent(updatedAt)}`
      )
    ).resolves.toMatchObject({
      logo: {
        key: 'logos/display-types/ystavyyden-puisto.png',
        updatedAt: '2026-05-04T12:34:56.000Z'
      }
    });
  });

  it('skips upload when both storage and db already have the logo', async () => {
    const uploads: Array<{ buffer: Buffer; contentType: string; key: string }> = [];
    const localLogoPath = join(logosDirectory, 'akasmannyn-kansallispuisto.png');

    await writeFile(localLogoPath, Buffer.from('fake-png-data'));

    await uploadParkLogo({
      database: testDatabase.database,
      logosDirectory,
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

    const result = await uploadParkLogo({
      database: testDatabase.database,
      logosDirectory,
      slug: 'akasmannyn-kansallispuisto',
      storage: {
        getObjectMetadata: async () => ({ contentLength: 100, contentType: 'image/png' }),
        upload: async (key, buffer, contentType) => {
          uploads.push({ buffer, contentType, key });
        }
      }
    });

    expect(result).toEqual({
      action: 'skipped',
      logoKey: 'logos/akasmannyn-kansallispuisto.png',
      parkName: 'Äkäsmännyn kansallispuisto',
      slug: 'akasmannyn-kansallispuisto'
    });
    expect(uploads).toHaveLength(0);
  });

  it('recovers storage when db has the key but storage is missing', async () => {
    const uploads: Array<{ buffer: Buffer; contentType: string; key: string }> = [];
    const localLogoPath = join(logosDirectory, 'akasmannyn-kansallispuisto.png');

    await writeFile(localLogoPath, Buffer.from('fake-png-data'));

    await uploadParkLogo({
      database: testDatabase.database,
      logosDirectory,
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

    const result = await uploadParkLogo({
      database: testDatabase.database,
      logosDirectory,
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
    const localLogoPath = join(logosDirectory, 'akasmannyn-kansallispuisto.png');

    await writeFile(localLogoPath, Buffer.from('fake-png-data'));

    const result = await uploadParkLogo({
      database: testDatabase.database,
      logosDirectory,
      now: () => '2026-05-04T12:34:56.000Z',
      slug: 'akasmannyn-kansallispuisto',
      storage: {
        getObjectMetadata: async () => ({ contentLength: 100, contentType: 'image/png' }),
        upload: async (key, buffer, contentType) => {
          uploads.push({ buffer, contentType, key });
        }
      }
    });

    expect(result).toEqual({
      action: 'db-only',
      logoKey: 'logos/akasmannyn-kansallispuisto.png',
      parkName: 'Äkäsmännyn kansallispuisto',
      slug: 'akasmannyn-kansallispuisto'
    });
    expect(uploads).toHaveLength(0);
    await expect(
      getParkBySlug(testDatabase.database, 'akasmannyn-kansallispuisto', (key, updatedAt) => {
        return `https://assets.example.com/${key}?v=${encodeURIComponent(updatedAt)}`;
      })
    ).resolves.toMatchObject({
      logo: {
        key: 'logos/akasmannyn-kansallispuisto.png',
        updatedAt: '2026-05-04T12:34:56.000Z'
      }
    });
  });

  it('forces upload and db write when force is true even if both exist', async () => {
    const uploads: Array<{ buffer: Buffer; contentType: string; key: string }> = [];
    const localLogoPath = join(logosDirectory, 'akasmannyn-kansallispuisto.png');

    await writeFile(localLogoPath, Buffer.from('fake-png-data'));

    const result = await uploadParkLogo({
      database: testDatabase.database,
      force: true,
      logosDirectory,
      now: () => '2026-05-03T12:34:56.000Z',
      slug: 'akasmannyn-kansallispuisto',
      storage: {
        getObjectMetadata: async () => ({ contentLength: 100, contentType: 'image/png' }),
        upload: async (key, buffer, contentType) => {
          uploads.push({ buffer, contentType, key });
        }
      }
    });

    expect(result.action).toBe('uploaded');
    expect(uploads).toHaveLength(1);
  });

  it('fails when the local png file does not exist or the slug is unknown', async () => {
    await expect(
      uploadParkLogo({
        database: testDatabase.database,
        logosDirectory,
        slug: 'akasmannyn-kansallispuisto',
        storage: {
          getObjectMetadata: async () => null,
          upload: async () => {}
        }
      })
    ).rejects.toThrow('Logo PNG not found');

    await writeFile(join(logosDirectory, 'missing-park.png'), Buffer.from('fake-png-data'));

    await expect(
      uploadParkLogo({
        database: testDatabase.database,
        logosDirectory,
        slug: 'missing-park',
        storage: {
          getObjectMetadata: async () => null,
          upload: async () => {}
        }
      })
    ).rejects.toThrow('Park not found');
  });

  it('re-throws non-ENOENT readFile errors', async () => {
    await mkdir(join(logosDirectory, 'akasmannyn-kansallispuisto.png'), { recursive: true });

    await expect(
      uploadParkLogo({
        database: testDatabase.database,
        logosDirectory,
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
      join(logosDirectory, 'akasmannyn-kansallispuisto.png'),
      Buffer.from('fake-png-data')
    );

    const spy = vi.spyOn(repositories, 'updateParkLogo').mockResolvedValue(null);

    await expect(
      uploadParkLogo({
        database: testDatabase.database,
        logosDirectory,
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
