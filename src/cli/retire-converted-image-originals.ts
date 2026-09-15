import { createDatabaseClient } from '../db/client.js';
import { createDatabase } from '../db/database.js';
import { getEnv } from '../env.js';
import { runConvertedImageOriginalRetirement } from '../media/retire-converted-image-originals.js';
import { createR2Client } from '../storage/r2-client.js';
import { assertReadOnlyMediaDatabaseIsCurrent } from './assert-read-only-media-database.js';

const usage = 'Usage: npm run media:remove-converted-originals -- [--apply]';

const parseArgs = (argv: string[]) => {
  if (argv.length === 0) {
    return { apply: false };
  }

  if (argv.length === 1 && argv[0] === '--apply') {
    return { apply: true };
  }

  throw new Error(`Unknown argument.\n${usage}`);
};

const getR2Config = () => {
  const env = getEnv();

  if (env.MEMORY_STORAGE === 'true') {
    throw new Error('media:remove-converted-originals requires real R2 credentials.');
  }

  if (
    !(env.R2_BUCKET_NAME && env.R2_ENDPOINT && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY)
  ) {
    throw new Error(
      'media:remove-converted-originals requires R2_BUCKET_NAME, R2_ENDPOINT, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.'
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
const r2Config = getR2Config();
const client = createDatabaseClient();

try {
  await assertReadOnlyMediaDatabaseIsCurrent(client);

  const result = await runConvertedImageOriginalRetirement({
    apply: args.apply,
    database: createDatabase(client),
    storage: createR2Client(r2Config)
  });
  const status =
    result.failures.length > 0
      ? 'finished_with_problems'
      : args.apply
        ? 'complete'
        : 'preview_complete';
  const summary = args.apply
    ? `${result.deleted} old source image files were removed. Normal-size images and thumbnails were kept.`
    : `${result.eligibleKeys.length} old source image files can be removed. Normal-size images and thumbnails will be kept.`;

  console.log(
    JSON.stringify({
      alreadyRemovedSourceImages: result.missingKeys.length,
      mode: args.apply ? 'remove' : 'preview',
      oldSourceImageBytesToRemove: result.eligibleBytes,
      oldSourceImagesToRemove: result.eligibleKeys.length,
      problems: result.failures,
      publishedReviewProtectedSourceImages: result.protectedKeys.length,
      removedSourceImages: result.deleted,
      scannedImages: result.scanned,
      oldSourceImagesFound: result.oldSourceImagesFound,
      status,
      summary
    })
  );

  if (result.failures.length > 0) {
    process.exitCode = 1;
  }
} finally {
  await client.close();
}
