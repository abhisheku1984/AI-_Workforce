import express from 'express';
import { getDb, now } from '../db/index.js';
import { ah, requireAuth, requirePermission, tenantContext } from '../auth/middleware.js';
import { requireOrg } from '../lib/guards.js';
import { audit } from '../lib/audit.js';
import { ApiError, ok, paginate } from '../lib/http.js';
import { hashPassword, assertPasswordPolicy, randomToken } from '../auth/passwords.js';
import { ROLE_TEMPLATES, PERMISSIONS, PERMISSION_GROUPS, ALL_PERMISSIONS } from '../auth/permissions.js';
import { getOrgSettings, setOrgSetting } from '../services/onboarding.js';
import { revokeAllUserSessions } from '../auth/session.js';
import { getSubscription, entitlementsFor } from '../services/billing.js';
import { aiConfigured } from '../config.js';

const router = express.Router();
router.use(requireAuth, tenantContext, requireOrg);

/* ------------------------------------------------------------------ profile */
router.get('/organization', requirePermission('org.view'), ah(async (req, res) => {
  const db = getDb();
  const org = db.prepare('SELECT * FROM organizations WHERE id = ?').get(req.orgId);
  const counts = {
    users: db.prepare('SELECT COUNT(*) c FROM users WHERE org_id = ?').get(req.orgId).c,
    employees: db.prepare('SELECT COUNT(*) c FROM employees WHERE org_id = ?').get(req.orgId).c,
    business_units: db.prepare('SELECT COUNT(*) c FROM business_units WHERE org_id = ?').get(req.orgId).c,
    departments: db.prepare('SELECT COUNT(*) c FROM departments WHERE org_id = ?').get(req.orgId).c,
    locations: db.prepare('SELECT COUNT(*) c FROM locations WHERE org_id = ?').get(req.orgId).c,
    projects: db.prepare('SELECT COUNT(*) c FROM projects WHERE org_id = ?').get(req.orgId).c,
  };
  return ok(res, {
    organization: org,
    counts,
    settings: getOrgSettings(req.orgId),
    subscription: getSubscription(req.orgId),
    entitlements: entitlementsFor(req.orgId),
    ai_provider_configured: aiConfigured(),
  });
}));

router.patch('/organization', requirePermission('org.manage'), ah(async (req, res) => {
  const allowed = ['name', 'industry', 'country', 'currency', 'timezone', 'week_start', 'fiscal_start_month', 'data_region'];
  const updates = [];
  const values = [];
  for (const k of allowed) {
    if (req.body[k] !== undefined) { updates.push(`${k} = ?`); values.push(req.body[k]); }
  }
  if (!updates.length) throw new ApiError(400, 'NO_CHANGES', 'No editable fields were supplied.');
  values.push(now(), req.orgId);
  getDb().prepare(`UPDATE organizations SET ${updates.join(', ')}, updated_at = ? WHERE id = ?`).run(...values);
  audit(req, { action: 'org.updated', entityType: 'organization', entityId: req.orgId, summary: 'Organization profile updated', meta: req.body });
  return ok(res, { updated: true });
}));

router.put('/settings/:key', requirePermission('org.manage'), ah(async (req, res) => {
  const key = String(req.params.key);
  if (!['utilization', 'cost', 'ai', 'data', 'notifications', 'branding'].includes(key)) {
    throw new ApiError(400, 'UNKNOWN_SETTING', 'Unknown settings group.');
  }
  if (key === 'ai' && req.body.external_model_allowed === true) {
    // Enabling external AI is a governance decision that requires platform configuration.
    const cfg = (process.env.AI_PROVIDER || 'local').toLowerCase();
    if (cfg === 'local') {
      throw new ApiError(
        400, 'AI_NOT_CONFIGURED',
        'An external AI provider is not configured for this deployment. Set AI_PROVIDER, AI_BASE_URL, AI_MODEL and AI_API_KEY on the server, then enable this setting.'
      );
    }
  }
  setOrgSetting(req.orgId, key, req.body, req.user.user.id);
  audit(req, { action: 'org.settings.updated', entityType: 'organization', entityId: req.orgId, summary: `Settings "${key}" updated`, meta: req.body });
  return ok(res, { settings: getOrgSettings(req.orgId)[key] });
}));

/* ---------------------------------------------------- business units / departments / locations */
router.get('/structure', requirePermission('org.view'), ah(async (req, res) => {
  const db = getDb();
  const bus = db.prepare('SELECT * FROM business_units WHERE org_id = ? ORDER BY name').all(req.orgId);
  const depts = db.prepare(`SELECT d.*, b.name AS business_unit_name FROM departments d
      LEFT JOIN business_units b ON b.id = d.business_unit_id WHERE d.org_id = ? ORDER BY d.name`).all(req.orgId);
  const locations = db.prepare('SELECT * FROM locations WHERE org_id = ? ORDER BY name').all(req.orgId);
  return ok(res, { business_units: bus, departments: depts, locations });
}));

router.post('/business-units', requirePermission('org.manage'), ah(async (req, res) => {
  const { name, code, leader } = req.body || {};
  if (!name || !code) throw new ApiError(400, 'VALIDATION_FAILED', 'Name and code are required.');
  const db = getDb();
  if (db.prepare('SELECT 1 FROM business_units WHERE org_id = ? AND code = ?').get(req.orgId, code)) {
    throw new ApiError(409, 'DUPLICATE_CODE', 'A business unit with that code already exists.');
  }
  const id = db.prepare('INSERT INTO business_units (org_id, name, code, leader, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(req.orgId, name, code, leader ?? null, now()).lastInsertRowid;
  audit(req, { action: 'business_unit.created', entityType: 'business_unit', entityId: id, summary: `Business unit ${name} created` });
  return ok(res, { id });
}));

router.post('/departments', requirePermission('org.manage'), ah(async (req, res) => {
  const { name, code, business_unit_id, cost_center } = req.body || {};
  if (!name || !code) throw new ApiError(400, 'VALIDATION_FAILED', 'Name and code are required.');
  const db = getDb();
  if (business_unit_id && !db.prepare('SELECT 1 FROM business_units WHERE id = ? AND org_id = ?').get(business_unit_id, req.orgId)) {
    throw new ApiError(400, 'INVALID_BUSINESS_UNIT', 'That business unit does not belong to your organization.');
  }
  const id = db.prepare('INSERT INTO departments (org_id, business_unit_id, name, code, cost_center, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.orgId, business_unit_id ?? null, name, code, cost_center ?? null, now()).lastInsertRowid;
  audit(req, { action: 'department.created', entityType: 'department', entityId: id, summary: `Department ${name} created` });
  return ok(res, { id });
}));

router.post('/locations', requirePermission('org.manage'), ah(async (req, res) => {
  const { name, country, timezone, hours_per_day, working_days, holidays } = req.body || {};
  if (!name) throw new ApiError(400, 'VALIDATION_FAILED', 'Location name is required.');
  const hpd = Number(hours_per_day ?? 8);
  if (hpd <= 0 || hpd > 24) throw new ApiError(400, 'VALIDATION_FAILED', 'Hours per day must be between 1 and 24.');
  const db = getDb();
  if (db.prepare('SELECT 1 FROM locations WHERE org_id = ? AND name = ?').get(req.orgId, name)) {
    throw new ApiError(409, 'DUPLICATE_LOCATION', 'A location with that name already exists.');
  }
  const id = db.prepare(`INSERT INTO locations (org_id, name, country, timezone, hours_per_day, working_days, holidays, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.orgId, name, country ?? 'IN', timezone ?? 'Asia/Kolkata', hpd,
      JSON.stringify(working_days ?? [1, 2, 3, 4, 5]), JSON.stringify(holidays ?? []), now()).lastInsertRowid;
  audit(req, { action: 'location.created', entityType: 'location', entityId: id, summary: `Location ${name} created` });
  return ok(res, { id });
}));

router.patch('/locations/:id', requirePermission('org.manage'), ah(async (req, res) => {
  const db = getDb();
  const loc = db.prepare('SELECT * FROM locations WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!loc) throw new ApiError(404, 'NOT_FOUND', 'Location not found.');
  const { hours_per_day, working_days, holidays, timezone } = req.body || {};
  if (working_days && (!Array.isArray(working_days) || working_days.some((d) => d < 0 || d > 6))) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Working days must be an array of weekday numbers 0–6.');
  }
  if (holidays && (!Array.isArray(holidays) || holidays.some((h) => !/^\d{4}-\d{2}-\d{2}$/.test(h)))) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Holidays must be ISO dates (YYYY-MM-DD).');
  }
  db.prepare(`UPDATE locations SET hours_per_day = ?, working_days = ?, holidays = ?, timezone = ? WHERE id = ?`)
    .run(hours_per_day ?? loc.hours_per_day,
      JSON.stringify(working_days ?? JSON.parse(loc.working_days)),
      JSON.stringify(holidays ?? JSON.parse(loc.holidays)),
      timezone ?? loc.timezone, loc.id);
  audit(req, { action: 'location.updated', entityType: 'location', entityId: loc.id, summary: `Location ${loc.name} updated` });
  return ok(res, { updated: true });
}));

/* ------------------------------------------------------------------ users */
router.get('/users', requirePermission('user.view'), ah(async (req, res) => {
  const db = getDb();
  const users = db.prepare(`SELECT id, email, full_name, title, status, is_platform_admin, last_login_at, created_at, must_change_password
      FROM users WHERE org_id = ? ORDER BY full_name`).all(req.orgId);
  const roles = db.prepare(`SELECT ur.user_id, r.id, r.code, r.name, ur.business_unit_id, ur.department_id
      FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.org_id = ?`).all(req.orgId);
  const byUser = new Map();
  for (const r of roles) {
    if (!byUser.has(r.user_id)) byUser.set(r.user_id, []);
    byUser.get(r.user_id).push(r);
  }
  const db2 = db.prepare('SELECT id, name FROM business_units WHERE org_id = ?').all(req.orgId);
  const dd = db.prepare('SELECT id, name FROM departments WHERE org_id = ?').all(req.orgId);
  const buNames = new Map(db2.map((b) => [b.id, b.name]));
  const deptNames = new Map(dd.map((d) => [d.id, d.name]));
  return ok(res, users.map((u) => ({
    ...u,
    roles: (byUser.get(u.id) || []).map((r) => ({
      ...r,
      business_unit_name: r.business_unit_id ? buNames.get(r.business_unit_id) : null,
      department_name: r.department_id ? deptNames.get(r.department_id) : null,
    })),
  })));
}));

router.post('/users', requirePermission('user.manage'), ah(async (req, res) => {
  const { email, full_name, title, roleCode = 'viewer', business_unit_id = null, department_id = null } = req.body || {};
  if (!email || !full_name) throw new ApiError(400, 'VALIDATION_FAILED', 'Email and full name are required.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new ApiError(400, 'VALIDATION_FAILED', 'Enter a valid email address.');
  const db = getDb();
  if (db.prepare('SELECT 1 FROM users WHERE LOWER(email) = LOWER(?)').get(email)) {
    throw new ApiError(409, 'EMAIL_TAKEN', 'A user with that email already exists.');
  }
  const role = db.prepare('SELECT * FROM roles WHERE org_id = ? AND code = ?').get(req.orgId, roleCode);
  if (!role) throw new ApiError(400, 'UNKNOWN_ROLE', 'That role does not exist for this organization.');
  if (business_unit_id && !db.prepare('SELECT 1 FROM business_units WHERE id = ? AND org_id = ?').get(business_unit_id, req.orgId)) {
    throw new ApiError(400, 'INVALID_SCOPE', 'Business unit does not belong to this organization.');
  }
  if (department_id && !db.prepare('SELECT 1 FROM departments WHERE id = ? AND org_id = ?').get(department_id, req.orgId)) {
    throw new ApiError(400, 'INVALID_SCOPE', 'Department does not belong to this organization.');
  }
  const tempPassword = randomToken(9) + 'Aa1!';
  assertPasswordPolicy(tempPassword);
  const hash = await hashPassword(tempPassword);
  const ts = now();
  const id = db.prepare(`INSERT INTO users (org_id, email, full_name, title, password_hash, status, must_change_password, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?)`)
    .run(req.orgId, email.toLowerCase(), full_name, title ?? null, hash, ts, ts).lastInsertRowid;
  db.prepare('INSERT INTO user_roles (user_id, role_id, business_unit_id, department_id, assigned_at) VALUES (?, ?, ?, ?, ?)')
    .run(id, role.id, business_unit_id, department_id, ts);
  audit(req, { action: 'user.created', entityType: 'user', entityId: id, summary: `User ${email} created with role ${roleCode}`, meta: { business_unit_id, department_id } });
  return ok(res, { id, temporaryPassword: tempPassword });
}));

router.patch('/users/:id', requirePermission('user.manage'), ah(async (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found.');
  if (user.id === req.user.user.id && req.body.status && req.body.status !== 'active') {
    throw new ApiError(400, 'SELF_LOCKOUT', 'You cannot suspend your own account.');
  }
  const { full_name, title, status } = req.body || {};
  if (status && !['active', 'invited', 'suspended'].includes(status)) throw new ApiError(400, 'VALIDATION_FAILED', 'Invalid status.');
  db.prepare('UPDATE users SET full_name = ?, title = ?, status = ?, updated_at = ? WHERE id = ?')
    .run(full_name ?? user.full_name, title ?? user.title, status ?? user.status, now(), user.id);
  if (status === 'suspended') revokeAllUserSessions(user.id);
  audit(req, { action: 'user.updated', entityType: 'user', entityId: user.id, summary: `User ${user.email} updated`, meta: req.body });
  return ok(res, { updated: true });
}));

router.put('/users/:id/roles', requirePermission('user.manage'), ah(async (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found.');
  const assignments = Array.isArray(req.body?.assignments) ? req.body.assignments : null;
  if (!assignments) throw new ApiError(400, 'VALIDATION_FAILED', 'assignments[] is required.');
  const ts = now();
  const validated = [];
  for (const a of assignments) {
    const role = db.prepare('SELECT * FROM roles WHERE id = ? AND org_id = ?').get(a.role_id, req.orgId);
    if (!role) throw new ApiError(400, 'UNKNOWN_ROLE', `Role ${a.role_id} does not belong to this organization.`);
    if (a.business_unit_id && !db.prepare('SELECT 1 FROM business_units WHERE id = ? AND org_id = ?').get(a.business_unit_id, req.orgId)) {
      throw new ApiError(400, 'INVALID_SCOPE', 'Business unit does not belong to this organization.');
    }
    if (a.department_id && !db.prepare('SELECT 1 FROM departments WHERE id = ? AND org_id = ?').get(a.department_id, req.orgId)) {
      throw new ApiError(400, 'INVALID_SCOPE', 'Department does not belong to this organization.');
    }
    validated.push(a);
  }
  const run = db.transaction(() => {
    db.prepare('DELETE FROM user_roles WHERE user_id = ?').run(user.id);
    for (const a of validated) {
      db.prepare('INSERT INTO user_roles (user_id, role_id, business_unit_id, department_id, assigned_at) VALUES (?, ?, ?, ?, ?)')
        .run(user.id, a.role_id, a.business_unit_id ?? null, a.department_id ?? null, ts);
    }
  });
  run();
  revokeAllUserSessions(user.id);
  audit(req, { action: 'user.roles.updated', entityType: 'user', entityId: user.id, summary: `Roles updated for ${user.email}`, meta: validated });
  return ok(res, { updated: true });
}));

router.post('/users/:id/reset-password', requirePermission('user.manage'), ah(async (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!user) throw new ApiError(404, 'NOT_FOUND', 'User not found.');
  const tempPassword = randomToken(9) + 'Aa1!';
  const hash = await hashPassword(tempPassword);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, failed_logins = 0, locked_until = NULL, updated_at = ? WHERE id = ?')
    .run(hash, now(), user.id);
  revokeAllUserSessions(user.id);
  audit(req, { action: 'user.password_reset', entityType: 'user', entityId: user.id, summary: `Password reset for ${user.email}` });
  return ok(res, { temporaryPassword: tempPassword });
}));

/* ------------------------------------------------------------------ roles */
router.get('/roles', requirePermission('user.view'), ah(async (req, res) => {
  const db = getDb();
  const roles = db.prepare('SELECT * FROM roles WHERE org_id = ? ORDER BY is_system DESC, name').all(req.orgId)
    .map((r) => ({ ...r, permissions: JSON.parse(r.permissions), user_count: db.prepare('SELECT COUNT(DISTINCT user_id) c FROM user_roles WHERE role_id = ?').get(r.id).c }));
  return ok(res, {
    roles,
    permissionCatalogue: PERMISSIONS,
    permissionGroups: PERMISSION_GROUPS,
    templates: ROLE_TEMPLATES,
  });
}));

router.post('/roles', requirePermission('role.manage'), ah(async (req, res) => {
  const { code, name, description, permissions = [], basedOn = null } = req.body || {};
  if (!name) throw new ApiError(400, 'VALIDATION_FAILED', 'Role name is required.');
  const db = getDb();
  const derivedCode = code || name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 40);
  if (db.prepare('SELECT 1 FROM roles WHERE org_id = ? AND code = ?').get(req.orgId, derivedCode)) {
    throw new ApiError(409, 'DUPLICATE_ROLE', 'A role with that code already exists.');
  }
  let perms = permissions;
  if (basedOn) {
    const tmpl = ROLE_TEMPLATES.find((t) => t.code === basedOn);
    if (!tmpl) throw new ApiError(400, 'UNKNOWN_TEMPLATE', 'Template not found.');
    perms = tmpl.permissions;
  }
  const invalid = perms.filter((p) => !ALL_PERMISSIONS.includes(p));
  if (invalid.length) throw new ApiError(400, 'INVALID_PERMISSION', `Unknown permission(s): ${invalid.join(', ')}`);
  const id = db.prepare('INSERT INTO roles (org_id, code, name, description, permissions, is_system, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)')
    .run(req.orgId, derivedCode, name, description ?? null, JSON.stringify(perms), now()).lastInsertRowid;
  audit(req, { action: 'role.created', entityType: 'role', entityId: id, summary: `Role ${name} created`, meta: { permissions: perms } });
  return ok(res, { id, code: derivedCode });
}));

router.put('/roles/:id', requirePermission('role.manage'), ah(async (req, res) => {
  const db = getDb();
  const role = db.prepare('SELECT * FROM roles WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!role) throw new ApiError(404, 'NOT_FOUND', 'Role not found.');
  const perms = req.body?.permissions;
  if (!Array.isArray(perms)) throw new ApiError(400, 'VALIDATION_FAILED', 'permissions[] is required.');
  const invalid = perms.filter((p) => !ALL_PERMISSIONS.includes(p));
  if (invalid.length) throw new ApiError(400, 'INVALID_PERMISSION', `Unknown permission(s): ${invalid.join(', ')}`);
  if (role.code === 'org_admin' && !perms.includes('user.manage')) {
    throw new ApiError(400, 'ADMIN_LOCKOUT', 'The Organization Administrator role must keep user management permission to avoid locking everyone out.');
  }
  db.prepare('UPDATE roles SET name = ?, description = ?, permissions = ? WHERE id = ?')
    .run(req.body.name ?? role.name, req.body.description ?? role.description, JSON.stringify(perms), role.id);
  audit(req, { action: 'role.updated', entityType: 'role', entityId: role.id, summary: `Role ${role.name} permissions updated`, meta: { permissions: perms } });
  return ok(res, { updated: true });
}));

/* ------------------------------------------------------------------ audit + modules */
router.get('/audit', requirePermission('audit.view'), ah(async (req, res) => {
  const { limit, offset } = paginate(req.query, 100, 500);
  const db = getDb();
  const where = ['org_id = ?'];
  const params = [req.orgId];
  if (req.query.action) { where.push('action LIKE ?'); params.push(`%${req.query.action}%`); }
  if (req.query.actor) { where.push('actor_email LIKE ?'); params.push(`%${req.query.actor}%`); }
  const rows = db.prepare(`SELECT * FROM audit_events WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) c FROM audit_events WHERE ${where.join(' AND ')}`).get(...params).c;
  return ok(res, rows, { total, limit, offset });
}));

router.get('/ai-audit', requirePermission('audit.view'), ah(async (req, res) => {
  const rows = getDb().prepare(`SELECT * FROM ai_audit_events WHERE org_id = ? ORDER BY created_at DESC LIMIT 200`).all(req.orgId);
  return ok(res, rows);
}));

router.get('/modules', requirePermission('org.view'), ah(async (req, res) => {
  const db = getDb();
  const all = db.prepare('SELECT * FROM modules ORDER BY sort_order').all();
  const ent = new Map(db.prepare('SELECT module_code, status, limit_value FROM org_entitlements WHERE org_id = ?').all(req.orgId).map((e) => [e.module_code, e]));
  const catalogue = all.map((m) => ({ ...m, entitlement: ent.get(m.code) || null, enabled: Boolean(ent.get(m.code)) }));
  return ok(res, { modules: catalogue, subscription: getSubscription(req.orgId), entitlements: entitlementsFor(req.orgId) });
}));

router.get('/data-retention', requirePermission('org.manage'), ah(async (req, res) => {
  const db = getDb();
  const imports = db.prepare(`SELECT id, entity_type, filename, size_bytes, created_at, status FROM imports WHERE org_id = ? ORDER BY created_at DESC`).all(req.orgId);
  const settings = getOrgSettings(req.orgId);
  const requests = db.prepare(`SELECT * FROM deletion_requests WHERE org_id = ? ORDER BY created_at DESC`).all(req.orgId);
  return ok(res, { imports, settings: settings.data || {}, deletion_requests: requests });
}));

export default router;
