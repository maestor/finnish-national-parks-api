import { copyFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { type Client, createClient } from '@libsql/client';
import { getPendingMigrationNames, migrateDatabase } from '../db/migrate.js';

const LOCAL_BACKUP_FILE_ERROR = 'Backup verification requires a local SQLite backup file.';

type RecordCounts = {
  dateRangeReviewShares: number;
  parks: number;
  tripStopImages: number;
  tripStops: number;
  trips: number;
  visitImages: number;
  visits: number;
  yearReviewShares: number;
};

export type BackupVerificationResult = {
  appliedMigrations: string[];
  foreignKeyViolations: number;
  invalidImageReferences: number;
  invalidSnapshotStories: number;
  pendingMigrations: string[];
  recordCounts: RecordCounts;
};

export const getBackupVerificationProblems = (result: BackupVerificationResult) => {
  return [
    ...(result.pendingMigrations.length > 0
      ? [`${result.pendingMigrations.length} migration(s) still pending after restore`]
      : []),
    ...(result.foreignKeyViolations > 0
      ? [`${result.foreignKeyViolations} foreign-key violation(s)`]
      : []),
    ...(result.invalidImageReferences > 0
      ? [`${result.invalidImageReferences} invalid image reference(s)`]
      : []),
    ...(result.invalidSnapshotStories > 0
      ? [`${result.invalidSnapshotStories} invalid published-review snapshot(s)`]
      : [])
  ];
};

const getCount = async (client: Client, sql: string) => {
  const result = await client.execute(sql);
  return Number(result.rows[0]?.count ?? 0);
};

const getRecordCounts = async (client: Client): Promise<RecordCounts> => {
  const [
    dateRangeReviewShares,
    parks,
    tripStopImages,
    tripStops,
    trips,
    visitImages,
    visits,
    yearReviewShares
  ] = await Promise.all([
    getCount(client, 'SELECT COUNT(*) AS count FROM date_range_review_shares'),
    getCount(client, 'SELECT COUNT(*) AS count FROM parks'),
    getCount(client, 'SELECT COUNT(*) AS count FROM trip_stop_images'),
    getCount(client, 'SELECT COUNT(*) AS count FROM trip_stops'),
    getCount(client, 'SELECT COUNT(*) AS count FROM trips'),
    getCount(client, 'SELECT COUNT(*) AS count FROM visit_images'),
    getCount(client, 'SELECT COUNT(*) AS count FROM park_visits'),
    getCount(client, 'SELECT COUNT(*) AS count FROM year_review_shares')
  ]);

  return {
    dateRangeReviewShares,
    parks,
    tripStopImages,
    tripStops,
    trips,
    visitImages,
    visits,
    yearReviewShares
  };
};

const getInvalidImageReferences = async (client: Client) => {
  return await getCount(
    client,
    `
      SELECT COUNT(*) AS count
      FROM (
        SELECT full_key, thumb_key FROM visit_images
        UNION ALL
        SELECT full_key, thumb_key FROM trip_stop_images
      )
      WHERE TRIM(full_key) = '' OR TRIM(thumb_key) = ''
    `
  );
};

const getInvalidSnapshotStories = async (client: Client) => {
  return await getCount(
    client,
    `
      SELECT COUNT(*) AS count
      FROM (
        SELECT story_json FROM date_range_review_shares
        UNION ALL
        SELECT story_json FROM year_review_shares
      )
      WHERE json_valid(story_json) = 0
    `
  );
};

const assertLocalBackupFilePath = async (backupFilePath: string) => {
  if (backupFilePath.startsWith('file:') || backupFilePath.includes('://')) {
    throw new Error(LOCAL_BACKUP_FILE_ERROR);
  }

  const resolvedBackupFilePath = resolve(backupFilePath);
  const backupFileStats = await stat(resolvedBackupFilePath);

  if (!backupFileStats.isFile()) {
    throw new Error(LOCAL_BACKUP_FILE_ERROR);
  }

  return resolvedBackupFilePath;
};

export const verifyBackupFile = async ({
  backupFilePath
}: {
  backupFilePath: string;
}): Promise<BackupVerificationResult> => {
  const sourceBackupFilePath = await assertLocalBackupFilePath(backupFilePath);
  const restoreDirectoryPath = await mkdtemp(join(tmpdir(), 'reissuvihko-restore-drill-'));
  const restoredBackupFilePath = join(restoreDirectoryPath, basename(sourceBackupFilePath));
  let client: Client | undefined;

  try {
    await copyFile(sourceBackupFilePath, restoredBackupFilePath);
    client = createClient({ url: pathToFileURL(restoredBackupFilePath).toString() });

    const quickCheck = await client.execute('PRAGMA quick_check');
    const quickCheckResult = String(quickCheck.rows[0]?.quick_check);

    if (quickCheckResult !== 'ok') {
      throw new Error(`Restored backup quick_check failed with result: ${quickCheckResult}`);
    }

    const appliedMigrations = await getPendingMigrationNames(client);
    await migrateDatabase(client);
    const pendingMigrations = await getPendingMigrationNames(client);
    const foreignKeyViolations = await getCount(
      client,
      'SELECT COUNT(*) AS count FROM pragma_foreign_key_check'
    );
    const [invalidImageReferences, invalidSnapshotStories, recordCounts] = await Promise.all([
      getInvalidImageReferences(client),
      getInvalidSnapshotStories(client),
      getRecordCounts(client)
    ]);

    return {
      appliedMigrations,
      foreignKeyViolations,
      invalidImageReferences,
      invalidSnapshotStories,
      recordCounts,
      pendingMigrations
    };
  } finally {
    client?.close();
    await rm(restoreDirectoryPath, { force: true, recursive: true });
  }
};
