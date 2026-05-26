import { resolve } from 'node:path';

import { createDatabaseClient } from '../db/client.js';
import { createDatabase } from '../db/database.js';
import { getEnv } from '../env.js';
import { uploadParkLogo } from '../parks/upload-park-logo.js';
import { createR2Client } from '../storage/r2-client.js';

const getSlug = () => {
  const slug = process.argv[2];

  if (!slug || process.argv[3]) {
    throw new Error('Usage: npm run park:logo -- <park-slug>');
  }

  return slug;
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

try {
  const result = await uploadParkLogo({
    database: createDatabase(client),
    logosDirectory: resolve('data/logos'),
    slug: getSlug(),
    storage: createR2Client(getR2Config())
  });

  console.log(`Uploaded ${result.logoKey} for ${result.parkName} (${result.slug}).`);
} finally {
  await client.close();
}
