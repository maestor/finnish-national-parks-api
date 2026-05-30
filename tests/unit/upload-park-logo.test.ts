import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFindParkLogoAsset, mockFindParkRecordBySlugIncludingRemoved, mockUpdateParkLogo } =
  vi.hoisted(() => ({
    mockFindParkLogoAsset: vi.fn(),
    mockFindParkRecordBySlugIncludingRemoved: vi.fn(),
    mockUpdateParkLogo: vi.fn()
  }));

vi.mock('../../src/db/repositories.js', () => ({
  findParkRecordBySlugIncludingRemoved: mockFindParkRecordBySlugIncludingRemoved,
  updateParkLogo: mockUpdateParkLogo
}));

vi.mock('../../src/parks/logo-assets.js', () => ({
  findParkLogoAsset: mockFindParkLogoAsset
}));

import { uploadParkLogo } from '../../src/parks/upload-park-logo.js';

describe('uploadParkLogo edge cases', () => {
  beforeEach(() => {
    mockFindParkRecordBySlugIncludingRemoved.mockReset();
    mockUpdateParkLogo.mockReset();
    mockFindParkLogoAsset.mockReset();
  });

  it('throws a clear error when the resolved logo file disappears before readFile', async () => {
    mockFindParkRecordBySlugIncludingRemoved.mockResolvedValue({
      displayTypeName: 'Ystävyyden puisto',
      logoKey: null,
      name: 'Elimyssalon luonnonsuojelualue',
      slug: 'elimyssalon-luonnonsuojelualue-ystavyyden-puisto'
    });
    mockFindParkLogoAsset.mockResolvedValue({
      localFilePath: '/tmp/missing-shared-logo.png',
      logoKey: 'logos/display-types/ystavyyden-puisto.png'
    });

    await expect(
      uploadParkLogo({
        database: {} as never,
        logosDirectory: '/tmp',
        slug: 'elimyssalon-luonnonsuojelualue-ystavyyden-puisto',
        storage: {
          getObjectMetadata: async () => null,
          upload: async () => {}
        }
      })
    ).rejects.toThrow(
      'Logo PNG not found for slug "elimyssalon-luonnonsuojelualue-ystavyyden-puisto" at /tmp/missing-shared-logo.png.'
    );
  });
});
