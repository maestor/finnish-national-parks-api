import { randomUUID } from 'node:crypto';

import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';

import type { Database } from './db/database.js';
import {
  createVisit,
  createVisitImage,
  deleteVisit,
  deleteVisitImage,
  findAdminByEmail,
  findVisitImageById,
  findVisitRecordById,
  getCatalogListEtagSeed,
  getParkBySlug,
  getParkVisitsBySlug,
  getPublicHomeSummary,
  getPublicMapSummary,
  getVisitById,
  listParks,
  listRemovedParks,
  listVisits,
  reorderVisitImages,
  updateParkRemoved,
  updateVisit
} from './db/repositories.js';
import { createAuthMiddleware } from './http/auth.js';
import {
  CATALOG_CACHE_CONTROL,
  createCatalogDetailEtag,
  createCatalogListEtag,
  createPublicSummaryEtag,
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
  deleteVisitImageRoute,
  deleteVisitRoute,
  getParkRoute,
  getParkVisitsRoute,
  getPublicHomeSummaryRoute,
  getPublicMapSummaryRoute,
  getVisitRoute,
  listParksRoute,
  listRemovedParksRoute,
  listVisitsRoute,
  reorderVisitImagesRoute,
  updateParkRemovedRoute,
  updateVisitRoute,
  uploadVisitImagesRoute
} from './routes/parks.js';

type AuthConfig = {
  cookieName: string;
  frontendUrl: string;
  googleClientId: string;
  googleClientSecret: string;
  jwtSecret: string;
};

import type { StorageClient } from './storage/types.js';

type AppDependencies = {
  apiKey?: string | undefined;
  auth?: AuthConfig | undefined;
  database?: Database | undefined;
  storage?: StorageClient | undefined;
};

const jsonNotFound = (error: string) => {
  return {
    error
  };
};

export const createApp = ({ apiKey, auth, database, storage }: AppDependencies = {}) => {
  const getImagePublicUrl = async (key: string) => {
    if (storage) {
      return storage.getPresignedUrl(key, 3600);
    }
    return '';
  };
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

    app.openapi(listRemovedParksRoute, async (context) => {
      context.header('Cache-Control', PRIVATE_CACHE_CONTROL);

      const parks = await listRemovedParks(database);

      return context.json(
        {
          parks
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

    app.openapi(getParkVisitsRoute, async (context) => {
      context.header('Cache-Control', PRIVATE_CACHE_CONTROL);

      const { slug } = context.req.valid('param');
      const parkVisits = await getParkVisitsBySlug(database, slug, getImagePublicUrl);

      if (!parkVisits) {
        return context.json(jsonNotFound('Park not found.'), 404);
      }

      return context.json(
        {
          ...parkVisits
        },
        200
      );
    });

    app.openapi(getPublicHomeSummaryRoute, async (context) => {
      const summary = await getPublicHomeSummary(database);
      const etag = createPublicSummaryEtag({
        kind: 'home',
        publicUpdatedAt: summary.updatedAt,
        publicVersion: summary.version
      });
      context.header('Cache-Control', CATALOG_CACHE_CONTROL);
      context.header('ETag', etag);

      if (hasMatchingEtag(context.req.header('if-none-match'), etag)) {
        return new Response(null, {
          headers: context.res.headers,
          status: 304
        });
      }

      return context.json(summary, 200);
    });

    app.openapi(getPublicMapSummaryRoute, async (context) => {
      const [catalogSeed, summary] = await Promise.all([
        getCatalogListEtagSeed(database),
        getPublicMapSummary(database)
      ]);
      const etag = createPublicSummaryEtag({
        activeCount: catalogSeed.activeCount,
        kind: 'map',
        latestCatalogImportRunId: catalogSeed.latestImportRunId,
        latestCatalogUpdatedAt: catalogSeed.latestUpdatedAt,
        publicUpdatedAt: summary.updatedAt,
        publicVersion: summary.version
      });
      context.header('Cache-Control', CATALOG_CACHE_CONTROL);
      context.header('ETag', etag);

      if (hasMatchingEtag(context.req.header('if-none-match'), etag)) {
        return new Response(null, {
          headers: context.res.headers,
          status: 304
        });
      }

      return context.json(summary, 200);
    });

    app.openapi(listVisitsRoute, async (context) => {
      context.header('Cache-Control', PRIVATE_CACHE_CONTROL);

      const visits = await listVisits(database, getImagePublicUrl);

      return context.json(
        {
          visits
        },
        200
      );
    });

    app.openapi(getVisitRoute, async (context) => {
      context.header('Cache-Control', PRIVATE_CACHE_CONTROL);

      const { id } = context.req.valid('param');
      const visit = await getVisitById(database, id, getImagePublicUrl);

      if (!visit) {
        return context.json(jsonNotFound('Visit not found.'), 404);
      }

      return context.json(visit, 200);
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

    app.openapi(updateParkRemovedRoute, async (context) => {
      context.header('Cache-Control', PRIVATE_CACHE_CONTROL);

      const { slug } = context.req.valid('param');
      const { removed } = context.req.valid('json');
      const updated = await updateParkRemoved(database, slug, removed);

      if (!updated) {
        return context.json(jsonNotFound('Park not found.'), 404);
      }

      return new Response(null, {
        headers: context.res.headers,
        status: 204
      });
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

    if (storage) {
      const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15 MB
      const ACCEPTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

      app.openapi(uploadVisitImagesRoute, async (context) => {
        context.header('Cache-Control', PRIVATE_CACHE_CONTROL);

        const { id } = context.req.valid('param');
        const body = await context.req.parseBody({ all: true });
        const rawImages = body.images;
        const files: File[] = [];

        if (Array.isArray(rawImages)) {
          for (const item of rawImages) {
            if (item instanceof File) {
              files.push(item);
            }
          }
        } else if (rawImages instanceof File) {
          files.push(rawImages);
        }

        if (files.length === 0) {
          return context.json({ error: 'No images provided.' }, 400);
        }

        // Verify visit exists
        const existingVisit = await findVisitRecordById(database, id);

        if (!existingVisit) {
          return context.json(jsonNotFound('Visit not found.'), 404);
        }

        type UploadResult = {
          createdAt: string;
          displayOrder: number;
          fullHeight: number | null;
          fullUrl: string;
          fullWidth: number | null;
          id: number;
          originalName: string | null;
          thumbHeight: number | null;
          thumbUrl: string;
          thumbWidth: number | null;
        };

        const results: UploadResult[] = [];
        const errors: { originalName: string; reason: string }[] = [];

        for (const file of files) {
          if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
            errors.push({ originalName: file.name, reason: 'Unsupported file type.' });
            continue;
          }

          if (file.size > MAX_FILE_SIZE) {
            errors.push({ originalName: file.name, reason: 'File too large.' });
            continue;
          }

          try {
            const buffer = Buffer.from(await file.arrayBuffer());
            const { processImage } = await import('./images/process-image.js');
            const processed = await processImage(buffer);

            const baseKey = `visits/${id}/${randomUUID()}`;
            const fullKey = `${baseKey}-full.jpg`;
            const thumbKey = `${baseKey}-thumb.jpg`;

            await storage.upload(fullKey, processed.fullBuffer, 'image/jpeg');
            await storage.upload(thumbKey, processed.thumbBuffer, 'image/jpeg');

            const timestamp = new Date().toISOString();
            const row = await createVisitImage(database, {
              createdAt: timestamp,
              displayOrder: 0,
              fileSizeBytes: processed.fullBuffer.length,
              fullHeight: processed.fullHeight,
              fullKey,
              fullWidth: processed.fullWidth,
              mimeType: 'image/jpeg',
              originalName: file.name,
              thumbHeight: processed.thumbHeight,
              thumbKey,
              thumbWidth: processed.thumbWidth,
              updatedAt: timestamp,
              visitId: id
            });

            results.push({
              createdAt: row.createdAt,
              displayOrder: row.displayOrder,
              fullHeight: row.fullHeight,
              fullUrl: await storage.getPresignedUrl(row.fullKey, 3600),
              fullWidth: row.fullWidth,
              id: row.id,
              originalName: row.originalName,
              thumbHeight: row.thumbHeight,
              thumbUrl: await storage.getPresignedUrl(row.thumbKey, 3600),
              thumbWidth: row.thumbWidth
            });
          } catch (err) {
            logger.error(
              { err: (err as Error).message, fileName: file.name },
              'Image upload failed'
            );
            errors.push({ originalName: file.name, reason: 'Processing failed.' });
          }
        }

        if (results.length === 0) {
          return context.json({ error: 'All uploads failed.', errors }, 422);
        }

        return context.json({ images: results, errors }, 201);
      });

      app.openapi(deleteVisitImageRoute, async (context) => {
        context.header('Cache-Control', PRIVATE_CACHE_CONTROL);

        const { imageId, visitId } = context.req.valid('param');
        const image = await findVisitImageById(database, imageId);

        if (!image || image.visitId !== visitId) {
          return context.json(jsonNotFound('Image not found.'), 404);
        }

        await storage.delete(image.fullKey);
        await storage.delete(image.thumbKey);
        await deleteVisitImage(database, imageId);

        return new Response(null, {
          headers: context.res.headers,
          status: 204
        });
      });

      app.openapi(reorderVisitImagesRoute, async (context) => {
        context.header('Cache-Control', PRIVATE_CACHE_CONTROL);

        const { id } = context.req.valid('param');
        const { imageIds } = context.req.valid('json');

        const existingVisit = await findVisitRecordById(database, id);

        if (!existingVisit) {
          return context.json(jsonNotFound('Visit not found.'), 404);
        }

        try {
          await reorderVisitImages(database, id, imageIds);
        } catch {
          return context.json({ error: 'Invalid image order.' }, 422);
        }

        return new Response(null, {
          headers: context.res.headers,
          status: 204
        });
      });
    }
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
