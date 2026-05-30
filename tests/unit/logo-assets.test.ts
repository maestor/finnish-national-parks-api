import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { accessMock } = vi.hoisted(() => ({
  accessMock: vi.fn()
}));

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');

  return {
    ...actual,
    access: accessMock
  };
});

import {
  createDisplayTypeLogoFilePath,
  createDisplayTypeLogoKey,
  createDisplayTypeLogoSlug,
  createParkLogoFilePath,
  createParkLogoKey,
  findParkLogoAsset
} from '../../src/parks/logo-assets.js';

describe('logo-assets', () => {
  let logosDirectory: string;

  beforeEach(async () => {
    const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');

    accessMock.mockReset();
    accessMock.mockImplementation(actual.access);
    logosDirectory = await mkdtemp(join(tmpdir(), 'logo-assets-'));
    await mkdir(join(logosDirectory, 'display-types'), { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds park-specific and display-type logo paths and keys', () => {
    expect(createParkLogoFilePath('/tmp/logos', 'evon-retkeilyalue')).toBe(
      '/tmp/logos/evon-retkeilyalue.png'
    );
    expect(createParkLogoKey('evon-retkeilyalue')).toBe('logos/evon-retkeilyalue.png');
    expect(createDisplayTypeLogoSlug('Ystävyyden puisto')).toBe('ystavyyden-puisto');
    expect(createDisplayTypeLogoFilePath('/tmp/logos', 'Ystävyyden puisto')).toBe(
      '/tmp/logos/display-types/ystavyyden-puisto.png'
    );
    expect(createDisplayTypeLogoKey('Ystävyyden puisto')).toBe(
      'logos/display-types/ystavyyden-puisto.png'
    );
    expect(createDisplayTypeLogoSlug('!!!')).toBe('logo');
  });

  it('prefers a park-specific logo when both park and display-type files exist', async () => {
    await writeFile(join(logosDirectory, 'evon-retkeilyalue.png'), Buffer.from('park-logo'));
    await writeFile(
      join(logosDirectory, 'display-types', 'valtion-retkeilyalue.png'),
      Buffer.from('shared-logo')
    );

    await expect(
      findParkLogoAsset(logosDirectory, {
        displayTypeName: 'Valtion retkeilyalue',
        slug: 'evon-retkeilyalue'
      })
    ).resolves.toEqual({
      localFilePath: join(logosDirectory, 'evon-retkeilyalue.png'),
      logoKey: 'logos/evon-retkeilyalue.png'
    });
  });

  it('falls back to a shared display-type logo when no park-specific file exists', async () => {
    await writeFile(
      join(logosDirectory, 'display-types', 'ystavyyden-puisto.png'),
      Buffer.from('shared-logo')
    );

    await expect(
      findParkLogoAsset(logosDirectory, {
        displayTypeName: 'Ystävyyden puisto',
        slug: 'elimyssalon-luonnonsuojelualue-ystavyyden-puisto'
      })
    ).resolves.toEqual({
      localFilePath: join(logosDirectory, 'display-types', 'ystavyyden-puisto.png'),
      logoKey: 'logos/display-types/ystavyyden-puisto.png'
    });
  });

  it('returns null when neither a park-specific nor a shared display-type logo exists', async () => {
    await expect(
      findParkLogoAsset(logosDirectory, {
        displayTypeName: 'Ystävyyden puisto',
        slug: 'lentuan-luonnonsuojelualue-ystavyyden-puisto'
      })
    ).resolves.toBeNull();
  });

  it('returns null when the park has no display type and no park-specific logo', async () => {
    await expect(
      findParkLogoAsset(logosDirectory, {
        displayTypeName: null,
        slug: 'hiidenvaaran-luonnonsuojelualue'
      })
    ).resolves.toBeNull();
  });

  it('rethrows non-ENOENT access errors', async () => {
    accessMock.mockRejectedValueOnce(
      Object.assign(new Error('permission denied'), { code: 'EACCES' })
    );

    await expect(
      findParkLogoAsset(logosDirectory, {
        displayTypeName: null,
        slug: 'broken-logo'
      })
    ).rejects.toThrow('permission denied');
  });
});
