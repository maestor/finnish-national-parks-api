import { createDatabaseClient } from '../db/client.js';
import { createDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrate.js';
import { getEnv } from '../env.js';
import {
  type ImageDerivativeBackfillCursor,
  runImageDerivativeBackfill
} from '../images/backfill-image-derivatives.js';
import { createR2Client } from '../storage/r2-client.js';

const usage =
  'Usage: npm run media:backfill-derivatives -- [--apply] [--batch-size <1-100>] [--cursor <opaque-cursor>]';

type ParsedArgs = {
  batchSize: number;
  cursor: ImageDerivativeBackfillCursor;
  dryRun: boolean;
};

const defaultCursor: ImageDerivativeBackfillCursor = {
  tripStopImageId: 0,
  visitImageId: 0
};

const decodeCursor = (value: string): ImageDerivativeBackfillCursor => {
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;

    if (
      !decoded ||
      typeof decoded !== 'object' ||
      !Number.isInteger((decoded as ImageDerivativeBackfillCursor).tripStopImageId) ||
      !Number.isInteger((decoded as ImageDerivativeBackfillCursor).visitImageId) ||
      (decoded as ImageDerivativeBackfillCursor).tripStopImageId < 0 ||
      (decoded as ImageDerivativeBackfillCursor).visitImageId < 0
    ) {
      throw new Error('Invalid cursor.');
    }

    return decoded as ImageDerivativeBackfillCursor;
  } catch {
    throw new Error(`Invalid --cursor. ${usage}`);
  }
};

const parseArgs = (argv: string[]): ParsedArgs => {
  let batchSize = 25;
  let cursor = defaultCursor;
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

    if (arg === '--cursor') {
      cursor = decodeCursor(argv[index + 1] ?? '');
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}\n${usage}`);
  }

  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new Error(`--batch-size must be an integer from 1 to 100.\n${usage}`);
  }

  return { batchSize, cursor, dryRun };
};

const getR2Config = () => {
  const env = getEnv();

  if (env.MEMORY_STORAGE === 'true') {
    throw new Error('media:backfill-derivatives requires real R2 credentials.');
  }

  if (
    !(env.R2_BUCKET_NAME && env.R2_ENDPOINT && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY)
  ) {
    throw new Error(
      'media:backfill-derivatives requires R2_BUCKET_NAME, R2_ENDPOINT, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.'
    );
  }

  return {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    bucketName: env.R2_BUCKET_NAME,
    endpoint: env.R2_ENDPOINT,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY
  };
};

const encodeCursor = (cursor: ImageDerivativeBackfillCursor) => {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
};

const args = parseArgs(process.argv.slice(2));
const client = createDatabaseClient();

try {
  await migrateDatabase(client);

  const result = await runImageDerivativeBackfill({
    ...args,
    database: createDatabase(client),
    storage: createR2Client(getR2Config())
  });

  console.log(
    JSON.stringify({
      ...result,
      nextCursor: encodeCursor(result.nextCursor),
      previewCursor: encodeCursor(result.previewCursor),
      sourceObjectsRetained: true
    })
  );

  if (result.failures.length > 0) {
    process.exitCode = 1;
  }
} finally {
  await client.close();
}
