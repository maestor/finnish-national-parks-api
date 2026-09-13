import { createDatabaseClient } from '../db/client.js';
import { createDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrate.js';
import { getEnv } from '../env.js';
import {
  runUnusedMediaCleanup,
  UNUSED_MEDIA_MINIMUM_AGE_MS
} from '../media/unused-media-cleanup.js';
import { createR2Client } from '../storage/r2-client.js';

const usage =
  'Usage: npm run media:cleanup-unused-images -- [--apply] [--older-than-days <minimum 8>]';

type ParsedArgs = {
  apply: boolean;
  olderThanDays: number;
};

const parseArgs = (argv: string[]): ParsedArgs => {
  let apply = false;
  let olderThanDays = UNUSED_MEDIA_MINIMUM_AGE_MS / (24 * 60 * 60 * 1000);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--apply') {
      apply = true;
      continue;
    }

    if (arg === '--older-than-days') {
      olderThanDays = Number(argv[index + 1]);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}\n${usage}`);
  }

  if (!Number.isInteger(olderThanDays) || olderThanDays < 8) {
    throw new Error(`--older-than-days must be an integer of at least 8.\n${usage}`);
  }

  return { apply, olderThanDays };
};

const getR2Config = () => {
  const env = getEnv();

  if (env.MEMORY_STORAGE === 'true') {
    throw new Error('media:cleanup-unused-images requires real R2 credentials.');
  }

  if (
    !(env.R2_BUCKET_NAME && env.R2_ENDPOINT && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY)
  ) {
    throw new Error(
      'media:cleanup-unused-images requires R2_BUCKET_NAME, R2_ENDPOINT, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.'
    );
  }

  return {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    bucketName: env.R2_BUCKET_NAME,
    endpoint: env.R2_ENDPOINT,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY
  };
};

const args = parseArgs(process.argv.slice(2));
const client = createDatabaseClient();

try {
  await migrateDatabase(client);

  const result = await runUnusedMediaCleanup({
    apply: args.apply,
    database: createDatabase(client),
    minimumAgeMs: args.olderThanDays * 24 * 60 * 60 * 1000,
    now: new Date(),
    storage: createR2Client(getR2Config())
  });
  const status =
    result.failures.length > 0
      ? 'finished_with_problems'
      : args.apply
        ? 'complete'
        : 'preview_complete';
  const summary = args.apply
    ? `${result.deleted} unused image files were deleted after a fresh reference check.`
    : `${result.eligibleKeys.length} unused image files would be deleted. No files were changed.`;

  console.log(
    JSON.stringify({
      deletedImages: result.deleted,
      imagesToDelete: result.eligibleKeys.length,
      mode: args.apply ? 'delete' : 'preview',
      olderThanDays: args.olderThanDays,
      problems: result.failures,
      protectedImages: result.protectedKeys.length,
      scannedImages: result.scanned,
      status,
      summary,
      unusedImageBytes: result.eligibleBytes
    })
  );

  if (result.failures.length > 0) {
    process.exitCode = 1;
  }
} finally {
  await client.close();
}
