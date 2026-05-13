import { serve } from '@hono/node-server';

import { createApp } from './app.js';
import { createDatabaseClient } from './db/client.js';
import { createDatabase } from './db/database.js';
import { getEnv } from './env.js';
import { logger } from './http/logger.js';

const env = getEnv();
const port = Number.parseInt(env.PORT ?? '3004', 10);
const client = createDatabaseClient();

const app = createApp({
  apiKey: env.API_KEY,
  database: createDatabase(client)
});

const server = serve(
  {
    fetch: app.fetch,
    port
  },
  (info) => {
    logger.info({ port: info.port }, 'Server started');
  }
);

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Shutting down');

  server.close(async () => {
    logger.info('Server closed');
    await client.close();
    logger.info('Database client closed');
    process.exit(0);
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
