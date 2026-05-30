import { access } from 'node:fs/promises';
import { resolve } from 'node:path';

type LogoAssetPark = {
  displayTypeName: string | null;
  slug: string;
};

export type ResolvedParkLogoAsset = {
  localFilePath: string;
  logoKey: string;
};

const normalizeLogoName = (value: string) => {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'logo';
};

const fileExists = async (path: string) => {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }

    throw error;
  }
};

export const createParkLogoFilePath = (logosDirectory: string, slug: string) => {
  return resolve(logosDirectory, `${slug}.png`);
};

export const createParkLogoKey = (slug: string) => {
  return `logos/${slug}.png`;
};

export const createDisplayTypeLogoSlug = (displayTypeName: string) => {
  return normalizeLogoName(displayTypeName);
};

export const createDisplayTypeLogoFilePath = (logosDirectory: string, displayTypeName: string) => {
  return resolve(
    logosDirectory,
    'display-types',
    `${createDisplayTypeLogoSlug(displayTypeName)}.png`
  );
};

export const createDisplayTypeLogoKey = (displayTypeName: string) => {
  return `logos/display-types/${createDisplayTypeLogoSlug(displayTypeName)}.png`;
};

export const findParkLogoAsset = async (
  logosDirectory: string,
  park: LogoAssetPark
): Promise<ResolvedParkLogoAsset | null> => {
  const parkSpecificFilePath = createParkLogoFilePath(logosDirectory, park.slug);

  if (await fileExists(parkSpecificFilePath)) {
    return {
      localFilePath: parkSpecificFilePath,
      logoKey: createParkLogoKey(park.slug)
    };
  }

  if (!park.displayTypeName) {
    return null;
  }

  const sharedDisplayTypeFilePath = createDisplayTypeLogoFilePath(
    logosDirectory,
    park.displayTypeName
  );

  if (!(await fileExists(sharedDisplayTypeFilePath))) {
    return null;
  }

  return {
    localFilePath: sharedDisplayTypeFilePath,
    logoKey: createDisplayTypeLogoKey(park.displayTypeName)
  };
};
