import { createApp } from './app.js';
import { createDatabaseClient } from './db/client.js';
import { createDatabase, type Database } from './db/database.js';
import { type Env, getEnv, isVercelDeployment } from './env.js';
import { createMemoryStorage } from './storage/memory-storage.js';
import { createR2Client } from './storage/r2-client.js';
import { createTripPlannerBudget, TripPlannerBudgetError } from './trip-planner/budget.js';
import { createGeoapifyClient } from './trip-planner/geoapify.js';
import { createTripPlannerService } from './trip-planner/search.js';

const LOGO_URL_POLICY_VERSION = '2';

const normalizeBaseUrl = (baseUrl: string) => {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
};

const encodeKeyPath = (key: string) => {
  return key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
};

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

export const createAuthConfig = (env: Env, runtimeEnv: NodeJS.ProcessEnv = process.env) => {
  const googleOAuthEnabled = Boolean(
    env.AUTH_JWT_SECRET && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
  );
  const localAgentAuthEnabled =
    env.LOCAL_AGENT_AUTH_ENABLED === 'true' && !isVercelDeployment(runtimeEnv);

  if (!(env.AUTH_JWT_SECRET && (googleOAuthEnabled || localAgentAuthEnabled))) {
    return undefined;
  }

  const authConfig = {
    cookieName: env.AUTH_COOKIE_NAME,
    frontendUrl: env.FRONTEND_URL,
    jwtSecret: env.AUTH_JWT_SECRET
  };

  const configuredAuth = googleOAuthEnabled
    ? {
        ...authConfig,
        googleClientId: env.GOOGLE_CLIENT_ID,
        googleClientSecret: env.GOOGLE_CLIENT_SECRET
      }
    : authConfig;

  const authWithLocalAgent = localAgentAuthEnabled
    ? { ...authConfig, localAgentAuthEnabled: true }
    : configuredAuth;

  if (!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)) {
    return authWithLocalAgent;
  }

  const authWithGoogle = {
    ...authWithLocalAgent,
    googleClientId: env.GOOGLE_CLIENT_ID,
    googleClientSecret: env.GOOGLE_CLIENT_SECRET
  };

  if (!env.GOOGLE_REDIRECT_URI) {
    return authWithGoogle;
  }

  return {
    ...authWithGoogle,
    googleRedirectUri: env.GOOGLE_REDIRECT_URI
  };
};

export const createTripPlanner = (
  env: Env,
  database: Database,
  tripPlannerBudget = createTripPlannerBudget({
    dailyProviderUnits: env.GEOAPIFY_DAILY_REQUEST_LIMIT,
    database
  })
) => {
  if (!env.GEOAPIFY_API_KEY) {
    return undefined;
  }

  return createTripPlannerService({
    database,
    provider: createGeoapifyClient({
      apiKey: env.GEOAPIFY_API_KEY,
      providerAdmission: async (operation) => {
        const reservation = await tripPlannerBudget.reserveProvider?.(
          operation === 'route' ? 5 : 1
        );

        if (reservation?.allowed) {
          return;
        }

        if (reservation?.reason === 'exceeded') {
          throw new TripPlannerBudgetError(
            'trip_planner_budget_exceeded',
            'Trip planner provider budget exceeded.',
            429,
            reservation.retryAfterSeconds
          );
        }

        throw new TripPlannerBudgetError(
          'trip_planner_budget_unavailable',
          'Trip planner budget is unavailable.',
          503
        );
      }
    })
  });
};

export const createLogoPublicUrl = (env: Env) => {
  if (!env.PUBLIC_API_BASE_URL) {
    return undefined;
  }

  const baseUrl = normalizeBaseUrl(env.PUBLIC_API_BASE_URL);

  return (key: string, updatedAt: string) => {
    const logoPath = key.startsWith('logos/') ? key.slice('logos/'.length) : key;
    const url = new URL(`assets/logos/${encodeKeyPath(logoPath)}`, baseUrl);
    url.searchParams.set('v', updatedAt);
    url.searchParams.set('policy', LOGO_URL_POLICY_VERSION);
    return url.toString();
  };
};

export const createPublicMediaUrl = (env: Env) => {
  if (!env.PUBLIC_API_BASE_URL) {
    return undefined;
  }

  const baseUrl = normalizeBaseUrl(env.PUBLIC_API_BASE_URL);

  return (key: string) => new URL(`assets/media/${encodeKeyPath(key)}`, baseUrl).toString();
};

export const env = getEnv();
export const databaseClient = createDatabaseClient();
export const database = createDatabase(databaseClient);
export const tripPlannerBudget = createTripPlannerBudget({
  dailyProviderUnits: env.GEOAPIFY_DAILY_REQUEST_LIMIT,
  database
});
export const tripPlanner = createTripPlanner(env, database, tripPlannerBudget);
export const app = createApp({
  apiKey: env.API_KEY,
  allowServerImageUploads: !isVercelDeployment(),
  auth: createAuthConfig(env),
  database,
  getLogoPublicUrl: createLogoPublicUrl(env),
  getPublicMediaUrl: createPublicMediaUrl(env),
  storage: createStorage(env),
  tripPlannerBudget,
  tripPlanner
});
