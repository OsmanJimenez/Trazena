import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppContext } from './env.js';
import { authMiddleware } from './middleware/auth.js';
import { organizationsRoutes } from './routes/organizations.js';
import { workspacesRoutes } from './routes/workspaces.js';
import { pagesRoutes } from './routes/pages.js';
import { systemRoutes } from './routes/system.js';

const app = new Hono<AppContext>();

app.use('/api/*', async (c, next) => {
  const allowed = (c.env.ALLOWED_ORIGINS ?? 'http://localhost:4200')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const corsHandler = cors({
    origin: (origin) => {
      if (!origin) return allowed[0] ?? '*';
      if (allowed.includes(origin) || allowed.includes('*')) return origin;
      return '';
    },
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    maxAge: 86400,
  });

  return corsHandler(c, next);
});

app.get('/api/health', (c) =>
  c.json({
    service: 'trazena-api',
    status: 'ok',
    timestamp: new Date().toISOString(),
  }),
);

// All business endpoints require verified Firebase identity + D1 authorization
app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/health') {
    await next();
    return;
  }
  return authMiddleware(c, next);
});

app.route('/api/organizations', organizationsRoutes);
app.route('/api/workspaces', workspacesRoutes);
app.route('/api/pages', pagesRoutes);
app.route('/api', systemRoutes);

app.onError((err, c) => {
  console.error('[trazena-api] Unhandled error:', err);
  return c.json(
    {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Unexpected server error.',
      },
    },
    500,
  );
});

app.notFound((c) =>
  c.json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } }, 404),
);

export default app;
