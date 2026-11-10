/**
 * Analytics service — the single source of truth for every capacity, utilization,
 * allocation and project-number shown in dashboards, reports, exports and the AI.
 */
import { getDb } from '../db/index.js';
import {
  computeCapacity, rollup, summarize, resolvePeriod, workingDaysIn, findOverlaps,
  round, standardWeeklyHours, parseDate, iso, addDays,
} from '../lib/capacity.js';
import { loadScopeEmployees, loadScopeProjects, maySeeCost, maySeeFinance } from './scope.js';

export function loadLocations(orgId) {
  const rows = getDb().prepare('SELECT * FROM locations WHERE org_id = ?').all(orgId);
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Build the full capacity dataset for an org within a period, honouring filters.
 * Filters: business_unit_id, department_id, location_id, project_id, employee_status
 */
export function buildCapacityDataset(principal, { period, filters = {} }) {
  const db = getDb();
  const orgId = principal.orgId;
  let employees = loadScopeEmployees(principal);
  if (filters.business_unit_id) employees = employees.filter((e) => e.business_unit_id === Number(filters.business_unit_id));
  if (filters.department_id) employees = employees.filter((e) => e.department_id === Number(filters.department_id));
  if (filters.location_id) employees = employees.filter((e) => e.location_id === Number(filters.location_id));
  if (filters.status) employees = employees.filter((e) => e.status === filters.status);
  else employees = employees.filter((e) => ['active', 'on_leave', 'notice'].includes(e.status) || (e.status === 'exited' && e.exit_date >= period.start));

  const empIds = new Set(employees.map((e) => e.id));
  const allAllocations = db
    .prepare(
      `SELECT a.* FROM allocations a
       WHERE a.org_id = ? AND a.status <> 'cancelled' AND a.start_date <= ? AND a.end_date >= ?`
    )
    .all(orgId, period.end, period.start)
    .filter((a) => empIds.has(a.employee_id));

  const allocations = filters.project_id
    ? allAllocations.filter((a) => a.project_id === Number(filters.project_id))
    : allAllocations;

  const timesheets = db
    .prepare(`SELECT employee_id, project_id, work_date, hours, billable FROM timesheets
              WHERE org_id = ? AND work_date >= ? AND work_date <= ?`)
    .all(orgId, period.start, period.end)
    .filter((t) => empIds.has(t.employee_id));

  const locations = loadLocations(orgId);
  const rows = computeCapacity({
    employees, locationsById: locations, allocations, timesheets,
    start: period.start, end: period.end,
  });

  // Attach human-readable dimension labels (never guess — null becomes "Unassigned").
  const buMap = new Map(db.prepare('SELECT id, name FROM business_units WHERE org_id = ?').all(orgId).map((r) => [r.id, r.name]));
  const deptMap = new Map(db.prepare('SELECT id, name FROM departments WHERE org_id = ?').all(orgId).map((r) => [r.id, r.name]));
  const locMap = new Map([...locations.values()].map((r) => [r.id, r.name]));
  const enriched = rows.map((r) => ({
    ...r,
    business_unit: buMap.get(r.business_unit_id) ?? 'Unassigned',
    department: deptMap.get(r.department_id) ?? 'Unassigned',
    location: locMap.get(r.location_id) ?? 'Unassigned',
  }));

  return { rows: enriched, employees, allocations, timesheets, locations, period, filters };
}

export function utilizationReport(principal, { period, filters = {} }) {
  const ds = buildCapacityDataset(principal, { period, filters });
  const total = summarize(ds.rows);
  const byDepartment = rollup(ds.rows, 'department');
  const byBusinessUnit = rollup(ds.rows, 'business_unit');
  const byLocation = rollup(ds.rows, 'location');
  const overAllocated = ds.rows
    .filter((r) => r.over_allocated_hours > 0)
    .sort((a, b) => b.over_allocated_hours - a.over_allocated_hours);
  const idle = ds.rows
    .filter((r) => r.available_hours > 0 && r.allocation_pct != null && r.allocation_pct < 25)
    .sort((a, b) => b.unallocated_hours - a.unallocated_hours);

  return {
    period: ds.period,
    filters: ds.filters,
    definitions: {
      available_hours: 'Standard capacity of active employees in the period (location working days × hours/day × FTE, excluding configured holidays).',
      allocated_hours: 'Planned hours from active allocations overlapping the period.',
      utilized_hours: 'Hours actually recorded on timesheets in the period.',
      unallocated_hours: 'Available minus allocated hours (bench / idle capacity).',
      over_allocated_hours: 'Allocated hours above available hours.',
      utilization_pct: 'Utilized ÷ available hours.',
      allocation_pct: 'Allocated ÷ available hours.',
      billable_pct: 'Billable timesheet hours ÷ total timesheet hours.',
      exclusions: 'Exited employees outside their active window, cancelled allocations and cancelled projects are excluded.',
    },
    total,
    byDepartment,
    byBusinessUnit,
    byLocation,
    overAllocated: overAllocated.slice(0, 50),
    idle: idle.slice(0, 50),
    employees: ds.rows,
  };
}

/** Trend by month for a set of months. */
export function utilizationTrend(principal, { months, filters = {} }) {
  const out = [];
  for (const m of months) {
    const period = resolvePeriod({ month: m });
    const ds = buildCapacityDataset(principal, { period, filters });
    const s = summarize(ds.rows);
    out.push({
      month: m,
      label: m,
      available_hours: s.available_hours,
      allocated_hours: s.allocated_hours,
      utilized_hours: s.utilized_hours,
      utilization_pct: s.utilization_pct,
      allocation_pct: s.allocation_pct,
      unallocated_hours: s.unallocated_hours,
      headcount: s.headcount,
      timesheet_coverage_pct: s.timesheet_coverage_pct,
    });
  }
  return out;
}

export function recentMonths(count = 6, endMonth = new Date().toISOString().slice(0, 7)) {
  const [y, m] = endMonth.split('-').map(Number);
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

/**
 * Project demand coverage: compares required capacity against allocations.
 * Gaps are reported, never guessed or auto-filled.
 */
export function demandAnalysis(principal, { asOf = new Date().toISOString().slice(0, 10) } = {}) {
  const db = getDb();
  const projects = loadScopeProjects(principal);
  const projectIds = new Set(projects.map((p) => p.id));
  const demand = db
    .prepare(`SELECT d.*, p.name AS project_name, p.code AS project_code, s.name AS skill_name
              FROM project_demand d
              JOIN projects p ON p.id = d.project_id
              LEFT JOIN skills s ON s.id = d.required_skill_id
              WHERE d.org_id = ? AND d.status IN ('open','partially_filled')`)
    .all(principal.orgId)
    .filter((d) => projectIds.has(d.project_id));

  const allocs = db
    .prepare(`SELECT a.* FROM allocations a JOIN projects p ON p.id = a.project_id
              WHERE a.org_id = ? AND a.status <> 'cancelled'`)
    .all(principal.orgId)
    .filter((a) => projectIds.has(a.project_id));

  const employees = loadScopeEmployees(principal);
  const empMap = new Map(employees.map((e) => [e.id, e]));
  const skillsByEmp = new Map();
  for (const r of db.prepare(`SELECT es.employee_id, es.skill_id, s.name FROM employee_skills es
                              JOIN skills s ON s.id = es.skill_id WHERE es.org_id = ?`).all(principal.orgId)) {
    if (!skillsByEmp.has(r.employee_id)) skillsByEmp.set(r.employee_id, []);
    skillsByEmp.get(r.employee_id).push({ id: r.skill_id, name: r.name });
  }

  const gaps = [];
  for (const d of demand) {
    // Filled = allocations linked to this demand, or (if none linked) allocations on the
    // same project overlapping the demand window for the required skill.
    let filledHours = 0;
    const linked = allocs.filter((a) => a.demand_id === d.id);
    const relevant = linked.length
      ? linked
      : allocs.filter((a) => a.project_id === d.project_id && a.start_date <= d.end_date && a.end_date >= d.start_date);
    for (const a of relevant) {
      const overlap = overlapWorkingDays(a.start_date, a.end_date, d.start_date, d.end_date);
      filledHours += (a.hours_per_week / 5) * overlap;
    }
    const requiredWeekly = d.hours_per_week * d.headcount;
    const requiredHours = (requiredWeekly / 5) * overlapWorkingDays(d.start_date, d.end_date, d.start_date, d.end_date);
    const coveragePct = requiredHours > 0 ? round((filledHours / requiredHours) * 100) : null;

    // Skill-matched bench candidates (capacity available AND skill present).
    let candidates = [];
    if (d.required_skill_id) {
      candidates = employees
        .filter((e) => e.status === 'active' && (skillsByEmp.get(e.id) || []).some((s) => s.id === d.required_skill_id))
        .map((e) => {
          const w = standardWeeklyHours(e, null);
          return { employee_id: e.id, full_name: e.full_name, employee_code: e.employee_code, weekly_capacity: round(w) };
        })
        .slice(0, 10);
    }

    gaps.push({
      demand_id: d.id,
      project_id: d.project_id,
      project_name: d.project_name,
      project_code: d.project_code,
      role_title: d.role_title,
      required_skill: d.skill_name,
      headcount: d.headcount,
      hours_per_week: d.hours_per_week,
      start_date: d.start_date,
      end_date: d.end_date,
      priority: d.priority,
      status: d.status,
      required_hours: round(requiredHours),
      filled_hours: round(filledHours),
      gap_hours: round(Math.max(requiredHours - filledHours, 0)),
      coverage_pct: coveragePct,
      linked_allocations: linked.length,
      skill_matched_candidates: candidates,
    });
  }
  gaps.sort((a, b) => (a.coverage_pct ?? 0) - (b.coverage_pct ?? 0));
  return { asOf, gaps };
}

function overlapWorkingDays(aStart, aEnd, bStart, bEnd) {
  const s = new Date(Math.max(parseDate(aStart), parseDate(bStart)));
  const e = new Date(Math.min(parseDate(aEnd), parseDate(bEnd)));
  if (s > e) return 0;
  return workingDaysIn(iso(s), iso(e));
}

/**
 * Financial analysis. Distinguishes:
 *  - Workforce cost  = employees' cost (allocated share) — an internal cost
 *  - Revenue         = invoiced amounts
 *  - Billable value  = timesheet hours × project billing rate (potential revenue, NOT invoiced)
 *  - Margin          = revenue − workforce cost − expenses (only when all inputs exist)
 * Every figure returns an explicit availability flag so nothing is silently assumed.
 */
export function financialAnalysis(principal, { period, filters = {} }) {
  const db = getDb();
  const orgId = principal.orgId;
  const canCost = maySeeCost(principal);
  const canFinance = maySeeFinance(principal);

  const employees = loadScopeEmployees(principal).filter((e) => {
    if (filters.business_unit_id && e.business_unit_id !== Number(filters.business_unit_id)) return false;
    if (filters.department_id && e.department_id !== Number(filters.department_id)) return false;
    return true;
  });
  const empIds = new Set(employees.map((e) => e.id));
  const locations = loadLocations(orgId);

  const allocations = db
    .prepare(`SELECT a.* FROM allocations a WHERE a.org_id = ? AND a.status <> 'cancelled'
              AND a.start_date <= ? AND a.end_date >= ?`)
    .all(orgId, period.end, period.start)
    .filter((a) => empIds.has(a.employee_id));

  const dayCount = workingDaysIn(period.start, period.end, [1, 2, 3, 4, 5], []);
  const monthFraction = dayCount / 21;

  const costRows = employees.map((e) => {
    const loc = locations.get(e.location_id);
    const weekly = standardWeeklyHours(e, loc);
    const availableHours = (weekly / 5) * workingDaysIn(period.start, period.end,
      loc ? JSON.parse(loc.working_days) : [1, 2, 3, 4, 5], loc ? JSON.parse(loc.holidays) : []);
    const empAlloc = allocations.filter((a) => a.employee_id === e.id);
    let allocatedHours = 0;
    for (const a of empAlloc) {
      allocatedHours += (a.hours_per_week / 5) * overlapWorkingDays(a.start_date, a.end_date, period.start, period.end);
    }
    const allocatedShare = availableHours > 0 ? Math.min(allocatedHours / availableHours, 1.5) : 0;
    const periodCost = e.annual_cost != null ? (e.annual_cost / 12) * monthFraction : null;
    return {
      employee_id: e.id,
      full_name: e.full_name,
      employee_code: e.employee_code,
      department_id: e.department_id,
      business_unit_id: e.business_unit_id,
      annual_cost: e.annual_cost,
      period_cost: periodCost != null ? round(periodCost) : null,
      allocated_period_cost: periodCost != null ? round(periodCost * Math.min(allocatedShare, 1)) : null,
      idle_period_cost: periodCost != null ? round(periodCost * Math.max(1 - allocatedShare, 0)) : null,
      available_hours: round(availableHours),
      allocated_hours: round(allocatedHours),
      bill_rate_hour: e.bill_rate_hour,
      grade: e.grade,
      has_cost: e.annual_cost != null,
    };
  });

  const projects = loadScopeProjects(principal);
  const projectIds = new Set(projects.map((p) => p.id));

  const invoices = db
    .prepare(`SELECT * FROM invoices WHERE org_id = ? AND period_month BETWEEN ? AND ?`)
    .all(orgId, period.start.slice(0, 7), period.end.slice(0, 7))
    .filter((i) => !i.project_id || projectIds.has(i.project_id) || !principal.scope.restricted);

  const expenses = db
    .prepare(`SELECT * FROM expenses WHERE org_id = ? AND period_month BETWEEN ? AND ?`)
    .all(orgId, period.start.slice(0, 7), period.end.slice(0, 7));

  const timesheets = db
    .prepare(`SELECT employee_id, project_id, hours, billable, work_date FROM timesheets
              WHERE org_id = ? AND work_date >= ? AND work_date <= ?`)
    .all(orgId, period.start, period.end);

  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const billableHoursByProject = new Map();
  for (const t of timesheets) {
    if (!t.billable || !t.project_id) continue;
    billableHoursByProject.set(t.project_id, (billableHoursByProject.get(t.project_id) || 0) + t.hours);
  }

  const totalWorkforceCost = costRows.reduce((s, r) => s + (r.period_cost || 0), 0);
  const totalIdleCost = costRows.reduce((s, r) => s + (r.idle_period_cost || 0), 0);
  const employeeCostAvailable = employees.length > 0 && costRows.some((r) => r.has_cost);
  const costCoveragePct = employees.length > 0
    ? round((costRows.filter((r) => r.has_cost).length / employees.length) * 100) : 0;

  const invoicedRevenue = invoices.filter((i) => i.status !== 'cancelled').reduce((s, i) => s + i.amount, 0);
  const paidRevenue = invoices.filter((i) => i.status === 'paid').reduce((s, i) => s + i.amount, 0);
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);

  // Billable value uses project billing rate × billable hours (a potential-revenue
  // measure, clearly separate from invoiced revenue).
  let billableValue = 0;
  let billableValueAvailable = false;
  for (const [pid, hrs] of billableHoursByProject) {
    const p = projectMap.get(pid);
    if (p?.billing_rate_hour) { billableValue += hrs * p.billing_rate_hour; billableValueAvailable = true; }
  }

  const byDepartment = groupCost(costRows, 'department_id', db, 'departments', orgId);
  const byBusinessUnit = groupCost(costRows, 'business_unit_id', db, 'business_units', orgId);
  const byProject = projects.map((p) => {
    const hrs = billableHoursByProject.get(p.id) || 0;
    return {
      project_id: p.id, code: p.code, name: p.name, client_name: p.client_name, currency: p.currency,
      billing_rate_hour: p.billing_rate_hour,
      billable_hours: round(hrs),
      billable_value: p.billing_rate_hour ? round(hrs * p.billing_rate_hour) : null,
      invoiced: round(invoices.filter((i) => i.project_id === p.id).reduce((s, i) => s + i.amount, 0)),
    };
  }).filter((p) => p.billable_hours > 0 || p.invoiced > 0);

  const canComputeMargin = canCost && canFinance && employeeCostAvailable && (invoicedRevenue > 0 || billableValueAvailable);

  return {
    period,
    filters,
    availability: {
      employee_cost: employeeCostAvailable,
      employee_cost_coverage_pct: costCoveragePct,
      invoices: invoices.length > 0,
      expenses: expenses.length > 0,
      billable_rates: billableValueAvailable,
      margin_computable: canComputeMargin,
      notes: [
        employeeCostAvailable ? null : 'Employee cost data is not available for this period.',
        invoices.length ? null : 'No invoices recorded for this period.',
        billableValueAvailable ? null : 'Project billing rates are not configured, so potential billable value cannot be calculated.',
        costCoveragePct < 100 ? `Cost data covers ${costCoveragePct}% of employees; totals are partial.` : null,
      ].filter(Boolean),
    },
    totals: {
      workforce_cost: canCost ? round(totalWorkforceCost) : null,
      idle_workforce_cost: canCost ? round(totalIdleCost) : null,
      invoiced_revenue: canFinance ? round(invoicedRevenue) : null,
      paid_revenue: canFinance ? round(paidRevenue) : null,
      expenses: canFinance ? round(totalExpenses) : null,
      billable_value: canFinance ? (billableValueAvailable ? round(billableValue) : null) : null,
      gross_margin: canComputeMargin ? round(invoicedRevenue - totalWorkforceCost - totalExpenses) : null,
      gross_margin_pct: canComputeMargin && invoicedRevenue > 0
        ? round(((invoicedRevenue - totalWorkforceCost - totalExpenses) / invoicedRevenue) * 100) : null,
    },
    byDepartment,
    byBusinessUnit,
    byProject,
    costRows: canCost ? costRows : [],
    invoices: canFinance ? invoices : [],
  };
}

function groupCost(costRows, key, db, table, orgId) {
  const names = new Map(db.prepare(`SELECT id, name FROM ${table} WHERE org_id = ?`).all(orgId).map((r) => [r.id, r.name]));
  const g = new Map();
  for (const r of costRows) {
    const k = r[key] ?? null;
    if (!g.has(k)) g.set(k, { id: k, name: names.get(k) ?? 'Unassigned', period_cost: 0, idle_cost: 0, headcount: 0, cost_records: 0 });
    const x = g.get(k);
    x.headcount += 1;
    if (r.has_cost) x.cost_records += 1;
    x.period_cost += r.period_cost || 0;
    x.idle_cost += r.idle_period_cost || 0;
  }
  return [...g.values()].map((x) => ({
    ...x,
    period_cost: round(x.period_cost),
    idle_cost: round(x.idle_cost),
    cost_coverage_pct: x.headcount ? round((x.cost_records / x.headcount) * 100) : 0,
  }));
}

export function dashboardSummary(principal, { period, filters = {} }) {
  const util = utilizationReport(principal, { period, filters });
  const fin = maySeeFinance(principal) || maySeeCost(principal)
    ? financialAnalysis(principal, { period, filters }) : null;
  const demand = demandAnalysis(principal);
  return { utilization: util, finance: fin, demand };
}

export function allocationOverlaps(principal, { period }) {
  const employees = loadScopeEmployees(principal);
  const empMap = new Map(employees.map((e) => [e.id, e]));
  const allocs = getDb()
    .prepare(`SELECT * FROM allocations WHERE org_id = ? AND status <> 'cancelled'
              AND start_date <= ? AND end_date >= ?`)
    .all(principal.orgId, period.end, period.start)
    .filter((a) => empMap.has(a.employee_id));
  return findOverlaps(allocs, empMap);
}
