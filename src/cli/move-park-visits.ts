import { createDatabaseClient } from '../db/client.js';
import { createDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrate.js';
import { reassignParkVisits } from '../db/repositories.js';

type ParsedArgs = {
  dryRun: boolean;
  fromSlug: string;
  toSlug: string;
};

const usage = `Usage: npm run park:move-visits -- --from <source-slug> --to <target-slug> [--dry-run]`;

const parseArgs = (argv: string[]): ParsedArgs => {
  let fromSlug = '';
  let toSlug = '';
  let dryRun = false;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (arg === '--from') {
      fromSlug = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (arg === '--to') {
      toSlug = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}\n${usage}`);
  }

  if (!fromSlug || !toSlug) {
    throw new Error(`${usage}`);
  }

  return {
    dryRun,
    fromSlug,
    toSlug
  };
};

const args = parseArgs(process.argv.slice(2));
const client = createDatabaseClient();

try {
  await migrateDatabase(client);

  const result = await reassignParkVisits(createDatabase(client), args);
  const verb = result.dryRun ? 'Would move' : 'Moved';

  console.log(
    `${verb} ${result.movedVisitCount} visit(s) and ${result.movedImageCount} image(s) from ${result.fromPark.slug} to ${result.toPark.slug}.`
  );

  if (result.movedVisitCount > 0) {
    console.log(`Visit IDs: ${result.movedVisitIds.join(', ')}`);
  }
} finally {
  await client.close();
}
