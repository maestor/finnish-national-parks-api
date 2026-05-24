import { serve } from '@hono/node-server';

import { logger } from './http/logger.js';
import { app, databaseClient, env } from './runtime.js';

const port = Number.parseInt(env.PORT ?? '3004', 10);

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
    await databaseClient.close();
    logger.info('Database client closed');
    process.exit(0);
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
