import express from 'express';
import { getDb, now } from '../db/index.js';
import { ah, requireAuth, requirePermission, tenantContext } from '../auth/middleware.js';
import { requireOrg } from '../lib/guards.js';
import { audit } from '../lib/audit.js';
import { ApiError, ok, paginate } from '../lib/http.js';
import { loadScopeProjects, canSeeProject, maySeeFinance } from '../services/scope.js';
import { demandAnalysis, allocationOverlaps } from '../services/analytics.js';
import { resolvePeriod } from '../lib/capacity.js';

const router = express.Router();
router.use(requireAuth, tenantContext, requireOrg);

const FINANCE_FIELDS = ['budget_amount', 'billing_rate_hour'];

function stripFinance(principal, p) {
  if (maySeeFinance(principal)) return p;
  const c = { ...p };
  for (const f of FINANCE_FIELDS) if (f in c) c[f] = null;
  c.finance_redacted = true;
  return c;
}

router.get('/', requirePermission('project.view'), ah(async (req, res) => {
  const db = getDb();
  const projects = loadScopeProjects(req.user);
  const filtered = req.query.status ? projects.filter((p) => p.status === req.query.status) : projects;
  const { limit, offset } = paginate(req.query, 100, 500);

  const allocRows = db.prepare(`SELECT project_id, SUM(hours_per_week) weekly, COUNT(DISTINCT employee_id) people
      FROM allocations WHERE org_id = ? AND status <> 'cancelled' GROUP BY project_id`).all(req.orgId);
  const allocByProject = new Map(allocRows.map((r) => [r.project_id, r]));
  const demandRows = db.prepare(`SELECT project_id, SUM(headcount) headcount, COUNT(*) records FROM project_demand
      WHERE org_id = ? AND status IN ('open','partially_filled') GROUP BY project_id`).all(req.orgId);
  const demandByProject = new Map(demandRows.map((r) => [r.project_id, r]));

  return ok(res, filtered.slice(offset, offset + limit).map((p) => stripFinance(req.user, {
    ...p,
    allocated_weekly_hours: allocByProject.get(p.id)?.weekly ?? 0,
    allocated_people: allocByProject.get(p.id)?.people ?? 0,
    open_demand_headcount: demandByProject.get(p.id)?.headcount ?? 0,
  })), { total: filtered.length });
}));

router.get('/demand', requirePermission('project.view'), ah(async (req, res) => {
  const d = demandAnalysis(req.user);
  return ok(res, d.gaps, { asOf: d.asOf, note: 'Coverage compares dated allocations with each demand record. Skill fit is shown separately.' });
}));

router.get('/overlaps', requirePermission('allocation.view'), ah(async (req, res) => {
  const period = resolvePeriod(req.query.from && req.query.to ? { from: req.query.from, to: req.query.to } : { month: req.query.month || new Date().toISOString().slice(0, 7) });
  const overlaps = allocationOverlaps(req.user, { period });
  return ok(res, overlaps, { period });
}));

router.get('/:id', requirePermission('project.view'), ah(async (req, res) => {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!project || !canSeeProject(req.user, project)) throw new ApiError(404, 'NOT_FOUND', 'Project not found or outside your data scope.');
  const demand = db.prepare(`SELECT d.*, s.name AS skill_name FROM project_demand d LEFT JOIN skills s ON s.id = d.required_skill_id
      WHERE d.project_id = ? ORDER BY d.start_date`).all(project.id);
  const allocations = db.prepare(`SELECT a.*, e.full_name, e.employee_code, e.designation FROM allocations a
      JOIN employees e ON e.id = a.employee_id WHERE a.project_id = ? AND a.status <> 'cancelled' ORDER BY a.start_date`).all(project.id);
  const invoices = maySeeFinance(req.user)
    ? db.prepare('SELECT * FROM invoices WHERE project_id = ? ORDER BY period_month DESC').all(project.id) : [];
  return ok(res, { project: stripFinance(req.user, project), demand, allocations, invoices });
}));

router.post('/', requirePermission('project.manage'), ah(async (req, res) => {
  const db = getDb();
  const b = req.body || {};
  if (!b.code || !b.name) throw new ApiError(400, 'VALIDATION_FAILED', 'Project code and name are required.');
  if (db.prepare('SELECT 1 FROM projects WHERE org_id = ? AND code = ?').get(req.orgId, b.code)) {
    throw new ApiError(409, 'DUPLICATE_CODE', 'A project with that code already exists.');
  }
  if (b.start_date && b.end_date && b.start_date > b.end_date) throw new ApiError(400, 'VALIDATION_FAILED', 'End date must be after the start date.');
  const ts = now();
  const id = db.prepare(`INSERT INTO projects (org_id, code, name, client_name, business_unit_id, department_id, start_date,
      end_date, status, contract_type, budget_amount, currency, billing_rate_hour, priority, health, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.orgId, b.code, b.name, b.client_name ?? null, b.business_unit_id ?? null, b.department_id ?? null,
      b.start_date ?? null, b.end_date ?? null, b.status ?? 'active', b.contract_type ?? 'time_material',
      b.budget_amount ?? null, b.currency ?? req.user.org?.currency ?? 'INR', b.billing_rate_hour ?? null,
      b.priority ?? 'medium', b.health ?? 'green', ts, ts).lastInsertRowid;
  audit(req, { action: 'project.created', entityType: 'project', entityId: id, summary: `Project ${b.code} created` });
  return ok(res, { id });
}));

router.patch('/:id', requirePermission('project.manage'), ah(async (req, res) => {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!project || !canSeeProject(req.user, project)) throw new ApiError(404, 'NOT_FOUND', 'Project not found.');
  const allowed = ['name', 'client_name', 'business_unit_id', 'department_id', 'start_date', 'end_date', 'status',
    'contract_type', 'priority', 'health', 'budget_amount', 'billing_rate_hour', 'currency'];
  const sets = [], vals = [];
  for (const f of allowed) if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f] === '' ? null : req.body[f]); }
  if (!sets.length) throw new ApiError(400, 'NO_CHANGES', 'No editable fields supplied.');
  db.prepare(`UPDATE projects SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...vals, now(), project.id);
  audit(req, { action: 'project.updated', entityType: 'project', entityId: project.id, summary: `Project ${project.code} updated`, meta: req.body });
  return ok(res, { updated: true });
}));

/* ------------------------------------------------------------------ demand */
router.post('/:id/demand', requirePermission('project.manage'), ah(async (req, res) => {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!project || !canSeeProject(req.user, project)) throw new ApiError(404, 'NOT_FOUND', 'Project not found.');
  const b = req.body || {};
  for (const f of ['role_title', 'headcount', 'start_date', 'end_date']) {
    if (b[f] === undefined || b[f] === null || b[f] === '') throw new ApiError(400, 'VALIDATION_FAILED', `${f} is required.`);
  }
  if (b.start_date > b.end_date) throw new ApiError(400, 'VALIDATION_FAILED', 'Demand end date must be after the start date.');
  if (Number(b.headcount) <= 0) throw new ApiError(400, 'VALIDATION_FAILED', 'Headcount must be greater than zero.');
  let skillId = null;
  if (b.required_skill) {
    let skill = db.prepare('SELECT id FROM skills WHERE org_id = ? AND LOWER(name) = LOWER(?)').get(req.orgId, b.required_skill);
    if (!skill) skill = { id: db.prepare('INSERT INTO skills (org_id, name, created_at) VALUES (?, ?, ?)').run(req.orgId, b.required_skill, now()).lastInsertRowid };
    skillId = skill.id;
  }
  const id = db.prepare(`INSERT INTO project_demand (org_id, project_id, role_title, required_skill_id, headcount, hours_per_week,
      start_date, end_date, priority, status, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.orgId, project.id, b.role_title, skillId, Number(b.headcount), Number(b.hours_per_week ?? 40),
      b.start_date, b.end_date, b.priority ?? 'medium', b.status ?? 'open', b.notes ?? null, now()).lastInsertRowid;
  audit(req, { action: 'demand.created', entityType: 'project_demand', entityId: id, summary: `Demand created for ${project.code}: ${b.role_title}` });
  return ok(res, { id });
}));

router.patch('/demand/:demandId', requirePermission('project.manage'), ah(async (req, res) => {
  const db = getDb();
  const d = db.prepare('SELECT * FROM project_demand WHERE id = ? AND org_id = ?').get(req.params.demandId, req.orgId);
  if (!d) throw new ApiError(404, 'NOT_FOUND', 'Demand record not found.');
  const allowed = ['role_title', 'headcount', 'hours_per_week', 'start_date', 'end_date', 'priority', 'status', 'notes'];
  const sets = [], vals = [];
  for (const f of allowed) if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
  if (!sets.length) throw new ApiError(400, 'NO_CHANGES', 'No editable fields supplied.');
  db.prepare(`UPDATE project_demand SET ${sets.join(', ')} WHERE id = ?`).run(...vals, d.id);
  audit(req, { action: 'demand.updated', entityType: 'project_demand', entityId: d.id, summary: 'Demand record updated' });
  return ok(res, { updated: true });
}));

export default router;
