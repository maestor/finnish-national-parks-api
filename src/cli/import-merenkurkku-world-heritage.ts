import { createDatabaseClient } from '../db/client.js';
import { createDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrate.js';
import { importMerenkurkkuWorldHeritage } from '../importer/import-merenkurkku-world-heritage.js';

const client = createDatabaseClient();

await migrateDatabase(client);

const result = await importMerenkurkkuWorldHeritage({
  database: createDatabase(client)
});

await client.close();

console.log(
  `Imported Merenkurkku world heritage park from ${result.featureCount} source features in run ${result.importRunId}.`
);
