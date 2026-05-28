import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { Database } from '../db/database.js';
import { findParkRecordBySlugIncludingRemoved, updateParkMap } from '../db/repositories.js';
import type { StorageClient } from '../storage/types.js';

type UploadParkMapOptions = {
  database: Database;
  force?: boolean;
  mapsDirectory: string;
  now?: () => string;
  slug: string;
  storage: Pick<StorageClient, 'getObjectMetadata' | 'upload'>;
};

type UploadParkMapResult = {
  action: 'db-only' | 'skipped' | 'uploaded';
  mapKey: string;
  parkName: string;
  slug: string;
};

const createMapFilePath = (mapsDirectory: string, slug: string) => {
  return resolve(mapsDirectory, `${slug}.pdf`);
};

const createMapKey = (slug: string) => {
  return `pdf-maps/${slug}.pdf`;
};

export const uploadParkMap = async ({
  database,
  force = false,
  mapsDirectory,
  now = () => new Date().toISOString(),
  slug,
  storage
}: UploadParkMapOptions): Promise<UploadParkMapResult> => {
  const existingPark = await findParkRecordBySlugIncludingRemoved(database, slug);

  if (!existingPark) {
    throw new Error(`Park not found for slug "${slug}".`);
  }

  const mapKey = createMapKey(slug);
  const storageMetadata = await storage.getObjectMetadata(mapKey);
  const storageExists = storageMetadata !== null;
  const dbExists = existingPark.mapKey === mapKey;

  if (!force && storageExists && dbExists) {
    return {
      action: 'skipped',
      mapKey,
      parkName: existingPark.name,
      slug
    };
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

  if (force || !storageExists) {
    await storage.upload(mapKey, buffer, 'application/pdf');
  }

  if (force || !dbExists) {
    const park = await updateParkMap(database, slug, {
      key: mapKey,
      updatedAt: now()
    });

    if (!park) {
      throw new Error(`Park not found for slug "${slug}".`);
    }

    return {
      action: force || !storageExists ? 'uploaded' : 'db-only',
      mapKey,
      parkName: park.name,
      slug: park.slug
    };
  }

  return {
    action: 'uploaded',
    mapKey,
    parkName: existingPark.name,
    slug
  };
};
