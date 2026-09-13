import { sql } from 'drizzle-orm';

import type { Database } from '../db/database.js';
import type { StorageClient } from '../storage/types.js';

const MEDIA_PREFIXES = ['trip-stops/', 'visits/'] as const;
const DEFAULT_PAGE_SIZE = 100;
export const UNUSED_MEDIA_MINIMUM_AGE_MS = 8 * 24 * 60 * 60 * 1000;

type MediaReferences = {
  cleanupEligibleAtByKey: Map<string, Date>;
  protectAllManagedKeys: boolean;
  protectedKeys: Set<string>;
};

type MediaCleanupFailure = {
  key: string;
  message: string;
};

export type UnusedMediaCleanupResult = {
  deleted: number;
  eligibleBytes: number;
  eligibleKeys: string[];
  failures: MediaCleanupFailure[];
  protectedBytes: number;
  protectedKeys: string[];
  scanned: number;
  scannedBytes: number;
};

const isManagedMediaKey = (value: string) => {
  return MEDIA_PREFIXES.some((prefix) => value.startsWith(prefix));
};

const isTemporaryDirectUploadKey = (value: string) => {
  return /^(?:trip-stops|visits)\/\d+\/staged\//.test(value);
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
      // A malformed legacy snapshot cannot justify deleting media it may reference.
      if (MEDIA_PREFIXES.some((prefix) => storyJson.includes(prefix))) {
        protectAllManagedKeys = true;
      }
    }
  }

  return { keys, protectAllManagedKeys };
};

const getMediaReferences = async (database: Database, now: Date): Promise<MediaReferences> => {
  const [visitRows, tripStopRows, yearReviewRows, dateRangeReviewRows, pendingRows, cleanupRows] =
    await Promise.all([
      database.all<{ fullKey: string; thumbKey: string; uploadKey: string | null }>(sql`
      SELECT full_key AS fullKey, thumb_key AS thumbKey, upload_key AS uploadKey FROM visit_images
    `),
      database.all<{ fullKey: string; thumbKey: string; uploadKey: string | null }>(sql`
      SELECT full_key AS fullKey, thumb_key AS thumbKey, upload_key AS uploadKey FROM trip_stop_images
    `),
      database.all<{ storyJson: string }>(
        sql`SELECT story_json AS storyJson FROM year_review_shares`
      ),
      database.all<{ storyJson: string }>(
        sql`SELECT story_json AS storyJson FROM date_range_review_shares`
      ),
      database.all<{ fullKey: string; thumbKey: string; uploadKey: string }>(sql`
      SELECT full_key AS fullKey, thumb_key AS thumbKey, upload_key AS uploadKey
      FROM media_uploads
      WHERE settled_at IS NULL AND expires_at > ${now.toISOString()}
    `),
      database.all<{ eligibleAt: string; key: string }>(sql`
      SELECT eligible_at AS eligibleAt, key FROM media_cleanup_tasks
    `)
    ]);

  const referencedKeys = new Set<string>();
  for (const row of [...visitRows, ...tripStopRows]) {
    referencedKeys.add(row.fullKey);
    referencedKeys.add(row.thumbKey);

    if (row.uploadKey && !isTemporaryDirectUploadKey(row.uploadKey)) {
      referencedKeys.add(row.uploadKey);
    }
  }
  const snapshotMedia = collectSnapshotMediaKeys([...yearReviewRows, ...dateRangeReviewRows]);
  for (const key of snapshotMedia.keys) {
    referencedKeys.add(key);
  }
  const protectedKeys = new Set(referencedKeys);
  for (const row of pendingRows) {
    protectedKeys.add(row.uploadKey);
    protectedKeys.add(row.fullKey);
    protectedKeys.add(row.thumbKey);
  }

  return {
    cleanupEligibleAtByKey: new Map(cleanupRows.map((row) => [row.key, new Date(row.eligibleAt)])),
    protectAllManagedKeys: snapshotMedia.protectAllManagedKeys,
    protectedKeys
  };
};

const isProtected = (references: MediaReferences, key: string, now: Date) => {
  const cleanupEligibleAt = references.cleanupEligibleAtByKey.get(key);

  return (
    references.protectAllManagedKeys ||
    references.protectedKeys.has(key) ||
    (cleanupEligibleAt !== undefined && cleanupEligibleAt > now)
  );
};

const isEligibleForCleanup = (
  references: MediaReferences,
  key: string,
  lastModified: Date | null,
  cutoff: number,
  now: Date
) => {
  const cleanupEligibleAt = references.cleanupEligibleAtByKey.get(key);

  if (cleanupEligibleAt !== undefined) {
    return cleanupEligibleAt <= now;
  }

  return lastModified !== null && lastModified.getTime() <= cutoff;
};

const listManagedObjects = async (storage: StorageClient) => {
  const objects = [] as Awaited<ReturnType<StorageClient['listObjects']>>['items'];

  for (const prefix of MEDIA_PREFIXES) {
    let cursor: string | undefined;

    do {
      const page = await storage.listObjects({
        ...(cursor ? { cursor } : {}),
        limit: DEFAULT_PAGE_SIZE,
        prefix
      });
      objects.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }

  return objects;
};

export const runUnusedMediaCleanup = async ({
  apply,
  database,
  minimumAgeMs = UNUSED_MEDIA_MINIMUM_AGE_MS,
  now,
  storage
}: {
  apply: boolean;
  database: Database;
  minimumAgeMs?: number;
  now: Date;
  storage: StorageClient;
}): Promise<UnusedMediaCleanupResult> => {
  const objects = await listManagedObjects(storage);
  const references = await getMediaReferences(database, now);
  const cutoff = now.getTime() - minimumAgeMs;
  const eligibleKeys = objects
    .filter((object) => isProtected(references, object.key, now) === false)
    .filter((object) =>
      isEligibleForCleanup(references, object.key, object.lastModified, cutoff, now)
    )
    .map((object) => object.key)
    .sort();
  const protectedKeys = objects
    .filter((object) => isProtected(references, object.key, now))
    .map((object) => object.key)
    .sort();
  const bytesByKey = new Map(objects.map((object) => [object.key, object.size ?? 0]));
  const failures: MediaCleanupFailure[] = [];
  let deleted = 0;

  if (apply) {
    for (const key of eligibleKeys) {
      const currentReferences = await getMediaReferences(database, now);

      if (isProtected(currentReferences, key, now)) {
        continue;
      }

      try {
        await storage.delete(key);
        await database.run(sql`DELETE FROM media_cleanup_tasks WHERE key = ${key}`);
        deleted += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Storage deletion failed.';
        failures.push({ key, message });
        await database.run(sql`
          INSERT INTO media_cleanup_tasks (
            key, eligible_at, attempt_count, last_attempt_at, last_error, created_at, updated_at
          ) VALUES (
            ${key}, ${now.toISOString()}, 1, ${now.toISOString()}, ${message},
            ${now.toISOString()}, ${now.toISOString()}
          )
          ON CONFLICT(key) DO UPDATE SET
            attempt_count = media_cleanup_tasks.attempt_count + 1,
            last_attempt_at = excluded.last_attempt_at,
            last_error = excluded.last_error,
            updated_at = excluded.updated_at
        `);
      }
    }
  }

  return {
    deleted,
    eligibleBytes: eligibleKeys.reduce((total, key) => total + bytesByKey.get(key)!, 0),
    eligibleKeys,
    failures,
    protectedBytes: protectedKeys.reduce((total, key) => total + bytesByKey.get(key)!, 0),
    protectedKeys,
    scanned: objects.length,
    scannedBytes: objects.reduce((total, object) => total + (object.size ?? 0), 0)
  };
};
