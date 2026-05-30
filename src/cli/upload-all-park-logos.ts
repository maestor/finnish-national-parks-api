import { resolve } from 'node:path';

import { createDatabaseClient } from '../db/client.js';
import { createDatabase } from '../db/database.js';
import { listParkRecordsIncludingRemoved } from '../db/repositories.js';
import { getEnv } from '../env.js';
import { findParkLogoAsset } from '../parks/logo-assets.js';
import { uploadParkLogo } from '../parks/upload-park-logo.js';
import { createR2Client } from '../storage/r2-client.js';

const force = process.argv.slice(2).includes('--force');

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

const client = createDatabaseClient();
const storage = createR2Client(getR2Config());
const database = createDatabase(client);
const parks = await listParkRecordsIncludingRemoved(database);
const uploadableSlugs: string[] = [];

for (const park of parks) {
  const logoAsset = await findParkLogoAsset(logosDirectory, park);

  if (logoAsset) {
    uploadableSlugs.push(park.slug);
  }
}

if (uploadableSlugs.length === 0) {
  console.log('No park logo PNG files found in data/logos or data/logos/display-types.');
  await client.close();
  process.exit(0);
}

const uploaded: string[] = [];
const skipped: string[] = [];
const failures: { slug: string; error: string }[] = [];

for (const slug of uploadableSlugs) {
  try {
    const result = await uploadParkLogo({
      database,
      force,
      logosDirectory,
      slug,
      storage
    });

    if (result.action === 'skipped') {
      console.log(`∘ ${result.slug} → ${result.logoKey} (already up to date)`);
      skipped.push(result.slug);
    } else {
      console.log(`✓ ${result.slug} → ${result.logoKey}`);
      uploaded.push(result.slug);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`✗ ${slug}: ${message}`);
    failures.push({ slug, error: message });
  }
}

await client.close();

console.log('');
console.log(
  `Done. ${uploaded.length} uploaded, ${skipped.length} skipped, ${failures.length} failed.`
);

if (failures.length > 0) {
  process.exit(1);
}
