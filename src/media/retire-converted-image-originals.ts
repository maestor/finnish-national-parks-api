import { sql } from 'drizzle-orm';

import type { Database } from '../db/database.js';
import type { StorageClient } from '../storage/types.js';

const MEDIA_PREFIXES = ['trip-stops/', 'visits/'] as const;
const PAGE_SIZE = 100;
const TRANSIENT_STORAGE_RETRY_DELAYS_MS = [0, 250, 1000] as const;

type ConvertedImageRow = {
  fullKey: string;
  id: number;
  parentId: number;
  thumbKey: string;
  type: 'trip-stop' | 'visit';
  uploadKey: string | null;
};

type RetirementReferences = {
  candidateKeys: Set<string>;
  protectAllCandidates: boolean;
  protectedKeys: Set<string>;
};

type RetirementFailure = {
  key: string;
  message: string;
};

export type ConvertedImageOriginalRetirementResult = {
  deleted: number;
  eligibleBytes: number;
  eligibleKeys: string[];
  failures: RetirementFailure[];
  missingKeys: string[];
  protectedKeys: string[];
  scanned: number;
  oldSourceImagesFound: number;
};

const isManagedMediaKey = (value: string) => {
  return MEDIA_PREFIXES.some((prefix) => value.startsWith(prefix));
};

const collectMediaKeys = (value: unknown, keys: Set<string>): void => {
  if (typeof value === 'string') {
    if (isManagedMediaKey(value)) {
      keys.add(value);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectMediaKeys(entry, keys);
    }
    return;
  }

  if (value && typeof value === 'object') {
    for (const entry of Object.values(value)) {
      collectMediaKeys(entry, keys);
    }
  }
};

const collectSnapshotMediaKeys = (stories: Array<{ storyJson: string }>) => {
  const keys = new Set<string>();
  let protectAllManagedKeys = false;

  for (const { storyJson } of stories) {
    try {
      collectMediaKeys(JSON.parse(storyJson), keys);
    } catch {
      // An unreadable snapshot cannot safely justify removing any historical source.
      if (MEDIA_PREFIXES.some((prefix) => storyJson.includes(prefix))) {
        protectAllManagedKeys = true;
      }
    }
  }

  return { keys, protectAllManagedKeys };
};

const isM1ConvertedImage = (row: ConvertedImageRow) => {
  const prefix = row.type === 'visit' ? 'visits' : 'trip-stops';
  const keyPrefix = `${prefix}/${row.parentId}/final/backfill-${row.id}`;

  return row.fullKey === `${keyPrefix}-full.jpg` && row.thumbKey === `${keyPrefix}-thumb.jpg`;
};

const getRetirementReferences = async (database: Database): Promise<RetirementReferences> => {
  const [visitRows, tripStopRows, yearReviewRows, dateRangeReviewRows] = await Promise.all([
    database.all<Omit<ConvertedImageRow, 'type'> & { parentId: number }>(sql`
      SELECT id, visit_id AS parentId, full_key AS fullKey, thumb_key AS thumbKey,
        upload_key AS uploadKey
      FROM visit_images
    `),
    database.all<Omit<ConvertedImageRow, 'type'> & { parentId: number }>(sql`
      SELECT id, trip_stop_id AS parentId, full_key AS fullKey, thumb_key AS thumbKey,
        upload_key AS uploadKey
      FROM trip_stop_images
    `),
    database.all<{ storyJson: string }>(sql`
      SELECT story_json AS storyJson FROM year_review_shares
    `),
    database.all<{ storyJson: string }>(sql`
      SELECT story_json AS storyJson FROM date_range_review_shares
    `)
  ]);
  const imageRows: ConvertedImageRow[] = [
    ...visitRows.map((row) => ({ ...row, type: 'visit' as const })),
    ...tripStopRows.map((row) => ({ ...row, type: 'trip-stop' as const }))
  ];
  const currentImageKeys = new Set(imageRows.flatMap((row) => [row.fullKey, row.thumbKey]));
  const candidateKeys = new Set(
    imageRows
      .filter((row) => row.uploadKey !== null)
      .filter((row) => isM1ConvertedImage(row))
      .map((row) => row.uploadKey!)
      .filter((key) => key !== '' && currentImageKeys.has(key) === false)
  );
  const snapshotMedia = collectSnapshotMediaKeys([...yearReviewRows, ...dateRangeReviewRows]);
  const protectedKeys = new Set(
    Array.from(candidateKeys).filter((key) => snapshotMedia.keys.has(key))
  );

  return {
    candidateKeys,
    protectAllCandidates: snapshotMedia.protectAllManagedKeys,
    protectedKeys
  };
};

const isTransientStorageError = (error: unknown) => {
  const details = error instanceof Error ? `${error.name} ${error.message}` : String(error);

  return /bad record mac|ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|socket hang up|network error/i.test(
    details
  );
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
    if (delayMs && delayMs > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, delayMs);
      });
    }

    return retryTransientStorageOperation(operation, remainingDelays);
  }
};

const listManagedObjects = async (storage: StorageClient) => {
  const objects = [] as Awaited<ReturnType<StorageClient['listObjects']>>['items'];

  for (const prefix of MEDIA_PREFIXES) {
    let cursor: string | undefined;

    do {
      const page = await retryTransientStorageOperation(() =>
        storage.listObjects({ ...(cursor ? { cursor } : {}), limit: PAGE_SIZE, prefix })
      );
      objects.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }

  return objects;
};

export const runConvertedImageOriginalRetirement = async ({
  apply,
  database,
  storage
}: {
  apply: boolean;
  database: Database;
  storage: StorageClient;
}): Promise<ConvertedImageOriginalRetirementResult> => {
  const [objects, references] = await Promise.all([
    listManagedObjects(storage),
    getRetirementReferences(database)
  ]);
  const objectsByKey = new Map(objects.map((object) => [object.key, object]));
  const oldSourceImagesFound = references.candidateKeys.size;
  const missingKeys = Array.from(references.candidateKeys)
    .filter((key) => objectsByKey.has(key) === false)
    .sort();
  const protectedKeys = Array.from(references.candidateKeys)
    .filter(
      (key) =>
        objectsByKey.has(key) &&
        (references.protectAllCandidates || references.protectedKeys.has(key))
    )
    .sort();
  const eligibleKeys = Array.from(references.candidateKeys)
    .filter((key) => objectsByKey.has(key))
    .filter(
      (key) =>
        references.protectAllCandidates === false && references.protectedKeys.has(key) === false
    )
    .sort();
  const failures: RetirementFailure[] = [];
  let deleted = 0;

  if (apply) {
    for (const key of eligibleKeys) {
      const currentReferences = await getRetirementReferences(database);

      if (
        currentReferences.candidateKeys.has(key) === false ||
        currentReferences.protectAllCandidates ||
        currentReferences.protectedKeys.has(key)
      ) {
        continue;
      }

      try {
        await retryTransientStorageOperation(() => storage.delete(key));
        deleted += 1;
      } catch (error) {
        failures.push({
          key,
          message: error instanceof Error ? error.message : 'Storage deletion failed.'
        });
      }
    }
  }

  return {
    deleted,
    eligibleBytes: eligibleKeys.reduce(
      (total, key) => total + (objectsByKey.get(key)?.size ?? 0),
      0
    ),
    eligibleKeys,
    failures,
    missingKeys,
    protectedKeys,
    scanned: objects.length,
    oldSourceImagesFound
  };
};
