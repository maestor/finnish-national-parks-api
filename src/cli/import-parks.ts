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
  sourceUrl: env.LIPAS_NATIONAL_PARKS_URL
});

await client.close();

console.log(`Imported ${result.activeCount} active parks in run ${result.importRunId}.`);
