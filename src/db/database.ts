import type { Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';

import * as schema from './schema.js';

export function createDatabase(client: Client) {
  return drizzle(client, {
    schema
  });
}

export type Database = ReturnType<typeof createDatabase>;
