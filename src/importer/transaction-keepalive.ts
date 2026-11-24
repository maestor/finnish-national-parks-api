import { sql } from 'drizzle-orm';
import type { DbClient } from '../db/database.js';

const TRANSACTION_KEEPALIVE_INTERVAL_MS = 1000;

// Geometry matching can spend several seconds without issuing a database query.
export const createTransactionKeepalive = (database: DbClient) => {
  let lastKeepalive = Date.now();
  return async () => {
    if (Date.now() - lastKeepalive >= TRANSACTION_KEEPALIVE_INTERVAL_MS) {
      await database.run(sql`select 1`);
      lastKeepalive = Date.now();
    }
  };
};
