import type { Database } from '../db/database.js';
import {
  type LegacyImageDerivativeCursor,
  type LegacyImageDerivativeRecord,
  listLegacyImageDerivativeRecords,
  replaceLegacyImageDerivatives
} from '../db/repositories.js';
import type { StorageClient } from '../storage/types.js';
import { processImage } from './process-image.js';

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
      const metadata = await storage.getObjectMetadata(record.sourceKey);

      if (!metadata?.contentLength || metadata.contentLength < 1) {
        throw new Error('Source object is missing or has an invalid size.');
      }

      sourceBytes += metadata.contentLength;

      if (!dryRun) {
        const sourceBuffer = await storage.getObject(record.sourceKey);

        if (!sourceBuffer) {
          throw new Error('Source object is missing.');
        }

        const processed = await processImage(sourceBuffer);
        const { fullKey, thumbKey } = createBackfillDerivativeKeys(record);

        await storage.upload(fullKey, processed.fullBuffer, 'image/jpeg');
        await storage.upload(thumbKey, processed.thumbBuffer, 'image/jpeg');

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
