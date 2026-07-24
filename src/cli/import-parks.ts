import { createDatabaseClient } from '../db/client.js';
import { createDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrate.js';
import { defaultLipasCatalogSourceUrl, importParks } from '../importer/import-parks.js';

type ParsedArgs = {
  dryRun: boolean;
};

const usage = 'Usage: npm run import:parks [-- --dry-run]';

const parseArgs = (argv: string[]): ParsedArgs => {
  let dryRun = false;

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}\n${usage}`);
  }

  return { dryRun };
};

const client = createDatabaseClient();
const args = parseArgs(process.argv.slice(2));

await migrateDatabase(client);

const result = await importParks({
  database: createDatabase(client),
  dryRun: args.dryRun,
  markNewParksRemoved: true,
  sourceUrl: defaultLipasCatalogSourceUrl
});

await client.close();

if (result.dryRun) {
  console.log(
    `Dry run: would import ${result.activeCount} catalog places from ${result.sourceActiveCount} active LIPAS records. Would skip ${result.skippedTrailCount} overlapping or nested trail records.`
  );
} else {
  console.log(
    `Imported ${result.activeCount} catalog places from ${result.sourceActiveCount} active LIPAS records in run ${result.importRunId}. Skipped ${result.skippedTrailCount} overlapping or nested trail records.`
  );
}

if (result.newParks.length === 0) {
  console.log(
    result.dryRun
      ? 'No new parks would be added in this import.'
      : 'No new parks were added in this import.'
  );
} else {
  console.log(
    result.dryRun
      ? `New parks that would be added (${result.newParks.length}). They would be imported as disabled until enabled from the admin UI:`
      : `New parks added (${result.newParks.length}). They were imported as disabled and must be enabled from admin UI:`
  );

  for (const park of result.newParks) {
    console.log(`- ${park.typeName}: ${park.name} [${park.lipasId}]`);
  }
}
