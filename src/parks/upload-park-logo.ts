import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { Database } from '../db/database.js';
import { findParkRecordBySlugIncludingRemoved, updateParkLogo } from '../db/repositories.js';

type LogoUploadStorage = {
  upload(key: string, buffer: Buffer, contentType: string): Promise<void>;
};

type UploadParkLogoOptions = {
  database: Database;
  logosDirectory: string;
  now?: () => string;
  slug: string;
  storage: LogoUploadStorage;
};

const createLogoFilePath = (logosDirectory: string, slug: string) => {
  return resolve(logosDirectory, `${slug}.png`);
};

const createLogoKey = (slug: string) => {
  return `logos/${slug}.png`;
};

export const uploadParkLogo = async ({
  database,
  logosDirectory,
  now = () => new Date().toISOString(),
  slug,
  storage
}: UploadParkLogoOptions) => {
  const existingPark = await findParkRecordBySlugIncludingRemoved(database, slug);

  if (!existingPark) {
    throw new Error(`Park not found for slug "${slug}".`);
  }

  const localLogoPath = createLogoFilePath(logosDirectory, slug);
  let buffer: Buffer;

  try {
    buffer = await readFile(localLogoPath);
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException).code;

    if (errorCode === 'ENOENT') {
      throw new Error(`Logo PNG not found for slug "${slug}" at ${localLogoPath}.`);
    }

    throw error;
  }

  const logoKey = createLogoKey(slug);
  await storage.upload(logoKey, buffer, 'image/png');

  const park = await updateParkLogo(database, slug, {
    key: logoKey,
    updatedAt: now()
  });

  if (!park) {
    throw new Error(`Park not found for slug "${slug}".`);
  }

  return {
    logoKey,
    parkName: park.name,
    slug: park.slug
  };
};
