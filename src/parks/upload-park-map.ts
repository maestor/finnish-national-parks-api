import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { Database } from '../db/database.js';
import { findParkRecordBySlugIncludingRemoved, updateParkMap } from '../db/repositories.js';

type MapUploadStorage = {
  upload(key: string, buffer: Buffer, contentType: string): Promise<void>;
};

type UploadParkMapOptions = {
  database: Database;
  mapsDirectory: string;
  now?: () => string;
  slug: string;
  storage: MapUploadStorage;
};

const createMapFilePath = (mapsDirectory: string, slug: string) => {
  return resolve(mapsDirectory, `${slug}.pdf`);
};

const createMapKey = (slug: string) => {
  return `pdf-maps/${slug}.pdf`;
};

export const uploadParkMap = async ({
  database,
  mapsDirectory,
  now = () => new Date().toISOString(),
  slug,
  storage
}: UploadParkMapOptions) => {
  const existingPark = await findParkRecordBySlugIncludingRemoved(database, slug);

  if (!existingPark) {
    throw new Error(`Park not found for slug "${slug}".`);
  }

  const localMapPath = createMapFilePath(mapsDirectory, slug);
  let buffer: Buffer;

  try {
    buffer = await readFile(localMapPath);
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException).code;

    if (errorCode === 'ENOENT') {
      throw new Error(`Map PDF not found for slug "${slug}" at ${localMapPath}.`);
    }

    throw error;
  }

  const mapKey = createMapKey(slug);
  await storage.upload(mapKey, buffer, 'application/pdf');

  const park = await updateParkMap(database, slug, {
    key: mapKey,
    updatedAt: now()
  });

  if (!park) {
    throw new Error(`Park not found for slug "${slug}".`);
  }

  return {
    mapKey,
    parkName: park.name,
    slug: park.slug
  };
};
