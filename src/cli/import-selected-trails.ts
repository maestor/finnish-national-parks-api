import { createDatabaseClient } from '../db/client.js';
import { createDatabase } from '../db/database.js';
import { getPendingMigrationNames } from '../db/migrate.js';
import { importSelectedTrails } from '../importer/import-selected-trails.js';

const options = process.argv.slice(2);
if (
  options.some((option) => option !== '--dry-run' && option !== '--json') ||
  new Set(options).size !== options.length
)
  throw new Error('Usage: npm run import:osm-linked-trails -- [--dry-run] [--json]');
const dryRun = options.includes('--dry-run');
const json = options.includes('--json');
const client = createDatabaseClient();
try {
  const pending = await getPendingMigrationNames(client);
  if (pending.length)
    throw new Error(
      `Database schema is not current. Apply migrations first: ${pending.join(', ')}`
    );
  const report = await importSelectedTrails({ database: createDatabase(client), dryRun });
  const selections = dryRun
    ? report.selections.filter((trail) => trail.action !== 'unchanged')
    : report.selections;
  if (json) {
    console.log(
      JSON.stringify({ mode: dryRun ? 'preview' : 'apply', ...report, selections }, null, 2)
    );
  } else if (dryRun && !selections.length) {
    console.log('No changes needed.');
  } else {
    const areas = new Map<string, typeof report.selections>();
    for (const trail of selections) {
      const group = areas.get(trail.parent) ?? [];
      group.push(trail);
      areas.set(trail.parent, group);
    }
    const added = selections.filter((trail) => trail.action === 'create').length;
    const updated = selections.filter((trail) => trail.action === 'update').length;
    const unchanged = selections.length - added - updated;
    if (!added && !updated) {
      console.log(`No changes needed — all ${unchanged} trails are up to date.`);
    } else {
      console.log(
        `${dryRun ? 'Dry run' : 'Imported'} — ${selections.length} ${selections.length === 1 ? 'trail' : 'trails'} in ${areas.size} ${areas.size === 1 ? 'area' : 'areas'}`
      );
      console.log(
        dryRun
          ? `${added} to add, ${updated} to update`
          : `${added} added, ${updated} updated, ${unchanged} unchanged`
      );
      const mixedActions = [added, updated, unchanged].filter((count) => count > 0).length > 1;
      for (const trails of areas.values()) {
        console.log(`\n${trails[0]!.parentName}`);
        for (const trail of trails) {
          const action =
            trail.action === 'create'
              ? dryRun
                ? 'add'
                : 'added'
              : trail.action === 'update' && !dryRun
                ? 'updated'
                : trail.action;
          console.log(`- ${trail.name}${mixedActions ? ` (${action})` : ''}`);
        }
      }
      const namesakes = dryRun ? [] : selections.filter((trail) => trail.distantNamesakes.length);
      if (namesakes.length) {
        console.log('\nOther trails with the same name (not changed):');
        for (const trail of namesakes)
          console.log(
            `- ${trail.name}: ${trail.distantNamesakes.map((item) => item.slug).join(', ')}`
          );
      }
    }
    console.log(`\nCatalog SHA-256: ${report.snapshotHash}`);
    console.log(`For source identities, geometry hashes and affected cache slugs, add --json.`);
  }
  if (report.affectedSlugs.length)
    console.error(
      dryRun
        ? 'Review this report and expire affected UI caches after applying.'
        : 'Expire affected UI caches now.'
    );
} finally {
  await client.close();
}
