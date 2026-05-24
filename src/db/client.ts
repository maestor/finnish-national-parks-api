import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { createClient } from '@libsql/client';

import { getEnv } from '../env.js';

const ensureLocalSqliteDirectory = (databaseUrl: string) => {
  if (!databaseUrl.startsWith('file:')) {
    return;
  }

  const filePath = databaseUrl.slice('file:'.length).split('?')[0];

  if (!filePath || filePath === ':memory:' || filePath.includes('mode=memory')) {
    return;
  }

  mkdirSync(dirname(filePath), { recursive: true });
};

export const createDatabaseClient = () => {
  const env = getEnv();
  ensureLocalSqliteDirectory(env.DATABASE_URL);

  return createClient(
    env.DATABASE_AUTH_TOKEN
      ? {
          authToken: env.DATABASE_AUTH_TOKEN,
          url: env.DATABASE_URL
        }
      : {
          url: env.DATABASE_URL
        }
  );
};
