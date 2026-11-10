import express from 'express';
import { getDb } from '../db/index.js';
import { ah, requireAuth, requirePermission, requireAnyPermission, tenantContext } from '../auth/middleware.js';
import { requireOrg } from '../lib/guards.js';
import { ok } from '../lib/http.js';
import { resolvePeriod } from '../lib/capacity.js';
import {
  utilizationReport, utilizationTrend, dashboardSummary, financialAnalysis,
  demandAnalysis, allocationOverlaps, recentMonths,
} from '../services/analytics.js';
import { getOrgSettings } from '../services/onboarding.js';

const router = express.Router();
router.use(requireAuth, tenantContext, requireOrg);

function periodFrom(req) {
  const q = req.query;
  if (q.from && q.to) return resolvePeriod({ from: q.from, to: q.to });
  if (q.quarter && q.year) return resolvePeriod({ quarter: q.quarter, year: q.year });
  if (q.month) return resolvePeriod({ month: q.month });
  if (q.days) return resolvePeriod({ days: q.days });
  return resolvePeriod({ month: new Date().toISOString().slice(0, 7) });
}

function filtersFrom(req) {
  const f = {};
  for (const k of ['business_unit_id', 'department_id', 'location_id', 'project_id']) {
    if (req.query[k]) f[k] = Number(req.query[k]);
  }
  return f;
}

/** Dashboard payload: one call, consistent numbers, freshness indicators. */
router.get('/dashboard', requireAnyPermission('analytics.utilization', 'analytics.executive'), ah(async (req, res) => {
  const period = periodFrom(req);
  const filters = filtersFrom(req);
  const data = dashboardSummary(req.user, { period, filters });
  const db = getDb();

  const latest = db.prepare(`SELECT
      (SELECT MAX(work_date) FROM timesheets WHERE org_id = ?) last_timesheet_date,
      (SELECT MAX(committed_at) FROM imports WHERE org_id = ? AND status = 'committed') last_import_at,
      (SELECT MAX(generated_at) FROM ai_insights WHERE org_id = ?) last_insight_at`).get(req.orgId, req.orgId, req.orgId);

  const months = recentMonths(6, period.end.slice(0, 7));
  const trend = utilizationTrend(req.user, { months, filters });
  const openInsights = db.prepare(`SELECT COUNT(*) c FROM ai_insights WHERE org_id = ? AND status = 'open'`).get(req.orgId).c;

  return ok(res, {
    period,
    filters,
    utilization: {
      total: data.utilization.total,
      definitions: data.utilization.definitions,
      byDepartment: data.utilization.byDepartment,
      byBusinessUnit: data.utilization.byBusinessUnit,
      byLocation: data.utilization.byLocation,
      overAllocated: data.utilization.overAllocated.slice(0, 10),
      idle: data.utilization.idle.slice(0, 10),
    },
    trend,
    demand: { gaps: data.demand.gaps.slice(0, 10), total_gaps: data.demand.gaps.length },
    finance: data.finance ? {
      availability: data.finance.availability,
      totals: data.finance.totals,
      byDepartment: data.finance.byDepartment,
      byProject: data.finance.byProject.slice(0, 10),
    } : null,
    dataFreshness: {
      last_timesheet_date: latest.last_timesheet_date,
      last_import_at: latest.last_import_at,
      last_insight_at: latest.last_insight_at,
      generated_at: new Date().toISOString(),
    },
    openInsights,
    settings: getOrgSettings(req.orgId).utilization,
  });
}));

router.get('/utilization', requirePermission('analytics.utilization'), ah(async (req, res) => {
  const period = periodFrom(req);
  const filters = filtersFrom(req);
  const report = utilizationReport(req.user, { period, filters });
  return ok(res, report);
}));

router.get('/utilization/trend', requirePermission('analytics.utilization'), ah(async (req, res) => {
  const months = req.query.months
    ? String(req.query.months).split(',').filter((m) => /^\d{4}-\d{2}$/.test(m))
    : recentMonths(Number(req.query.count) || 6, (req.query.end || new Date().toISOString().slice(0, 7)));
  return ok(res, utilizationTrend(req.user, { months, filters: filtersFrom(req) }));
}));

router.get('/financial', requireAnyPermission('finance.view', 'workforce.cost.view'), ah(async (req, res) => {
  const period = periodFrom(req);
  return ok(res, financialAnalysis(req.user, { period, filters: filtersFrom(req) }));
}));

router.get('/demand', requirePermission('project.view'), ah(async (req, res) => ok(res, demandAnalysis(req.user))));

router.get('/overlaps', requirePermission('allocation.view'), ah(async (req, res) => {
  const period = periodFrom(req);
  return ok(res, allocationOverlaps(req.user, { period }));
}));

/** Metric definitions — shown in the UI so no number is ambiguous. */
router.get('/definitions', requireAuth, ah(async (req, res) => {
  const settings = getOrgSettings(req.orgId);
  return ok(res, {
    metrics: [
      { key: 'available_hours', name: 'Available hours', formula: 'Standard weekly hours ÷ 5 × working days in period (excludes configured holidays and non-working weekdays)', notes: 'Standard weekly hours = the employee’s contracted weekly hours when supplied; otherwise location hours/day × working weekdays × FTE. FTE is never applied twice.' },
      { key: 'allocated_hours', name: 'Allocated hours', formula: 'Σ (allocation hours per week ÷ 5 × overlapping working days)', notes: 'Cancelled allocations are excluded. Allocations are a plan, not actual work.' },
      { key: 'utilized_hours', name: 'Utilized hours', formula: 'Σ timesheet hours in the period', notes: 'Actual recorded work. Requires the Timesheets data set.' },
      { key: 'allocation_pct', name: 'Allocation %', formula: 'Allocated hours ÷ available hours × 100', notes: 'Above 100% means over-allocation.' },
      { key: 'utilization_pct', name: 'Utilization %', formula: 'Utilized hours ÷ available hours × 100', notes: 'Not measurable without timesheets; shown as blank rather than zero.' },
      { key: 'unallocated_hours', name: 'Unallocated capacity', formula: 'max(available − allocated, 0)', notes: 'Bench / idle capacity. Not the same as non-billable time.' },
      { key: 'over_allocated_hours', name: 'Over-allocation', formula: 'max(allocated − available, 0)', notes: 'Planned hours above capacity.' },
      { key: 'billable_pct', name: 'Billable %', formula: 'Billable timesheet hours ÷ total timesheet hours × 100', notes: 'Derived from timesheet billable flags.' },
      { key: 'workforce_cost', name: 'Workforce cost (period)', formula: 'Annual employer cost ÷ 12 × (working days in period ÷ 21 working days per month)', notes: 'Only available for employees with cost data. Partial coverage is stated.' },
      { key: 'idle_workforce_cost', name: 'Cost of unallocated time', formula: 'Employee period cost × unallocated share', notes: 'Cost of carrying spare capacity. It is not a saving already achieved.' },
      { key: 'gross_margin', name: 'Gross margin', formula: 'Invoiced revenue − workforce cost − operating expenses', notes: 'Shown only when all three inputs exist. Not the same as billable value.' },
      { key: 'demand_coverage_pct', name: 'Demand coverage %', formula: 'Allocated hours matched to demand ÷ required hours × 100', notes: 'Skill suitability is reported separately from hour coverage.' },
    ],
    calculation_settings: settings.utilization || {},
    currency: req.user.org?.currency || 'INR',
    note: 'Definitions are fixed by the platform so results are reproducible. Customer-specific targets can be configured, but formulas are not silently changed.',
  });
}));

export default router;
