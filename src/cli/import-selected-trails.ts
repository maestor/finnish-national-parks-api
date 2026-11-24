import { createDatabaseClient } from '../db/client.js';
import { createDatabase } from '../db/database.js';
import { getPendingMigrationNames } from '../db/migrate.js';
import { importSelectedTrails } from '../importer/import-selected-trails.js';

const flags = new Set<string>();
const selectionKeys = new Set<string>();
const args = process.argv.slice(2);
const usage =
  'Usage: npm run import:osm-linked-trails -- [--dry-run] [--json] [--guard-public-conversions] [--selection <key>]...';
for (let index = 0; index < args.length; index++) {
  const option = args[index]!;
  if (option === '--selection') {
    const key = args[++index];
    if (!key || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) || selectionKeys.has(key))
      throw new Error(usage);
    selectionKeys.add(key);
  } else {
    if (
      !['--dry-run', '--json', '--guard-public-conversions'].includes(option) ||
      flags.has(option)
    )
      throw new Error(usage);
    flags.add(option);
  }
}
const dryRun = flags.has('--dry-run');
const json = flags.has('--json');
const client = createDatabaseClient();
try {
  const pending = await getPendingMigrationNames(client);
  if (pending.length)
    throw new Error(
      `Database schema is not current. Apply migrations first: ${pending.join(', ')}`
    );
  const report = await importSelectedTrails({
    database: createDatabase(client),
    dryRun,
    guardPublicConversions: flags.has('--guard-public-conversions'),
    ...(selectionKeys.size ? { selectionKeys: [...selectionKeys] } : {})
  });
  const selections = report.selections.filter((trail) => trail.action !== 'unchanged');
  if (json) {
    console.log(
      JSON.stringify({ mode: dryRun ? 'preview' : 'apply', ...report, selections }, null, 2)
    );
  } else if (!selections.length) {
    console.log('No changes needed.');
  } else {
    const areas = new Map<string, typeof selections>();
    for (const trail of selections) {
      const group = areas.get(trail.parent) ?? [];
      group.push(trail);
      areas.set(trail.parent, group);
    }

    const added = selections.filter((trail) => trail.action === 'create').length;
    const updated = selections.length - added;
    const addLabel = dryRun ? 'to add' : 'added';
    const updateLabel = dryRun ? 'to update' : 'updated';
    console.log(
      `${dryRun ? 'Dry run' : 'Imported'} — ${selections.length} ${selections.length === 1 ? 'trail' : 'trails'} in ${areas.size} ${areas.size === 1 ? 'area' : 'areas'}`
    );
    console.log(`${added} ${addLabel}, ${updated} ${updateLabel}`);
    for (const trails of areas.values()) {
      console.log(`\n${trails[0]!.parentName}`);
      for (const trail of trails) {
        const action = trail.action === 'create' ? addLabel : updateLabel;
        const label = added > 0 && updated > 0 ? ` (${action})` : '';
        console.log(`- ${trail.name}${label}`);
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
