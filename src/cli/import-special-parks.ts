import { createDatabaseClient } from '../db/client.js';
import { createDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrate.js';
import { importSpecialParks } from '../importer/import-special-parks.js';

const includeSlugs = process.argv.slice(2);
const client = createDatabaseClient();

await migrateDatabase(client);

const result = await importSpecialParks({
  database: createDatabase(client),
  ...(includeSlugs.length > 0 ? { includeSlugs } : {})
});

await client.close();

for (const park of result.results) {
  console.log(
    `Imported ${park.name} from ${park.featureCount} source features in run ${park.importRunId}.`
  );
}
