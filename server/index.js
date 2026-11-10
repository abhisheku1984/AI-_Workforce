import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config.js';
import { migrate, getDb } from './db/index.js';
import { authenticate } from './auth/middleware.js';
import { ensureModuleCatalogue } from './services/onboarding.js';
import { sendError } from './lib/http.js';

import authRoutes from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import workforceRoutes from './routes/workforce.js';
import projectRoutes from './routes/projects.js';
import allocationRoutes from './routes/allocations.js';
import importRoutes from './routes/imports.js';
import analyticsRoutes from './routes/analytics.js';
import aiRoutes from './routes/ai.js';
import reportRoutes from './routes/reports.js';
import governanceRoutes from './routes/governance.js';

migrate();
ensureModuleCatalogue();

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false, // set by the static host for the SPA; API serves JSON only
  crossOriginResourcePolicy: { policy: 'same-site' },
}));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

/** Simple in-memory rate limiter for auth endpoints (per IP). */
const authAttempts = new Map();
function authRateLimit(req, res, next) {
  const key = req.ip;
  const nowMs = Date.now();
  const entry = authAttempts.get(key) || { count: 0, reset: nowMs + 60000 };
  if (nowMs > entry.reset) { entry.count = 0; entry.reset = nowMs + 60000; }
  entry.count += 1;
  authAttempts.set(key, entry);
  if (entry.count > 30) {
    return res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait a minute and try again.' } });
  }
  return next();
}

app.use('/api', authenticate);

// Block cross-site state-changing requests (defence in depth on top of SameSite cookies).
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  try {
    const host = new URL(origin).host;
    const selfHost = req.headers.host;
    if (host !== selfHost) {
      return sendError(res, 403, 'CROSS_SITE_BLOCKED', 'Cross-site requests are not permitted.');
    }
  } catch { /* malformed origin — allow, cookie auth still applies */ }
  return next();
});

app.get('/api/health', (_req, res) => {
  let dbOk = true;
  try { getDb().prepare('SELECT 1').get(); } catch { dbOk = false; }
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'degraded',
    environment: config.env,
    version: '1.0.0',
    database: dbOk ? 'connected' : 'unavailable',
    ai_provider: config.ai.provider,
    time: new Date().toISOString(),
  });
});

app.use('/api/auth', authRateLimit, authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/workforce', workforceRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/allocations', allocationRoutes);
app.use('/api/imports', importRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/governance', governanceRoutes);

app.use('/api', (_req, res) => sendError(res, 404, 'NOT_FOUND', 'That API endpoint does not exist.'));

// Serve the built SPA in production.
const distDir = path.resolve(import.meta.dirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

// Central error handler — never leaks stack traces to clients.
app.use((err, req, res, _next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  const code = err.code || 'INTERNAL_ERROR';
  if (status >= 500) {
    console.error('[api] unhandled error', { path: req.path, method: req.method, message: err.message, stack: err.stack });
  }
  if (res.headersSent) return;
  sendError(res, status, typeof code === 'string' ? code : 'INTERNAL_ERROR',
    status >= 500 ? 'Something went wrong on our side. The action was not completed.' : err.message,
    err.details);
});

export function start(port = config.port) {
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`[api] WorkforceIQ listening on 0.0.0.0:${server.address().port} (${config.env})`);
    console.log(`[api] AI provider: ${config.ai.provider}${config.ai.provider !== 'local' ? ` (${config.ai.model})` : ' (deterministic, grounded)'}`);
  });
  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  return server;
}

// Only listen when executed directly (tests import the app instead).
if (process.argv[1] && process.argv[1].endsWith('server/index.js')) start();

export { app };
