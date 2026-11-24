import type { Client } from '@libsql/client';
import { DrizzleQueryError } from 'drizzle-orm';
import { z } from 'zod';

import { createDatabase } from '../db/database.js';
import { getPendingMigrationNames } from '../db/migrate.js';
import { defaultLipasCatalogSourceUrl, importParks } from './import-parks.js';
import { type GithubReviewTarget, sendPendingParkReviews } from './park-review-notifications.js';

const socketDisconnect = z.object({ cause: z.object({ code: z.literal('UND_ERR_SOCKET') }) });

export const runScheduledParkImport = async (client: Client, github: GithubReviewTarget) => {
  const pending = await getPendingMigrationNames(client);
  if (pending.length > 0) {
    throw new Error(
      `Scheduled import requires applied migrations; pending migrations: ${pending.join(', ')}`
    );
  }

  const database = createDatabase(client);
  // Deliver previous reports even if this week's upstream import later fails.
  await sendPendingParkReviews(database, github);
  const importCatalog = () =>
    importParks({
      database,
      queueNewParkNotification: true,
      requireNoPublicTrailConversions: true,
      sourceUrl: defaultLipasCatalogSourceUrl
    });
  const result = await importCatalog().catch((error: unknown) => {
    // Drizzle wraps statement failures. COMMIT errors are raised directly by libSQL.
    if (!(error instanceof DrizzleQueryError) || !socketDisconnect.safeParse(error.cause).success) {
      throw error;
    }
    process.stderr.write('Database socket closed during the catalog import. Retrying once.\n');
    return importCatalog();
  });
  await sendPendingParkReviews(database, github);
  return result;
};
