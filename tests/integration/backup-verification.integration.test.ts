import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createClient } from '@libsql/client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getBackupVerificationProblems,
  verifyBackupFile
} from '../../src/cli/verify-backup-lib.js';
import { migrateDatabase } from '../../src/db/migrate.js';

describe('backup verification', () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories
        .splice(0)
        .map(async (directory) => rm(directory, { force: true, recursive: true }))
    );
  });

  it('restores a local backup into an isolated temporary database without changing the source', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'reissuvihko-backup-verification-'));
    directories.push(directory);
    const backupFilePath = join(directory, 'source.db');
    const sourceClient = createClient({ url: pathToFileURL(backupFilePath).toString() });
    await migrateDatabase(sourceClient);
    await sourceClient.close();
    const sourceBeforeVerification = await readFile(backupFilePath);

    const result = await verifyBackupFile({ backupFilePath });

    await expect(readFile(backupFilePath)).resolves.toEqual(sourceBeforeVerification);
    expect(result).toEqual({
      appliedMigrations: [],
      foreignKeyViolations: 0,
      invalidImageReferences: 0,
      invalidSnapshotStories: 0,
      pendingMigrations: [],
      recordCounts: {
        dateRangeReviewShares: 0,
        parks: 0,
        tripRouteWaypoints: 0,
        tripStopImages: 0,
        tripStops: 0,
        trips: 0,
        visitImages: 0,
        visits: 0,
        yearReviewShares: 0
      }
    });
  });

  it('rejects a remote database address instead of connecting to it', async () => {
    await expect(
      verifyBackupFile({ backupFilePath: 'libsql://production.example.com' })
    ).rejects.toThrow('Backup verification requires a local SQLite backup file.');

    await expect(verifyBackupFile({ backupFilePath: 'file:///tmp/production.db' })).rejects.toThrow(
      'Backup verification requires a local SQLite backup file.'
    );
  });

  it('reports broken restored references and snapshots for an operator to investigate', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'reissuvihko-backup-verification-'));
    directories.push(directory);
    const backupFilePath = join(directory, 'source.db');
    const sourceClient = createClient({ url: pathToFileURL(backupFilePath).toString() });
    await migrateDatabase(sourceClient);
    await sourceClient.execute('PRAGMA foreign_keys = OFF');
    await sourceClient.execute(`
      INSERT INTO park_visits (park_id, visited_on, exclude_from_route, created_at, updated_at)
      VALUES (99999, '2026-09-13', 0, '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z')
    `);
    await sourceClient.execute(`
      INSERT INTO year_review_shares (
        year, share_id, story_json, generated_at, published_at, created_at, updated_at
      ) VALUES (
        2026,
        'recovery-test-share',
        '{not valid JSON}',
        '2026-09-13T00:00:00.000Z',
        '2026-09-13T00:00:00.000Z',
        '2026-09-13T00:00:00.000Z',
        '2026-09-13T00:00:00.000Z'
      )
    `);
    await sourceClient.close();

    const result = await verifyBackupFile({ backupFilePath });

    expect(getBackupVerificationProblems(result)).toEqual([
      '1 foreign-key violation(s)',
      '1 invalid published-review snapshot(s)'
    ]);
  });
});
