import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';

import type { Database } from './db/database.js';
import {
  createVisit,
  deleteVisit,
  findAdminByEmail,
  getCatalogListEtagSeed,
  getParkBySlug,
  getPersonalParkBySlug,
  listParks,
  listPersonalParks,
  updateVisit
} from './db/repositories.js';
import { createAuthMiddleware } from './http/auth.js';
import {
  CATALOG_CACHE_CONTROL,
  createCatalogDetailEtag,
  createCatalogListEtag,
  hasMatchingEtag,
  PRIVATE_CACHE_CONTROL
} from './http/cache.js';
import {
  buildGoogleAuthUrl,
  clearOAuthStateCookie,
  clearPkceCookie,
  exchangeCodeForTokens,
  generateCodeChallenge,
  generateCodeVerifier,
  generateState,
  getOAuthStateCookie,
  getPkceCookie,
  setOAuthStateCookie,
  setPkceCookie,
  verifyGoogleIdToken
} from './http/google-oauth.js';
import { logger } from './http/logger.js';
import {
  clearSessionCookie,
  createSessionToken,
  getSessionCookie,
  setSessionCookie,
  verifySessionToken
} from './http/session.js';
import {
  getAuthMeRoute,
  googleAuthCallbackRoute,
  googleAuthRoute,
  postAuthLogoutRoute
} from './routes/auth.js';
import { healthRoute } from './routes/health.js';
import {
  createVisitRoute,
  deleteVisitRoute,
  getParkRoute,
  getPersonalParkRoute,
  listParksRoute,
  listPersonalParksRoute,
  updateVisitRoute
} from './routes/parks.js';

type AuthConfig = {
  cookieName: string;
  frontendUrl: string;
  googleClientId: string;
  googleClientSecret: string;
  jwtSecret: string;
};

type AppDependencies = {
  apiKey?: string | undefined;
  auth?: AuthConfig | undefined;
  database?: Database | undefined;
};

const jsonNotFound = (error: string) => {
  return {
    error
  };
};

export const createApp = ({ apiKey, auth, database }: AppDependencies = {}) => {
  const app = new OpenAPIHono();

  app.use(async (c, next) => {
    const start = Date.now();
    await next();
    logger.info(
      {
        duration: Date.now() - start,
        method: c.req.method,
        path: c.req.path,
        status: c.res.status
      },
      'request'
    );
  });

  app.onError((err, c) => {
    logger.error({ err: err.message, path: c.req.path }, 'Unhandled error');
    return c.json({ error: 'Internal server error.' }, 500);
  });

  if (auth) {
    const authCors = cors({
      credentials: true,
      origin: auth.frontendUrl
    });

    app.use('/auth/*', authCors);
    app.use('/api/*', authCors);
  }

  app.use(createAuthMiddleware(apiKey));

  app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer'
  });

  app.openapi(healthRoute, (context) =>
    context.json({
      ok: true,
      service: 'finnish-national-parks-api'
    })
  );

  if (database) {
    app.openapi(googleAuthRoute, (c) => {
      if (!auth) {
        return c.json({ error: 'OAuth not configured.' }, 503);
      }

      const state = generateState();
      const codeVerifier = generateCodeVerifier();
      const codeChallenge = generateCodeChallenge(codeVerifier);

      setOAuthStateCookie(c, state);
      setPkceCookie(c, codeVerifier);

      const redirectUri = new URL('/auth/google/callback', c.req.url).toString();
      const url = buildGoogleAuthUrl({
        clientId: auth.googleClientId,
        codeChallenge,
        redirectUri,
        state
      });

      return c.redirect(url, 302);
    });

    app.openapi(googleAuthCallbackRoute, async (c) => {
      if (!auth) {
        return c.json({ error: 'OAuth not configured.' }, 503);
      }

      const query = c.req.valid('query');
      const frontendUrl = auth.frontendUrl;

      try {
        if (query.error) {
          throw new Error('OAuth error');
        }

        const code = query.code;
        const state = query.state;

        if (!code || !state) {
          throw new Error('Missing code or state');
        }

        const storedState = getOAuthStateCookie(c);
        const codeVerifier = getPkceCookie(c);

        if (!storedState || !codeVerifier || storedState !== state) {
          throw new Error('Invalid state');
        }

        clearOAuthStateCookie(c);
        clearPkceCookie(c);

        const redirectUri = new URL('/auth/google/callback', c.req.url).toString();
        const tokens = await exchangeCodeForTokens({
          clientId: auth.googleClientId,
          clientSecret: auth.googleClientSecret,
          code,
          codeVerifier,
          redirectUri
        });

        const googleUser = await verifyGoogleIdToken(tokens.id_token, auth.googleClientId);
        const admin = await findAdminByEmail(database, googleUser.email);

        if (!admin) {
          return c.redirect(`${frontendUrl}/login?error=access_denied`, 302);
        }

        const sessionToken = await createSessionToken(
          {
            email: googleUser.email,
            name: googleUser.name ?? '',
            picture: googleUser.picture ?? '',
            sub: googleUser.sub
          },
          new TextEncoder().encode(auth.jwtSecret)
        );

        setSessionCookie(c, sessionToken, auth.cookieName);

        return c.redirect(`${frontendUrl}/control-panel`, 302);
      } catch {
        return c.redirect(`${frontendUrl}/login?error=auth_failed`, 302);
      }
    });

    app.openapi(getAuthMeRoute, async (c) => {
      if (!auth) {
        return c.json({ error: 'OAuth not configured.' }, 503);
      }

      const token = getSessionCookie(c, auth.cookieName);

      if (!token) {
        return c.json({ error: 'Unauthorized' }, 401);
      }

      try {
        const payload = await verifySessionToken(token, new TextEncoder().encode(auth.jwtSecret));

        return c.json(
          {
            email: payload.email,
            id: payload.sub,
            name: payload.name,
            picture: payload.picture
          },
          200
        );
      } catch {
        return c.json({ error: 'Unauthorized' }, 401);
      }
    });

    app.openapi(postAuthLogoutRoute, (c) => {
      if (!auth) {
        return c.json({ error: 'OAuth not configured.' }, 503);
      }

      clearSessionCookie(c, auth.cookieName);

      return new Response(null, {
        headers: c.res.headers,
        status: 204
      });
    });

    app.openapi(listParksRoute, async (context) => {
      const query = context.req.valid('query');
      const typeSlug = query.type;
      const filter = typeSlug ? { typeSlug } : {};
      const etag = createCatalogListEtag(await getCatalogListEtagSeed(database, filter));
      context.header('Cache-Control', CATALOG_CACHE_CONTROL);
      context.header('ETag', etag);

      if (hasMatchingEtag(context.req.header('if-none-match'), etag)) {
        return new Response(null, {
          headers: context.res.headers,
          status: 304
        });
      }

      const parks = await listParks(database, filter);

      return context.json(
        {
          parks: parks.map(
            ({
              boundaryGeoJson: _boundaryGeoJson,
              catalogStatus: _catalogStatus,
              lipasId: _lipasId,
              municipalityCode: _municipalityCode,
              postalOffice: _postalOffice,
              sourceEventDate: _sourceEventDate,
              updatedAt: _updatedAt,
              ...park
            }) => park
          )
        },
        200
      );
    });

    app.openapi(getParkRoute, async (context) => {
      const { slug } = context.req.valid('param');
      const query = context.req.valid('query');
      const includeBoundary = query.includeBoundary === 'true';
      const omitBoundary = query.includeBoundary === 'false' || !query.includeBoundary;
      const park = await getParkBySlug(database, slug);

      if (!park) {
        return context.json(jsonNotFound('Park not found.'), 404);
      }

      const etag = createCatalogDetailEtag({
        includeBoundary,
        lipasId: park.lipasId,
        updatedAt: park.updatedAt
      });
      context.header('Cache-Control', CATALOG_CACHE_CONTROL);
      context.header('ETag', etag);

      if (hasMatchingEtag(context.req.header('if-none-match'), etag)) {
        return new Response(null, {
          headers: context.res.headers,
          status: 304
        });
      }

      return context.json(
        {
          ...park,
          ...(omitBoundary ? { boundaryGeoJson: undefined } : {})
        },
        200
      );
    });

    app.openapi(listPersonalParksRoute, async (context) => {
      context.header('Cache-Control', PRIVATE_CACHE_CONTROL);

      const parks = await listPersonalParks(database);

      return context.json(
        {
          parks
        },
        200
      );
    });

    app.openapi(getPersonalParkRoute, async (context) => {
      context.header('Cache-Control', PRIVATE_CACHE_CONTROL);

      const { slug } = context.req.valid('param');
      const park = await getPersonalParkBySlug(database, slug);

      if (!park) {
        return context.json(jsonNotFound('Park not found.'), 404);
      }

      return context.json(park, 200);
    });

    app.openapi(createVisitRoute, async (context) => {
      context.header('Cache-Control', PRIVATE_CACHE_CONTROL);

      const { slug } = context.req.valid('param');
      const body = context.req.valid('json');

      try {
        const visit = await createVisit(database, slug, body);
        return context.json(visit, 201);
      } catch (error) {
        return context.json(jsonNotFound((error as Error).message), 404);
      }
    });

    app.openapi(updateVisitRoute, async (context) => {
      context.header('Cache-Control', PRIVATE_CACHE_CONTROL);

      const { id } = context.req.valid('param');
      const body = context.req.valid('json');
      const visit = await updateVisit(database, id, body);

      if (!visit) {
        return context.json(jsonNotFound('Visit not found.'), 404);
      }

      return context.json(visit, 200);
    });

    app.openapi(deleteVisitRoute, async (context) => {
      context.header('Cache-Control', PRIVATE_CACHE_CONTROL);

      const { id } = context.req.valid('param');
      const deleted = await deleteVisit(database, id);

      if (!deleted) {
        return context.json(jsonNotFound('Visit not found.'), 404);
      }

      return new Response(null, {
        headers: context.res.headers,
        status: 204
      });
    });
  }

  app.doc('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'Finnish National Parks API',
      version: '0.1.0'
    }
  });

  return app;
};
