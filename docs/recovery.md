# Recovery drill

This runbook separates what the repository can prove locally from the backup, retention, and media-recovery controls that must be verified by the operator in Turso, Cloudflare R2, GitHub, and Vercel. Do not point a restore command at production.

## What exists today

- The production migration workflow creates a Turso SQLite backup only when a schema migration is pending. GitHub retains that workflow artifact for 14 days.
- `npm run db:backup` can create a fresh local SQLite copy of the remote Turso database before a high-risk import, migration, or bulk administrative change.
- The repository does not prove a recurring database-backup schedule, Turso PITR retention, R2 object versioning, an independent media copy, or a completed production restore drill. Those remain operator checks, not controls this code claims are configured.

## Safe database drill

Run this on a trusted machine with a downloaded backup file. The command accepts only a local SQLite file path; it does not read `DATABASE_URL`, does not connect to Turso, and does not use R2 credentials.

```sh
npm run db:verify-backup -- data/backups/turso-backup-2026-09-13T10-00-00Z-before-production-migrate.db
```

It copies the supplied backup into a new operating-system temporary directory, runs `PRAGMA quick_check`, applies the repository migrations only to that copy, then checks:

- no migration remains pending after the isolated restore;
- SQLite foreign-key integrity;
- non-empty full and thumbnail image keys; and
- valid JSON in published year-review and date-range-review snapshots.

It prints `"status":"complete"` only when those checks pass, including record counts for parks, visits, trips, images, and published review snapshots. The copied database is removed automatically. The source backup remains unchanged. A failure means the isolated copy was not accepted; it does not modify production.

Record the date, backup timestamp, command output, duration, result, and any recovery gap in the operations log. A current database backup may need migrations during the drill; that count is reported as `appliedMigrationCount` and is safe because it happens only in the temporary copy.

## Operator evidence still required

Before M3 storage cleanup can begin, record dated evidence for all of these controls:

1. Turso: backup/PITR retention, access roles, and the restore target that is separate from the production database URL.
2. GitHub: who can download the 14-day migration artifacts and whether their retention meets the chosen recovery target.
3. R2: bucket privacy, object versioning or an independent copy policy, retention, and restricted recovery access. The database drill validates keys, not object bytes.
4. A disposable media recovery: copy a small approved media sample to a separate non-production bucket, compare the restored objects with the database references, and remove only that disposable copy afterward.
5. Vercel: confirm the production migration check still runs before dependent deployment promotion.

Initial targets proposed in the sustainability plan are at most 24 hours of visit-data loss and restoration within one working day. The project owner must approve or replace those targets and choose the backup-failure notification route before they are treated as operational commitments.

## Never do this in a drill

- Do not overwrite the production Turso URL.
- Do not restore production media into a public bucket.
- Do not delete objects or rely on absence from image rows: frozen published-review snapshots can still reference image keys.
- Do not put database backups or copied media in the repository, CI logs, or a broadly shared location.
