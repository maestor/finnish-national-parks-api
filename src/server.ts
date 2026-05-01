import { serve } from '@hono/node-server';

import { createApp } from './app.js';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);

serve({
  fetch: createApp().fetch,
  port
});
