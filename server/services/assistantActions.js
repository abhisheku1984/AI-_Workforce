/**
 * Write actions the assistant may perform on a user's behalf.
 *
 * The assistant is a *record keeper*, not an authority. Every action here:
 *
 *   1. requires the same permission the REST endpoint requires — no new privilege is granted
 *      to a user because they asked by voice instead of by clicking;
 *   2. is **staged first** and only applied when the user confirms, so a misheard phrase can
 *      never mutate data on its own;
 *   3. is written to the audit trail with the actor, the before/after values and whether the
 *      request came in by voice;
 *   4. never hard-deletes. An allocation is cancelled, an employee is marked exited, so the
 *      records that reports depend on stay traceable.
 *
 * Deliberate exclusions: nothing here touches pay, cost rates, invoices or approvals. Those
 * remain manual, permissioned actions in the UI, because the cost of a misheard instruction is
 * too high to accept for a voice channel.
 */
import { getDb, now } from '../db/index.js';
import { ApiError } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { canSeeEmployee, loadScopeEmployees } from './scope.js';

const ACTIONS = {
  add_allocation: {
    label: 'Add an allocation',
    permission: 'allocation.manage',
    destructive: false,
    description: 'Assign a person to a project for a period at a number of hours per week.',
  },
  remove_allocation: {
    label: 'Remove an allocation',
    permission: 'allocation.manage',
    destructive: true,
    description: 'Cancel an allocation. The record is retained as cancelled, not deleted.',
  },
  add_employee: {
    label: 'Add a person',
    permission: 'workforce.manage',
    destructive: false,
    description: 'Create a workforce record: name, employee code and optionally department, designation and joining date.',
  },
  update_employee: {
    label: 'Update a person',
    permission: 'workforce.manage',
    destructive: false,
    description: 'Change a person’s department, designation, status or contact email.',
  },
  deactivate_employee: {
    label: 'Mark a person as exited',
    permission: 'workforce.manage',
    destructive: true,
    description: 'Set a person’s status to exited. History and allocations are preserved.',
  },
};

export function listActions() {
  return Object.entries(ACTIONS).map(([name, a]) => ({
    name,
    label: a.label,
    permission: a.permission,
    destructive: a.destructive,
    description: a.description,
  }));
}

export function actionDefinition(name) {
  return ACTIONS[name] || null;
}

/* ------------------------------------------------------------------ parsing */

/** Pull a date from "2026-11-01", "1 Nov 2026", "Nov 1 2026", "01/11/2026". */
export function parseDate(input) {
  if (!input) return null;
  const text = String(input).trim();
  // Already ISO.
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return text;
  const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

/** Numbers spoken or typed, including "40", "40 hours", "2.5", "forty" for small values. */
export function parseNumber(input) {
  if (input == null) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, hundred: 100 };
  const text = String(input).toLowerCase().trim();
  const asWord = words[text.split(/\s+/)[0]];
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (match) return Number(match[0]);
  return asWord ?? null;
}

/** Find one employee by name, email or code, restricted to what the user may see. */
export function resolveEmployee(principal, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (needle.length < 2) return { match: null, candidates: [] };
  const visible = loadScopeEmployees(principal).filter((e) => e.status !== 'exited');
  const scored = visible.map((e) => {
    const name = String(e.full_name || '').toLowerCase();
    const email = String(e.email || '').toLowerCase();
    const code = String(e.employee_code || '').toLowerCase();
    let score = 0;
    if (name === needle || email === needle || code === needle) score = 3;
    else if (name.startsWith(needle) || code === needle) score = 2;
    else if (name.includes(needle)) score = 1;
    return { employee: e, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);

  if (!scored.length) return { match: null, candidates: [] };
  // Ambiguity must be surfaced, never guessed: two "Priya"s are a real situation.
  const top = scored.filter((x) => x.score === scored[0].score);
  if (top.length > 1) return { match: null, candidates: top.map((x) => x.employee) };
  return { match: scored[0].employee, candidates: [] };
}

/** Find one project by name or code within the user's organisation. */
export function resolveProject(principal, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (needle.length < 2) return { match: null, candidates: [] };
  // Project status is constrained to planned/active/on_hold/completed/cancelled.
  const rows = getDb().prepare("SELECT * FROM projects WHERE org_id = ? AND status NOT IN ('cancelled','completed')")
    .all(principal.orgId);
  const scored = rows.map((p) => {
    const name = String(p.name || '').toLowerCase();
    const code = String(p.code || '').toLowerCase();
    let score = 0;
    if (name === needle || code === needle) score = 3;
    else if (name.startsWith(needle)) score = 2;
    else if (name.includes(needle)) score = 1;
    return { project: p, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  if (!scored.length) return { match: null, candidates: [] };
  const top = scored.filter((x) => x.score === scored[0].score);
  if (top.length > 1) return { match: null, candidates: top.map((x) => x.project) };
  return { match: scored[0].project, candidates: [] };
}

/** A structured instruction, as produced by the UI (or by an intent parser). */
export function normaliseInstruction(input = {}) {
  return {
    action: input.action || null,
    employee: input.employee ?? input.person ?? null,
    project: input.project ?? null,
    startDate: parseDate(input.startDate ?? input.start ?? null),
    endDate: parseDate(input.endDate ?? input.end ?? null),
    hoursPerWeek: parseNumber(input.hoursPerWeek ?? input.hours ?? null),
    fullName: input.fullName ?? input.name ?? null,
    employeeCode: input.employeeCode ?? input.code ?? null,
    email: input.email ?? null,
    department: input.department ?? null,
    designation: input.designation ?? null,
    status: input.status ?? null,
    note: input.note ?? null,
    // Keep the raw request so validation can explain why a field was ignored.
    ...Object.fromEntries(Object.entries(input).filter(([k]) => ![
      'action', 'employee', 'person', 'project', 'startDate', 'start', 'endDate', 'end',
      'hoursPerWeek', 'hours', 'fullName', 'name', 'employeeCode', 'code', 'email',
      'department', 'designation', 'status', 'note',
    ].includes(k))),
  };
}

/* ------------------------------------------------------------------ staging */

/**
 * Validate an instruction and return a human-readable preview of what would change.
 * Nothing is written here. Errors are returned in plain language so the UI (or a spoken
 * reply) can say exactly what is missing.
 */
export function stageAction(principal, rawInstruction, { via = 'text' } = {}) {
  const instruction = normaliseInstruction(rawInstruction);
  const definition = actionDefinition(instruction.action);
  if (!definition) {
    return {
      ok: false,
      code: 'UNKNOWN_ACTION',
      message: `I can ${Object.values(ACTIONS).map((a) => a.label.toLowerCase()).join(', ')}. Which would you like?`,
      actions: listActions(),
    };
  }

  if (!principal?.permissions?.has?.(definition.permission)) {
    return {
      ok: false,
      code: 'FORBIDDEN',
      message: `Your role does not include "${definition.permission}", which ${definition.label.toLowerCase()} requires. Ask an administrator for that permission — it cannot be granted by asking me.`,
    };
  }

  const db = getDb();
  const problems = [];

  /* ---------------- employee resolution shared by the person actions ---------- */
  let employee = null;
  if (['remove_allocation', 'update_employee', 'deactivate_employee'].includes(instruction.action) || (instruction.action === 'add_allocation')) {
    if (!instruction.employee && !instruction.employeeCode) {
      problems.push('Who is this about? Give a name or employee code.');
    } else {
      const found = instruction.employeeCode
        ? { match: db.prepare('SELECT * FROM employees WHERE org_id = ? AND lower(employee_code) = lower(?)')
          .get(principal.orgId, instruction.employeeCode), candidates: [] }
        : resolveEmployee(principal, instruction.employee);
      if (found.candidates?.length) {
        return {
          ok: false,
          code: 'AMBIGUOUS',
          message: `That name matches ${found.candidates.length} people. Which one: ${found.candidates.map((c) => `${c.full_name} (${c.employee_code})`).join(', ')}?`,
          candidates: found.candidates.map((c) => ({ id: c.id, full_name: c.full_name, employee_code: c.employee_code })),
        };
      }
      employee = found.match;
      if (!employee) problems.push(`I could not find anyone matching "${instruction.employee}".`);
      else if (!canSeeEmployee(principal, employee)) problems.push('That person is outside your permitted scope.');
    }
  }

  /* ---------------- per-action validation ------------------------------------ */
  switch (instruction.action) {
    case 'add_allocation': {
      if (!instruction.project) problems.push('Which project should the allocation go to?');
      let project = null;
      if (instruction.project) {
        const found = resolveProject(principal, instruction.project);
        if (found.candidates?.length) {
          return {
            ok: false,
            code: 'AMBIGUOUS_PROJECT',
            message: `That project name matches ${found.candidates.length} projects: ${found.candidates.map((p) => p.name).join(', ')}.`,
            candidates: found.candidates.map((p) => ({ id: p.id, name: p.name })),
          };
        }
        project = found.match;
        if (!project) problems.push(`I could not find a project matching "${instruction.project}".`);
      }
      if (!instruction.startDate) problems.push('When should it start? A date like 2026-11-01.');
      if (!instruction.endDate) problems.push('When should it end?');
      const hours = instruction.hoursPerWeek;
      if (hours == null) problems.push('How many hours per week?');
      else if (hours <= 0 || hours > 60) problems.push('Hours per week must be between 1 and 60.');
      if (instruction.startDate && instruction.endDate && instruction.endDate < instruction.startDate) {
        problems.push('The end date is before the start date.');
      }
      if (problems.length) return { ok: false, code: 'INCOMPLETE', message: problems.join(' '), problems };

      // Warn, do not block: over-allocation is visible information, not an error.
      const existing = db.prepare(`SELECT COALESCE(SUM(hours_per_week), 0) AS h FROM allocations
          WHERE org_id = ? AND employee_id = ? AND status IN ('planned','confirmed')
            AND start_date <= ? AND end_date >= ?`)
        .get(principal.orgId, employee.id, instruction.endDate, instruction.startDate).h;
      const capacity = employee.weekly_hours ?? 40;
      const total = existing + hours;
      const warning = total > capacity
        ? `${employee.full_name} would be allocated ${total} h/week against a ${capacity} h/week capacity — over-allocated by ${total - capacity} h.`
        : null;

      return {
        ok: true,
        instruction,
        preview: {
          action: 'add_allocation',
          summary: `Allocate ${employee.full_name} (${employee.employee_code}) to ${project.name} for ${instruction.startDate} → ${instruction.endDate} at ${hours} h/week.`,
          details: [
            ['Person', `${employee.full_name} (${employee.employee_code})`],
            ['Project', project.name],
            ['Period', `${instruction.startDate} → ${instruction.endDate}`],
            ['Hours per week', String(hours)],
            ['Current allocation', `${existing} h/week of ${capacity}`],
          ],
          warning,
          destructive: false,
          payload: {
            employeeId: employee.id, projectId: project.id,
            startDate: instruction.startDate, endDate: instruction.endDate, hoursPerWeek: hours,
          },
        },
        via,
      };
    }

    case 'remove_allocation': {
      if (!employee) return { ok: false, code: 'INCOMPLETE', message: problems.join(' ') || 'I could not identify that person.', problems };
      const open = db.prepare(`SELECT a.*, p.name AS project_name FROM allocations a
          LEFT JOIN projects p ON p.id = a.project_id
          WHERE a.org_id = ? AND a.employee_id = ? AND a.status IN ('planned','confirmed')
          ORDER BY a.start_date`).all(principal.orgId, employee.id);
      if (!open.length) {
        return { ok: false, code: 'NOTHING_TO_REMOVE', message: `${employee.full_name} has no active allocations to remove.` };
      }
      // If a project was named, narrow to it; otherwise ask rather than guess which to cancel.
      const chosen = instruction.project
        ? open.filter((a) => String(a.project_name || '').toLowerCase().includes(String(instruction.project).toLowerCase()))
        : open;
      if (!chosen.length) {
        return {
          ok: false, code: 'NOT_FOUND',
          message: `${employee.full_name} is not allocated to anything matching "${instruction.project}". Current allocations: ${open.map((a) => a.project_name || 'unassigned').join(', ')}.`,
        };
      }
      if (chosen.length > 1) {
        return {
          ok: false, code: 'AMBIGUOUS_ALLOCATION',
          message: `${employee.full_name} has ${chosen.length} active allocations: ${chosen.map((a) => `${a.project_name || 'unassigned'} (${a.start_date} → ${a.end_date})`).join('; ')}. Which should I cancel?`,
          candidates: chosen.map((a) => ({ id: a.id, project: a.project_name, start: a.start_date, end: a.end_date })),
        };
      }
      const allocation = chosen[0];
      return {
        ok: true,
        instruction,
        preview: {
          action: 'remove_allocation',
          summary: `Cancel ${employee.full_name}’s allocation to ${allocation.project_name || 'the project'} (${allocation.start_date} → ${allocation.end_date}, ${allocation.hours_per_week} h/week).`,
          details: [
            ['Person', `${employee.full_name} (${employee.employee_code})`],
            ['Project', allocation.project_name || '—'],
            ['Period', `${allocation.start_date} → ${allocation.end_date}`],
            ['Hours per week', String(allocation.hours_per_week)],
            ['Effect', 'Marked cancelled and kept for history. Nothing is deleted.'],
          ],
          warning: 'This reduces planned capacity on that project and will change utilisation reports.',
          destructive: true,
          payload: { allocationId: allocation.id },
        },
        via,
      };
    }

    case 'add_employee': {
      if (!instruction.fullName) problems.push('What is the person’s full name?');
      if (!instruction.employeeCode) problems.push('What employee code should I use? It must be unique.');
      if (instruction.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(instruction.email)) problems.push('That email address does not look valid.');
      let departmentId = null;
      if (instruction.department) {
        const dept = db.prepare('SELECT id, name FROM departments WHERE org_id = ? AND lower(name) LIKE lower(?)')
          .get(principal.orgId, `%${instruction.department}%`);
        if (!dept) problems.push(`There is no department called "${instruction.department}".`);
        else departmentId = dept.id;
      }
      if (problems.length) return { ok: false, code: 'INCOMPLETE', message: problems.join(' '), problems };

      return {
        ok: true,
        instruction,
        preview: {
          action: 'add_employee',
          summary: `Add ${instruction.fullName} with employee code ${instruction.employeeCode}${departmentId ? ` in ${instruction.department}` : ''}.`,
          details: [
            ['Name', instruction.fullName],
            ['Employee code', instruction.employeeCode],
            ['Email', instruction.email || '—'],
            ['Department', instruction.department || '—'],
            ['Designation', instruction.designation || '—'],
            ['Employment type', 'full_time (default)'],
          ],
          warning: 'No cost, pay or billing fields are set. Those need the finance permission and must be entered manually.',
          destructive: false,
          payload: {
            fullName: instruction.fullName, employeeCode: instruction.employeeCode, email: instruction.email ?? null,
            departmentId, designation: instruction.designation ?? null,
          },
        },
        via,
      };
    }

    case 'update_employee': {
      if (!employee) return { ok: false, code: 'INCOMPLETE', message: problems.join(' ') || 'I could not identify that person.', problems };
      const changes = {};
      if (instruction.department) {
        const dept = db.prepare('SELECT id, name FROM departments WHERE org_id = ? AND lower(name) LIKE lower(?)')
          .get(principal.orgId, `%${instruction.department}%`);
        if (!dept) problems.push(`There is no department called "${instruction.department}".`);
        else changes.department_id = dept.id;
      }
      if (instruction.designation) changes.designation = instruction.designation;
      if (instruction.email) {
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(instruction.email)) problems.push('That email address does not look valid.');
        else changes.email = instruction.email;
      }
      if (!Object.keys(changes).length) {
        // Name the excluded field explicitly: "what should change?" is confusing when the user
        // *did* ask for something, but asked for something the assistant may not touch.
        const refused = Object.keys(instruction)
          .filter((k) => /cost|pay|salary|bill|rate|invoice/i.test(k) && instruction[k] != null);
        problems.push(refused.length
          ? `I cannot change ${refused.join(', ')} — pay, cost and billing fields are never edited by the assistant. Change those in the person's record with the finance permission.`
          : 'What should change? Department, designation or email.');
      }
      if (problems.length) return { ok: false, code: 'INCOMPLETE', message: problems.join(' '), problems };

      return {
        ok: true,
        instruction,
        preview: {
          action: 'update_employee',
          summary: `Update ${employee.full_name} (${employee.employee_code}): ${Object.keys(changes).map((k) => k.replace('_id', '')).join(', ')}.`,
          details: [
            ['Person', `${employee.full_name} (${employee.employee_code})`],
            ...Object.entries(changes).map(([k, v]) => [k.replace('_id', '').replace('email', 'Email'), String(v)]),
          ],
          warning: null,
          destructive: false,
          payload: { employeeId: employee.id, changes },
        },
        via,
      };
    }

    case 'deactivate_employee': {
      if (!employee) return { ok: false, code: 'INCOMPLETE', message: problems.join(' ') || 'I could not identify that person.', problems };
      if (employee.status === 'exited') {
        return { ok: false, code: 'ALREADY_EXITED', message: `${employee.full_name} is already marked as exited.` };
      }
      const active = db.prepare(`SELECT COUNT(*) AS c FROM allocations WHERE org_id = ? AND employee_id = ?
          AND status IN ('planned','confirmed')`).get(principal.orgId, employee.id).c;
      return {
        ok: true,
        instruction,
        preview: {
          action: 'deactivate_employee',
          summary: `Mark ${employee.full_name} (${employee.employee_code}) as exited.`,
          details: [
            ['Person', `${employee.full_name} (${employee.employee_code})`],
            ['Current status', employee.status],
            ['New status', 'exited'],
            ['Active allocations', String(active)],
          ],
          warning: active
            ? `${active} active allocation(s) will remain but no longer count towards capacity. Review them.`
            : 'No active allocations.',
          destructive: true,
          payload: { employeeId: employee.id },
        },
        via,
      };
    }

    default:
      return { ok: false, code: 'UNKNOWN_ACTION', message: 'I did not recognise that action.' };
  }
}

/* ------------------------------------------------------------------ applying */

/**
 * Apply a previewed action. The caller must pass the preview payload that was shown to the
 * user; the payload is re-validated here so a stale or tampered preview cannot be replayed.
 */
export function applyAction(req, { action, payload = {}, via = 'text' } = {}) {
  const principal = req.user;
  const definition = actionDefinition(action);
  if (!definition) throw new ApiError(400, 'UNKNOWN_ACTION', 'Unknown action.');
  if (!principal?.permissions?.has?.(definition.permission)) {
    throw new ApiError(403, 'FORBIDDEN', `Your role does not include ${definition.permission}.`);
  }

  const db = getDb();
  const ts = now();
  const auditMeta = { via_voice: via === 'voice', assistant: true };

  switch (action) {
    case 'add_allocation': {
      const { employeeId, projectId, startDate, endDate, hoursPerWeek } = payload;
      const employee = db.prepare('SELECT * FROM employees WHERE id = ? AND org_id = ?').get(employeeId, principal.orgId);
      if (!employee) throw new ApiError(404, 'NOT_FOUND', 'Employee not found.');
      if (!canSeeEmployee(principal, employee)) throw new ApiError(403, 'FORBIDDEN', 'That person is outside your scope.');
      const project = db.prepare('SELECT * FROM projects WHERE id = ? AND org_id = ?').get(projectId, principal.orgId);
      if (!project) throw new ApiError(404, 'NOT_FOUND', 'Project not found.');
      if (!startDate || !endDate || !hoursPerWeek) throw new ApiError(400, 'VALIDATION_FAILED', 'startDate, endDate and hoursPerWeek are required.');
      const id = db.prepare(`INSERT INTO allocations (org_id, employee_id, project_id, start_date, end_date,
          hours_per_week, billable, status, note, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 1, 'planned', ?, ?, ?, ?)`)
        .run(principal.orgId, employee.id, project.id, startDate, endDate, hoursPerWeek,
          `Created by the assistant (${via})`, principal.user?.id ?? null, ts, ts).lastInsertRowid;
      audit(req, {
        action: 'allocation.created', entityType: 'allocation', entityId: id,
        summary: `Assistant allocated ${employee.full_name} to ${project.name} (${startDate} → ${endDate}, ${hoursPerWeek} h/week)`,
        meta: { ...auditMeta, employee_id: employee.id, project_id: project.id },
      });
      return {
        ok: true, action,
        message: `${employee.full_name} is now allocated to ${project.name} at ${hoursPerWeek} h/week, ${startDate} to ${endDate}.`,
        entityType: 'allocation', entityId: id,
      };
    }

    case 'remove_allocation': {
      const allocation = db.prepare('SELECT * FROM allocations WHERE id = ? AND org_id = ?').get(payload.allocationId, principal.orgId);
      if (!allocation) throw new ApiError(404, 'NOT_FOUND', 'Allocation not found.');
      const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(allocation.employee_id);
      if (!canSeeEmployee(principal, employee)) throw new ApiError(403, 'FORBIDDEN', 'That allocation is outside your scope.');
      db.prepare("UPDATE allocations SET status = 'cancelled', updated_at = ? WHERE id = ?").run(ts, allocation.id);
      audit(req, {
        action: 'allocation.cancelled', entityType: 'allocation', entityId: allocation.id,
        summary: `Assistant cancelled ${employee?.full_name || 'an employee'}’s allocation (retained as cancelled)`,
        meta: { ...auditMeta, previous_status: allocation.status },
      });
      return {
        ok: true, action,
        message: `Cancelled the allocation for ${employee?.full_name || 'that person'}. The record is kept as cancelled, so history and reports stay traceable.`,
        entityType: 'allocation', entityId: allocation.id,
      };
    }

    case 'add_employee': {
      const { fullName, employeeCode, email = null, departmentId = null, designation = null } = payload;
      if (!fullName || !employeeCode) throw new ApiError(400, 'VALIDATION_FAILED', 'A name and employee code are required.');
      if (db.prepare('SELECT 1 FROM employees WHERE org_id = ? AND employee_code = ?').get(principal.orgId, employeeCode)) {
        throw new ApiError(409, 'DUPLICATE_CODE', `Employee code ${employeeCode} is already in use.`);
      }
      const id = db.prepare(`INSERT INTO employees (org_id, employee_code, full_name, email, department_id, designation,
          employment_type, status, fte, cost_currency, data_source, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'full_time', 'active', 1, 'INR', 'assistant', ?, ?)`)
        .run(principal.orgId, employeeCode, fullName, email, departmentId, designation, ts, ts).lastInsertRowid;
      audit(req, {
        action: 'employee.created', entityType: 'employee', entityId: id,
        summary: `Assistant created employee ${employeeCode} (${fullName})`,
        meta: { ...auditMeta, cost_fields_set: false },
      });
      return {
        ok: true, action,
        message: `Added ${fullName} with employee code ${employeeCode}. Cost and billing fields are empty and need the finance permission.`,
        entityType: 'employee', entityId: id,
      };
    }

    case 'update_employee': {
      const changes = payload.changes || {};
      const employee = db.prepare('SELECT * FROM employees WHERE id = ? AND org_id = ?').get(payload.employeeId, principal.orgId);
      if (!employee) throw new ApiError(404, 'NOT_FOUND', 'Employee not found.');
      if (!canSeeEmployee(principal, employee)) throw new ApiError(403, 'FORBIDDEN', 'That person is outside your scope.');
      // Cost fields are never settable through the assistant, even if the user may see them.
      const allowed = ['department_id', 'designation', 'email', 'status'];
      const keys = Object.keys(changes).filter((k) => allowed.includes(k));
      if (!keys.length) throw new ApiError(400, 'VALIDATION_FAILED', 'No permitted field to change.');
      const before = Object.fromEntries(keys.map((k) => [k, employee[k]]));
      db.prepare(`UPDATE employees SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
        .run(...keys.map((k) => changes[k]), ts, employee.id);
      audit(req, {
        action: 'employee.updated', entityType: 'employee', entityId: employee.id,
        summary: `Assistant updated ${employee.full_name} (${keys.join(', ')})`,
        meta: { ...auditMeta, before, after: Object.fromEntries(keys.map((k) => [k, changes[k]])) },
      });
      return {
        ok: true, action,
        message: `Updated ${employee.full_name}: ${keys.map((k) => k.replace('_id', '')).join(', ')}.`,
        entityType: 'employee', entityId: employee.id,
      };
    }

    case 'deactivate_employee': {
      const employee = db.prepare('SELECT * FROM employees WHERE id = ? AND org_id = ?').get(payload.employeeId, principal.orgId);
      if (!employee) throw new ApiError(404, 'NOT_FOUND', 'Employee not found.');
      if (!canSeeEmployee(principal, employee)) throw new ApiError(403, 'FORBIDDEN', 'That person is outside your scope.');
      db.prepare("UPDATE employees SET status = 'exited', exit_date = COALESCE(exit_date, ?), updated_at = ? WHERE id = ?")
        .run(ts.slice(0, 10), ts, employee.id);
      audit(req, {
        action: 'employee.exited', entityType: 'employee', entityId: employee.id,
        summary: `Assistant marked ${employee.full_name} as exited`,
        meta: { ...auditMeta, previous_status: employee.status },
      });
      return {
        ok: true, action,
        message: `${employee.full_name} is marked as exited. Their history and allocations are preserved.`,
        entityType: 'employee', entityId: employee.id,
      };
    }

    default:
      throw new ApiError(400, 'UNKNOWN_ACTION', 'Unknown action.');
  }
}
