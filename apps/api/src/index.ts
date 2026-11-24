import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { APP_PROTOCOL_VERSIONS, type ApiVersionInfo } from '@trazena/shared';
import type { AppContext } from './env.js';
import { authMiddleware } from './middleware/auth.js';
import { authRoutes } from './routes/auth.js';
import { organizationsRoutes } from './routes/organizations.js';
import { workspacesRoutes } from './routes/workspaces.js';
import { pagesRoutes } from './routes/pages.js';
import { systemRoutes } from './routes/system.js';
import { syncRoutes } from './routes/sync.js';

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

// Lightweight compatibility endpoint — zero document queries
app.get('/api/version', (c) => {
  const info: ApiVersionInfo = {
    appName: 'trazena-api',
    apiVersion: APP_PROTOCOL_VERSIONS.apiVersion,
    syncProtocolVersion: APP_PROTOCOL_VERSIONS.syncProtocolVersion,
    remoteSchemaVersion: APP_PROTOCOL_VERSIONS.remoteSchemaVersion,
    minimumCompatibleAppVersion: APP_PROTOCOL_VERSIONS.minimumCompatibleAppVersion,
    serverTime: new Date().toISOString(),
  };
  return c.json(info);
});

// All business endpoints require verified Worker HS256 JWT + D1 authorization
app.use('/api/*', async (c, next) => {
  if (
    c.req.path === '/api/health' ||
    c.req.path === '/api/version' ||
    c.req.path === '/api/auth/login'
  ) {
    await next();
    return;
  }
  return authMiddleware(c, next);
});

app.route('/api/auth', authRoutes);
app.route('/api/organizations', organizationsRoutes);
app.route('/api/workspaces', workspacesRoutes);
app.route('/api/pages', pagesRoutes);
app.route('/api', syncRoutes);
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
