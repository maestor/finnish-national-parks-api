import { serve } from '@hono/node-server';

import { createDatabaseClient } from './db/client.js';
import { createDatabase } from './db/database.js';
import { createApp } from './app.js';
import { getEnv } from './env.js';

const env = getEnv();
const port = Number.parseInt(env.PORT ?? '3000', 10);
const client = createDatabaseClient();

serve({
  fetch: createApp({
    database: createDatabase(client)
  }).fetch,
  port
});
