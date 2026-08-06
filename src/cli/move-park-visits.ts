import { createDatabaseClient } from '../db/client.js';
import { createDatabase } from '../db/database.js';
import { migrateDatabase } from '../db/migrate.js';
import { reassignParkVisits } from '../db/repositories.js';

type ParsedArgs = {
  dryRun: boolean;
  toSlug: string;
  fromSlug?: string;
  visitId?: number;
};

const usage =
  'Usage: npm run park:move-visits -- (--from <source-slug> | --visit-id <visit-id>) --to <target-slug> [--dry-run]';

const parseArgs = (argv: string[]): ParsedArgs => {
  let fromSlug: string | undefined;
  let toSlug = '';
  let visitId: number | undefined;
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

    if (arg === '--visit-id') {
      const value = argv[index + 1] ?? '';
      visitId = Number.parseInt(value, 10);
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

  if (!toSlug || (!fromSlug && visitId === undefined)) {
    throw new Error(`${usage}`);
  }

  if (fromSlug && visitId !== undefined) {
    throw new Error(`Provide either --from or --visit-id.\n${usage}`);
  }

  if (visitId !== undefined && (!Number.isInteger(visitId) || visitId < 1)) {
    throw new Error(`--visit-id must be a positive integer.\n${usage}`);
  }

  return {
    dryRun,
    ...(fromSlug ? { fromSlug } : {}),
    toSlug,
    ...(visitId !== undefined ? { visitId } : {})
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
