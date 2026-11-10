/**
 * Capacity, allocation and utilization engine.
 *
 * DEFINITIONS (these are exposed verbatim to customers in the UI and reports):
 *
 *  Standard weekly capacity (hours)
 *    = employee.weekly_hours if the customer supplied it (this is the person's
 *      CONTRACTED weekly hours and is used as-is — FTE is not applied again, which
 *      would double-reduce part-time capacity)
 *      else location.hours_per_day × number of working days for the location × employee.fte
 *
 *  Available hours in a period = standard weekly capacity / 7 × days in period,
 *    counting MONDAY–FRIDAY only by default (configurable working days), excluding
 *    days the employee is not "active" (before join_date / after exit_date).
 *    Public holidays configured on the location are excluded.
 *
 *  Allocated hours = Σ over allocations overlapping the period of
 *    hours_per_week / 7 × overlap days (weekends excluded).
 *
 *  Utilized (productive) hours = approved/logged timesheet hours in the period.
 *    This is DIFFERENT from allocation: allocation is a plan, utilization is actual work.
 *    They are never added together and never presented as the same measure.
 *
 *  Utilization %   = utilized hours / available hours
 *  Allocation %    = allocated hours / available hours          (>100% = over-allocated)
 *  Unallocated hrs = max(available − allocated, 0)   -- "idle / bench capacity"
 *  Over-allocated  = max(allocated − available, 0)
 *  Billable %      = billable utilized hours / utilized hours
 *
 *  Exclusions: exited employees, employees outside their active window, cancelled
 *  allocations, cancelled projects and rows outside the requested period are excluded.
 *
 * All figures returned by this module carry the assumptions used, so AI and reports
 * can show their working rather than presenting a bare number.
 */

const DAY = 86400000;

export function parseDate(s) {
  if (!s) return null;
  const d = new Date(`${String(s).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
export const iso = (d) => new Date(d).toISOString().slice(0, 10);
export const addDays = (d, n) => new Date(new Date(d).getTime() + n * DAY);
export const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / DAY);

export function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 0));
  return { start: iso(start), end: iso(end) };
}

export function quarterRange(year, q) {
  const startMonth = (q - 1) * 3;
  const start = new Date(Date.UTC(year, startMonth, 1));
  const end = new Date(Date.UTC(year, startMonth + 3, 0));
  return { start: iso(start), end: iso(end) };
}

/**
 * Resolve a period spec into {start, end, label}.
 * Accepts explicit from/to, a month, a quarter or a rolling window.
 */
export function resolvePeriod({ from, to, month, quarter, year, days } = {}, reference = new Date()) {
  if (from && to) {
    const s = parseDate(from), e = parseDate(to);
    if (!s || !e) throw Object.assign(new Error('Invalid period dates.'), { status: 400 });
    if (s > e) throw Object.assign(new Error('Period start must be before end.'), { status: 400 });
    return { start: iso(s), end: iso(e), label: `${iso(s)} to ${iso(e)}` };
  }
  if (month) {
    const r = monthRange(month);
    return { ...r, label: month };
  }
  if (quarter && year) {
    const r = quarterRange(Number(year), Number(quarter));
    return { ...r, label: `Q${quarter} ${year}` };
  }
  if (days) {
    const end = iso(reference);
    const start = iso(addDays(reference, -(Number(days) - 1)));
    return { start, end, label: `Last ${days} days` };
  }
  const r = monthRange(iso(reference).slice(0, 7));
  return { ...r, label: iso(reference).slice(0, 7) };
}

/** Count working days in [start,end] for a given set of weekday numbers (0=Sun). */
export function workingDaysIn(start, end, workingDays = [1, 2, 3, 4, 5], holidays = []) {
  const s = parseDate(start), e = parseDate(end);
  if (!s || !e || s > e) return 0;
  const hol = new Set(holidays || []);
  let count = 0;
  for (let d = new Date(s); d <= e; d = addDays(d, 1)) {
    if (!workingDays.includes(d.getUTCDay())) continue;
    if (hol.has(iso(d))) continue;
    count += 1;
  }
  return count;
}

function overlapDays(aStart, aEnd, bStart, bEnd, workingDays, holidays) {
  const s = new Date(Math.max(parseDate(aStart), parseDate(bStart)));
  const e = new Date(Math.min(parseDate(aEnd), parseDate(bEnd)));
  if (s > e) return 0;
  return workingDaysIn(iso(s), iso(e), workingDays, holidays);
}

export function standardWeeklyHours(emp, location) {
  // Explicit contracted weekly hours already account for part-time arrangements.
  if (emp.weekly_hours != null && Number(emp.weekly_hours) > 0) return Number(emp.weekly_hours);
  const hoursPerDay = location?.hours_per_day ?? 8;
  const wd = location ? safeJson(location.working_days, [1, 2, 3, 4, 5]) : [1, 2, 3, 4, 5];
  return hoursPerDay * wd.length * (emp.fte ?? 1);
}

function safeJson(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

/** Is the employee active during any part of the period? */
export function isActiveInPeriod(emp, start, end) {
  if (emp.status === 'exited') {
    // An exited employee may have worked part of the period — we only count until exit_date.
    if (!emp.exit_date) return false;
    return parseDate(emp.exit_date) >= parseDate(start);
  }
  if (emp.join_date && parseDate(emp.join_date) > parseDate(end)) return false;
  return true;
}

/** Effective active window clipped to the requested period. */
function activeWindow(emp, start, end) {
  let s = parseDate(start), e = parseDate(end);
  if (emp.join_date) {
    const j = parseDate(emp.join_date);
    if (j > s) s = j;
  }
  if (emp.exit_date) {
    const x = parseDate(emp.exit_date);
    if (x < e) e = x;
  }
  if (s > e) return null;
  return { start: iso(s), end: iso(e) };
}

/**
 * Core computation for a set of employees over a period.
 * Pure function: no DB access, so it is fully unit-testable.
 */
export function computeCapacity({
  employees,
  locationsById,
  allocations,
  timesheets,
  start,
  end,
  workingDays = [1, 2, 3, 4, 5],
  holidays = [],
}) {
  const rows = [];
  const allocByEmp = new Map();
  for (const a of allocations) {
    if (a.status === 'cancelled') continue;
    if (!allocByEmp.has(a.employee_id)) allocByEmp.set(a.employee_id, []);
    allocByEmp.get(a.employee_id).push(a);
  }
  const tsByEmp = new Map();
  for (const t of timesheets) {
    if (!tsByEmp.has(t.employee_id)) tsByEmp.set(t.employee_id, []);
    tsByEmp.get(t.employee_id).push(t);
  }

  for (const emp of employees) {
    if (!isActiveInPeriod(emp, start, end)) continue;
    const win = activeWindow(emp, start, end);
    if (!win) continue;
    const location = locationsById.get(emp.location_id) || null;
    const locWorkingDays = location ? safeJson(location.working_days, workingDays) : workingDays;
    const locHolidays = location ? safeJson(location.holidays, []) : [];
    const weekly = standardWeeklyHours(emp, location);
    const periodWorkingDays = workingDaysIn(win.start, win.end, locWorkingDays, locHolidays);
    const availableHours = (weekly / 5) * periodWorkingDays;

    let allocatedHours = 0;
    const projectIds = new Set();
    for (const a of allocByEmp.get(emp.id) || []) {
      const ov = overlapDays(a.start_date, a.end_date, win.start, win.end, locWorkingDays, locHolidays);
      const hrs = (a.hours_per_week / 5) * ov;
      allocatedHours += hrs;
      if (ov > 0 && a.project_id) projectIds.add(a.project_id);
    }

    let utilizedHours = 0, billableHours = 0, timesheetRows = 0;
    for (const t of tsByEmp.get(emp.id) || []) {
      if (t.work_date < win.start || t.work_date > win.end) continue;
      utilizedHours += t.hours;
      timesheetRows += 1;
      if (t.billable) billableHours += t.hours;
    }

    const unallocatedHours = Math.max(availableHours - allocatedHours, 0);
    const overAllocatedHours = Math.max(allocatedHours - availableHours, 0);

    rows.push({
      employee_id: emp.id,
      employee_code: emp.employee_code,
      full_name: emp.full_name,
      department_id: emp.department_id,
      business_unit_id: emp.business_unit_id,
      location_id: emp.location_id,
      designation: emp.designation,
      status: emp.status,
      weekly_hours: round(weekly),
      working_days: periodWorkingDays,
      available_hours: round(availableHours),
      allocated_hours: round(allocatedHours),
      utilized_hours: round(utilizedHours),
      billable_hours: round(billableHours),
      unallocated_hours: round(unallocatedHours),
      over_allocated_hours: round(overAllocatedHours),
      allocation_pct: availableHours > 0 ? round((allocatedHours / availableHours) * 100) : null,
      // Null (not zero) when no timesheet exists: absence of data is not zero utilization.
      utilization_pct: availableHours > 0 && timesheetRows > 0 ? round((utilizedHours / availableHours) * 100) : null,
      billable_pct: utilizedHours > 0 ? round((billableHours / utilizedHours) * 100) : null,
      project_count: projectIds.size,
      has_timesheet_data: (tsByEmp.get(emp.id) || []).length > 0,
    });
  }
  return rows;
}

export function round(n, dp = 1) {
  if (n == null || Number.isNaN(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Roll up employee rows into a grouping (department, business unit, location). */
export function rollup(rows, key) {
  const groups = new Map();
  for (const r of rows) {
    const k = r[key] ?? null;
    if (!groups.has(k)) {
      groups.set(k, {
        key: k,
        headcount: 0,
        available_hours: 0,
        allocated_hours: 0,
        utilized_hours: 0,
        billable_hours: 0,
        unallocated_hours: 0,
        over_allocated_hours: 0,
        employees_with_timesheets: 0,
        employees_over_allocated: 0,
      });
    }
    const g = groups.get(k);
    g.headcount += 1;
    g.available_hours += r.available_hours;
    g.allocated_hours += r.allocated_hours;
    g.utilized_hours += r.utilized_hours;
    g.billable_hours += r.billable_hours;
    g.unallocated_hours += r.unallocated_hours;
    g.over_allocated_hours += r.over_allocated_hours;
    if (r.has_timesheet_data) g.employees_with_timesheets += 1;
    if (r.over_allocated_hours > 0) g.employees_over_allocated += 1;
  }
  return [...groups.values()].map((g) => ({
    ...g,
    available_hours: round(g.available_hours),
    allocated_hours: round(g.allocated_hours),
    utilized_hours: round(g.utilized_hours),
    billable_hours: round(g.billable_hours),
    unallocated_hours: round(g.unallocated_hours),
    over_allocated_hours: round(g.over_allocated_hours),
    allocation_pct: g.available_hours > 0 ? round((g.allocated_hours / g.available_hours) * 100) : null,
    utilization_pct: g.available_hours > 0 && g.employees_with_timesheets > 0
      ? round((g.utilized_hours / g.available_hours) * 100) : null,
    billable_pct: g.utilized_hours > 0 ? round((g.billable_hours / g.utilized_hours) * 100) : null,
    // Whether utilization is based on complete timesheet coverage for this group.
    utilization_confidence: g.employees_with_timesheets === 0
      ? 'no_timesheets'
      : g.employees_with_timesheets === g.headcount ? 'full' : 'partial',
  }));
}

/** Total-level summary used by dashboards and the AI engine. */
export function summarize(rows) {
  const t = {
    headcount: rows.length,
    available_hours: 0, allocated_hours: 0, utilized_hours: 0, billable_hours: 0,
    unallocated_hours: 0, over_allocated_hours: 0,
    employees_with_timesheets: 0, employees_over_allocated: 0, employees_bench: 0,
  };
  for (const r of rows) {
    t.available_hours += r.available_hours;
    t.allocated_hours += r.allocated_hours;
    t.utilized_hours += r.utilized_hours;
    t.billable_hours += r.billable_hours;
    t.unallocated_hours += r.unallocated_hours;
    t.over_allocated_hours += r.over_allocated_hours;
    if (r.has_timesheet_data) t.employees_with_timesheets += 1;
    if (r.over_allocated_hours > 0) t.employees_over_allocated += 1;
    if (r.allocation_pct != null && r.allocation_pct < 1) t.employees_bench += 1;
  }
  return {
    ...t,
    available_hours: round(t.available_hours),
    allocated_hours: round(t.allocated_hours),
    utilized_hours: round(t.utilized_hours),
    billable_hours: round(t.billable_hours),
    unallocated_hours: round(t.unallocated_hours),
    over_allocated_hours: round(t.over_allocated_hours),
    allocation_pct: t.available_hours > 0 ? round((t.allocated_hours / t.available_hours) * 100) : null,
    utilization_pct: t.available_hours > 0 && t.employees_with_timesheets > 0
      ? round((t.utilized_hours / t.available_hours) * 100) : null,
    billable_pct: t.utilized_hours > 0 ? round((t.billable_hours / t.utilized_hours) * 100) : null,
    timesheet_coverage_pct: t.headcount > 0 ? round((t.employees_with_timesheets / t.headcount) * 100) : 0,
  };
}

/** Detect overlapping allocations for the same employee (double-booking risk). */
export function findOverlaps(allocations, employeesById) {
  const byEmp = new Map();
  for (const a of allocations) {
    if (a.status === 'cancelled') continue;
    if (!byEmp.has(a.employee_id)) byEmp.set(a.employee_id, []);
    byEmp.get(a.employee_id).push(a);
  }
  const findings = [];
  for (const [empId, list] of byEmp) {
    list.sort((x, y) => (x.start_date < y.start_date ? -1 : 1));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (b.start_date > a.end_date) break;
        const overlapStart = a.start_date > b.start_date ? a.start_date : b.start_date;
        const overlapEnd = a.end_date < b.end_date ? a.end_date : b.end_date;
        if (overlapStart > overlapEnd) continue;
        const totalWeekly = a.hours_per_week + b.hours_per_week;
        const emp = employeesById.get(empId);
        const capacity = emp ? standardWeeklyHours(emp, null) : 40;
        findings.push({
          employee_id: empId,
          employee_name: emp?.full_name || `#${empId}`,
          allocation_a: { id: a.id, project_id: a.project_id, from: a.start_date, to: a.end_date, hrs: a.hours_per_week },
          allocation_b: { id: b.id, project_id: b.project_id, from: b.start_date, to: b.end_date, hrs: b.hours_per_week },
          overlap_from: overlapStart,
          overlap_to: overlapEnd,
          combined_weekly_hours: round(totalWeekly),
          standard_weekly_hours: round(capacity),
          over_capacity: totalWeekly > capacity,
        });
      }
    }
  }
  return findings;
}
