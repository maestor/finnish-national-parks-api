import { createDatabaseClient } from '../db/client.js';
import { createDatabase } from '../db/database.js';
import { getPendingMigrationNames } from '../db/migrate.js';
import { backfillParkFeaturedImages } from '../db/repositories.js';

const usage = 'Usage: npm run park:backfill-featured-images [-- --dry-run]';
let dryRun = false;
for (const arg of process.argv.slice(2)) {
  if (arg !== '--dry-run') throw new Error(`Unknown argument: ${arg}\n${usage}`);
  dryRun = true;
}

const client = createDatabaseClient();
try {
  const pending = await getPendingMigrationNames(client);
  if (pending.length > 0) {
    throw new Error(
      `Database schema is not current. Run npm run db:migrate first.\nPending migrations: ${pending.join(', ')}`
    );
  }
  const result = await backfillParkFeaturedImages(createDatabase(client), dryRun);
  console.log(
    `${dryRun ? 'Would set' : 'Set'} featured images for ${result.parks.length} park(s).`
  );
  for (const park of result.parks) {
    console.log(`- ${park.name} [${park.slug}: image ${park.imageId}]`);
  }
  if (!dryRun && result.parks.length > 0) {
    console.log(
      'Refresh the frontend public park caches for the listed slugs to show the new images immediately.'
    );
  }
} finally {
  await client.close();
}
