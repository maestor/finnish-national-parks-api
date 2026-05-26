import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createDatabaseClient } from '../db/client.js';
import { createDatabase } from '../db/database.js';
import { getEnv } from '../env.js';
import { uploadParkLogo } from '../parks/upload-park-logo.js';
import { createR2Client } from '../storage/r2-client.js';

const getR2Config = () => {
  const env = getEnv();

  if (env.MEMORY_STORAGE === 'true') {
    throw new Error(
      'park:logos requires real R2 credentials. MEMORY_STORAGE=true is not supported.'
    );
  }

  if (
    !(env.R2_BUCKET_NAME && env.R2_ENDPOINT && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY)
  ) {
    throw new Error(
      'park:logos requires R2_BUCKET_NAME, R2_ENDPOINT, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.'
    );
  }

  return {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    bucketName: env.R2_BUCKET_NAME,
    endpoint: env.R2_ENDPOINT,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY
  };
};

const logosDirectory = resolve('data/logos');

const entries = await readdir(logosDirectory, { withFileTypes: true });
const slugs = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith('.png'))
  .map((entry) => entry.name.replace(/\.png$/, ''));

if (slugs.length === 0) {
  console.log('No logo PNG files found in data/logos.');
  process.exit(0);
}

const client = createDatabaseClient();
const storage = createR2Client(getR2Config());
const database = createDatabase(client);

const successes: string[] = [];
const failures: { slug: string; error: string }[] = [];

for (const slug of slugs) {
  try {
    const result = await uploadParkLogo({
      database,
      logosDirectory,
      slug,
      storage
    });
    console.log(`✓ ${result.slug} → ${result.logoKey}`);
    successes.push(result.slug);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✗ ${slug}: ${message}`);
    failures.push({ slug, error: message });
  }
}

await client.close();

console.log('');
console.log(`Done. ${successes.length} uploaded, ${failures.length} failed.`);

if (failures.length > 0) {
  process.exit(1);
}
