import type { Client } from '@libsql/client';

import { getPendingMigrationNames } from '../db/migrate.js';

export const assertReadOnlyMediaDatabaseIsCurrent = async (client: Client) => {
  const pendingMigrationNames = await getPendingMigrationNames(client);

  if (pendingMigrationNames.length > 0) {
    throw new Error(
      [
        'Database schema is not current. Run npm run db:migrate before running this media command.',
        `Pending migrations: ${pendingMigrationNames.join(', ')}`
      ].join('\n')
    );
  }
};
