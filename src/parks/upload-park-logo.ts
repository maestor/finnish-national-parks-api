import { readFile } from 'node:fs/promises';

import type { Database } from '../db/database.js';
import { findParkRecordBySlugIncludingRemoved, updateParkLogo } from '../db/repositories.js';
import type { StorageClient } from '../storage/types.js';
import { findParkLogoAsset } from './logo-assets.js';

type UploadParkLogoOptions = {
  database: Database;
  force?: boolean;
  logosDirectory: string;
  now?: () => string;
  slug: string;
  storage: Pick<StorageClient, 'getObjectMetadata' | 'upload'>;
};

type UploadParkLogoResult = {
  action: 'db-only' | 'skipped' | 'uploaded';
  logoKey: string;
  parkName: string;
  slug: string;
};

export const uploadParkLogo = async ({
  database,
  force = false,
  logosDirectory,
  now = () => new Date().toISOString(),
  slug,
  storage
}: UploadParkLogoOptions): Promise<UploadParkLogoResult> => {
  const existingPark = await findParkRecordBySlugIncludingRemoved(database, slug);

  if (!existingPark) {
    throw new Error(`Park not found for slug "${slug}".`);
  }

  const logoAsset = await findParkLogoAsset(logosDirectory, existingPark);

  if (!logoAsset) {
    throw new Error(`Logo PNG not found for slug "${slug}".`);
  }

  const { localFilePath: localLogoPath, logoKey } = logoAsset;
  const storageMetadata = await storage.getObjectMetadata(logoKey);
  const storageExists = storageMetadata !== null;
  const dbExists = existingPark.logoKey === logoKey;

  if (!force && storageExists && dbExists) {
    return {
      action: 'skipped',
      logoKey,
      parkName: existingPark.name,
      slug
    };
  }

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

  if (force || !storageExists) {
    await storage.upload(logoKey, buffer, 'image/png');
  }

  if (force || !dbExists) {
    const park = await updateParkLogo(database, slug, {
      key: logoKey,
      updatedAt: now()
    });

    if (!park) {
      throw new Error(`Park not found for slug "${slug}".`);
    }

    return {
      action: force || !storageExists ? 'uploaded' : 'db-only',
      logoKey,
      parkName: park.name,
      slug: park.slug
    };
  }

  return {
    action: 'uploaded',
    logoKey,
    parkName: existingPark.name,
    slug
  };
};
