import { createDatabaseClient } from '../db/client.js';
import { createDatabase } from '../db/database.js';
import { getPendingMigrationNames } from '../db/migrate.js';
import { mergeTrails } from '../db/trail-merges.js';

const usage =
  'Usage: npm run trails:merge -- --from <source-slug> --to <destination-slug> [--name <new-name>] [--dry-run]';
const values = new Map<string, string>();
let dryRun = false;
const argv = process.argv.slice(2);
for (let index = 0; index < argv.length; index++) {
  const arg = argv[index]!;
  if (arg === '--dry-run') {
    dryRun = true;
    continue;
  }
  if (!['--from', '--to', '--name'].includes(arg) || values.has(arg)) throw new Error(usage);
  const value = argv[++index];
  if (!value || value.startsWith('--')) throw new Error(usage);
  values.set(arg, value);
}
const fromSlug = values.get('--from');
const toSlug = values.get('--to');
if (!fromSlug || !toSlug) throw new Error(usage);
const name = values.get('--name');
const client = createDatabaseClient();
try {
  const pending = await getPendingMigrationNames(client);
  if (pending.length)
    throw new Error(
      `Database schema is not current. Run npm run db:migrate on the intended database first. Pending migrations: ${pending.join(', ')}`
    );
  const result = await mergeTrails(createDatabase(client), {
    fromSlug,
    toSlug,
    dryRun,
    ...(name === undefined ? {} : { name })
  });
  console.log(
    result.alreadyMerged
      ? `Already merged into ${result.toSlug}; no changes.`
      : `${dryRun ? 'Would merge' : 'Merged'} ${fromSlug} into ${result.toSlug} (${result.name}).`
  );
  if (!result.alreadyMerged) {
    console.log(`Source OSM relations: ${result.sourceRelationIds.join(', ')}`);
    console.log(
      `${result.movedVisitCount} visit link(s) ${dryRun ? 'would move' : 'moved'}; ${result.sharedVisitCount} shared link(s) deduplicated.`
    );
    console.log(
      `Combined unique mapped-line length: ${result.measuredLengthKm.toFixed(3)} km (not an itinerary distance).`
    );
    if (result.addedAreaSlugs.length)
      console.log(`Additional pinned destination areas: ${result.addedAreaSlugs.join(', ')}`);
    console.log(
      `${dryRun ? 'After applying, refresh' : 'Refresh'} the frontend public park caches for: ${result.affectedSlugs.join(', ')}`
    );
  }
} finally {
  await client.close();
}
