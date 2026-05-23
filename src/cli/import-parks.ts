import { createDatabaseClient } from '../db/client.js';
import { createDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrate.js';
import { getEnv } from '../env.js';
import { importParks } from '../importer/import-parks.js';

const env = getEnv();
const client = createDatabaseClient();

await migrateDatabase(client);

const result = await importParks({
  database: createDatabase(client),
  sourceUrl: env.LIPAS_PROTECTED_AREAS_URL
});

await client.close();

console.log(
  `Imported ${result.activeCount} catalog places from ${result.sourceActiveCount} active LIPAS records in run ${result.importRunId}. Skipped ${result.skippedContainedTrailCount} fully contained nature trails.`
);
