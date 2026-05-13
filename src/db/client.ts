import { createClient } from '@libsql/client';

import { getEnv } from '../env.js';

export const createDatabaseClient = () => {
  const env = getEnv();

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
