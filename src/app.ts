import { OpenAPIHono } from '@hono/zod-openapi';

import type { Database } from './db/database.js';
import {
  createVisit,
  deleteVisit,
  getCatalogListEtagSeed,
  getParkBySlug,
  getPersonalParkBySlug,
  listParks,
  listPersonalParks,
  putParkNote,
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
import { logger } from './http/logger.js';
import { healthRoute } from './routes/health.js';
import {
  createVisitRoute,
  deleteVisitRoute,
  getParkRoute,
  getPersonalParkRoute,
  listParksRoute,
  listPersonalParksRoute,
  putParkNoteRoute,
  updateVisitRoute
} from './routes/parks.js';

type AppDependencies = {
  apiKey?: string | undefined;
  database?: Database;
};

const jsonNotFound = (error: string) => {
  return {
    error
  };
};

export const createApp = ({ apiKey, database }: AppDependencies = {}) => {
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

    app.openapi(putParkNoteRoute, async (context) => {
      context.header('Cache-Control', PRIVATE_CACHE_CONTROL);

      const { slug } = context.req.valid('param');
      const body = context.req.valid('json');

      try {
        const note = await putParkNote(database, slug, body.note);
        return context.json({ note }, 200);
      } catch (error) {
        return context.json(jsonNotFound((error as Error).message), 404);
      }
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
