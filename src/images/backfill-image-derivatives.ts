import type { Database } from '../db/database.js';
import {
  type LegacyImageDerivativeCursor,
  type LegacyImageDerivativeRecord,
  listLegacyImageDerivativeRecords,
  replaceLegacyImageDerivatives
} from '../db/repositories.js';
import type { StorageClient } from '../storage/types.js';
import { processImage } from './process-image.js';

const TRANSIENT_STORAGE_RETRY_DELAYS_MS = [0, 250, 1000] as const;

const isTransientStorageError = (error: unknown) => {
  const details = error instanceof Error ? `${error.name} ${error.message}` : String(error);

  return /bad record mac|ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|socket hang up|network error/i.test(
    details
  );
};

const waitForRetry = async (delayMs: number) => {
  if (delayMs > 0) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }
};

const retryTransientStorageOperation = async <Result>(
  operation: () => Promise<Result>,
  retryDelaysMs: readonly number[] = TRANSIENT_STORAGE_RETRY_DELAYS_MS
): Promise<Result> => {
  try {
    return await operation();
  } catch (error) {
    if (!isTransientStorageError(error) || retryDelaysMs.length === 0) {
      throw error;
    }

    const [delayMs, ...remainingDelays] = retryDelaysMs;
    await waitForRetry(delayMs!);

    return retryTransientStorageOperation(operation, remainingDelays);
  }
};

export type ImageDerivativeBackfillCursor = LegacyImageDerivativeCursor;

export type ImageDerivativeBackfillResult = {
  completed: number;
  dryRun: boolean;
  failures: Array<{ id: number; message: string; type: LegacyImageDerivativeRecord['type'] }>;
  nextCursor: ImageDerivativeBackfillCursor;
  outputBytes: number;
  previewCursor: ImageDerivativeBackfillCursor;
  scanned: number;
  sourceBytes: number;
};

const createBackfillDerivativeKeys = (record: LegacyImageDerivativeRecord) => {
  const prefix = record.type === 'visit' ? 'visits' : 'trip-stops';
  const keyPrefix = `${prefix}/${record.parentId}/final/backfill-${record.id}`;

  return {
    fullKey: `${keyPrefix}-full.jpg`,
    thumbKey: `${keyPrefix}-thumb.jpg`
  };
};

const MAX_IMAGE_SOURCE_BYTES = 15 * 1024 * 1024;

const advanceCursor = (
  cursor: ImageDerivativeBackfillCursor,
  record: LegacyImageDerivativeRecord
): ImageDerivativeBackfillCursor => {
  return record.type === 'visit'
    ? { ...cursor, visitImageId: record.id }
    : { ...cursor, tripStopImageId: record.id };
};

export const runImageDerivativeBackfill = async ({
  batchSize,
  cursor,
  database,
  dryRun,
  storage
}: {
  batchSize: number;
  cursor: ImageDerivativeBackfillCursor;
  database: Database;
  dryRun: boolean;
  storage: StorageClient;
}): Promise<ImageDerivativeBackfillResult> => {
  const records = await listLegacyImageDerivativeRecords(database, cursor, batchSize);
  let nextCursor = cursor;
  let previewCursor = cursor;
  let sourceBytes = 0;
  let outputBytes = 0;
  let completed = 0;
  const failures: ImageDerivativeBackfillResult['failures'] = [];

  for (const record of records) {
    try {
      const metadata = await retryTransientStorageOperation(() =>
        storage.getObjectMetadata(record.sourceKey)
      );

      if (!metadata?.contentLength || metadata.contentLength < 1) {
        throw new Error('Source object is missing or has an invalid size.');
      }

      sourceBytes += metadata.contentLength;

      if (!dryRun) {
        const sourceBuffer = await retryTransientStorageOperation(() =>
          storage.getObject(record.sourceKey, { maxBytes: MAX_IMAGE_SOURCE_BYTES })
        );

        if (!sourceBuffer) {
          throw new Error('Source object is missing.');
        }

        const processed = await processImage(sourceBuffer);
        const { fullKey, thumbKey } = createBackfillDerivativeKeys(record);

        await retryTransientStorageOperation(() =>
          storage.upload(fullKey, processed.fullBuffer, 'image/jpeg')
        );
        await retryTransientStorageOperation(() =>
          storage.upload(thumbKey, processed.thumbBuffer, 'image/jpeg')
        );

        const updated = await replaceLegacyImageDerivatives(database, record, {
          fileSizeBytes: processed.fullBuffer.length,
          fullHeight: processed.fullHeight,
          fullKey,
          fullWidth: processed.fullWidth,
          thumbHeight: processed.thumbHeight,
          thumbKey,
          thumbWidth: processed.thumbWidth,
          updatedAt: new Date().toISOString()
        });

        if (updated === false) {
          throw new Error('Image row changed before derivatives could be recorded.');
        }

        outputBytes += processed.fullBuffer.length + processed.thumbBuffer.length;
      }

      completed += 1;
      previewCursor = advanceCursor(previewCursor, record);

      if (!dryRun) {
        nextCursor = previewCursor;
      }
    } catch (error) {
      failures.push({
        id: record.id,
        message: error instanceof Error ? error.message : String(error),
        type: record.type
      });
      break;
    }
  }

  return {
    completed,
    dryRun,
    failures,
    nextCursor,
    outputBytes,
    previewCursor,
    scanned: records.length,
    sourceBytes
  };
};

export const runImageDerivativeBackfillToCompletion = async ({
  batchSize,
  cursor,
  database,
  dryRun,
  storage
}: {
  batchSize: number;
  cursor: ImageDerivativeBackfillCursor;
  database: Database;
  dryRun: boolean;
  storage: StorageClient;
}): Promise<ImageDerivativeBackfillResult> => {
  let currentCursor = cursor;
  let completed = 0;
  let outputBytes = 0;
  let scanned = 0;
  let sourceBytes = 0;

  while (true) {
    const batch = await runImageDerivativeBackfill({
      batchSize,
      cursor: currentCursor,
      database,
      dryRun,
      storage
    });

    completed += batch.completed;
    outputBytes += batch.outputBytes;
    scanned += batch.scanned;
    sourceBytes += batch.sourceBytes;

    if (batch.failures.length > 0 || batch.scanned === 0) {
      return {
        completed,
        dryRun,
        failures: batch.failures,
        nextCursor: batch.nextCursor,
        outputBytes,
        previewCursor: batch.previewCursor,
        scanned,
        sourceBytes
      };
    }

    currentCursor = dryRun ? batch.previewCursor : batch.nextCursor;
  }
};
