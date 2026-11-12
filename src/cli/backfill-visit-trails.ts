import { createDatabaseClient } from '../db/client.js';
import { createDatabase } from '../db/database.js';
import { getPendingMigrationNames } from '../db/migrate.js';
import { backfillVisitTrails } from '../db/repositories.js';

const usage = 'Usage: npm run visit:backfill-trails [-- --dry-run]';
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
  const result = await backfillVisitTrails(createDatabase(client), dryRun);
  console.log(`${dryRun ? 'Would add' : 'Added'} trail links to ${result.added.length} visit(s).`);
  for (const visit of result.added) {
    console.log(
      `- ${visit.parkSlug}: visit ${visit.visitId} (${visit.visitedOn}) -> ${visit.route} [trail ${visit.trailId}]`
    );
  }
  console.log(
    `Skipped: ${result.alreadyLinked} already linked, ${result.unmatched} without an exact match, ${result.ambiguous.length} ambiguous.`
  );
  for (const visit of result.ambiguous) {
    console.log(
      `- Ambiguous: ${visit.parkSlug}: visit ${visit.visitId} (${visit.visitedOn}), ${visit.route} [trails ${visit.trailIds.join(', ')}]`
    );
  }
  if (!dryRun && result.added.length > 0) {
    console.log(
      `Refresh the frontend public park caches for these slugs: ${[...new Set(result.added.map((visit) => visit.parkSlug))].join(', ')}`
    );
  }
} finally {
  await client.close();
}
