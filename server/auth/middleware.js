import { loadPrincipal, parseCookies, SESSION_COOKIE } from './session.js';
import { config } from '../config.js';
import { sendError } from '../lib/http.js';

/** Attaches req.user (principal) if a valid session cookie is present. */
/**
 * Session token extraction.
 *
 * The cookie is the primary transport. A bearer token is also accepted, because some
 * environments (embedded preview frames, browsers with third-party cookies blocked,
 * portals that strip Set-Cookie) do not persist cookies at all. Both carry the same
 * opaque session token, so revocation — sign-out or password change — kills both.
 */
export function sessionTokenFrom(req) {
  const header = String(req.headers.authorization || '');
  const m = /^Bearer\s+([A-Za-z0-9_-]{16,})$/.exec(header);
  if (m) return m[1];
  const cookies = parseCookies(req.headers.cookie || '');
  return cookies[SESSION_COOKIE] || null;
}

export function authenticate(req, _res, next) {
  const token = sessionTokenFrom(req);
  req.sessionTransport = req.headers.authorization ? 'bearer' : (token ? 'cookie' : 'none');
  req.user = token ? loadPrincipal(token) : null;
  if (config.debugAuthHeaders && req.path.startsWith('/auth')) {
    // Evidence for diagnosing "sign-in succeeded but the session did not stick".
    // Header values only — never a cookie value or a password.
    console.log('[auth-debug]', JSON.stringify({
      path: req.path,
      method: req.method,
      host: req.headers.host || null,
      origin: req.headers.origin || null,
      x_forwarded_host: req.headers['x-forwarded-host'] || null,
      x_forwarded_proto: req.headers['x-forwarded-proto'] || null,
      sec_fetch_site: req.headers['sec-fetch-site'] || null,
      sec_fetch_mode: req.headers['sec-fetch-mode'] || null,
      token_transport: req.sessionTransport,
      cookie_present: req.sessionTransport === 'cookie',
      resolved: Boolean(req.user),
    }));
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return sendError(res, 401, 'AUTH_REQUIRED', 'Please sign in to continue.');
  return next();
}

export function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) return sendError(res, 401, 'AUTH_REQUIRED', 'Please sign in to continue.');
    if (req.user.permissions.has(permission) || req.user.isPlatformAdmin) return next();
    return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to perform this action.', {
      required: permission,
    });
  };
}

export function requireAnyPermission(...permissions) {
  return (req, res, next) => {
    if (!req.user) return sendError(res, 401, 'AUTH_REQUIRED', 'Please sign in to continue.');
    if (req.user.isPlatformAdmin || permissions.some((p) => req.user.permissions.has(p))) return next();
    return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to perform this action.', {
      required: permissions,
    });
  };
}

export function requireModule(code) {
  return (req, res, next) => {
    if (!req.user) return sendError(res, 401, 'AUTH_REQUIRED', 'Please sign in to continue.');
    if (req.user.isPlatformAdmin) return next();
    if (req.user.entitlements.has(code)) return next();
    return sendError(res, 403, 'MODULE_NOT_ENABLED', `The ${code} module is not enabled for your organization.`);
  };
}

/**
 * Tenant resolution. The organization is ALWAYS taken from the authenticated user.
 * Platform admins may impersonate a tenant read context via the X-Org-Context header,
 * which is audited separately.
 */
export function tenantContext(req, res, next) {
  if (!req.user) return sendError(res, 401, 'AUTH_REQUIRED', 'Please sign in to continue.');
  const headerOrg = req.headers['x-org-context'];
  if (req.user.isPlatformAdmin && headerOrg) {
    const orgId = Number(headerOrg);
    if (Number.isInteger(orgId)) {
      req.orgId = orgId;
      req.platformImpersonation = true;
      return next();
    }
  }
  if (!req.user.orgId) {
    return sendError(res, 403, 'NO_TENANT', 'This action is not available for platform accounts.');
  }
  req.orgId = req.user.orgId;
  return next();
}

/** Express error wrapper so async handlers surface cleanly. */
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
