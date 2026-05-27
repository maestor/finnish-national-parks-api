import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createDatabaseClient } from '../db/client.js';
import { createDatabase } from '../db/database.js';
import { getEnv } from '../env.js';
import { uploadParkMap } from '../parks/upload-park-map.js';
import { createR2Client } from '../storage/r2-client.js';

const getR2Config = () => {
  const env = getEnv();

  if (env.MEMORY_STORAGE === 'true') {
    throw new Error(
      'park:maps requires real R2 credentials. MEMORY_STORAGE=true is not supported.'
    );
  }

  if (
    !(env.R2_BUCKET_NAME && env.R2_ENDPOINT && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY)
  ) {
    throw new Error(
      'park:maps requires R2_BUCKET_NAME, R2_ENDPOINT, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.'
    );
  }

  return {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    bucketName: env.R2_BUCKET_NAME,
    endpoint: env.R2_ENDPOINT,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY
  };
};

const mapsDirectory = resolve('data/maps');

const entries = await readdir(mapsDirectory, { withFileTypes: true });
const slugs = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith('.pdf'))
  .map((entry) => entry.name.replace(/\.pdf$/, ''));

if (slugs.length === 0) {
  console.log('No map PDF files found in data/maps.');
  process.exit(0);
}

const client = createDatabaseClient();
const storage = createR2Client(getR2Config());
const database = createDatabase(client);

const successes: string[] = [];
const failures: { slug: string; error: string }[] = [];

for (const slug of slugs) {
  try {
    const result = await uploadParkMap({
      database,
      mapsDirectory,
      slug,
      storage
    });
    console.log(`✓ ${result.slug} → ${result.mapKey}`);
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
