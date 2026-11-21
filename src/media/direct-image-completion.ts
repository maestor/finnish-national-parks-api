import { randomUUID } from 'node:crypto';
import type { Database } from '../db/database.js';
import {
  claimPendingMediaUpload,
  createPendingMediaUpload,
  findMediaUploadByUploadKey,
  MEDIA_UPLOAD_PROCESSING_LEASE_MS,
  releasePendingMediaUploadClaim
} from '../db/repositories.js';
import { ImageProcessingError, processImage } from '../images/process-image.js';
import {
  type StorageClient,
  StorageObjectTooLargeError,
  type StoredObjectMetadata
} from '../storage/types.js';

export const MAX_VISIT_IMAGE_FILE_SIZE = 15 * 1024 * 1024;
export const ACCEPTED_VISIT_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const DIRECT_VISIT_UPLOAD_URL_TTL_SECONDS = 15 * 60;
const DIRECT_IMAGE_COMPLETION_WAIT_MS = 5_000;
const DIRECT_IMAGE_COMPLETION_POLL_MS = 50;

type InvalidUpload = {
  kind: 'invalid';
  error: string;
  status: 413 | 422;
};

const invalidUpload = (error: string, status: 413 | 422 = 422): InvalidUpload => ({
  kind: 'invalid',
  error,
  status
});

const validateStoredImageCompletionMetadata = (
  objectMetadata: StoredObjectMetadata
): InvalidUpload | null => {
  const { contentLength } = objectMetadata;

  if (
    typeof contentLength !== 'number' ||
    !Number.isFinite(contentLength) ||
    !Number.isInteger(contentLength) ||
    contentLength <= 0
  ) {
    return invalidUpload('Invalid stored file size.');
  }

  if (contentLength > MAX_VISIT_IMAGE_FILE_SIZE) {
    return invalidUpload('File too large.', 413);
  }

  const contentType = objectMetadata.contentType ?? 'application/octet-stream';

  if (!ACCEPTED_VISIT_IMAGE_MIME_TYPES.includes(contentType)) {
    return invalidUpload('Unsupported file type.');
  }

  return null;
};

export const createFinalImageKeys = (parentPrefix: 'trip-stops' | 'visits', parentId: number) => {
  const baseKey = `${parentPrefix}/${parentId}/final/${randomUUID()}`;

  return {
    fullKey: `${baseKey}-full.jpg`,
    thumbKey: `${baseKey}-thumb.jpg`
  };
};

const isDirectUploadKeyForParent = (
  key: string,
  parentPrefix: 'trip-stops' | 'visits',
  parentId: number
) => {
  return key.startsWith(`${parentPrefix}/${parentId}/`);
};

type DirectImageFinalization =
  | InvalidUpload
  | {
      kind: 'finalized';
      image: {
        fileSizeBytes: number;
        fullHeight: number;
        fullKey: string;
        fullWidth: number;
        thumbHeight: number;
        thumbKey: string;
        thumbWidth: number;
      };
    };

const finalizeDirectImageUpload = async (
  storage: StorageClient,
  key: string,
  finalKeys: { fullKey: string; thumbKey: string }
): Promise<DirectImageFinalization> => {
  let sourceBuffer: Buffer | null;
  try {
    sourceBuffer = await storage.getObject(key, {
      maxBytes: MAX_VISIT_IMAGE_FILE_SIZE,
      timeoutMs: 10_000
    });
  } catch (error) {
    if (error instanceof StorageObjectTooLargeError) {
      return invalidUpload('File too large.', 413);
    }

    throw error;
  }

  if (!sourceBuffer || sourceBuffer.length === 0) {
    return invalidUpload('Upload is missing from storage.');
  }

  if (sourceBuffer.length > MAX_VISIT_IMAGE_FILE_SIZE) {
    return invalidUpload('File too large.', 413);
  }

  try {
    const processed = await processImage(sourceBuffer);
    const { fullKey, thumbKey } = finalKeys;

    await storage.upload(fullKey, processed.fullBuffer, 'image/jpeg');
    await storage.upload(thumbKey, processed.thumbBuffer, 'image/jpeg');

    return {
      kind: 'finalized',
      image: {
        fileSizeBytes: processed.fullBuffer.length,
        fullHeight: processed.fullHeight,
        fullKey,
        fullWidth: processed.fullWidth,
        thumbHeight: processed.thumbHeight,
        thumbKey,
        thumbWidth: processed.thumbWidth
      }
    };
  } catch (error) {
    if (error instanceof ImageProcessingError) {
      return invalidUpload('Invalid image content.');
    }

    throw error;
  }
};

const normalizeOptionalOriginalName = (originalName?: string | null) => {
  return originalName?.trim() || null;
};

type ImageUploadParent = { id: number; type: 'trip-stop' | 'visit' };

interface DirectImageCompletion<T> {
  database: Database;
  storage: StorageClient;
  key: string;
  parent: ImageUploadParent;
  findCompletedImage: () => Promise<T | null>;
}

const parentPrefix = (parent: ImageUploadParent) =>
  parent.type === 'visit' ? 'visits' : 'trip-stops';

const uploadNotPrepared = () => invalidUpload('Upload could not be prepared for completion.');

export const prepareDirectImageCompletion = async <T>({
  database,
  storage,
  key,
  parent,
  findCompletedImage
}: DirectImageCompletion<T>) => {
  const prefix = parentPrefix(parent);
  const wrongParent = () =>
    invalidUpload(
      parent.type === 'visit'
        ? 'Upload key does not belong to this visit.'
        : 'Upload key does not belong to this trip stop.'
    );
  if (!isDirectUploadKeyForParent(key, prefix, parent.id)) {
    return wrongParent();
  }

  const existingImage = await findCompletedImage();
  if (existingImage) {
    return { kind: 'existing', image: existingImage } as const;
  }

  let pendingUpload = await findMediaUploadByUploadKey(database, key);
  if (
    pendingUpload &&
    (pendingUpload.parentId !== parent.id || pendingUpload.parentType !== parent.type)
  ) {
    return wrongParent();
  }

  if (!pendingUpload) {
    const timestamp = new Date().toISOString();
    await createPendingMediaUpload(database, {
      ...createFinalImageKeys(prefix, parent.id),
      expiresAt: new Date(Date.now() + DIRECT_VISIT_UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
      parentId: parent.id,
      parentType: parent.type,
      timestamp,
      uploadKey: key
    });
    pendingUpload = await findMediaUploadByUploadKey(database, key);
  }

  if (!pendingUpload) {
    return uploadNotPrepared();
  }

  const objectMetadata = await storage.getObjectMetadata(key);
  if (!objectMetadata) {
    return invalidUpload('Upload is missing from storage.');
  }

  return validateStoredImageCompletionMetadata(objectMetadata) ?? ({ kind: 'prepared' } as const);
};

const waitForImageCompletionClaim = async <T>({
  database,
  key,
  parent,
  findCompletedImage
}: DirectImageCompletion<T>) => {
  const completionDeadline = Date.now() + DIRECT_IMAGE_COMPLETION_WAIT_MS;
  const prefix = parentPrefix(parent);

  while (true) {
    const existingImage = await findCompletedImage();
    if (existingImage) {
      return { kind: 'existing', image: existingImage } as const;
    }

    const currentUpload = await findMediaUploadByUploadKey(database, key);
    if (!currentUpload) {
      return uploadNotPrepared();
    }

    const timestamp = new Date().toISOString();
    const processingToken = randomUUID();
    const keys = createFinalImageKeys(prefix, parent.id);
    const upload = await claimPendingMediaUpload(database, {
      ...keys,
      expectedFullKey: currentUpload.fullKey,
      expectedThumbKey: currentUpload.thumbKey,
      parentId: parent.id,
      parentType: parent.type,
      processingStartedAt: timestamp,
      processingToken,
      staleBefore: new Date(Date.parse(timestamp) - MEDIA_UPLOAD_PROCESSING_LEASE_MS).toISOString(),
      timestamp,
      uploadKey: key
    });
    if (upload) {
      return { kind: 'claimed', upload, processingToken } as const;
    }

    if (Date.now() >= completionDeadline) {
      return invalidUpload('Upload completion is already in progress. Retry shortly.');
    }
    await new Promise((resolve) => setTimeout(resolve, DIRECT_IMAGE_COMPLETION_POLL_MS));
  }
};

export const claimAndFinalizeDirectImage = async <T>(
  completion: DirectImageCompletion<T>,
  originalName?: string | null
) => {
  const claim = await waitForImageCompletionClaim(completion);
  if (claim.kind !== 'claimed') {
    return claim;
  }

  const { database, key, storage } = completion;
  const { upload, processingToken } = claim;
  const finalized = await finalizeDirectImageUpload(storage, key, upload);
  if (finalized.kind === 'invalid') {
    await releasePendingMediaUploadClaim(database, {
      processingToken,
      timestamp: new Date().toISOString(),
      uploadKey: key
    });
    return finalized;
  }

  const timestamp = new Date().toISOString();
  return {
    kind: 'ready',
    image: {
      ...finalized.image,
      createdAt: timestamp,
      displayOrder: 0,
      mimeType: 'image/jpeg',
      originalName: normalizeOptionalOriginalName(originalName),
      processingToken,
      updatedAt: timestamp,
      uploadKey: key
    }
  } as const;
};
