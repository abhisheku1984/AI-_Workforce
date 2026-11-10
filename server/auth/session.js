import { getDb, now } from '../db/index.js';
import { config } from '../config.js';
import { randomToken, sha256 } from './passwords.js';

export const SESSION_COOKIE = 'wiq_session';

export function createSession({ userId, orgId, ip, userAgent }) {
  const token = randomToken(32);
  const createdAt = now();
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3600 * 1000).toISOString();
  getDb()
    .prepare(
      `INSERT INTO auth_sessions (user_id, token_hash, org_id, ip, user_agent, created_at, expires_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(userId, sha256(token), orgId ?? null, ip || null, userAgent || null, createdAt, expiresAt, createdAt);
  return { token, expiresAt };
}

export function revokeSession(rawToken) {
  if (!rawToken) return;
  getDb()
    .prepare('UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
    .run(now(), sha256(rawToken));
}

export function revokeAllUserSessions(userId, exceptRawToken = null) {
  const db = getDb();
  if (exceptRawToken) {
    db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND token_hash <> ? AND revoked_at IS NULL')
      .run(now(), userId, sha256(exceptRawToken));
  } else {
    db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(now(), userId);
  }
}

/** Loads the authenticated principal (user + org + roles + permissions + scopes). */
export function loadPrincipal(rawToken) {
  if (!rawToken) return null;
  const db = getDb();
  const hash = sha256(rawToken);
  const session = db
    .prepare('SELECT * FROM auth_sessions WHERE token_hash = ? AND revoked_at IS NULL')
    .get(hash);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) return null;

  const user = db
    .prepare(`SELECT id, org_id, email, full_name, title, is_platform_admin, status, must_change_password
              FROM users WHERE id = ?`)
    .get(session.user_id);
  if (!user || user.status !== 'active') return null;

  db.prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?').run(now(), session.id);

  let org = null;
  if (user.org_id) {
    org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(user.org_id) || null;
    if (!org || org.status === 'closed') return null;
  }

  const roleRows = db
    .prepare(
      `SELECT r.id, r.code, r.name, r.permissions, ur.business_unit_id, ur.department_id
       FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?`
    )
    .all(user.id);

  const permissions = new Set();
  for (const r of roleRows) {
    try {
      for (const p of JSON.parse(r.permissions || '[]')) permissions.add(p);
    } catch { /* ignore malformed */ }
  }

  // Data scope: if ANY role assignment is unrestricted (no BU/dept), the user sees all.
  const unrestricted = roleRows.length === 0 || roleRows.some((r) => !r.business_unit_id && !r.department_id);
  const scopedBus = new Set(roleRows.map((r) => r.business_unit_id).filter(Boolean));
  const scopedDepts = new Set(roleRows.map((r) => r.department_id).filter(Boolean));

  const entitlements = user.org_id
    ? db
        .prepare(`SELECT module_code, status, limit_value FROM org_entitlements WHERE org_id = ? AND status IN ('active','trial')`)
        .all(user.org_id)
    : [];

  return {
    sessionId: session.id,
    sessionToken: rawToken,
    user,
    org,
    orgId: user.org_id,
    roles: roleRows.map(({ id, code, name }) => ({ id, code, name })),
    permissions,
    entitlements: new Map(entitlements.map((e) => [e.module_code, e])),
    scope: unrestricted
      ? { restricted: false, businessUnitIds: null, departmentIds: null }
      : {
          restricted: true,
          businessUnitIds: [...scopedBus],
          departmentIds: [...scopedDepts],
        },
    isPlatformAdmin: Boolean(user.is_platform_admin),
  };
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function sessionCookie(token, expiresAt, { clear = false } = {}) {
  const parts = [
    `${SESSION_COOKIE}=${clear ? '' : encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (config.secureCookies) parts.push('Secure');
  parts.push(clear ? 'Max-Age=0' : `Expires=${new Date(expiresAt).toUTCString()}`);
  return parts.join('; ');
}
