import express from 'express';
import { getDb, now } from '../db/index.js';
import { ah, requireAuth, requirePermission, tenantContext } from '../auth/middleware.js';
import { requireOrg } from '../lib/guards.js';
import { audit } from '../lib/audit.js';
import { ApiError, ok, paginate } from '../lib/http.js';
import { canSeeEmployee, canSeeProject, loadScopeEmployees, loadScopeProjects } from '../services/scope.js';
import { standardWeeklyHours, parseDate, iso, addDays, round, workingDaysIn } from '../lib/capacity.js';
import { listApprovals } from '../services/automation.js';

const router = express.Router();
router.use(requireAuth, tenantContext, requireOrg);

router.get('/', requirePermission('allocation.view'), ah(async (req, res) => {
  const db = getDb();
  const { limit, offset } = paginate(req.query, 200, 1000);
  const employees = loadScopeEmployees(req.user);
  const projects = loadScopeProjects(req.user);
  const empIds = new Set(employees.map((e) => e.id));
  const projIds = new Set(projects.map((p) => p.id));

  const rows = db.prepare(`SELECT a.*, e.full_name, e.employee_code, e.designation, p.code AS project_code, p.name AS project_name,
      d.name AS department, b.name AS business_unit
      FROM allocations a JOIN employees e ON e.id = a.employee_id
      LEFT JOIN projects p ON p.id = a.project_id
      LEFT JOIN departments d ON d.id = e.department_id
      LEFT JOIN business_units b ON b.id = e.business_unit_id
      WHERE a.org_id = ? ORDER BY a.start_date DESC LIMIT 2000`).all(req.orgId)
    .filter((a) => empIds.has(a.employee_id) && (!a.project_id || projIds.has(a.project_id)));

  return ok(res, rows.slice(offset, offset + limit), { total: rows.length });
}));

/**
 * Allocation capacity check before writing. Detects overlaps and over-capacity so the
 * user is warned; high-impact changes are routed through the approval workflow.
 */
function capacityCheck(orgId, { employee, startDate, endDate, hoursPerWeek, excludeId = null }) {
  const db = getDb();
  const loc = employee.location_id ? db.prepare('SELECT * FROM locations WHERE id = ?').get(employee.location_id) : null;
  const weekly = standardWeeklyHours(employee, loc);
  const overlapping = db.prepare(`SELECT * FROM allocations WHERE org_id = ? AND employee_id = ? AND status <> 'cancelled'
      AND start_date <= ? AND end_date >= ? AND id <> ?`)
    .all(orgId, employee.id, endDate, startDate, excludeId ?? -1);
  const existingWeekly = overlapping.reduce((s, a) => s + a.hours_per_week, 0);
  const combined = existingWeekly + hoursPerWeek;
  return {
    standard_weekly_hours: round(weekly),
    existing_weekly_hours: round(existingWeekly),
    combined_weekly_hours: round(combined),
    over_capacity: combined > weekly + 0.01,
    overlapping_allocations: overlapping.map((a) => ({ id: a.id, from: a.start_date, to: a.end_date, hours_per_week: a.hours_per_week })),
  };
}

router.post('/', requirePermission('allocation.manage'), ah(async (req, res) => {
  const db = getDb();
  const b = req.body || {};
  const employee = db.prepare('SELECT * FROM employees WHERE id = ? AND org_id = ?').get(b.employee_id, req.orgId);
  if (!employee) throw new ApiError(404, 'NOT_FOUND', 'Employee not found in this organization.');
  if (!canSeeEmployee(req.user, employee)) throw new ApiError(403, 'OUT_OF_SCOPE', 'That employee is outside your data scope.');
  if (b.project_id) {
    const project = db.prepare('SELECT * FROM projects WHERE id = ? AND org_id = ?').get(b.project_id, req.orgId);
    if (!project) throw new ApiError(404, 'NOT_FOUND', 'Project not found in this organization.');
    if (!canSeeProject(req.user, project)) throw new ApiError(403, 'OUT_OF_SCOPE', 'That project is outside your data scope.');
  }
  if (!b.start_date || !b.end_date) throw new ApiError(400, 'VALIDATION_FAILED', 'Start and end dates are required.');
  if (b.start_date > b.end_date) throw new ApiError(400, 'VALIDATION_FAILED', 'Allocation end date must be after the start date.');
  const hrs = Number(b.hours_per_week);
  if (!Number.isFinite(hrs) || hrs <= 0 || hrs > 80) throw new ApiError(400, 'VALIDATION_FAILED', 'Weekly hours must be between 0 and 80.');

  const check = capacityCheck(req.orgId, { employee, startDate: b.start_date, endDate: b.end_date, hoursPerWeek: hrs });
  if (check.combined_weekly_hours > check.standard_weekly_hours * 1.5) {
    throw new ApiError(400, 'CAPACITY_EXCEEDED',
      `This would allocate ${check.combined_weekly_hours} of ${check.standard_weekly_hours} standard weekly hours (more than 150%). Reduce the hours or split the period.`,
      check);
  }

  const ts = now();
  const id = db.prepare(`INSERT INTO allocations (org_id, employee_id, project_id, demand_id, start_date, end_date, hours_per_week,
      billable, bill_rate_hour, status, note, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.orgId, employee.id, b.project_id ?? null, b.demand_id ?? null, b.start_date, b.end_date, hrs,
      b.billable === false ? 0 : 1, b.bill_rate_hour ?? null, b.status ?? 'planned', b.note ?? null, req.user.user.id, ts, ts)
    .lastInsertRowid;

  audit(req, {
    action: 'allocation.created', entityType: 'allocation', entityId: id,
    summary: `Allocation for ${employee.employee_code} (${hrs}h/week from ${b.start_date})`,
    meta: { over_capacity: check.over_capacity, combined_weekly_hours: check.combined_weekly_hours },
  });
  return ok(res, { id, capacityWarning: check.over_capacity ? check : null });
}));

router.patch('/:id', requirePermission('allocation.manage'), ah(async (req, res) => {
  const db = getDb();
  const a = db.prepare('SELECT * FROM allocations WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!a) throw new ApiError(404, 'NOT_FOUND', 'Allocation not found.');
  const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(a.employee_id);
  if (!canSeeEmployee(req.user, employee)) throw new ApiError(403, 'OUT_OF_SCOPE', 'That allocation is outside your data scope.');
  const allowed = ['start_date', 'end_date', 'hours_per_week', 'billable', 'status', 'note', 'bill_rate_hour'];
  const sets = [], vals = [];
  for (const f of allowed) if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
  if (!sets.length) throw new ApiError(400, 'NO_CHANGES', 'No editable fields supplied.');
  const startDate = req.body.start_date ?? a.start_date;
  const endDate = req.body.end_date ?? a.end_date;
  if (startDate > endDate) throw new ApiError(400, 'VALIDATION_FAILED', 'Allocation end date must be after the start date.');
  db.prepare(`UPDATE allocations SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...vals, now(), a.id);
  audit(req, { action: 'allocation.updated', entityType: 'allocation', entityId: a.id, summary: 'Allocation updated', meta: req.body });
  const check = capacityCheck(req.orgId, {
    employee, startDate, endDate, hoursPerWeek: Number(req.body.hours_per_week ?? a.hours_per_week), excludeId: a.id,
  });
  return ok(res, { updated: true, capacityWarning: check.over_capacity ? check : null });
}));

router.delete('/:id', requirePermission('allocation.manage'), ah(async (req, res) => {
  const db = getDb();
  const a = db.prepare('SELECT * FROM allocations WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!a) throw new ApiError(404, 'NOT_FOUND', 'Allocation not found.');
  db.prepare(`UPDATE allocations SET status = 'cancelled', updated_at = ? WHERE id = ?`).run(now(), a.id);
  audit(req, { action: 'allocation.cancelled', entityType: 'allocation', entityId: a.id, summary: 'Allocation cancelled (kept for history)' });
  return ok(res, { cancelled: true, note: 'The allocation is retained as cancelled so reports and history stay traceable.' });
}));

/**
 * Staffing scenario analysis: given demand and a horizon, show which people *could*
 * fill it. This is decision support only — it never assigns anyone.
 */
router.post('/scenario', requirePermission('allocation.view'), ah(async (req, res) => {
  const db = getDb();
  const { start_date, end_date, required_skill, hours_per_week = 40, limit = 10 } = req.body || {};
  if (!start_date || !end_date) throw new ApiError(400, 'VALIDATION_FAILED', 'start_date and end_date are required.');
  const employees = loadScopeEmployees(req.user).filter((e) => e.status === 'active');
  const empIds = new Set(employees.map((e) => e.id));
  const allocations = db.prepare(`SELECT * FROM allocations WHERE org_id = ? AND status <> 'cancelled'
      AND start_date <= ? AND end_date >= ?`).all(req.orgId, end_date, start_date).filter((a) => empIds.has(a.employee_id));
  const skills = db.prepare(`SELECT es.employee_id, s.id AS skill_id, s.name, es.proficiency FROM employee_skills es
      JOIN skills s ON s.id = es.skill_id WHERE es.org_id = ?`).all(req.orgId);
  const skillsByEmp = new Map();
  for (const s of skills) {
    if (!skillsByEmp.has(s.employee_id)) skillsByEmp.set(s.employee_id, []);
    skillsByEmp.get(s.employee_id).push(s);
  }
  const locations = new Map(db.prepare('SELECT * FROM locations WHERE org_id = ?').all(req.orgId).map((l) => [l.id, l]));

  const candidates = employees.map((e) => {
    const weekly = standardWeeklyHours(e, locations.get(e.location_id));
    const allocated = allocations.filter((a) => a.employee_id === e.id).reduce((s, a) => s + a.hours_per_week, 0);
    const free = Math.max(weekly - allocated, 0);
    const empSkills = skillsByEmp.get(e.id) || [];
    const skillMatch = required_skill
      ? empSkills.find((s) => s.name.toLowerCase() === String(required_skill).toLowerCase())
      : null;
    return {
      employee_id: e.id, employee_code: e.employee_code, full_name: e.full_name, designation: e.designation,
      department_id: e.department_id, weekly_capacity: round(weekly), allocated_hours: round(allocated),
      free_hours: round(free), meets_hours: free >= Number(hours_per_week),
      skill_match: skillMatch ? { name: skillMatch.name, proficiency: skillMatch.proficiency } : null,
      has_required_skill: required_skill ? Boolean(skillMatch) : null,
      other_skills: empSkills.slice(0, 6).map((s) => s.name),
    };
  }).filter((c) => c.free_hours > 0)
    .sort((a, b) => {
      if (a.has_required_skill !== b.has_required_skill) return a.has_required_skill ? -1 : 1;
      return b.free_hours - a.free_hours;
    });

  return ok(res, {
    scenario: { start_date, end_date, required_skill: required_skill || null, hours_per_week: Number(hours_per_week) },
    candidates: candidates.slice(0, Number(limit)),
    total_available_people: candidates.length,
    note: 'These are suggestions based on capacity and recorded skills only. The platform does not assign people automatically — a resource manager must approve any assignment.',
  });
}));

/** Allocation approval requests (high-impact changes require sign-off). */
router.post('/:id/request-approval', requirePermission('allocation.manage'), ah(async (req, res) => {
  const db = getDb();
  const a = db.prepare('SELECT * FROM allocations WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!a) throw new ApiError(404, 'NOT_FOUND', 'Allocation not found.');
  const id = db.prepare(`INSERT INTO approval_requests (org_id, type, title, description, payload, risk_level, status, requested_by, created_at)
      VALUES (?, 'allocation_change', ?, ?, ?, 'medium', 'pending', ?, ?)`)
    .run(req.orgId, `Allocation change approval requested`,
      req.body?.reason || 'An allocation was changed and requires sign-off.',
      JSON.stringify({ allocation_id: a.id, employee_id: a.employee_id, project_id: a.project_id, hours_per_week: a.hours_per_week, period: [a.start_date, a.end_date] }),
      req.user.user.id, now()).lastInsertRowid;
  audit(req, { action: 'approval.requested', entityType: 'approval', entityId: id, summary: 'Allocation change approval requested' });
  return ok(res, { approvalId: id });
}));

export default router;
