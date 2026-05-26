import { createApp } from './app.js';
import { createDatabaseClient } from './db/client.js';
import { createDatabase } from './db/database.js';
import { type Env, getEnv, isVercelDeployment } from './env.js';
import { createMemoryStorage } from './storage/memory-storage.js';
import { createR2Client } from './storage/r2-client.js';

export const createStorage = (env: Env) => {
  if (env.MEMORY_STORAGE === 'true') {
    return createMemoryStorage();
  }

  if (env.R2_BUCKET_NAME && env.R2_ENDPOINT && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY) {
    return createR2Client({
      accessKeyId: env.R2_ACCESS_KEY_ID,
      bucketName: env.R2_BUCKET_NAME,
      endpoint: env.R2_ENDPOINT,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY
    });
  }

  return undefined;
};

export const createAuthConfig = (env: Env) => {
  if (!(env.AUTH_JWT_SECRET && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)) {
    return undefined;
  }

  const authConfig = {
    cookieName: env.AUTH_COOKIE_NAME,
    frontendUrl: env.FRONTEND_URL,
    googleClientId: env.GOOGLE_CLIENT_ID,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET,
    jwtSecret: env.AUTH_JWT_SECRET
  };

  if (!env.GOOGLE_REDIRECT_URI) {
    return authConfig;
  }

  return {
    ...authConfig,
    googleRedirectUri: env.GOOGLE_REDIRECT_URI
  };
};

export const env = getEnv();
export const databaseClient = createDatabaseClient();
export const app = createApp({
  apiKey: env.API_KEY,
  allowServerImageUploads: !isVercelDeployment(),
  auth: createAuthConfig(env),
  database: createDatabase(databaseClient),
  getLogoPublicUrl: undefined,
  storage: createStorage(env)
});
