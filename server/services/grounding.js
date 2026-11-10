/**
 * Grounding layer.
 *
 * The assistant NEVER queries the database directly and never receives free-form
 * customer text. It receives a "fact pack": a small, permission-filtered, aggregate
 * JSON object built by the analytics services. The same pack is used to render the
 * evidence panel in the UI, so the answer and its evidence can never diverge.
 */
import { getDb } from '../db/index.js';
import {
  utilizationReport, financialAnalysis, demandAnalysis, allocationOverlaps,
  recentMonths, utilizationTrend,
} from './analytics.js';
import { resolvePeriod, round } from '../lib/capacity.js';
import { maySeeCost, maySeeFinance } from './scope.js';
import { ENTITY_SCHEMAS } from '../ingestion/schemas.js';

export const SUPPORTED_INTENTS = [
  'unallocated_capacity',
  'over_allocation',
  'staffing_gaps',
  'utilization_trend',
  'cost_trend',
  'operational_risks',
  'data_quality',
  'finance_summary',
  'headcount_summary',
  'definition_help',
  'capability',
  'unknown',
];

const INTENT_PATTERNS = [
  { intent: 'unallocated_capacity', patterns: [/unallocat/i, /bench/i, /idle/i, /available capacity/i, /free capacity/i, /spare capacity/i, /not allocated/i] },
  { intent: 'over_allocation', patterns: [/over.?allocat/i, /double.?book/i, /overloaded/i, /too much work/i, /over capacity/i, /burnout/i] },
  { intent: 'staffing_gaps', patterns: [/staffing gap/i, /gap/i, /unfilled/i, /demand/i, /hiring need/i, /shortage/i, /open position/i] },
  { intent: 'utilization_trend', patterns: [/utilization.*(chang|trend|quarter|month|improv|declin)/i, /(trend|chang).*utilization/i, /how.*utilization/i, /billable/i] },
  { intent: 'cost_trend', patterns: [/cost/i, /spend/i, /expense/i, /salary/i, /workforce cost/i, /increasing.*cost/i] },
  { intent: 'operational_risks', patterns: [/risk/i, /concern/i, /problem/i, /issue/i, /what should management/i, /attention/i] },
  { intent: 'data_quality', patterns: [/data quality/i, /missing/i, /incomplete/i, /reliable/i, /trust/i, /accuracy/i, /required.*forecast/i, /what additional/i] },
  { intent: 'finance_summary', patterns: [/revenue/i, /margin/i, /billing/i, /invoice/i, /profitab/i, /financial/i] },
  { intent: 'headcount_summary', patterns: [/headcount/i, /how many (people|employees|resources)/i, /team size/i, /workforce size/i] },
  { intent: 'definition_help', patterns: [/what does .* mean/i, /definition/i, /how (do|is) you (calculate|compute)/i, /formula/i, /explain .* (metric|utilization|allocation)/i] },
  { intent: 'capability', patterns: [/what can you do/i, /help me/i, /who are you/i, /what questions/i] },
];

export function detectIntent(question) {
  const q = String(question || '');
  for (const { intent, patterns } of INTENT_PATTERNS) {
    if (patterns.some((p) => p.test(q))) return intent;
  }
  return 'unknown';
}

/** Facts are always scoped to the user's tenant + data scope + entitlements. */
export function buildFactPack(principal, { period, filters = {}, question = '' } = {}) {
  const orgId = principal.orgId;
  // Accept either a period spec ({month}, {quarter,year}, {from,to}) or an already
  // resolved period ({start,end}). Passing a resolved period must not silently
  // fall back to the current month.
  const spec = period && period.start && period.end
    ? { from: period.start, to: period.end }
    : (period || {});
  const resolved = resolvePeriod(spec);
  const facts = {
    organization: principal.org?.name,
    currency: principal.org?.currency || 'INR',
    period: { start: resolved.start, end: resolved.end, label: resolved.label },
    filters,
    permissions_applied: {
      cost_data_included: maySeeCost(principal),
      finance_data_included: maySeeFinance(principal),
      scope_restricted: principal.scope.restricted,
      scope_business_units: principal.scope.businessUnitIds,
      scope_departments: principal.scope.departmentIds,
    },
    metrics: {},
    series: {},
    data_quality: {},
    unavailable: [],
  };

  const util = utilizationReport(principal, { period: resolved, filters });
  facts.metrics.utilization = util.total;
  facts.metrics.by_department = util.byDepartment.map((d) => ({
    department: d.key, headcount: d.headcount, available_hours: d.available_hours,
    allocated_hours: d.allocated_hours, utilized_hours: d.utilized_hours,
    unallocated_hours: d.unallocated_hours, allocation_pct: d.allocation_pct,
    utilization_pct: d.utilization_pct, over_allocated_hours: d.over_allocated_hours,
    utilization_confidence: d.utilization_confidence,
  }));
  facts.metrics.by_location = util.byLocation.map((l) => ({
    location: l.key, headcount: l.headcount, allocated_hours: l.allocated_hours,
    unallocated_hours: l.unallocated_hours, utilization_pct: l.utilization_pct,
  }));
  facts.metrics.over_allocated_employees = util.overAllocated.slice(0, 25).map((e) => ({
    employee: principal.isPlatformAdmin || true ? e.employee_code : null,
    name: e.full_name,
    department: e.department,
    available_hours: e.available_hours, allocated_hours: e.allocated_hours,
    over_allocated_hours: e.over_allocated_hours, allocation_pct: e.allocation_pct,
  }));
  facts.metrics.idle_employees = util.idle.slice(0, 25).map((e) => ({
    name: e.full_name, employee: e.employee_code, department: e.department,
    unallocated_hours: e.unallocated_hours, allocation_pct: e.allocation_pct,
    utilization_pct: e.utilization_pct,
  }));

  // Newly ingested demo/real data may have no timesheets — be explicit about it.
  facts.data_quality.timesheet_coverage_pct = util.total.timesheet_coverage_pct;
  if (util.total.employees_with_timesheets === 0) {
    facts.unavailable.push('No timesheet data in this period, so actual utilization cannot be measured — only allocation (plan) is available.');
  } else if (util.total.timesheet_coverage_pct < 80) {
    facts.unavailable.push(
      `Only ${util.total.timesheet_coverage_pct}% of employees have timesheet records in this period, so utilization may understate real work.`
    );
  }

  const demand = demandAnalysis(principal);
  facts.metrics.demand_gaps = demand.gaps.slice(0, 20).map((g) => ({
    project: g.project_name, code: g.project_code, role: g.role_title,
    skill: g.required_skill, headcount: g.headcount, required_hours: g.required_hours,
    filled_hours: g.filled_hours, gap_hours: g.gap_hours, coverage_pct: g.coverage_pct,
    priority: g.priority, start_date: g.start_date, end_date: g.end_date,
    skill_matched_candidates: g.skill_matched_candidates.length,
  }));
  if (!demand.gaps.length) facts.unavailable.push('No open staffing demand records exist, so gap analysis is empty rather than healthy.');

  const overlaps = allocationOverlaps(principal, { period: resolved });
  facts.metrics.allocation_overlaps = overlaps.slice(0, 20).map((o) => ({
    employee: o.employee_name, overlap_from: o.overlap_from, overlap_to: o.overlap_to,
    combined_weekly_hours: o.combined_weekly_hours, standard_weekly_hours: o.standard_weekly_hours,
    over_capacity: o.over_capacity,
  }));

  if (maySeeCost(principal) || maySeeFinance(principal)) {
    const fin = financialAnalysis(principal, { period: resolved, filters });
    facts.metrics.finance = {
      availability: fin.availability,
      totals: fin.totals,
      by_department: fin.byDepartment,
      by_project: fin.byProject.slice(0, 15),
    };
  } else {
    facts.unavailable.push('You do not have permission to view cost or financial data, so financial questions cannot be answered.');
  }

  // Trend series (last 6 months) — used by trend and forecast questions.
  const months = recentMonths(6, resolved.end.slice(0, 7));
  const trend = utilizationTrend(principal, { months, filters });
  facts.series.utilization_by_month = trend;
  facts.data_quality.months_of_history = trend.filter((t) => t.headcount > 0).length;

  // Counts of master records for headcount/quality questions.
  const db = getDb();
  const counts = {};
  for (const t of ['employees', 'projects', 'project_demand', 'allocations', 'timesheets', 'invoices', 'expenses', 'skills']) {
    counts[t] = db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE org_id = ?`).get(orgId).c;
  }
  facts.metrics.record_counts = counts;

  const openInsights = db.prepare(`SELECT severity, COUNT(*) c FROM ai_insights WHERE org_id = ? AND status = 'open' GROUP BY severity`).all(orgId);
  facts.metrics.open_insights = Object.fromEntries(openInsights.map((r) => [r.severity, r.c]));

  facts.metrics.employee_cost_coverage = util.employees.length
    ? round((util.employees.filter((r) => r.available_hours > 0).length / Math.max(util.employees.length, 1)) * 100) : 0;

  return facts;
}

/**
 * Prompt-injection defence for any externally supplied text (uploaded files,
 * pasted notes, external content). Uploaded data is DATA, never instructions.
 */
const INJECTION_PATTERNS = [
  /ignore (all )?(previous|prior|above) (instructions|prompts|rules)/i,
  /disregard (the )?(system|previous) (prompt|instructions)/i,
  /you are now (a|an|the) /i,
  /reveal (the )?(system prompt|underlying instructions)/i,
  /(print|show|dump|return) (all )?(api keys?|secrets?|passwords?|credentials?)/i,
  /(change|update|delete|drop) (the )?(database|tables?|records?|payroll|salary)/i,
  /\bexecute\b.*\b(sql|command|shell)\b/i,
  /set (your|the) (role|permissions?) to/i,
  /bypass (all )?(security|permission|access|tenant)/i,
  /exfiltrate|send .* to (http|https|@)/i,
  /as an ai (language )?model,? (you must|ignore)/i,
];

export function scanForInjection(text) {
  const s = String(text || '');
  const hits = INJECTION_PATTERNS.filter((p) => p.test(s));
  return { flagged: hits.length > 0, matches: hits.map((h) => h.source) };
}

/** Sanitise user question for the model: strip control chars, cap length. */
export function sanitizeQuestion(text) {
  return String(text || '').replace(/[\u0000-\u001F\u007F]/g, ' ').slice(0, 1200).trim();
}

export const ENTITY_LABELS = Object.fromEntries(
  Object.entries(ENTITY_SCHEMAS).map(([k, v]) => [k, v.label])
);
