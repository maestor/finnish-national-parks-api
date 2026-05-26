import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as repositories from '../../src/db/repositories.js';
import { getParkBySlug } from '../../src/db/repositories.js';
import { importParks } from '../../src/importer/import-parks.js';
import { uploadParkLogo } from '../../src/parks/upload-park-logo.js';
import { createLipasPark } from '../fixtures/lipas.js';
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
        upload: async (key, buffer, contentType) => {
          uploads.push({ buffer, contentType, key });
        }
      }
    });

    expect(result).toEqual({
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

  it('fails when the local png file does not exist or the slug is unknown', async () => {
    await expect(
      uploadParkLogo({
        database: testDatabase.database,
        logosDirectory,
        slug: 'akasmannyn-kansallispuisto',
        storage: {
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
          upload: async () => {}
        }
      })
    ).rejects.toThrow('Park not found');

    spy.mockRestore();
  });
});
