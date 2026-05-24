import { mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createClient } from '@libsql/client';

import { getEnv } from '../env.js';

const backupDirectoryPath = resolve('data/backups');

const escapeSqliteString = (value: string) => {
  return value.replaceAll("'", "''");
};

const createTimestamp = (date = new Date()) => {
  return date
    .toISOString()
    .replaceAll(':', '-')
    .replace(/\.\d{3}Z$/, 'Z');
};

const sanitizeLabel = (value: string) => {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
};

const createBackupFileName = (label?: string) => {
  const normalizedLabel = label ? sanitizeLabel(label) : '';
  return normalizedLabel
    ? `turso-backup-${createTimestamp()}-${normalizedLabel}.db`
    : `turso-backup-${createTimestamp()}.db`;
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = -1;

  do {
    value /= 1024;
    unitIndex += 1;
  } while (value >= 1024 && unitIndex < units.length - 1);

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
};

const getBackupLabel = () => {
  const label = process.argv[2];

  if (!label) {
    return undefined;
  }

  const normalizedLabel = sanitizeLabel(label);

  if (!normalizedLabel) {
    throw new Error(
      'Backup label must contain at least one letter or number, for example: npm run db:backup -- before-import'
    );
  }

  return normalizedLabel;
};

const isLocalDatabaseUrl = (databaseUrl: string) => {
  return databaseUrl === ':memory:' || databaseUrl.startsWith('file:');
};

const assertRemoteBackupEnv = (databaseUrl: string, authToken: string | undefined) => {
  if (isLocalDatabaseUrl(databaseUrl)) {
    throw new Error(
      'db:backup expects DATABASE_URL to point at a remote Turso/libSQL database. Current DATABASE_URL is local.'
    );
  }

  if (!authToken) {
    throw new Error('db:backup requires DATABASE_AUTH_TOKEN for the remote Turso/libSQL database.');
  }

  return authToken;
};

const env = getEnv();
const backupLabel = getBackupLabel();

const authToken = assertRemoteBackupEnv(env.DATABASE_URL, env.DATABASE_AUTH_TOKEN);

mkdirSync(backupDirectoryPath, { recursive: true });

const backupFilePath = resolve(backupDirectoryPath, createBackupFileName(backupLabel));
const replicaDirectoryPath = mkdtempSync(resolve(backupDirectoryPath, '.turso-backup-work-'));
const replicaFilePath = resolve(replicaDirectoryPath, 'replica.db');
const replicaFileUrl = pathToFileURL(replicaFilePath).toString();

const client = createClient({
  authToken,
  syncUrl: env.DATABASE_URL,
  url: replicaFileUrl
});

try {
  const replication = await client.sync();
  const quickCheck = await client.execute('PRAGMA quick_check');
  const quickCheckResult = quickCheck.rows[0]?.quick_check;

  if (quickCheckResult !== 'ok') {
    throw new Error(`Backup quick_check failed with result: ${String(quickCheckResult)}`);
  }

  await client.execute(`VACUUM INTO '${escapeSqliteString(backupFilePath)}'`);

  const backupFileStats = statSync(backupFilePath);
  const backupFileLabel = relative(process.cwd(), backupFilePath) || basename(backupFilePath);

  console.log(`Created Turso backup at ${backupFileLabel}`);
  console.log(`Size: ${formatBytes(backupFileStats.size)}`);
  console.log(`Frames synced: ${replication?.frames_synced ?? 'n/a'}`);
  console.log(`Frame number: ${replication?.frame_no ?? 'n/a'}`);
} catch (error) {
  rmSync(backupFilePath, { force: true });
  throw error;
} finally {
  client.close();
  rmSync(replicaDirectoryPath, { force: true, recursive: true });
}
