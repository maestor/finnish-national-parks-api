import { appendFileSync } from 'node:fs';

import { createDatabaseClient } from '../db/client.js';
import { getPendingMigrationNames } from '../db/migrate.js';

const setGithubOutput = (name: string, value: string) => {
  const outputPath = process.env.GITHUB_OUTPUT;

  if (!outputPath) {
    return;
  }

  appendFileSync(outputPath, `${name}=${value}\n`);
};

const client = createDatabaseClient();

try {
  const pendingMigrationNames = await getPendingMigrationNames(client);
  const hasPendingMigrations = pendingMigrationNames.length > 0;

  setGithubOutput('has_pending', hasPendingMigrations ? 'true' : 'false');
  setGithubOutput('pending_count', String(pendingMigrationNames.length));

  if (!hasPendingMigrations) {
    console.log('No pending migrations.');
  } else {
    console.log(`Pending migrations (${pendingMigrationNames.length}):`);

    for (const migrationName of pendingMigrationNames) {
      console.log(`- ${migrationName}`);
    }
  }
} finally {
  await client.close();
}
