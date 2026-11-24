import { createDatabaseClient } from '../db/client.js';
import { createDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrate.js';
import {
  defaultLipasCatalogSourceUrl,
  importParks,
  kuntorataSourceUrl
} from '../importer/import-parks.js';

type ParsedArgs = {
  dryRun: boolean;
  kuntorataOnly: boolean;
};

const usage = 'Usage: npm run import:parks [-- --dry-run] [--kuntorata-only]';

const parseArgs = (argv: string[]): ParsedArgs => {
  let dryRun = false;
  let kuntorataOnly = false;

  for (const arg of argv) {
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg === '--kuntorata-only') {
      kuntorataOnly = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}\n${usage}`);
  }

  return { dryRun, kuntorataOnly };
};

const client = createDatabaseClient();
const args = parseArgs(process.argv.slice(2));

await migrateDatabase(client);

const result = await importParks({
  database: createDatabase(client),
  dryRun: args.dryRun,
  scope: args.kuntorataOnly ? 'area-link-only' : 'catalog',
  sourceUrl: args.kuntorataOnly ? kuntorataSourceUrl : defaultLipasCatalogSourceUrl
});

await client.close();

if (result.dryRun) {
  console.log(
    `Dry run: would import ${result.activeCount} catalog places from ${result.sourceActiveCount} active LIPAS records.`
  );
} else {
  console.log(
    `Imported ${result.activeCount} catalog places from ${result.sourceActiveCount} active LIPAS records in run ${result.importRunId}.`
  );
}

for (const park of result.adoptedParks)
  console.log(
    `${result.dryRun ? 'Would adopt' : 'Adopted'} ${park.slug} in place [LIPAS ${park.lipasId}].`
  );
if (!result.dryRun && result.adoptedParks.length)
  console.log(
    `Expire these public park URLs immediately: ${result.adoptedParks.map((park) => park.slug).join(', ')}`
  );

if (result.newParks.length === 0) {
  console.log(
    result.dryRun
      ? 'No new parks would be added in this import.'
      : 'No new parks were added in this import.'
  );
} else {
  console.log(
    result.dryRun
      ? `New parks that would be added (${result.newParks.length}):`
      : `New parks added (${result.newParks.length}):`
  );

  for (const park of result.newParks) {
    console.log(`- ${park.typeName}: ${park.name} [${park.lipasId}]`);
  }
}

if (result.trailAreaResult) {
  const { automaticLinks, manualExclusions, newlyHidden, newlyHiddenPublicSlugs } =
    result.trailAreaResult;
  console.log(
    `Trail–area matches: ${automaticLinks}; newly classified trails: ${newlyHidden}; manual exclusions: ${manualExclusions}.`
  );
  if (newlyHiddenPublicSlugs.length)
    console.log(`Expire these public park URLs immediately: ${newlyHiddenPublicSlugs.join(', ')}`);
}

console.log(`Source deactivations: ${result.deactivatedParks.length}.`);
for (const park of result.deactivatedParks) console.log(`- ${park.slug} [${park.lipasId}]`);
for (const warning of result.mergeWarnings) console.warn(warning);
if (result.affectedMergedTrailSlugs.length)
  console.log(
    `${result.dryRun ? 'After applying, expire' : 'Expire'} these merged-trail public park URLs: ${result.affectedMergedTrailSlugs.join(', ')}`
  );

if (result.affectedAreaLinkOnlySlugs.length)
  console.log(
    `${result.dryRun ? 'After applying, expire' : 'Expire'} these Kuntorata-related URLs: ${result.affectedAreaLinkOnlySlugs.join(', ')}`
  );
