/**
 * Environment + platform configuration.
 * Secrets are read ONLY from environment variables (never hardcoded).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadDotEnv();

const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const uploadsDir = path.join(dataDir, 'uploads');
const exportsDir = path.join(dataDir, 'exports');
for (const d of [dataDir, uploadsDir, exportsDir]) fs.mkdirSync(d, { recursive: true });

const isProd = process.env.NODE_ENV === 'production';

/**
 * Session secret handling:
 *  - In production a real secret MUST be supplied (SESSION_SECRET).
 *  - In development a local secret file is generated once so sessions survive restarts.
 */
function resolveSessionSecret() {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 32) return process.env.SESSION_SECRET;
  const file = path.join(dataDir, '.dev-session-secret');
  if (isProd) {
    throw new Error(
      'SESSION_SECRET (min 32 chars) is required in production. Generate one with: openssl rand -hex 32'
    );
  }
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export const config = {
  env: isProd ? 'production' : 'development',
  isProd,
  port: Number(process.env.PORT || 4000),
  dataDir,
  uploadsDir,
  exportsDir,
  dbFile: process.env.DB_FILE ? path.resolve(process.env.DB_FILE) : path.join(dataDir, 'workforceiq.db'),
  sessionSecret: resolveSessionSecret(),
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS || 12),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB || 20) * 1024 * 1024,
  allowedUploadTypes: ['.csv', '.xlsx', '.xls'],
  /**
   * AI provider switch. The platform ships with a grounded, deterministic
   * analytics engine ("local") that never fabricates figures. An external LLM can
   * be enabled ONLY by explicit configuration, and only aggregate/authorized facts
   * are ever sent to it.
   */
  ai: {
    provider: (process.env.AI_PROVIDER || 'local').toLowerCase(),
    model: process.env.AI_MODEL || '',
    apiKey: process.env.AI_API_KEY || '',
    baseUrl: process.env.AI_BASE_URL || '',
    allowEmployeeNames: process.env.AI_ALLOW_EMPLOYEE_NAMES === 'true',
    timeoutMs: Number(process.env.AI_TIMEOUT_MS || 20000),
    maxFactsChars: 12000,
  },
  trustProxy: process.env.TRUST_PROXY === 'true',
  /**
   * Whether the app may be rendered inside an iframe.
   *
   * Preview/tunnel environments and many enterprise portals embed the app in a frame.
   * Helmet's default `X-Frame-Options: SAMEORIGIN` blocks that, which looks exactly like
   * "I cannot log in": sign-in succeeds server-side but the framed page cannot keep the
   * session. Production defaults to not embeddable (clickjacking protection); set
   * ALLOW_FRAME_EMBEDDING=true for a deployment that must be embedded.
   */
  allowFrameEmbedding: process.env.ALLOW_FRAME_EMBEDDING
    ? process.env.ALLOW_FRAME_EMBEDDING === 'true'
    : !isProd,
  /** Cookies are marked Secure only over HTTPS. Plain-HTTP previews would silently drop them. */
  secureCookies: process.env.INSECURE_COOKIES === 'true' ? false : isProd,
  /**
   * SameSite policy for the session cookie.
   *
   * 'lax' (default) is correct for a normal same-origin deployment and gives real CSRF
   * protection. 'none' is required when the app runs inside a cross-site frame (previews,
   * portals, embedded dashboards): a Lax cookie is simply NOT SENT on a cross-site
   * subresource request, so sign-in appears to succeed and the next request arrives
   * unauthenticated. 'none' requires Secure, which is applied automatically whenever the
   * request arrived over HTTPS (browsers reject SameSite=None without Secure).
   */
  cookieSameSite: (process.env.COOKIE_SAMESITE || 'lax').toLowerCase() === 'none' ? 'none' : 'lax',
  /** Log authentication request headers so a cookie problem can be diagnosed from evidence. */
  debugAuthHeaders: process.env.DEBUG_AUTH_HEADERS === 'true',
  demoMode: process.env.DEMO_MODE !== 'false',
};

export function aiConfigured() {
  return config.ai.provider !== 'local' && Boolean(config.ai.apiKey && config.ai.baseUrl && config.ai.model);
}
