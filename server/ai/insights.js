/**
 * Evidence-backed insight generation (rules engine + analytics).
 *
 * Each insight is stored with: finding, supporting evidence, business explanation,
 * quantified impact ONLY where the inputs support a defensible calculation,
 * assumptions, limitations, risks, next step and whether approval is required.
 * Nothing here takes an action or makes an employment decision.
 */
import { getDb, now } from '../db/index.js';
import { utilizationReport, financialAnalysis, demandAnalysis, allocationOverlaps, recentMonths, utilizationTrend } from '../services/analytics.js';
import { maySeeCost, maySeeFinance } from '../services/scope.js';
import { resolvePeriod, round } from '../lib/capacity.js';

const money = (n, cur) => `${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })} ${cur}`;

export function generateInsights(principal, { period, filters = {} }) {
  const db = getDb();
  const orgId = principal.orgId;
  const resolved = period || resolvePeriod({});
  const currency = principal.org?.currency || 'INR';
  const util = utilizationReport(principal, { period: resolved, filters });
  const demand = demandAnalysis(principal);
  const overlaps = allocationOverlaps(principal, { period: resolved });
  const costAllowed = maySeeCost(principal);
  const fin = costAllowed || maySeeFinance(principal) ? financialAnalysis(principal, { period: resolved, filters }) : null;
  const trend = utilizationTrend(principal, { months: recentMonths(6, resolved.end.slice(0, 7)), filters });

  const insights = [];
  const push = (i) => insights.push({
    assumptions: [], limitations: [], risks: [], requiresApproval: false,
    ...i,
    period_start: resolved.start, period_end: resolved.end,
  });

  // 1. Unallocated capacity concentration
  const byDept = util.byDepartment.slice().sort((a, b) => b.unallocated_hours - a.unallocated_hours);
  const topDept = byDept[0];
  if (topDept && topDept.unallocated_hours > 0 && util.total.unallocated_hours > 0) {
    const share = round((topDept.unallocated_hours / util.total.unallocated_hours) * 100);
    push({
      code: 'UNALLOCATED_CAPACITY_CONCENTRATION',
      category: 'capacity', severity: share > 50 ? 'high' : share > 30 ? 'medium' : 'low',
      title: `Unallocated capacity is concentrated in ${topDept.key}`,
      finding: `${topDept.key} holds ${topDept.unallocated_hours} unallocated hours, which is ${share}% of the ${util.total.unallocated_hours} unallocated hours across all departments in ${resolved.label}.`,
      explanation: `Unallocated hours are capacity that is available but not planned onto billable work. With ${topDept.headcount} people at ${topDept.allocation_pct}% average allocation, this team has more spare capacity than the rest of the organisation.`,
      evidence: {
        metric: 'unallocated_hours', value: topDept.unallocated_hours, unit: 'hours',
        comparison: { organisation_total: util.total.unallocated_hours, share_pct: share, department_headcount: topDept.headcount, allocation_pct: topDept.allocation_pct },
        period: resolved, source: 'Utilization report → Department roll-up', filters,
      },
      impact: costAllowed && fin?.availability.employee_cost
        ? { type: 'cost_of_unallocated_time', value: round(fin.byDepartment.find((d) => d.name === topDept.key)?.idle_cost ?? 0), unit: currency, basis: 'Employee period cost × unallocated share for that department. This is the cost of carrying spare capacity, not a saving already achieved.' }
        : null,
      assumptions: ['Allocations reflect planned work; unrecorded work is treated as unallocated capacity.'],
      limitations: [`Utilization in this department is based on timesheet coverage of ${topDept.utilization_confidence === 'full' ? 'all' : 'part of the'} team.`],
      risks: ['Moving people off projects to fill this capacity could destabilise current delivery.'],
      next_step: `Review ${topDept.key}'s pipeline against open demand before the next staffing cycle. Any reassignment needs the resource manager's approval.`,
    });
  }

  // 2. Over-allocation
  if (util.total.employees_over_allocated > 0) {
    push({
      code: 'EMPLOYEES_OVER_ALLOCATED',
      category: 'allocation', severity: util.total.over_allocated_hours > util.total.available_hours * 0.05 ? 'high' : 'medium',
      title: `${util.total.employees_over_allocated} people are over-allocated`,
      finding: `${util.total.employees_over_allocated} employees are allocated above their available capacity, totalling ${util.total.over_allocated_hours} excess hours in ${resolved.label}.`,
      explanation: 'Over-allocation means the plan asks for more hours than a person has available. It usually leads to slippage, unpaid overtime or quality problems, and it makes delivery dates unreliable.',
      evidence: {
        metric: 'over_allocated_hours', value: util.total.over_allocated_hours, unit: 'hours',
        comparison: { employees_affected: util.total.employees_over_allocated, headcount: util.total.headcount, available_hours: util.total.available_hours },
        period: resolved, source: 'Allocation register vs capacity engine', filters,
        employees: util.overAllocated.slice(0, 10).map((e) => ({ name: e.full_name, department: e.department, allocated: e.allocated_hours, available: e.available_hours, pct: e.allocation_pct })),
      },
      impact: null,
      assumptions: ['Allocation hours are planned hours, not recorded overtime.'],
      limitations: ['The platform cannot tell whether the extra hours were actually worked without timesheet data.'],
      risks: ['Reducing allocations may breach project commitments; increasing them risks burnout.'],
      next_step: 'Resource manager to confirm and rebalance the affected allocations. The platform will not change allocations automatically.',
      requiresApproval: true,
    });
  }

  // 3. Overlapping allocations
  if (overlaps.length) {
    push({
      code: 'OVERLAPPING_ALLOCATIONS',
      category: 'allocation', severity: overlaps.some((o) => o.over_capacity) ? 'high' : 'medium',
      title: `${overlaps.length} overlapping allocations detected`,
      finding: `${overlaps.length} pairs of allocations overlap in time for the same person; ${overlaps.filter((o) => o.over_capacity).length} of those exceed standard weekly hours.`,
      explanation: 'Two overlapping allocations are not automatically wrong (a person can split their week), but combined hours above capacity indicate a planning error or a genuine double-booking.',
      evidence: {
        metric: 'overlapping_allocations', value: overlaps.length, unit: 'pairs',
        comparisons: overlaps.slice(0, 10).map((o) => ({ employee: o.employee_name, from: o.overlap_from, to: o.overlap_to, combined_weekly_hours: o.combined_weekly_hours, standard: o.standard_weekly_hours })),
        period: resolved, source: 'Allocation register', filters,
      },
      assumptions: ['Split allocations are legitimate up to standard capacity.'],
      limitations: ['Overlap detection uses dated allocations only.'],
      risks: ['Continuous over-capacity allocation is a delivery and wellbeing risk.'],
      next_step: 'Check the flagged allocations and adjust end dates or hours where the split is unintended.',
      requiresApproval: true,
    });
  }

  // 4. Demand coverage gaps
  const uncovered = demand.gaps.filter((g) => (g.coverage_pct ?? 0) < 80);
  if (uncovered.length) {
    const worst = uncovered[0];
    push({
      code: 'DEMAND_COVERAGE_GAP',
      category: 'demand', severity: worst.priority === 'critical' ? 'critical' : uncovered.length > 3 ? 'high' : 'medium',
      title: `${uncovered.length} staffing demands are under-covered`,
      finding: `${uncovered.length} open demand records are below 80% allocation coverage. The lowest is ${worst.project_name} (${worst.role_title}) at ${worst.coverage_pct ?? 0}% coverage, a shortfall of ${worst.gap_hours} hours.`,
      explanation: 'Demand records describe the people a project needs. When dated allocations do not cover that demand, delivery is at risk unless staffing changes.',
      evidence: {
        metric: 'uncovered_demand_hours', value: round(uncovered.reduce((s, g) => s + g.gap_hours, 0)), unit: 'hours',
        comparison: uncovered.slice(0, 10).map((g) => ({ project: g.project_name, role: g.role_title, skill: g.required_skill, coverage_pct: g.coverage_pct, gap_hours: g.gap_hours, start: g.start_date, priority: g.priority })),
        period: resolved, source: 'Project demand register vs allocations', filters,
      },
      assumptions: ['A person allocated without the required skill still counts as covering hours; skill fit is reported separately.'],
      limitations: ['Skill matching depends on complete employee skill records.'],
      risks: ['Excess demand may force contractor spend or schedule changes.'],
      next_step: `Resource manager to review ${worst.project_name} first, using skill-matched candidates where available. Hiring and contractor decisions require human approval.`,
    });
  }

  // 5. Utilization trend
  const actuals = trend.filter((t) => t.utilization_pct != null && t.headcount > 0);
  if (actuals.length >= 3) {
    const first = actuals[0], last = actuals.at(-1);
    const delta = round(last.utilization_pct - first.utilization_pct);
    if (Math.abs(delta) >= 5) {
      push({
        code: 'UTILIZATION_TREND_SHIFT',
        category: 'capacity', severity: Math.abs(delta) >= 10 ? 'high' : 'medium',
        title: `Utilization has ${delta > 0 ? 'risen' : 'fallen'} ${Math.abs(delta)} points since ${first.month}`,
        finding: `Utilization moved from ${first.utilization_pct}% in ${first.month} to ${last.utilization_pct}% in ${last.month}.`,
        explanation: delta > 0
          ? 'Rising utilization increases billed delivery but can hide overwork. Check it against over-allocation before treating it as good news.'
          : 'Falling utilization means capacity is not being converted into work. If demand has not fallen, the likely cause is recording gaps or poor allocation, not idleness.',
        evidence: {
          metric: 'utilization_pct', value: last.utilization_pct, unit: '%', change_points: delta,
          comparison: actuals.map((a) => ({ month: a.month, utilization_pct: a.utilization_pct, allocation_pct: a.allocation_pct, coverage: a.timesheet_coverage_pct })),
          period: resolved, source: 'Timesheets vs capacity', filters,
        },
        assumptions: ['Utilization compares timesheet hours with capacity in the same month.'],
        limitations: actuals.some((a) => a.timesheet_coverage_pct < 90) ? ['Some months have incomplete timesheet coverage.'] : [],
        risks: ['A trend based on partial data can mislead; confirm coverage before acting.'],
        next_step: 'Confirm timesheet completeness for the affected months before making staffing decisions.',
      });
    }
  }

  // 6. Cost movement (only when cost data exists)
  if (costAllowed && fin?.availability.employee_cost) {
    const costDepts = fin.byDepartment.filter((d) => d.period_cost > 0).sort((a, b) => b.idle_cost - a.idle_cost);
    if (costDepts[0]?.idle_cost > 0 && fin.totals.workforce_cost > 0) {
      const share = round((costDepts[0].idle_cost / fin.totals.workforce_cost) * 100);
      push({
        code: 'IDLE_WORKFORCE_COST',
        category: 'cost', severity: share > 30 ? 'high' : 'medium',
        title: `Unallocated time is costing ${money(costDepts[0].idle_cost, currency)} in ${costDepts[0].name}`,
        finding: `${costDepts[0].name} carries ${money(costDepts[0].idle_cost, currency)} of workforce cost tied to time not allocated to any project in ${resolved.label}, ${share}% of total workforce cost.`,
        explanation: 'Salary is paid whether or not a person is on a project. This figure shows the cost of that spare capacity so it can be planned for deliberately.',
        evidence: {
          metric: 'idle_workforce_cost', value: costDepts[0].idle_cost, unit: currency,
          comparison: { department: costDepts[0].name, department_total_cost: costDepts[0].period_cost, organisation_workforce_cost: fin.totals.workforce_cost, cost_coverage_pct: fin.availability.employee_cost_coverage_pct },
          period: resolved, source: 'Employee cost records × allocation', filters,
        },
        impact: {
          type: 'cost_of_unallocated_capacity', value: costDepts[0].idle_cost, unit: currency,
          basis: 'Employee annual cost ÷ 12 pro-rated to the period, multiplied by the unallocated share. It is a cost of carrying capacity, not a saving.',
        },
        assumptions: ['Annual employer cost is the cost basis.', 'Unallocated share is derived from dated allocations.'],
        limitations: [`Cost data covers ${fin.availability.employee_cost_coverage_pct}% of employees.`],
        risks: ['Reducing this cost by releasing people has legal, contractual and morale implications; it is a management decision, not an automated one.'],
        next_step: 'Finance and workforce leaders to review whether the unallocated cost is temporary between projects or structural.',
        requiresApproval: true,
      });
    }
  }

  // 7. Data quality
  const qualityIssues = [];
  if (util.total.timesheet_coverage_pct < 90) qualityIssues.push(`timesheet coverage is ${util.total.timesheet_coverage_pct}%`);
  const counts = db.prepare(`SELECT
      (SELECT COUNT(*) FROM employees WHERE org_id = ?) employees,
      (SELECT COUNT(*) FROM employees WHERE org_id = ? AND annual_cost IS NULL) employees_without_cost,
      (SELECT COUNT(*) FROM project_demand WHERE org_id = ?) demand,
      (SELECT COUNT(*) FROM invoices WHERE org_id = ?) invoices,
      (SELECT COUNT(*) FROM employees WHERE org_id = ? AND department_id IS NULL) employees_without_department`).get(orgId, orgId, orgId, orgId, orgId);
  if (counts.employees_without_cost > 0) qualityIssues.push(`${counts.employees_without_cost} of ${counts.employees} employees have no cost recorded`);
  if (counts.employees_without_department > 0) qualityIssues.push(`${counts.employees_without_department} employees are not assigned to a department`);
  if (counts.invoices === 0) qualityIssues.push('no invoices are loaded, so revenue and margin cannot be reported');
  if (counts.demand === 0) qualityIssues.push('no project demand is recorded, so staffing gaps cannot be assessed');
  if (qualityIssues.length) {
    push({
      code: 'DATA_QUALITY_INCOMPLETE',
      category: 'data_quality', severity: qualityIssues.length > 2 ? 'high' : 'medium',
      title: `${qualityIssues.length} data completeness issue${qualityIssues.length === 1 ? '' : 's'} limit reporting`,
      finding: `Reporting accuracy is limited because ${qualityIssues.join('; ')}.`,
      explanation: 'The platform reports only what the data supports. Missing inputs are stated rather than estimated, so figures like utilization and margin may be conservative or unavailable.',
      evidence: {
        metric: 'data_completeness_issues', value: qualityIssues.length, unit: 'issues',
        comparison: qualityIssues, period: resolved, source: 'Data catalogue and import history', filters,
      },
      assumptions: [],
      limitations: ['This checks presence of data, not its correctness; use the Data page validation report for correctness.'],
      risks: ['Decisions taken on incomplete data may be wrong.'],
      next_step: 'Upload the missing data sets (Data → Upload) or have Finance complete the cost and invoice records.',
    });
  }

  // Persist with upsert so repeated generation doesn't duplicate.
  const inserted = [];
  const stmt = db.prepare(`INSERT INTO ai_insights (org_id, code, category, severity, title, finding, explanation, evidence,
      impact, assumptions, limitations, risks, next_step, requires_approval, status, period_start, period_end, generated_by, generated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, 'rules_engine', ?)
      ON CONFLICT(org_id, code, period_start, period_end) DO UPDATE SET
        severity = excluded.severity, title = excluded.title, finding = excluded.finding,
        explanation = excluded.explanation, evidence = excluded.evidence, impact = excluded.impact,
        assumptions = excluded.assumptions, limitations = excluded.limitations, risks = excluded.risks,
        next_step = excluded.next_step, requires_approval = excluded.requires_approval, generated_at = excluded.generated_at`);
  for (const i of insights) {
    stmt.run(orgId, i.code, i.category, i.severity, i.title, i.finding, i.explanation, JSON.stringify(i.evidence),
      i.impact ? JSON.stringify(i.impact) : null, JSON.stringify(i.assumptions), JSON.stringify(i.limitations),
      JSON.stringify(i.risks), i.next_step, i.requiresApproval ? 1 : 0,
      i.period_start, i.period_end, now());
    inserted.push(i.code);
  }

  return { generated: inserted.length, codes: inserted, period: resolved, insights };
}

export function listInsights(principal, { status = null, category = null } = {}) {
  const db = getDb();
  const where = ['org_id = ?'];
  const params = [principal.orgId];
  if (status) { where.push('status = ?'); params.push(status); }
  if (category) { where.push('category = ?'); params.push(category); }
  const rows = db.prepare(`SELECT * FROM ai_insights WHERE ${where.join(' AND ')} ORDER BY
      CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
      generated_at DESC`).all(...params);
  return rows.map((r) => ({
    ...r,
    evidence: safeParse(r.evidence, {}),
    impact: r.impact ? safeParse(r.impact, null) : null,
    assumptions: safeParse(r.assumptions, []),
    limitations: safeParse(r.limitations, []),
    risks: safeParse(r.risks, []),
    requires_approval: Boolean(r.requires_approval),
  }));
}

function safeParse(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}
