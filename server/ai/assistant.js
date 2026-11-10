/**
 * AI Business Assistant — deterministic, grounded answer composition.
 *
 * Every answer is produced from a fact pack built with the requesting user's
 * permissions. The composer never invents values: if the facts needed for an answer
 * are missing it returns an explicit "insufficient data" response listing exactly
 * what is required.
 */
import { detectIntent, buildFactPack, sanitizeQuestion, scanForInjection } from '../services/grounding.js';
import { callModel, verifyNumbers, providerName } from './provider.js';
import { getDb, now } from '../db/index.js';
import { round } from '../lib/capacity.js';
import { auditAi } from '../lib/audit.js';

const fmt = (n, unit = 'h') => (n == null ? 'no data'
  : `${Number(n).toLocaleString('en-IN', { maximumFractionDigits: unit && unit !== 'h' ? 0 : 1 })}${unit ? ` ${unit}` : ''}`);
const pct = (n) => (n == null ? 'not measurable' : `${n}%`);

export function composeAnswer({ intent, facts, question }) {
  const m = facts.metrics;
  const util = m.utilization;
  const period = facts.period.label;
  const base = {
    intent,
    period: facts.period,
    filters: facts.filters,
    assumptions: [],
    limitations: [...facts.unavailable],
    confidence: 'medium',
    evidence: [],
    sources: [],
  };

  const deptRows = (m.by_department || []).slice().sort((a, b) => (b.unallocated_hours || 0) - (a.unallocated_hours || 0));
  const fin = m.finance;

  switch (intent) {
    case 'unallocated_capacity': {
      if (!util.headcount) return insufficient(facts, 'No active employees were found in scope for this period, so there is no capacity to report.');
      const top = deptRows.filter((d) => d.unallocated_hours > 0).slice(0, 3);
      const names = top.map((d) => `${d.department} (${fmt(d.unallocated_hours)} unallocated across ${d.headcount} people)`).join('; ');
      let answer = top.length
        ? `In ${period}, the largest unallocated capacity is in ${top[0].department} at ${fmt(top[0].unallocated_hours)} (${pct(top[0].allocation_pct)} of that team is allocated to work).`
        : `In ${period} every department in scope is fully allocated, with ${fmt(util.unallocated_hours)} of unallocated capacity overall.`;
      if (top.length > 1) answer += ` Next: ${names.split('; ').slice(1).join('; ')}.`;
      base.evidence = [
        { label: 'Unallocated capacity in scope', value: util.unallocated_hours, unit: 'hours', basis: 'Available hours − allocated hours' },
        { label: 'Department ranking', value: top.map((d) => ({ department: d.department, unallocated_hours: d.unallocated_hours, allocation_pct: d.allocation_pct })) },
      ];
      base.sources = ['Utilization report (allocation basis)', 'Department roll-up'];
      base.assumptions = [
        'Allocations are the plan of record; hours not allocated are treated as available even if the person is doing unrecorded work.',
        `Capacity uses location working days and excludes configured holidays for ${facts.period.start} to ${facts.period.end}.`,
        'Unallocated hours are calculated per person, so one person\u2019s over-allocation does not cancel another\u2019s spare capacity. A team can therefore show spare capacity and a high allocation percentage at the same time.',
      ];
      base.confidence = util.allocation_pct != null ? 'high' : 'low';
      base.detail = `Employees with the least allocation: ${(m.idle_employees || []).slice(0, 5).map((e) => `${e.name} — ${pct(e.allocation_pct)} allocated`).join(', ') || 'none in scope'}.`;
      base.nextStep = top.length
        ? `Review ${top[0].department}'s allocation plan and check whether ${Math.round(top[0].unallocated_hours)} unallocated hours can be moved to open demand. This needs a resource manager's approval before any change.`
        : 'No action needed on allocation this period.';
      return finish(base, answer, facts);
    }

    case 'over_allocation': {
      const over = util.employees_over_allocated;
      const overlaps = m.allocation_overlaps || [];
      if (!util.headcount) return insufficient(facts, 'No active employees were found in scope for this period.');
      let answer = over
        ? `${over} ${over === 1 ? 'person is' : 'people are'} over-allocated in ${period}, totalling ${fmt(util.over_allocated_hours)} above their available capacity.`
        : `No one is over-allocated in ${period}: allocated hours are within available capacity for all ${util.headcount} people in scope.`;
      if (overlaps.length) answer += ` Separately, ${overlaps.length} overlapping allocation pairs were found, which is a double-booking risk.`;
      base.evidence = [
        { label: 'Employees over-allocated', value: over, unit: 'people' },
        { label: 'Hours above capacity', value: util.over_allocated_hours, unit: 'hours' },
        { label: 'Over-allocated individuals', value: (m.over_allocated_employees || []).slice(0, 8).map((e) => ({ name: e.name, allocated_hours: e.allocated_hours, available_hours: e.available_hours, allocation_pct: e.allocation_pct })) },
      ];
      base.sources = ['Allocation register', 'Capacity engine'];
      base.assumptions = ['Over-allocation compares planned allocation hours with standard capacity; it does not automatically mean overtime was worked.'];
      base.confidence = 'high';
      base.nextStep = over
        ? 'Have the resource manager confirm whether these people are genuinely double-booked, then rebalance the allocations. The platform will not change any allocation automatically.'
        : 'Monitor next period as projects ramp up.';
      return finish(base, answer, facts);
    }

    case 'staffing_gaps': {
      const gaps = m.demand_gaps || [];
      if (!gaps.length) {
        return insufficient(
          facts,
          'There are no open staffing demand records in scope, so a gap analysis cannot be produced. Add project demand records (required role, headcount, dates) to enable it.'
        );
      }
      const worst = gaps.filter((g) => (g.coverage_pct ?? 0) < 100).slice(0, 3);
      const answer = worst.length
        ? `${worst.length} of ${gaps.length} open demand records are not fully covered. ${worst[0].project} — ${worst[0].role} needs ${worst[0].headcount} people from ${worst[0].start_date} and is ${pct(worst[0].coverage_pct)} covered (${fmt(worst[0].gap_hours)} short).`
        : `All ${gaps.length} open demand records are fully covered by existing allocations.`;
      base.evidence = gaps.slice(0, 8).map((g) => ({
        label: `${g.code} · ${g.role}`, value: { required_hours: g.required_hours, filled_hours: g.filled_hours, gap_hours: g.gap_hours, coverage_pct: g.coverage_pct, priority: g.priority },
      }));
      base.sources = ['Project demand register', 'Allocation matching'];
      base.assumptions = ['Coverage is calculated by matching dated allocations to the demand window; a person allocated without the required skill still counts as filling hours, so skill fit is shown separately.'];
      base.limitations.push('Skill matching uses the skills recorded on employee records; missing skill data will understate suitable candidates.');
      base.confidence = 'medium';
      base.nextStep = worst.length ? `Ask the resource manager to review ${worst[0].project} first — it has the lowest coverage. Any assignment remains a human decision.` : 'No action required.';
      return finish(base, answer, facts);
    }

    case 'utilization_trend': {
      const series = facts.series.utilization_by_month || [];
      const withData = series.filter((s) => s.headcount > 0);
      if (!withData.length) return insufficient(facts, 'No historical periods contain workforce data yet, so a trend cannot be calculated.');
      const actuals = withData.filter((s) => s.utilization_pct != null);
      if (!actuals.length) {
        return insufficient(
          facts,
          `Allocation data exists for ${withData.length} month(s), but there are no timesheet hours recorded, so actual utilization cannot be measured. Allocation (plan) for the latest month is ${pct(withData.at(-1).allocation_pct)}.`
        );
      }
      const first = actuals[0], last = actuals.at(-1);
      const delta = round(last.utilization_pct - first.utilization_pct, 1);
      const direction = delta > 0 ? 'increased' : delta < 0 ? 'decreased' : 'stayed flat';
      const answer = `Utilization ${direction} from ${pct(first.utilization_pct)} in ${first.month} to ${pct(last.utilization_pct)} in ${last.month} (${delta > 0 ? '+' : ''}${delta} points).`;
      base.evidence = [
        { label: 'Monthly utilization', value: actuals.map((s) => ({ month: s.month, utilization_pct: s.utilization_pct, allocation_pct: s.allocation_pct, timesheet_coverage_pct: s.timesheet_coverage_pct })) },
      ];
      base.sources = ['Timesheets (actuals)', 'Allocation register (plan)'];
      base.assumptions = ['Utilization = timesheet hours ÷ available capacity. Months with partial timesheet coverage are less reliable.'];
      if (actuals.some((s) => s.timesheet_coverage_pct < 90)) {
        base.limitations.push('Some months have incomplete timesheet coverage; treat those points as indicative.');
      }
      base.confidence = actuals.every((s) => s.timesheet_coverage_pct >= 90) ? 'high' : 'medium';
      base.nextStep = delta < 0
        ? 'Investigate whether the decline comes from less billable demand or from unrecorded time before drawing conclusions.'
        : 'Check whether higher utilization is sustainable or caused by over-allocation.';
      return finish(base, answer, facts);
    }

    case 'cost_trend': {
      if (!fin) return insufficient(facts, 'You do not have permission to view workforce cost data, so this question cannot be answered. Ask an administrator for the "View workforce cost" permission.');
      if (!fin.availability.employee_cost) return insufficient(facts, 'Employee cost data has not been provided, so workforce cost trends cannot be calculated. Upload the annual cost column (or have Finance add it) to enable this.');
      const byDept = (fin.by_department || []).slice().sort((a, b) => b.period_cost - a.period_cost);
      const totals = fin.totals;
      const answer = `A cost trend cannot be measured yet: the platform currently holds one cost figure per employee (annual cost), not a monthly cost history, so only the ${period} position can be reported. Workforce cost for that period is ${fmt(totals.workforce_cost, facts.currency)} for ${util.headcount} people, of which about ${fmt(totals.idle_workforce_cost, facts.currency)} relates to time not allocated to any project. ${byDept[0] ? `The largest department cost is ${byDept[0].name} at ${fmt(byDept[0].period_cost, facts.currency)}.` : ''}`;
      base.evidence = [
        { label: 'Workforce cost in period', value: totals.workforce_cost, unit: facts.currency, basis: 'Annual cost ÷ 12 × working-day fraction' },
        { label: 'Cost of unallocated time', value: totals.idle_workforce_cost, unit: facts.currency, basis: 'Employee period cost × unallocated share' },
        { label: 'Cost by department', value: byDept.slice(0, 6).map((d) => ({ department: d.name, period_cost: d.period_cost, idle_cost: d.idle_cost, cost_coverage_pct: d.cost_coverage_pct })) },
      ];
      base.sources = ['Employee cost records', 'Allocation register'];
      base.assumptions = [
        'Period cost is derived from annual employer cost divided by 12 and pro-rated to working days in the period.',
        'Only time not allocated to any project is treated as idle cost; it is a cost-of-capacity indicator, not a saving already achieved.',
      ];
      if (fin.availability.employee_cost_coverage_pct < 100) {
        base.limitations.push(`Cost data covers ${fin.availability.employee_cost_coverage_pct}% of employees, so the total is partial.`);
      }
      base.limitations.push('Cost trend is not measurable from the current data model (annual cost per employee, no monthly payroll history). Uploading month-by-month cost records would enable it.');
      base.confidence = fin.availability.employee_cost_coverage_pct >= 95 ? 'medium' : 'low';
      base.nextStep = 'Compare with the prior month once available, and review whether unallocated cost is concentrated in one department.';
      return finish(base, answer, facts);
    }

    case 'operational_risks': {
      const risks = [];
      if (util.employees_over_allocated) risks.push(`${util.employees_over_allocated} people are over-allocated by ${fmt(util.over_allocated_hours)} in total`);
      const uncovered = (m.demand_gaps || []).filter((g) => (g.coverage_pct ?? 0) < 80);
      if (uncovered.length) risks.push(`${uncovered.length} demand records are below 80% coverage, the lowest being ${uncovered[0].project} at ${pct(uncovered[0].coverage_pct)}`);
      if (util.utilization_pct != null && util.utilization_pct < 65) risks.push(`overall utilization is ${pct(util.utilization_pct)}, below 65%`);
      if (util.timesheet_coverage_pct < 70) risks.push(`timesheet coverage is only ${pct(util.timesheet_coverage_pct)}, so operational reporting may be incomplete`);
      if (fin && fin.totals.gross_margin_pct != null && fin.totals.gross_margin_pct < 20) risks.push(`gross margin is ${pct(fin.totals.gross_margin_pct)} on invoiced revenue`);
      if (!risks.length) {
        return {
          ...base,
          answer: `No rule-based risks were triggered for ${period}. That is not the same as "no risk": ${facts.unavailable.length ? 'some data is incomplete (' + facts.unavailable.join(' ') + ')' : 'only the data currently loaded was checked'}.`,
          confidence: 'medium',
          nextStep: 'Review the Insights page after the next data refresh.',
        };
      }
      const answer = `For ${period} management should review ${risks.length} item${risks.length === 1 ? '' : 's'}: ${risks.join('; ')}.`;
      base.evidence = [
        { label: 'Over-allocation', value: { people: util.employees_over_allocated, hours: util.over_allocated_hours } },
        { label: 'Low coverage demand', value: uncovered.slice(0, 5).map((g) => ({ project: g.project, role: g.role, coverage_pct: g.coverage_pct, gap_hours: g.gap_hours })) },
        { label: 'Utilization', value: { utilization_pct: util.utilization_pct, allocation_pct: util.allocation_pct, timesheet_coverage_pct: util.timesheet_coverage_pct } },
      ];
      base.sources = ['Utilization report', 'Demand analysis', 'Insights engine'];
      base.confidence = 'medium';
      base.nextStep = 'Open the Insights page to review each item with its evidence and record a decision. No action is taken automatically.';
      return finish(base, answer, facts);
    }

    case 'data_quality': {
      const c = m.record_counts || {};
      const missing = [];
      if (!c.timesheets) missing.push('timesheets (needed for actual utilization)');
      if (!c.project_demand) missing.push('project demand (needed for staffing gap analysis)');
      if (!c.invoices) missing.push('invoices (needed for revenue and margin)');
      if (fin && !fin.availability.employee_cost) missing.push('employee cost (needed for cost analysis)');
      if (!c.projects) missing.push('projects (needed to attach allocations)');
      const months = facts.data_quality.months_of_history || 0;
      const forecastNote = months >= 4
        ? `Forecasting is available: ${months} month(s) of history are loaded (minimum 4).`
        : `Forecasting is not available yet: ${months} month(s) of history are loaded and at least 4 are required.`;
      const answer = missing.length
        ? `To produce a reliable forecast and complete operational view, the following are missing: ${missing.join(', ')}. Currently loaded: ${c.employees || 0} employees, ${c.projects || 0} projects, ${c.allocations || 0} allocations, ${c.timesheets || 0} timesheet rows, ${c.invoices || 0} invoices. ${forecastNote}`
        : `Core data sets are present: ${c.employees} employees, ${c.projects} projects, ${c.allocations} allocations, ${c.timesheets} timesheet rows and ${c.invoices} invoices. Timesheet coverage for the period is ${pct(util.timesheet_coverage_pct)}. ${forecastNote} Workforce cost history is not stored month by month, so cost trend forecasting is unavailable.`;
      base.evidence = [{ label: 'Record counts', value: c }, { label: 'Timesheet coverage', value: util.timesheet_coverage_pct, unit: '%' }];
      base.sources = ['Data catalogue', 'Import history'];
      base.assumptions = ['Presence of a data set does not guarantee completeness; coverage percentages are shown where they can be calculated.'];
      base.confidence = 'high';
      base.nextStep = missing.length ? 'Upload the missing data sets from the Data page, then regenerate insights.' : 'Check the import history for rows that were skipped or flagged during upload.';
      return finish(base, answer, facts);
    }

    case 'finance_summary': {
      if (!fin) return insufficient(facts, 'You do not have permission to view financial data, so this question cannot be answered.');
      if (!fin.availability.invoices) return insufficient(facts, 'No invoices are recorded for this period, so revenue and margin cannot be reported.');
      const t = fin.totals;
      const answer = `Invoiced revenue for ${period} is ${fmt(t.invoiced_revenue, ` ${facts.currency}`)} against ${fmt(t.workforce_cost, ` ${facts.currency}`)} of workforce cost and ${fmt(t.expenses, ` ${facts.currency}`)} of operating expenses. ${t.gross_margin != null ? `That implies a gross margin of ${fmt(t.gross_margin, ` ${facts.currency}`)} (${pct(t.gross_margin_pct)}).` : 'Gross margin cannot be calculated because cost inputs are incomplete.'}`;
      base.evidence = [
        { label: 'Invoiced revenue', value: t.invoiced_revenue, unit: facts.currency },
        { label: 'Workforce cost', value: t.workforce_cost, unit: facts.currency },
        { label: 'Operating expenses', value: t.expenses, unit: facts.currency },
        { label: 'Gross margin', value: t.gross_margin, unit: facts.currency },
      ];
      base.sources = ['Invoices', 'Employee cost records', 'Expense register'];
      base.assumptions = ['Revenue is invoiced value, not cash collected', 'Margin = invoiced revenue − workforce cost − operating expenses for the same period'];
      for (const n of fin.availability.notes) base.limitations.push(n);
      base.confidence = fin.availability.margin_computable ? 'medium' : 'low';
      base.nextStep = t.gross_margin_pct != null && t.gross_margin_pct < 20
        ? 'Review projects with the lowest billed value relative to allocated hours.'
        : 'No immediate financial concern in the reported figures.';
      return finish(base, answer, facts);
    }

    case 'headcount_summary': {
      const answer = `There are ${util.headcount} people in scope${facts.filters.business_unit_id || facts.filters.department_id ? ' for the selected filters' : ''}, with a combined available capacity of ${fmt(util.available_hours)} in ${period}. ${pct(util.allocation_pct)} of that capacity is allocated to projects.`;
      base.evidence = [
        { label: 'Headcount', value: util.headcount, unit: 'people' },
        { label: 'Available hours', value: util.available_hours, unit: 'hours' },
        { label: 'Allocation', value: util.allocation_pct, unit: '%' },
        { label: 'By department', value: (m.by_department || []).map((d) => ({ department: d.department, headcount: d.headcount })) },
      ];
      base.sources = ['Employee master data'];
      base.assumptions = ['Only employees with status active, on leave or notice (and not yet exited) are counted.'];
      base.confidence = 'high';
      base.nextStep = 'Use the Workforce page to view individuals behind these totals.';
      return finish(base, answer, facts);
    }

    case 'definition_help': {
      const answer = `Utilization is the share of available capacity actually worked: timesheet hours ÷ available hours. Allocation is the share of capacity planned onto projects: allocated hours ÷ available hours. Available hours come from each person's location working days, hours per day and FTE, excluding configured holidays. Unallocated capacity is available minus allocated, and over-allocation is allocated above available. Planned and actual figures are always shown separately.`;
      base.evidence = [{ label: 'Definitions in force', value: ['utilization_pct', 'allocation_pct', 'available_hours', 'unallocated_hours', 'over_allocated_hours'] }];
      base.sources = ['Metric definitions (platform)'];
      base.confidence = 'high';
      base.nextStep = 'The Metric definitions page lists the same definitions with worked examples.';
      return finish(base, answer, facts);
    }

    case 'capability': {
      const answer = `I can answer questions about your own workforce, project, allocation and (where you have permission) financial data. For example: which departments have the most unallocated capacity; where people are over-allocated; which projects have staffing gaps; how utilization has moved month to month; workforce cost by department; and what data is missing for a reliable forecast. I only use data you are authorised to see, and I will say so when the data is not sufficient.`;
      base.sources = ['Assistant capabilities'];
      base.confidence = 'high';
      return finish(base, answer, facts);
    }

    default: {
      return {
        ...base,
        answer: `I could not map that question to one of the analyses I can answer reliably: ${[
          'unallocated capacity', 'over-allocation', 'staffing gaps', 'utilization trend', 'workforce cost', 'operational risks', 'data completeness', 'finance summary', 'headcount', 'metric definitions',
        ].join(', ')}. I will not guess at an answer. Please rephrase, or use the dashboards for exploration.`,
        confidence: 'insufficient_data',
        limitations: [...base.limitations, 'The question did not match a supported analysis.'],
        nextStep: 'Try one of the suggested questions, or open the dashboard for the period you need.',
        insufficient: true,
        missing: ['A question that matches a supported analysis'],
      };
    }
  }
}

function insufficient(facts, reason) {
  return {
    answer: reason,
    intent: 'insufficient_data',
    insufficient: true,
    missing: facts.unavailable,
    evidence: [],
    assumptions: [],
    limitations: [reason, ...facts.unavailable],
    confidence: 'insufficient_data',
    sources: [],
    period: facts.period,
    filters: facts.filters,
    nextStep: 'Supply the missing data from the Data page, then ask again.',
  };
}

function finish(base, answer, facts) {
  return {
    ...base,
    answer,
    confidence: base.confidence || 'medium',
    period: facts.period,
    filters: facts.filters,
  };
}

/**
 * Main entry point used by the API.
 * 1. sanitise + scan the question
 * 2. build a permission-filtered fact pack
 * 3. compose the deterministic answer
 * 4. optionally let an LLM rephrase, verifying every number against the facts
 */
export async function answerQuestion(principal, { question, period, filters = {}, conversationId = null }) {
  const started = Date.now();
  const clean = sanitizeQuestion(question);
  if (!clean) {
    const err = new Error('Please enter a question.');
    err.status = 400; err.code = 'EMPTY_QUESTION';
    throw err;
  }

  const injection = scanForInjection(clean);
  if (injection.flagged) {
    auditAi(principal, {
      action: 'prompt_injection.blocked', intent: null, provider: providerName(),
      dataSent: null, resultStatus: 'blocked',
      detail: `Blocked pattern(s): ${injection.matches.join(' | ')}`,
    });
    return {
      blocked: true,
      answer: 'That request looks like an attempt to change my instructions or access data outside your permissions. I can only answer business questions about your own organisation’s data. Please rephrase.',
      evidence: [], assumptions: [], limitations: ['Request blocked by the assistant safety check.'], confidence: 'insufficient_data', intent: 'blocked',
      provider: providerName(),
      external_calls_made: providerName() !== 'local-deterministic',
      mode: providerName() === 'local-deterministic' ? 'grounded_local' : 'grounded_external_writer',
    };
  }

  const intent = detectIntent(clean);
  const facts = buildFactPack(principal, { period, filters, question: clean });
  const composed = composeAnswer({ intent, facts, question: clean });

  let finalText = composed.answer;
  let provider = 'local-deterministic';
  let modelNotes = null;

  if (!composed.insufficient) {
    const llm = await callModel({ question: clean, facts, intent });
    if (llm.available) {
      const check = verifyNumbers(llm.text, facts);
      if (check.ok) {
        finalText = llm.text;
        provider = providerName();
      } else {
        modelNotes = `Model output contained figures not present in the authorised data (${check.suspicious.join(', ')}); the verified analytical answer was used instead.`;
        auditAi(principal, {
          action: 'assistant.model_output.rejected', intent, provider: providerName(),
          dataSent: { facts_bytes: JSON.stringify(facts).length, model: providerName() },
          resultStatus: 'rejected', detail: modelNotes,
        });
      }
    }
  }

  const db = getDb();
  let convId = conversationId;
  if (!convId) {
    const info = db.prepare('INSERT INTO ai_conversations (org_id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(principal.orgId, principal.user.id, clean.slice(0, 80), now(), now());
    convId = info.lastInsertRowid;
  } else {
    const convo = db.prepare('SELECT id FROM ai_conversations WHERE id = ? AND org_id = ? AND user_id = ?')
      .get(convId, principal.orgId, principal.user.id);
    if (!convo) {
      const err = new Error('Conversation not found.');
      err.status = 404; throw err;
    }
  }

  db.prepare(`INSERT INTO ai_messages (org_id, conversation_id, user_id, role, content, created_at) VALUES (?, ?, ?, 'user', ?, ?)`)
    .run(principal.orgId, convId, principal.user.id, clean, now());

  const latency = Date.now() - started;
  const info = db.prepare(`INSERT INTO ai_messages (org_id, conversation_id, user_id, role, content, intent, evidence,
      assumptions, limitations, confidence, provider, latency_ms, created_at)
      VALUES (?, ?, ?, 'assistant', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      principal.orgId, convId, principal.user.id, finalText, intent,
      JSON.stringify({ evidence: composed.evidence, period: composed.period, filters: composed.filters, sources: composed.sources, nextStep: composed.nextStep, detail: composed.detail ?? null }),
      JSON.stringify(composed.assumptions), JSON.stringify([...(composed.limitations || []), ...(modelNotes ? [modelNotes] : [])]),
      composed.confidence, provider, latency, now()
    );

  db.prepare('UPDATE ai_conversations SET updated_at = ? WHERE id = ?').run(now(), convId);

  auditAi(principal, {
    action: 'assistant.query', intent, provider,
    dataSent: provider === 'local-deterministic' ? null : { model: provider, facts_bytes: JSON.stringify(facts).length, employee_names: false },
    resultStatus: composed.insufficient ? 'insufficient_data' : 'ok',
    detail: clean.slice(0, 200),
  });

  return {
    conversationId: convId,
    messageId: info.lastInsertRowid,
    answer: finalText,
    intent,
    evidence: composed.evidence,
    assumptions: composed.assumptions,
    limitations: composed.limitations,
    confidence: composed.confidence,
    sources: composed.sources,
    nextStep: composed.nextStep ?? null,
    detail: composed.detail ?? null,
    period: composed.period,
    filters: composed.filters,
    insufficient: Boolean(composed.insufficient),
    missing: composed.missing ?? [],
    provider,
    // Say plainly whether any data left the machine: customers ask this first.
    external_calls_made: provider !== 'local-deterministic',
    mode: provider === 'local-deterministic' ? 'grounded_local' : 'grounded_external_writer',
    latencyMs: latency,
    modelNote: modelNotes,
  };
}
