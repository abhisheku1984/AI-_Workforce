import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { migrate, getDb } from './db/index.js';
import { authenticate } from './auth/middleware.js';
import { ensureModuleCatalogue, refreshSystemRoles } from './services/onboarding.js';
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
import crmRoutes from './routes/crm.js';

migrate();
ensureModuleCatalogue();
// New permissions must reach existing organisations on restart, not only on fresh installs.
refreshSystemRoles();

const app = express();
app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: false, // set by the reverse proxy for the SPA; the API serves JSON only
  crossOriginResourcePolicy: { policy: 'same-site' },
  // Framing is a deployment decision, not a fixed default — see config.allowFrameEmbedding.
  frameguard: config.allowFrameEmbedding ? false : { action: 'sameorigin' },
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

/**
 * Block cross-site state-changing requests (defence in depth on top of SameSite cookies).
 *
 * Comparing Origin only against the Host header is too strict: behind a reverse proxy or
 * a preview tunnel, the browser sends Origin = the public host while the proxy forwards
 * Host = the upstream address (or an X-Forwarded-Host). That mismatch used to reject
 * legitimate sign-ins before authentication even ran.
 *
 * The check therefore accepts a request when ANY of these hold:
 *   1. the browser states Sec-Fetch-Site: same-origin (browsers set this; a cross-site
 *      page cannot forge it);
 *   2. the Origin host matches Host, X-Forwarded-Host, or an explicitly configured
 *      PUBLIC_HOST allow-list;
 *   3. there is no Origin header at all (non-browser client — the session cookie still
 *      has to be valid, and a cross-site page always sends Origin).
 * Anything else is refused. The protection is unchanged for a genuinely cross-site page.
 */
const PUBLIC_HOSTS = new Set(
  String(process.env.PUBLIC_HOST || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
);

app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (String(req.headers['sec-fetch-site'] || '').toLowerCase() === 'same-origin') return next();

  const origin = req.headers.origin;
  if (!origin) return next();

  let originHost;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return next(); // malformed origin — cookie auth still applies
  }

  const candidates = new Set(PUBLIC_HOSTS);
  for (const header of [req.headers.host, req.headers['x-forwarded-host']]) {
    if (!header) continue;
    for (const part of String(header).split(',')) {
      const value = part.trim().toLowerCase();
      if (value) candidates.add(value);
    }
  }

  if (candidates.has(originHost)) return next();
  return sendError(res, 403, 'CROSS_SITE_BLOCKED', 'Cross-site requests are not permitted.');
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
    build: (() => {
      try {
        const dist = path.resolve(import.meta.dirname, '..', 'dist', 'assets');
        return fs.readdirSync(dist).find((f) => /^index-.*\.js$/.test(f)) || null;
      } catch { return null; }
    })(),
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
app.use('/api/crm', crmRoutes);

app.use('/api', (_req, res) => sendError(res, 404, 'NOT_FOUND', 'That API endpoint does not exist.'));

// Serve the built SPA.
//
// Asset filenames are content-hashed by the bundler, so they can be cached hard. The
// entry document must NOT be: a client holding a stale index.html loads a stale bundle
// and runs old code against a new API — which is exactly how a fixed defect appears to
// still be broken. index.html is therefore served no-store, with a visible build stamp.
const ROOT = path.resolve(import.meta.dirname, '..');
// DIST_DIR lets a build live elsewhere (used by the tests, and by anyone shipping a
// prebuilt interface from a different location).
const distDir = process.env.DIST_DIR ? path.resolve(process.env.DIST_DIR) : path.join(ROOT, 'dist');
function buildStamp() {
  try {
    const entry = fs.readdirSync(path.join(distDir, 'assets')).find((f) => /^index-.*\.js$/.test(f));
    const mtime = fs.statSync(path.join(distDir, 'index.html')).mtimeMs;
    return { entry: entry || null, builtAt: new Date(mtime).toISOString() };
  } catch {
    return { entry: null, builtAt: null };
  }
}

// dist/ only counts if it actually contains an entry document. A directory left behind by a
// failed or removed build must not shadow a second chance at serving the interface.
const hasBuiltInterface = fs.existsSync(path.join(distDir, 'index.html'));

if (!hasBuiltInterface) {
  // The API works without the interface, but the landing page has to say so in words a human
  // can act on, rather than a JSON 404 that looks like a routing bug.
  const hint = fs.existsSync(path.join(ROOT, 'prebuilt', 'dist', 'index.html'))
    ? 'A prebuilt interface ships with this checkout. Install it with: npm run use-prebuilt'
    : 'Build it with: npm run build   (or run the dev server with: npm run dev)';
  app.get('/', (_req, res) => {
    res.status(503).type('html').send(
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<title>WorkforceIQ — interface not built</title>' +
      '<style>body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;' +
      'max-width:44rem;margin:4rem auto;padding:0 1.5rem;line-height:1.6;color:#1b2230}' +
      'code{background:#eceef2;padding:.15rem .4rem;border-radius:.25rem;font-size:.95em}' +
      'h1{font-size:1.4rem;margin-bottom:.25rem}p{margin:.6rem 0}.hint{background:#eef2ff;' +
      'border-left:3px solid #6366f1;padding:.75rem 1rem;border-radius:.25rem}</style></head>' +
      '<body><h1>The interface is not built</h1>' +
      '<p>The API is running, but no compiled interface was found in <code>dist/</code>.</p>' +
      `<p class="hint">${hint}</p>` +
      '<p>The REST API is unaffected: <code>/api/health</code> responds normally.</p>' +
      '</body></html>',
    );
  });
}

if (hasBuiltInterface) {
  const stamp = buildStamp();

  // Hashed assets: immutable and cacheable for a year.
  app.use('/assets', express.static(path.join(distDir, 'assets'), {
    immutable: true,
    maxAge: '1y',
    fallthrough: true,
  }));

  // Everything else in dist (favicon, etc.) with a short cache.
  app.use(express.static(distDir, { index: false, maxAge: '1h' }));

  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-App-Build', stamp.entry || 'unknown');
    res.sendFile(path.join(distDir, 'index.html'));
  });
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
    console.log(`[api] WorkforceIQ listening on http://localhost:${server.address().port} (${config.env})`);
    console.log(`[api] AI provider: ${config.ai.provider}${config.ai.provider !== 'local' ? ` (${config.ai.model})` : ' (deterministic, grounded)'}`);
    if (!fs.existsSync(path.join(distDir, 'index.html'))) {
      console.warn('[api] No built interface in dist/ — http://localhost:' + server.address().port + ' will explain how to fix that.');
      if (fs.existsSync(path.join(ROOT, 'prebuilt', 'dist', 'index.html'))) {
        console.warn('[api] A prebuilt interface ships with this checkout: run  npm run use-prebuilt');
      } else {
        console.warn('[api] Build it with: npm run build   (or use: npm run dev for hot reload)');
      }
    }
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[api] Port ${port} is already in use — another copy of the app is probably running.`);
      console.error('[api] Start on a different port:  $env:PORT=4001; npm start');
      console.error(`[api] Or find and stop the process:  Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object OwningProcess`);
    } else {
      console.error('[api] Failed to start:', err.message);
    }
    process.exit(1);
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
//
// Do not compare the raw argv[1] string: on Windows it is an absolute path with
// backslashes ("E:\\proj\\server\\index.js"), so endsWith('server/index.js') is false and
// the server exits silently — `npm start` appears to do nothing at all. Compare the
// resolved real paths instead, and never let a detection failure take the process down.
function invokedDirectly() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return fs.realpathSync(path.resolve(entry)) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return /(^|[/\\])server[/\\]index\.js$/i.test(entry);
  }
}

// Importing this module (as the tests do) must not open a port: the caller decides.
if (invokedDirectly()) start();

export { app };
