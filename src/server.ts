import { serve } from '@hono/node-server';

import { createApp } from './app.js';
import { createDatabaseClient } from './db/client.js';
import { createDatabase } from './db/database.js';
import { getEnv } from './env.js';
import { logger } from './http/logger.js';
import { createMemoryStorage } from './storage/memory-storage.js';
import { createR2Client } from './storage/r2-client.js';

const env = getEnv();
const port = Number.parseInt(env.PORT ?? '3004', 10);
const client = createDatabaseClient();

const storage =
  env.MEMORY_STORAGE === 'true'
    ? createMemoryStorage()
    : env.R2_BUCKET_NAME && env.R2_ENDPOINT && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY
      ? createR2Client({
          accessKeyId: env.R2_ACCESS_KEY_ID,
          bucketName: env.R2_BUCKET_NAME,
          endpoint: env.R2_ENDPOINT,
          publicUrl: env.R2_PUBLIC_URL ?? env.R2_ENDPOINT,
          secretAccessKey: env.R2_SECRET_ACCESS_KEY
        })
      : undefined;

const app = createApp({
  apiKey: env.API_KEY,
  auth:
    env.AUTH_JWT_SECRET && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? {
          cookieName: env.AUTH_COOKIE_NAME,
          frontendUrl: env.FRONTEND_URL,
          googleClientId: env.GOOGLE_CLIENT_ID,
          googleClientSecret: env.GOOGLE_CLIENT_SECRET,
          jwtSecret: env.AUTH_JWT_SECRET
        }
      : undefined,
  database: createDatabase(client),
  storage
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
