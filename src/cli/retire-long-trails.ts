import { createDatabaseClient } from '../db/client.js';
import { createDatabase } from '../db/database.js';
import { getPendingMigrationNames } from '../db/migrate.js';
import { retireLongTrails } from '../importer/retire-long-trails.js';

const usage = 'Usage: npm run trails:retire-long [-- --dry-run]';
let dryRun = false;
for (const arg of process.argv.slice(2)) {
  if (arg !== '--dry-run') throw new Error(`Unknown argument: ${arg}\n${usage}`);
  dryRun = true;
}
const client = createDatabaseClient();
try {
  const pending = await getPendingMigrationNames(client);
  if (pending.length)
    throw new Error(
      `Database schema is not current. Run npm run db:migrate first.\nPending migrations: ${pending.join(', ')}`
    );
  const result = await retireLongTrails({ database: createDatabase(client), dryRun });
  console.log(
    `${dryRun ? 'Would retire' : 'Retired'} ${result.retiredTrails.length} trails over 100 km by measured or reported length. Existing visits and manual links are preserved.`
  );
  for (const trail of result.retiredTrails)
    console.log(
      `- ${trail.name} [${trail.slug}]: ${trail.reportedLengthKm?.toFixed(3) ?? 'unknown'} km reported, ${trail.measuredLengthKm?.toFixed(3) ?? 'unknown'} km measured`
    );
  if (result.affectedSlugs.length)
    console.log(dryRun ? 'Expire the park cache after applying.' : 'Expire the park cache now.');
} finally {
  await client.close();
}
