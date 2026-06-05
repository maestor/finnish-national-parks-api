import { createDatabaseClient } from '../db/client.js';
import { createDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrate.js';
import { defaultLipasCatalogSourceUrl, importParks } from '../importer/import-parks.js';

const client = createDatabaseClient();

await migrateDatabase(client);

const result = await importParks({
  database: createDatabase(client),
  sourceUrl: defaultLipasCatalogSourceUrl
});

await client.close();

console.log(
  `Imported ${result.activeCount} catalog places from ${result.sourceActiveCount} active LIPAS records in run ${result.importRunId}. Skipped ${result.skippedTrailCount} overlapping or nested trail records.`
);
