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
  completeVisitImageUploadRoute,
  createVisitImageUploadUrlRoute,
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
  googleRedirectUri?: string;
  jwtSecret: string;
};

import type { StorageClient } from './storage/types.js';

type AppDependencies = {
  apiKey?: string | undefined;
  allowServerImageUploads?: boolean | undefined;
  auth?: AuthConfig | undefined;
  database?: Database | undefined;
  getLogoPublicUrl?: ((key: string, updatedAt: string) => string | Promise<string>) | undefined;
  storage?: StorageClient | undefined;
};

const MAX_VISIT_IMAGE_FILE_SIZE = 15 * 1024 * 1024;
const ACCEPTED_VISIT_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const DIRECT_VISIT_UPLOAD_URL_TTL_SECONDS = 15 * 60;
const LOGO_PRESIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

const jsonNotFound = (error: string) => {
  return {
    error
  };
};

const getVisitImageFileExtension = (contentType: string) => {
  if (contentType === 'image/png') {
    return 'png';
  }

  if (contentType === 'image/webp') {
    return 'webp';
  }

  return 'jpg';
};

const normalizeOptionalOriginalName = (originalName?: string | null) => {
  return originalName?.trim() || null;
};

const toVisitImageResponse = async (
  storage: StorageClient,
  row: {
    createdAt: string;
    displayOrder: number;
    fullHeight: number | null;
    fullKey: string;
    fullWidth: number | null;
    id: number;
    originalName: string | null;
    thumbHeight: number | null;
    thumbKey: string;
    thumbWidth: number | null;
  }
) => {
  return {
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
  };
};

export const createApp = ({
  apiKey,
  allowServerImageUploads = true,
  auth,
  database,
  getLogoPublicUrl,
  storage
}: AppDependencies = {}) => {
  const logoPublicUrl =
    getLogoPublicUrl ??
    (storage
      ? async (key: string) => storage.getPresignedUrl(key, LOGO_PRESIGNED_URL_TTL_SECONDS)
      : undefined);

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

      const redirectUri =
        auth.googleRedirectUri ?? new URL('/auth/google/callback', c.req.url).toString();
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

        const redirectUri =
          auth.googleRedirectUri ?? new URL('/auth/google/callback', c.req.url).toString();
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

      const parks = await listParks(database, filter, logoPublicUrl);

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

      const parks = await listRemovedParks(database, logoPublicUrl);

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
      const park = await getParkBySlug(database, slug, logoPublicUrl);

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
        getPublicMapSummary(database, logoPublicUrl)
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
      app.openapi(createVisitImageUploadUrlRoute, async (context) => {
        context.header('Cache-Control', PRIVATE_CACHE_CONTROL);

        const { id } = context.req.valid('param');
        const { contentType, fileSizeBytes } = context.req.valid('json');

        const existingVisit = await findVisitRecordById(database, id);

        if (!existingVisit) {
          return context.json(jsonNotFound('Visit not found.'), 404);
        }

        if (fileSizeBytes > MAX_VISIT_IMAGE_FILE_SIZE) {
          return context.json({ error: 'File too large.' }, 413);
        }

        const key = `visits/${id}/${randomUUID()}.${getVisitImageFileExtension(contentType)}`;
        const uploadUrl = await storage.getPresignedUploadUrl(
          key,
          contentType,
          DIRECT_VISIT_UPLOAD_URL_TTL_SECONDS
        );

        return context.json(
          {
            expiresAt: new Date(
              Date.now() + DIRECT_VISIT_UPLOAD_URL_TTL_SECONDS * 1000
            ).toISOString(),
            headers: {
              'content-type': contentType
            },
            key,
            method: 'PUT' as const,
            uploadUrl
          },
          201
        );
      });

      app.openapi(completeVisitImageUploadRoute, async (context) => {
        context.header('Cache-Control', PRIVATE_CACHE_CONTROL);

        const { id } = context.req.valid('param');
        const { fullHeight, fullWidth, key, originalName } = context.req.valid('json');

        const existingVisit = await findVisitRecordById(database, id);

        if (!existingVisit) {
          return context.json(jsonNotFound('Visit not found.'), 404);
        }

        if (!key.startsWith(`visits/${id}/`)) {
          return context.json({ error: 'Upload key does not belong to this visit.' }, 422);
        }

        const objectMetadata = await storage.getObjectMetadata(key);

        if (!objectMetadata) {
          return context.json({ error: 'Upload is missing from storage.' }, 422);
        }

        const resolvedContentType = objectMetadata.contentType ?? 'application/octet-stream';

        if (!ACCEPTED_VISIT_IMAGE_MIME_TYPES.includes(resolvedContentType)) {
          return context.json({ error: 'Unsupported file type.' }, 422);
        }

        const timestamp = new Date().toISOString();
        const row = await createVisitImage(database, {
          createdAt: timestamp,
          displayOrder: 0,
          fileSizeBytes: objectMetadata.contentLength,
          fullHeight: fullHeight ?? null,
          fullKey: key,
          fullWidth: fullWidth ?? null,
          mimeType: resolvedContentType,
          originalName: normalizeOptionalOriginalName(originalName),
          thumbHeight: fullHeight ?? null,
          thumbKey: key,
          thumbWidth: fullWidth ?? null,
          updatedAt: timestamp,
          visitId: id
        });

        return context.json(
          {
            image: await toVisitImageResponse(storage, row)
          },
          201
        );
      });

      app.openapi(uploadVisitImagesRoute, async (context) => {
        context.header('Cache-Control', PRIVATE_CACHE_CONTROL);

        if (!allowServerImageUploads) {
          return context.json(
            {
              error: 'Server-side multipart uploads are disabled here. Use the direct upload flow.'
            },
            501
          );
        }

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
          if (!ACCEPTED_VISIT_IMAGE_MIME_TYPES.includes(file.type)) {
            errors.push({ originalName: file.name, reason: 'Unsupported file type.' });
            continue;
          }

          if (file.size > MAX_VISIT_IMAGE_FILE_SIZE) {
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

            results.push(await toVisitImageResponse(storage, row));
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
