import { getBackupVerificationProblems, verifyBackupFile } from './verify-backup-lib.js';

const usage = 'Usage: npm run db:verify-backup -- <local-backup.db>';

const backupFilePath = process.argv[2];

if (!(backupFilePath && process.argv.length === 3)) {
  throw new Error(usage);
}

const startedAt = Date.now();
const result = await verifyBackupFile({ backupFilePath });
const problems = getBackupVerificationProblems(result);

if (problems.length > 0) {
  throw new Error(`Backup verification failed: ${problems.join('; ')}.`);
}

console.log(
  JSON.stringify({
    appliedMigrationCount: result.appliedMigrations.length,
    completedInMilliseconds: Date.now() - startedAt,
    recordCounts: result.recordCounts,
    status: 'complete',
    summary: 'The backup was restored into a temporary local database and passed integrity checks.'
  })
);
