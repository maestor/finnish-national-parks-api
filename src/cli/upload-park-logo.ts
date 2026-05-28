import { resolve } from 'node:path';

import { createDatabaseClient } from '../db/client.js';
import { createDatabase } from '../db/database.js';
import { getEnv } from '../env.js';
import { uploadParkLogo } from '../parks/upload-park-logo.js';
import { createR2Client } from '../storage/r2-client.js';

const parseArgs = () => {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const slug = args.find((arg) => arg !== '--force');

  if (!slug) {
    throw new Error('Usage: npm run park:logo -- <park-slug> [--force]');
  }

  return { force, slug };
};

const getR2Config = () => {
  const env = getEnv();

  if (env.MEMORY_STORAGE === 'true') {
    throw new Error(
      'park:logo requires real R2 credentials. MEMORY_STORAGE=true is not supported.'
    );
  }

  if (
    !(env.R2_BUCKET_NAME && env.R2_ENDPOINT && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY)
  ) {
    throw new Error(
      'park:logo requires R2_BUCKET_NAME, R2_ENDPOINT, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.'
    );
  }

  return {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    bucketName: env.R2_BUCKET_NAME,
    endpoint: env.R2_ENDPOINT,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY
  };
};

const client = createDatabaseClient();

const { force, slug } = parseArgs();

try {
  const result = await uploadParkLogo({
    database: createDatabase(client),
    force,
    logosDirectory: resolve('data/logos'),
    slug,
    storage: createR2Client(getR2Config())
  });

  if (result.action === 'skipped') {
    console.log(
      `Skipped ${result.logoKey} for ${result.parkName} (${result.slug}) — already up to date.`
    );
  } else {
    console.log(`Uploaded ${result.logoKey} for ${result.parkName} (${result.slug}).`);
  }
} finally {
  await client.close();
}
