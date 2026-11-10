import express from 'express';
import { getDb, now } from '../db/index.js';
import { hashPassword, verifyPassword, assertPasswordPolicy, randomToken } from '../auth/passwords.js';
import { createSession, revokeSession, sessionCookie, SESSION_COOKIE, revokeAllUserSessions, parseCookies } from '../auth/session.js';
import { config } from '../config.js';
import { requireAuth, ah } from '../auth/middleware.js';
import { audit } from '../lib/audit.js';
import { ApiError, ok } from '../lib/http.js';
import { ROLE_TEMPLATES, PERMISSIONS } from '../auth/permissions.js';
import { seedOrgDefaults } from '../services/onboarding.js';

const router = express.Router();

const MAX_FAILED = 6;
const LOCK_MINUTES = 15;

router.post('/login', ah(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) throw new ApiError(400, 'VALIDATION_FAILED', 'Email and password are required.');
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(String(email).trim());

  // Constant-ish response to avoid account enumeration.
  const fail = () => {
    audit(req, { action: 'auth.login.failed', entityType: 'user', entityId: user?.id, summary: `Failed sign-in for ${email}`, orgId: user?.org_id });
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  };

  if (!user) {
    await verifyPassword(String(password), 'scrypt$16384$8$1$AAAA$AAAA'); // burn time
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  }
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new ApiError(423, 'ACCOUNT_LOCKED', 'This account is temporarily locked after repeated failed sign-ins. Try again later.');
  }
  if (user.status !== 'active') throw new ApiError(403, 'ACCOUNT_INACTIVE', 'This account is not active. Contact your administrator.');

  const valid = await verifyPassword(String(password), user.password_hash);
  if (!valid) {
    const failed = user.failed_logins + 1;
    const lock = failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : null;
    db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : failed, lock, user.id);
    fail();
  }

  if (user.org_id) {
    const org = db.prepare('SELECT status FROM organizations WHERE id = ?').get(user.org_id);
    if (!org || org.status !== 'active') throw new ApiError(403, 'ORG_INACTIVE', 'This organisation is not active.');
  }

  db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?').run(now(), user.id);
  const { token, expiresAt } = createSession({ userId: user.id, orgId: user.org_id, ip: req.ip, userAgent: req.headers['user-agent'] });
  res.setHeader('Set-Cookie', sessionCookie(token, expiresAt, { req }));
  audit(req, { action: 'auth.login', entityType: 'user', entityId: user.id, summary: `${user.email} signed in`, orgId: user.org_id });
  return ok(res, { expiresAt, mustChangePassword: Boolean(user.must_change_password) });
}));

router.post('/logout', ah(async (req, res) => {
  const cookies = req.headers.cookie || '';
  const m = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(cookies);
  if (m) revokeSession(decodeURIComponent(m[1]));
  if (req.user) audit(req, { action: 'auth.logout', entityType: 'user', entityId: req.user.user.id, summary: `${req.user.user.email} signed out` });
  res.setHeader('Set-Cookie', sessionCookie('', new Date(0), { clear: true, req }));
  return ok(res, { signedOut: true });
}));

/** Headers that tell a diagnosing administrator (or the user) why a session did not stick. */
function sessionDiagnostics(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return {
    cookie_present: Boolean(cookies[SESSION_COOKIE]),
    cookie_secure: config.secureCookies,
    https_detected: req.secure || req.headers['x-forwarded-proto'] === 'https',
  };
}

router.get('/me', ah(async (req, res) => {
  if (!req.user) {
    // A session cookie that arrives but does not resolve means the session expired, was
    // revoked, or the cookie belongs to a different deployment. Say so, rather than
    // silently returning an anonymous principal and bouncing the user back to sign-in
    // with no explanation.
    const diag = sessionDiagnostics(req);
    return ok(res, {
      user: null,
      reason: diag.cookie_present ? 'SESSION_NOT_RECOGNISED' : 'NO_SESSION_COOKIE',
      diagnostics: diag,
    });
  }
  const p = req.user;
  const db = getDb();
  const notifications = db.prepare(`SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read_at IS NULL`).get(p.user.id).c;
  const org = p.org ? {
    id: p.org.id, name: p.org.name, slug: p.org.slug, industry: p.org.industry, country: p.org.country,
    currency: p.org.currency, timezone: p.org.timezone, fiscal_start_month: p.org.fiscal_start_month,
  } : null;
  const modules = [...p.entitlements.entries()].map(([code, e]) => ({ code, status: e.status }));

  const permissionList = [...p.permissions].sort();
  return ok(res, {
    user: {
      id: p.user.id, email: p.user.email, full_name: p.user.full_name, title: p.user.title,
      isPlatformAdmin: p.isPlatformAdmin, mustChangePassword: Boolean(p.user.must_change_password),
    },
    roles: p.roles,
    permissions: permissionList,
    scopes: p.scope,
    org,
    modules,
    notifications,
    platform: { environment: process.env.NODE_ENV || 'development', aiMode: (process.env.AI_PROVIDER || 'local').toLowerCase() },
  });
}));

router.post('/change-password', requireAuth, ah(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.user.id);
  const valid = await verifyPassword(String(currentPassword || ''), user.password_hash);
  if (!valid) throw new ApiError(400, 'INVALID_PASSWORD', 'Your current password is incorrect.');
  if (currentPassword === newPassword) throw new ApiError(400, 'SAME_PASSWORD', 'Choose a password different from the current one.');
  const hash = await hashPassword(newPassword);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?').run(hash, now(), user.id);
  revokeAllUserSessions(user.id, req.user.sessionToken);
  audit(req, { action: 'auth.password_changed', entityType: 'user', entityId: user.id, summary: `${user.email} changed their password` });
  return ok(res, { changed: true });
}));

router.get('/permission-catalogue', requireAuth, ah(async (_req, res) => ok(res, {
  permissions: PERMISSIONS, roles: ROLE_TEMPLATES,
})));

/** Create a new customer organization + first administrator (platform admin only). */
router.post('/register-org', requireAuth, ah(async (req, res) => {
  if (!req.user.isPlatformAdmin) throw new ApiError(403, 'FORBIDDEN', 'Only platform administrators can create organizations.');
  const { orgName, slug, industry, country, currency, adminEmail, adminName, planCode = 'professional', modules = [], seats = 10 } = req.body || {};
  if (!orgName || !slug || !adminEmail || !adminName) throw new ApiError(400, 'VALIDATION_FAILED', 'orgName, slug, adminEmail and adminName are required.');
  const db = getDb();
  if (db.prepare('SELECT 1 FROM organizations WHERE slug = ?').get(slug)) throw new ApiError(409, 'SLUG_TAKEN', 'That organisation URL slug is already in use.');
  if (db.prepare('SELECT 1 FROM users WHERE LOWER(email) = LOWER(?)').get(adminEmail)) throw new ApiError(409, 'EMAIL_TAKEN', 'A user with that email already exists.');

  const ts = now();
  const orgId = db.prepare(`INSERT INTO organizations (name, slug, industry, country, currency, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(orgName, slug, industry ?? null, country ?? 'IN', currency ?? 'INR', ts, ts).lastInsertRowid;
  seedOrgDefaults(orgId, { modules, planCode, seats });

  const tempPassword = req.body.tempPassword || randomToken(12);
  assertPasswordPolicy(tempPassword);
  const hash = await hashPassword(tempPassword);
  const userId = db.prepare(`INSERT INTO users (org_id, email, full_name, title, password_hash, status, must_change_password, created_at, updated_at)
      VALUES (?, ?, ?, 'Organization Administrator', ?, 'active', 1, ?, ?)`)
    .run(orgId, String(adminEmail).toLowerCase(), adminName, hash, ts, ts).lastInsertRowid;
  const roleId = db.prepare('SELECT id FROM roles WHERE org_id = ? AND code = ?').get(orgId, 'org_admin').id;
  db.prepare('INSERT INTO user_roles (user_id, role_id, assigned_at) VALUES (?, ?, ?)').run(userId, roleId, ts);

  audit(req, { action: 'org.created', entityType: 'organization', entityId: orgId, summary: `Created organization ${orgName}`, orgId });
  return ok(res, { orgId, adminUserId: userId, temporaryPassword: tempPassword, mustChangePassword: true });
}));

export default router;
