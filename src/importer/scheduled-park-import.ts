import type { Client } from '@libsql/client';

import { createDatabase } from '../db/database.js';
import { getPendingMigrationNames } from '../db/migrate.js';
import { defaultLipasCatalogSourceUrl, importParks } from './import-parks.js';
import { type GithubReviewTarget, sendPendingParkReviews } from './park-review-notifications.js';

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
  const result = await importParks({
    database,
    markNewParksRemoved: true,
    queueNewParkNotification: true,
    sourceUrl: defaultLipasCatalogSourceUrl
  });
  await sendPendingParkReviews(database, github);
  return result;
};
