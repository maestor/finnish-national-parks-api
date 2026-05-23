import { createMiddleware } from 'hono/factory';

export const createAuthMiddleware = (apiKey: string | undefined) => {
  return createMiddleware(async (c, next) => {
    if (!apiKey) {
      return next();
    }

    const path = c.req.path;
    if (
      path === '/health' ||
      path === '/openapi.json' ||
      path.startsWith('/auth/') ||
      path.startsWith('/api/public/')
    ) {
      return next();
    }

    const forwardedFor = c.req.header('x-forwarded-for');
    const host = c.req.header('host') || '';

    const isLocalhost =
      !forwardedFor && (host.startsWith('localhost:') || host === '127.0.0.1' || host === '::1');

    if (isLocalhost) {
      return next();
    }

    const auth = c.req.header('authorization');
    if (!auth || auth !== `Bearer ${apiKey}`) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    return next();
  });
};
