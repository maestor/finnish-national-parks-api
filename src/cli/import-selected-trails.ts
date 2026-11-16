import { createDatabaseClient } from '../db/client.js';
import { createDatabase } from '../db/database.js';
import { getPendingMigrationNames } from '../db/migrate.js';
import { importSelectedTrails } from '../importer/import-selected-trails.js';

const args = process.argv.slice(2);
const options = args.slice(2);
if (
  args[0] !== '--selection' ||
  args[1] !== 'visited-trails-2026-11' ||
  options.some((option) => option !== '--dry-run' && option !== '--json') ||
  new Set(options).size !== options.length
)
  throw new Error(
    'Usage: npm run import:selected-trails -- --selection visited-trails-2026-11 [--dry-run] [--json]'
  );
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
  if (json) {
    console.log(JSON.stringify({ mode: dryRun ? 'preview' : 'apply', ...report }, null, 2));
  } else {
    const areas = new Map<string, typeof report.selections>();
    for (const trail of report.selections) {
      const group = areas.get(trail.parent) ?? [];
      group.push(trail);
      areas.set(trail.parent, group);
    }
    const added = report.selections.filter((trail) => trail.action === 'create').length;
    const updated = report.selections.filter((trail) => trail.action === 'update').length;
    const unchanged = report.selections.length - added - updated;
    if (!added && !updated) {
      console.log(`No changes needed — all ${unchanged} trails are up to date.`);
    } else {
      console.log(
        `${dryRun ? 'Dry run' : 'Imported'} — ${report.selections.length} trails in ${areas.size} areas`
      );
      console.log(
        dryRun
          ? `${added} to add, ${updated} to update, ${unchanged} unchanged`
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
      const namesakes = report.selections.filter((trail) => trail.distantNamesakes.length);
      if (namesakes.length) {
        console.log('\nOther trails with the same name (not changed):');
        for (const trail of namesakes)
          console.log(
            `- ${trail.name}: ${trail.distantNamesakes.map((item) => item.slug).join(', ')}`
          );
      }
    }
    console.log(`\nManifest SHA-256: ${report.manifestHash}`);
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
