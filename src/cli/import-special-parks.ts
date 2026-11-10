import { createDatabaseClient } from '../db/client.js';
import { createDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrate.js';
import { importSpecialParks } from '../importer/import-special-parks.js';

const args = process.argv.slice(2);
const allowPublicTrailConversions = args.includes('--allow-public-trail-conversions');
const includeSlugs = args.filter((arg) => arg !== '--allow-public-trail-conversions');
const client = createDatabaseClient();

await migrateDatabase(client);

const result = await importSpecialParks({
  database: createDatabase(client),
  allowPublicTrailConversions,
  ...(includeSlugs.length > 0 ? { includeSlugs } : {})
});

await client.close();

for (const park of result.results) {
  console.log(
    `Imported ${park.name} from ${park.featureCount} source features in run ${park.importRunId}.`
  );
}

if (result.publicTrailSlugs.length)
  console.log(`Expire these public park URLs immediately: ${result.publicTrailSlugs.join(', ')}`);

for (const { areaSlug, report } of result.trailAreaReports) {
  console.log(
    `${areaSlug}: ${report.automaticLinks} automatic trail links; ${report.manualExclusions} manual exclusions; ${report.unresolved.length} unresolved geometry cases.`
  );
  for (const issue of report.unresolved)
    console.log(
      `Unresolved geometry: trail ${issue.trailId}, area ${issue.areaId ?? 'none'}, ${issue.status}`
    );
}
