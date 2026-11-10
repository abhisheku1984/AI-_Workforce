import express from 'express';
import { getDb, now } from '../db/index.js';
import { ah, requireAuth, requirePermission, tenantContext } from '../auth/middleware.js';
import { requireOrg } from '../lib/guards.js';
import { audit } from '../lib/audit.js';
import { ApiError, ok, paginate } from '../lib/http.js';
import { employeeScopeSql, maySeeCost, loadScopeEmployees } from '../services/scope.js';
import { standardWeeklyHours, round } from '../lib/capacity.js';

const router = express.Router();
router.use(requireAuth, tenantContext, requireOrg);

const COST_FIELDS = ['annual_cost', 'cost_currency', 'bill_rate_hour', 'annual_bill_rate'];

/** Removes cost fields for users without cost permission. Never rely on the UI for this. */
function redactCost(principal, row) {
  if (maySeeCost(principal)) return row;
  const copy = { ...row };
  for (const f of COST_FIELDS) { if (f in copy) copy[f] = null; }
  copy.cost_redacted = true;
  return copy;
}

router.get('/', requirePermission('workforce.view'), ah(async (req, res) => {
  const db = getDb();
  const { limit, offset } = paginate(req.query, 100, 1000);
  const params = {};
  const where = [employeeScopeSql(req.user, params, 'e')];
  if (req.query.q) {
    where.push('(e.full_name LIKE @q OR e.employee_code LIKE @q OR e.email LIKE @q)');
    params.q = `%${String(req.query.q).slice(0, 60)}%`;
  }
  if (req.query.department_id) { where.push('e.department_id = @dept'); params.dept = Number(req.query.department_id); }
  if (req.query.business_unit_id) { where.push('e.business_unit_id = @bu'); params.bu = Number(req.query.business_unit_id); }
  if (req.query.location_id) { where.push('e.location_id = @loc'); params.loc = Number(req.query.location_id); }
  if (req.query.status) { where.push('e.status = @st'); params.st = req.query.status; }

  const sql = `SELECT e.*, d.name AS department, b.name AS business_unit, l.name AS location, m.full_name AS manager_name
      FROM employees e LEFT JOIN departments d ON d.id = e.department_id
      LEFT JOIN business_units b ON b.id = e.business_unit_id
      LEFT JOIN locations l ON l.id = e.location_id
      LEFT JOIN employees m ON m.id = e.manager_id
      WHERE ${where.join(' AND ')} ORDER BY e.full_name LIMIT ${limit} OFFSET ${offset}`;
  const rows = db.prepare(sql).all(params);
  const total = db.prepare(`SELECT COUNT(*) c FROM employees e WHERE ${where.join(' AND ')}`).get(params).c;

  const skillRows = db.prepare(`SELECT es.employee_id, es.proficiency, s.name FROM employee_skills es
      JOIN skills s ON s.id = es.skill_id WHERE es.org_id = ?`).all(req.orgId);
  const skillsByEmp = new Map();
  for (const s of skillRows) {
    if (!skillsByEmp.has(s.employee_id)) skillsByEmp.set(s.employee_id, []);
    skillsByEmp.get(s.employee_id).push({ name: s.name, proficiency: s.proficiency });
  }

  const locations = new Map(db.prepare('SELECT * FROM locations WHERE org_id = ?').all(req.orgId).map((l) => [l.id, l]));
  return ok(res, rows.map((r) => ({
    ...redactCost(req.user, r),
    skills: skillsByEmp.get(r.id) || [],
    standard_weekly_hours: round(standardWeeklyHours(r, locations.get(r.location_id))),
  })), { total, limit, offset });
}));

router.get('/:id', requirePermission('workforce.view'), ah(async (req, res) => {
  const db = getDb();
  const params = {};
  const where = [employeeScopeSql(req.user, params, 'e'), 'e.id = @id'];
  params.id = Number(req.params.id);
  const emp = db.prepare(`SELECT e.*, d.name AS department, b.name AS business_unit, l.name AS location
      FROM employees e LEFT JOIN departments d ON d.id = e.department_id
      LEFT JOIN business_units b ON b.id = e.business_unit_id
      LEFT JOIN locations l ON l.id = e.location_id
      WHERE ${where.join(' AND ')}`).get(params);
  if (!emp) throw new ApiError(404, 'NOT_FOUND', 'Employee not found or outside your data scope.');
  const skills = db.prepare(`SELECT es.*, s.name FROM employee_skills es JOIN skills s ON s.id = es.skill_id WHERE es.employee_id = ?`).all(emp.id);
  const allocations = db.prepare(`SELECT a.*, p.code AS project_code, p.name AS project_name FROM allocations a
      LEFT JOIN projects p ON p.id = a.project_id WHERE a.employee_id = ? AND a.status <> 'cancelled' ORDER BY a.start_date DESC`).all(emp.id);
  const timesheetSummary = db.prepare(`SELECT work_date, SUM(hours) hours FROM timesheets WHERE employee_id = ?
      GROUP BY work_date ORDER BY work_date DESC LIMIT 60`).all(emp.id);
  const versions = db.prepare(`SELECT version, change_type, changed_at, snapshot FROM record_versions
      WHERE org_id = ? AND entity_type = 'employee' AND entity_id = ? ORDER BY version DESC LIMIT 20`).all(req.orgId, emp.id);
  audit(req, { action: 'employee.view', entityType: 'employee', entityId: emp.id, summary: `Viewed employee ${emp.employee_code}` });
  return ok(res, {
    employee: redactCost(req.user, emp),
    skills, allocations, timesheetSummary,
    history: maySeeCost(req.user) ? versions.map((v) => ({ ...v, snapshot: JSON.parse(v.snapshot) })) : versions.map((v) => ({ version: v.version, change_type: v.change_type, changed_at: v.changed_at })),
  });
}));

router.post('/', requirePermission('workforce.manage'), ah(async (req, res) => {
  const db = getDb();
  const b = req.body || {};
  if (!b.employee_code || !b.full_name) throw new ApiError(400, 'VALIDATION_FAILED', 'Employee code and full name are required.');
  if (db.prepare('SELECT 1 FROM employees WHERE org_id = ? AND employee_code = ?').get(req.orgId, b.employee_code)) {
    throw new ApiError(409, 'DUPLICATE_CODE', 'An employee with that code already exists.');
  }
  for (const [field, table] of [['department_id', 'departments'], ['business_unit_id', 'business_units'], ['location_id', 'locations']]) {
    if (b[field] && !db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND org_id = ?`).get(b[field], req.orgId)) {
      throw new ApiError(400, 'INVALID_REFERENCE', `${field} does not belong to this organization.`);
    }
  }
  if (!maySeeCost(req.user) && COST_FIELDS.some((f) => b[f] != null)) {
    throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to set cost or billing fields.');
  }
  if (b.fte != null && (b.fte <= 0 || b.fte > 2)) throw new ApiError(400, 'VALIDATION_FAILED', 'FTE must be between 0 and 2.');
  const ts = now();
  const id = db.prepare(`INSERT INTO employees (org_id, employee_code, full_name, email, department_id, business_unit_id,
      location_id, designation, grade, employment_type, status, join_date, exit_date, fte, weekly_hours, annual_cost,
      cost_currency, bill_rate_hour, annual_bill_rate, data_source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)`)
    .run(req.orgId, b.employee_code, b.full_name, b.email ?? null, b.department_id ?? null, b.business_unit_id ?? null,
      b.location_id ?? null, b.designation ?? null, b.grade ?? null, b.employment_type ?? 'full_time',
      b.status ?? 'active', b.join_date ?? null, b.exit_date ?? null, b.fte ?? 1, b.weekly_hours ?? null,
      b.annual_cost ?? null, b.cost_currency ?? 'INR', b.bill_rate_hour ?? null, b.annual_bill_rate ?? null, ts, ts)
    .lastInsertRowid;
  audit(req, { action: 'employee.created', entityType: 'employee', entityId: id, summary: `Employee ${b.employee_code} created` });
  return ok(res, { id });
}));

router.patch('/:id', requirePermission('workforce.manage'), ah(async (req, res) => {
  const db = getDb();
  const emp = db.prepare('SELECT * FROM employees WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!emp) throw new ApiError(404, 'NOT_FOUND', 'Employee not found.');
  const body = req.body || {};
  const allowed = ['full_name', 'email', 'department_id', 'business_unit_id', 'location_id', 'designation', 'grade',
    'employment_type', 'status', 'join_date', 'exit_date', 'fte', 'weekly_hours', ...COST_FIELDS];
  if (!maySeeCost(req.user) && COST_FIELDS.some((f) => body[f] !== undefined)) {
    throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to change cost or billing fields.');
  }
  const sets = [];
  const vals = [];
  for (const f of allowed) {
    if (body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(body[f] === '' ? null : body[f]); }
  }
  if (!sets.length) throw new ApiError(400, 'NO_CHANGES', 'No editable fields were supplied.');
  if (body.employment_type && !['full_time', 'part_time', 'contractor', 'intern', 'furlough'].includes(body.employment_type)) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Invalid employment type.');
  }
  if (body.status && !['active', 'on_leave', 'notice', 'exited'].includes(body.status)) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'Invalid status.');
  }
  const last = db.prepare('SELECT MAX(version) v FROM record_versions WHERE org_id = ? AND entity_type = ? AND entity_id = ?')
    .get(req.orgId, 'employee', emp.id);
  db.transaction(() => {
    db.prepare(`INSERT INTO record_versions (org_id, entity_type, entity_id, version, snapshot, changed_by, change_type, changed_at)
        VALUES (?, 'employee', ?, ?, ?, ?, 'update', ?)`)
      .run(req.orgId, emp.id, (last?.v || 0) + 1, JSON.stringify(emp), req.user.user.id, now());
    db.prepare(`UPDATE employees SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...vals, now(), emp.id);
  })();
  audit(req, { action: 'employee.updated', entityType: 'employee', entityId: emp.id, summary: `Employee ${emp.employee_code} updated`, meta: body });
  return ok(res, { updated: true });
}));

/* ------------------------------------------------------------------ skills */
router.get('/meta/skills', requirePermission('workforce.view'), ah(async (req, res) => {
  const db = getDb();
  const skills = db.prepare(`SELECT s.*, COUNT(es.id) AS employee_count FROM skills s
      LEFT JOIN employee_skills es ON es.skill_id = s.id WHERE s.org_id = ? GROUP BY s.id ORDER BY employee_count DESC, s.name`).all(req.orgId);
  const locations = db.prepare('SELECT * FROM locations WHERE org_id = ? ORDER BY name').all(req.orgId);
  const departments = db.prepare('SELECT * FROM departments WHERE org_id = ? ORDER BY name').all(req.orgId);
  const businessUnits = db.prepare('SELECT * FROM business_units WHERE org_id = ? ORDER BY name').all(req.orgId);
  return ok(res, { skills, locations, departments, business_units: businessUnits });
}));

router.put('/:id/skills', requirePermission('workforce.manage'), ah(async (req, res) => {
  const db = getDb();
  const emp = db.prepare('SELECT * FROM employees WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!emp) throw new ApiError(404, 'NOT_FOUND', 'Employee not found.');
  const skills = Array.isArray(req.body?.skills) ? req.body.skills : null;
  if (!skills) throw new ApiError(400, 'VALIDATION_FAILED', 'skills[] is required.');
  const ts = now();
  const run = db.transaction(() => {
    db.prepare('DELETE FROM employee_skills WHERE employee_id = ?').run(emp.id);
    for (const s of skills) {
      if (!s.name) continue;
      let skill = db.prepare('SELECT id FROM skills WHERE org_id = ? AND LOWER(name) = LOWER(?)').get(req.orgId, s.name);
      if (!skill) {
        const id = db.prepare('INSERT INTO skills (org_id, name, category, created_at) VALUES (?, ?, ?, ?)')
          .run(req.orgId, s.name, s.category ?? null, ts).lastInsertRowid;
        skill = { id };
      }
      const prof = Math.min(Math.max(Number(s.proficiency) || 3, 1), 5);
      db.prepare('INSERT INTO employee_skills (org_id, employee_id, skill_id, proficiency, years, verified) VALUES (?, ?, ?, ?, ?, ?)')
        .run(req.orgId, emp.id, skill.id, prof, s.years ?? null, s.verified ? 1 : 0);
    }
  });
  run();
  audit(req, { action: 'employee.skills.updated', entityType: 'employee', entityId: emp.id, summary: `Skills updated for ${emp.employee_code}` });
  return ok(res, { updated: true });
}));

/** CSV export of the workforce scoped to the requesting user. */
router.get('/export/csv', requirePermission('report.view'), ah(async (req, res) => {
  const { generateReport } = await import('../services/reports.js');
  const { resolvePeriod } = await import('../lib/capacity.js');
  const fs = await import('node:fs');
  const period = resolvePeriod({ month: new Date().toISOString().slice(0, 7) });
  const rep = generateReport(req.user, { code: 'employee_capacity', period, format: 'csv' });
  audit(req, { action: 'report.downloaded', entityType: 'report', entityId: 'employee_capacity', summary: 'Employee capacity report downloaded' });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${rep.filename}"`);
  return res.send(fs.readFileSync(rep.path));
}));

export { redactCost, loadScopeEmployees };
export default router;
