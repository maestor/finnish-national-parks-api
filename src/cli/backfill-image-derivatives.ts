import { createDatabaseClient } from '../db/client.js';
import { createDatabase } from '../db/database.js';
import { getEnv } from '../env.js';
import { runImageDerivativeBackfillToCompletion } from '../images/backfill-image-derivatives.js';
import { createR2Client } from '../storage/r2-client.js';
import { assertReadOnlyMediaDatabaseIsCurrent } from './assert-read-only-media-database.js';

const usage = 'Usage: npm run media:convert-existing-images -- [--apply] [--batch-size <1-100>]';

type ParsedArgs = {
  batchSize: number;
  dryRun: boolean;
};

const defaultCursor = {
  tripStopImageId: 0,
  visitImageId: 0
};

const parseArgs = (argv: string[]): ParsedArgs => {
  let batchSize = 25;
  let dryRun = true;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === '--apply') {
      dryRun = false;
      continue;
    }

    if (arg === '--batch-size') {
      batchSize = Number.parseInt(argv[index + 1] ?? '', 10);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}\n${usage}`);
  }

  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new Error(`--batch-size must be an integer from 1 to 100.\n${usage}`);
  }

  return { batchSize, dryRun };
};

const getR2Config = () => {
  const env = getEnv();

  if (env.MEMORY_STORAGE === 'true') {
    throw new Error('media:convert-existing-images requires real R2 credentials.');
  }

  if (
    !(env.R2_BUCKET_NAME && env.R2_ENDPOINT && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY)
  ) {
    throw new Error(
      'media:convert-existing-images requires R2_BUCKET_NAME, R2_ENDPOINT, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.'
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

  const result = await runImageDerivativeBackfillToCompletion({
    ...args,
    cursor: defaultCursor,
    database: createDatabase(client),
    storage: createR2Client(r2Config)
  });

  const problems = result.failures.map((failure) => ({
    imageId: failure.id,
    location: failure.type === 'visit' ? 'visit' : 'trip stop',
    message: failure.message
  }));
  const status = problems.length > 0 ? 'stopped' : result.dryRun ? 'preview-complete' : 'complete';
  const summary =
    status === 'complete'
      ? 'All existing images now have a normal-size image and a thumbnail.'
      : status === 'preview-complete'
        ? `${result.completed} existing images would be converted.`
        : 'Conversion stopped. Wait briefly, then run the same command again.';
  const output = {
    mode: result.dryRun ? 'preview' : 'convert',
    problems,
    status,
    summary,
    originalImageBytes: result.sourceBytes,
    originalImagesKept: true,
    ...(result.dryRun
      ? { imagesToConvert: result.completed }
      : { imagesConverted: result.completed, newImageBytes: result.outputBytes })
  };

  console.log(JSON.stringify(output));

  if (status === 'stopped') {
    process.exitCode = 1;
  }
} finally {
  await client.close();
}
