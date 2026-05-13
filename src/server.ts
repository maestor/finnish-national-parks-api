import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { createDatabaseClient } from './db/client.js';
import { createDatabase } from './db/database.js';
import { getEnv } from './env.js';

const env = getEnv();
const port = Number.parseInt(env.PORT ?? '3004', 10);
const client = createDatabaseClient();

serve({
  fetch: createApp({
    apiKey: env.API_KEY,
    database: createDatabase(client)
  }).fetch,
  port
});
