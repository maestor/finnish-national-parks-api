import { OpenAPIHono } from '@hono/zod-openapi';

import { healthRoute } from './routes/health.js';

export function createApp() {
  const app = new OpenAPIHono();

  app.openAPIRegistry.registerComponent('securitySchemes', 'none', {
    type: 'http',
    scheme: 'bearer'
  });

  app.openapi(healthRoute, (context) =>
    context.json({
      ok: true,
      service: 'finnish-national-parks-api'
    })
  );

  app.doc('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'Finnish National Parks API',
      version: '0.1.0'
    }
  });

  return app;
}
