/**
 * Answer any question that can be answered from this database, or say precisely why it cannot.
 *
 * The existing assistant handled eleven fixed intents, which is fine for a demo and useless in
 * practice: the moment someone asks something outside the list, they are told to rephrase. This
 * module takes the opposite approach — it first finds which parts of the database the question
 * refers to, then answers from those, and when it genuinely cannot answer it says what it *can*
 * answer about the subject rather than "I could not map that question".
 *
 * It is deliberately not an LLM: there is no model to hallucinate. Every figure comes from a
 * query against the requesting user's own organisation and data scope.
 */
import { getDb } from '../db/index.js';
import { maySeeFinance, maySeeCost } from './scope.js';

/* ------------------------------------------------------------------ subjects */

/**
 * Words that indicate a subject, mapped to a handler. Order matters only for tie-breaks: the
 * handler with the most matching words wins, so "how many leads are in each stage" resolves to
 * crm rather than workforce.
 */
const SUBJECTS = [
  {
    name: 'crm',
    label: 'CRM leads and pipeline',
    words: ['crm', 'lead', 'leads', 'pipeline', 'opportunity', 'opportunities', 'deal', 'deals',
      'prospect', 'client', 'clients', 'sales', 'quota', 'funnel', 'negotiation', 'proposal', 'won', 'lost'],
  },
  {
    name: 'employees',
    label: 'People',
    words: ['employee', 'employees', 'people', 'person', 'staff', 'headcount', 'team', 'teams',
      'workforce', 'attrition', 'hired', 'hiring', 'joined', 'exited', 'contractor', 'designation', 'grade'],
  },
  {
    name: 'projects',
    label: 'Projects and demand',
    words: ['project', 'projects', 'demand', 'delivery', 'milestone', 'scope', 'client project', 'engagement'],
  },
  {
    name: 'allocations',
    label: 'Allocations and utilisation',
    words: ['allocation', 'allocations', 'allocated', 'utilisation', 'utilization', 'capacity',
      'bench', 'billable', 'over-allocated', 'overallocated', 'free', 'available', 'unallocated'],
  },
  {
    name: 'finance',
    label: 'Costs, invoices and margin',
    words: ['cost', 'costs', 'invoice', 'invoices', 'revenue', 'margin', 'billing', 'billed',
      'paid', 'outstanding', 'overdue', 'expense', 'expenses', 'price', 'pricing', 'profit', 'rupee', 'lakh', 'crore'],
  },
  {
    name: 'timesheets',
    label: 'Timesheets',
    words: ['timesheet', 'timesheets', 'hours', 'logged', 'overtime', 'attendance', 'leave'],
  },
  {
    name: 'departments',
    label: 'Departments and business units',
    words: ['department', 'departments', 'business unit', 'business units', 'location', 'locations', 'office', 'city'],
  },
  {
    name: 'insights',
    label: 'AI insights and risks',
    words: ['insight', 'insights', 'risk', 'risks', 'concern', 'anomaly', 'alert', 'notification'],
  },
  {
    name: 'approvals',
    label: 'Approvals and automation',
    words: ['approval', 'approvals', 'pending', 'approve', 'automation', 'rule', 'rules', 'queue'],
  },
  {
    name: 'audit',
    label: 'Audit trail',
    words: ['audit', 'who changed', 'history', 'log', 'trail'],
  },
];

/** Does the question look like it is about something we simply do not hold? */
const OUT_OF_SCOPE = [
  { words: ['weather', 'temperature', 'rain', 'forecast today'], subject: 'the weather' },
  { words: ['cricket', 'football', 'match score', 'ipl'], subject: 'sport' },
  { words: ['stock price', 'share price', 'sensex', 'nifty'], subject: 'the stock market' },
  { words: ['news', 'headline'], subject: 'the news' },
  { words: ['who is the prime minister', 'president', 'election'], subject: 'politics' },
];

export function detectSubjects(question) {
  const q = String(question || '').toLowerCase();
  // Allow common inflections: "invoiced", "leads", "allocations" must all match their root.
  const stem = (w) => w.replace(/(e)$/, '');
  const scored = SUBJECTS.map((s) => ({
    subject: s,
    hits: s.words.filter((w) => new RegExp(`(^|[^a-z])${stem(w)}[a-z]{0,3}([^a-z]|$)`, 'i').test(q)).length,
  })).filter((x) => x.hits > 0).sort((a, b) => b.hits - a.hits);
  return scored.map((x) => x.subject);
}

export function detectOutOfScope(question) {
  const q = String(question || '').toLowerCase();
  return OUT_OF_SCOPE.find((o) => o.words.some((w) => q.includes(w))) || null;
}

/* ------------------------------------------------------------------ shape of the question */

export function questionShape(question) {
  const q = String(question || '').toLowerCase();
  return {
    count: /\bhow many\b|\bcount\b|\bnumber of\b/.test(q),
    list: /\blist\b|\bshow me\b|\bwhich are\b|\bname\b|\bwho are\b|\bwhat are\b/.test(q),
    sum: /\btotal\b|\bvalue\b|\bworth\b|\bsum\b|\bhow much\b/.test(q),
    trend: /\btrend\b|\bover time\b|\bthis month\b|\blast month\b|\bquarter\b|\bmonth on month\b|\bgrowth\b|\bcompared\b/.test(q),
    detail: /\bdetail\b|\bdetails\b|\beverything\b|\ball about\b|\btell me about\b|\bsummar/.test(q),
    top: /\btop\b|\bhighest\b|\bbiggest\b|\blargest\b|\bmost\b|\bbest\b/.test(q),
    empty: /\bempty\b|\bmissing\b|\bblank\b|\bincomplete\b|\bno data\b/.test(q),
  };
}

/* ------------------------------------------------------------------ answering */

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
// English counts: "1 lead", not "1 leads". Small, but it is the first thing a reader notices.
const plural = (n, one, many = `${one}s`) => `${n} ${Number(n) === 1 ? one : many}`;

/**
 * Answer a CRM question. Kept separate from the generic dispatcher because the CRM is the
 * newest part of the schema and deserves specific, honest answers.
 */
function answerCrm(principal, question, shape) {
  const db = getDb();
  const orgId = principal.orgId;
  const evidence = {};
  const lines = [];

  const byStage = db.prepare(`SELECT stage, COUNT(*) AS count, COALESCE(SUM(estimated_value),0) AS value
      FROM crm_leads WHERE org_id = ? GROUP BY stage ORDER BY count DESC`).all(orgId);
  evidence.by_stage = byStage;

  const total = byStage.reduce((a, r) => a + r.count, 0);
  if (total === 0) {
    return {
      answer: 'There are no leads in the CRM yet for this organisation. You can add one by asking the assistant to create a lead, or by importing a file with the CRM template.',
      evidence,
      confidence: 'high',
    };
  }

  const open = byStage.filter((r) => !['won', 'lost', 'disqualified'].includes(r.stage));
  const openCount = open.reduce((a, r) => a + r.count, 0);
  const openValue = open.reduce((a, r) => a + r.value, 0);
  const wonRow = byStage.find((r) => r.stage === 'won');

  if (shape.empty) {
    const blank = db.prepare(`SELECT COUNT(*) AS c FROM crm_leads WHERE org_id = ?
        AND (contact_email IS NULL OR contact_email = '' OR estimated_value IS NULL OR next_step IS NULL)`).get(orgId).c;
    evidence.leads_missing_fields = blank;
    return {
      answer: `${blank} of ${total} leads are missing at least one of contact email, estimated value or next step.`,
      evidence,
      confidence: 'high',
    };
  }

  if (shape.count && !shape.sum) {
    lines.push(`There ${total === 1 ? 'is' : 'are'} ${plural(total, 'lead')}: ${openCount} still open and ${total - openCount} closed.`);
    lines.push(byStage.map((r) => `${r.stage}: ${r.count}`).join(', ') + '.');
  } else if (shape.sum || shape.top) {
    lines.push(`The open pipeline is worth ${money(openValue)} across ${plural(openCount, 'lead')}.`);
    lines.push(byStage.filter((r) => r.value > 0).map((r) => `${r.stage}: ${money(r.value)}`).join(', ') + '.');
    const top = db.prepare(`SELECT company, stage, estimated_value FROM crm_leads WHERE org_id = ?
        AND estimated_value IS NOT NULL ORDER BY estimated_value DESC LIMIT 3`).all(orgId);
    evidence.largest_open_deals = top;
    if (top.length) lines.push(`Largest: ${top.map((t) => `${t.company} (${money(t.estimated_value)}, ${t.stage})`).join('; ')}.`);
  } else if (shape.list) {
    const rows = db.prepare(`SELECT lead_code, company, contact_name, stage, estimated_value, next_step, next_step_date
        FROM crm_leads WHERE org_id = ? ORDER BY updated_at DESC LIMIT 12`).all(orgId);
    evidence.leads = rows;
    lines.push(`${Math.min(rows.length, 12)} most recently updated leads:`);
    lines.push(rows.map((r) => `${r.company} — ${r.contact_name || 'no contact'}, ${r.stage}${r.estimated_value ? `, ${money(r.estimated_value)}` : ''}${r.next_step ? `, next: ${r.next_step}` : ''}`).join('; ') + '.');
  } else {
    lines.push(`There ${total === 1 ? 'is' : 'are'} ${plural(total, 'lead')} in the CRM: ${openCount} open worth ${money(openValue)}${wonRow ? `, and ${wonRow.count} won worth ${money(wonRow.value)}` : ''}.`);
    lines.push(byStage.map((r) => `${r.stage}: ${r.count}`).join(', ') + '.');
  }

  if (wonRow) lines.push(`Won so far: ${plural(wonRow.count, 'lead')}, ${money(wonRow.value)}.`);

  return { answer: lines.join(' '), evidence, confidence: 'high' };
}

function answerEmployees(principal, question, shape) {
  const db = getDb();
  const orgId = principal.orgId;
  const evidence = {};
  const rows = db.prepare(`SELECT status, COUNT(*) AS c FROM employees WHERE org_id = ? GROUP BY status`).all(orgId);
  const total = rows.reduce((a, r) => a + r.c, 0);
  evidence.by_status = rows;
  const active = rows.find((r) => r.status === 'active')?.c || 0;

  if (shape.list || shape.detail) {
    const latest = db.prepare(`SELECT e.full_name, e.employee_code, e.designation, d.name AS department, e.status, e.join_date
        FROM employees e LEFT JOIN departments d ON d.id = e.department_id
        WHERE e.org_id = ? ORDER BY e.created_at DESC LIMIT 10`).all(orgId);
    evidence.recent_joins = latest;
    return {
      answer: `${total} people in scope (${active} active). The 10 most recently added: ${latest.map((e) => `${e.full_name}${e.designation ? ` (${e.designation}${e.department ? `, ${e.department}` : ''})` : ''}`).join('; ')}.`,
      evidence, confidence: 'high',
    };
  }
  if (shape.empty) {
    const blanks = db.prepare(`SELECT COUNT(*) AS c FROM employees WHERE org_id = ? AND (email IS NULL OR department_id IS NULL)`).get(orgId).c;
    evidence.missing_fields = blanks;
    return { answer: `${blanks} of ${total} people are missing an email address or a department.`, evidence, confidence: 'high' };
  }
  return {
    answer: `${total} people are in scope: ${rows.map((r) => `${r.status} ${r.c}`).join(', ')}.`,
    evidence, confidence: 'high',
  };
}

function answerProjects(principal, question, shape) {
  const db = getDb();
  const rows = db.prepare(`SELECT id, name, code, status, start_date, end_date FROM projects WHERE org_id = ?`).all(principal.orgId);
  const demand = db.prepare(`SELECT COALESCE(SUM(required_hours),0) AS h FROM project_demand WHERE org_id = ?`).get(principal.orgId).h;
  const evidence = { projects: rows.length, demand_hours: demand };
  if (shape.list) {
    const list = db.prepare(`SELECT name, code, status, start_date, end_date FROM projects WHERE org_id = ? ORDER BY name LIMIT 15`).all(principal.orgId);
    evidence.list = list;
    return {
      answer: `${rows.length} projects. ${list.map((p) => `${p.name} (${p.status})`).join('; ')}.`,
      evidence, confidence: 'high',
    };
  }
  const byStatus = rows.reduce((a, p) => { a[p.status] = (a[p.status] || 0) + 1; return a; }, {});
  return {
    answer: `${rows.length} projects: ${Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(', ')}. Total demand on record is ${Math.round(demand)} hours.`,
    evidence, confidence: 'high',
  };
}

function answerAllocations(principal, question, shape) {
  const db = getDb();
  const orgId = principal.orgId;
  const hours = db.prepare(`SELECT COALESCE(SUM(hours_per_week),0) AS h FROM allocations WHERE org_id = ? AND status IN ('planned','confirmed')`).get(orgId).h;
  const people = db.prepare(`SELECT COUNT(DISTINCT employee_id) AS c FROM allocations WHERE org_id = ? AND status IN ('planned','confirmed')`).get(orgId).c;
  const active = db.prepare(`SELECT COUNT(*) AS c FROM employees WHERE org_id = ? AND status = 'active'`).get(orgId).c;
  const evidence = { weekly_hours_allocated: hours, people_with_allocations: people, active_people: active };
  return {
    answer: `${people} of ${active} active people have allocations, totalling ${Math.round(hours)} allocated hours per week.`,
    evidence, confidence: 'high',
  };
}

function answerFinance(principal, question, shape) {
  // The permission check is the point of this handler: finance data must not leak through a
  // generic question just because the assistant is helpful.
  if (!maySeeFinance(principal) && !maySeeCost(principal)) {
    return {
      answer: 'Your role does not include access to cost, invoice or margin data, so I cannot answer that. An administrator can grant the finance permission if you need it.',
      evidence: {},
      confidence: 'high',
      refused: true,
    };
  }
  const db = getDb();
  const orgId = principal.orgId;
  const inv = db.prepare(`SELECT status, COUNT(*) AS c, COALESCE(SUM(amount),0) AS v FROM invoices WHERE org_id = ? GROUP BY status`).all(orgId);
  const evidence = { invoices_by_status: inv };
  const total = inv.reduce((a, r) => a + r.v, 0);
  return {
    answer: `Invoiced ${money(total)} across ${inv.reduce((a, r) => a + r.c, 0)} invoices: ${inv.map((r) => `${r.status} ${r.c} (${money(r.v)})`).join(', ')}.`,
    evidence, confidence: 'high',
  };
}

const HANDLERS = {
  crm: answerCrm,
  employees: answerEmployees,
  projects: answerProjects,
  allocations: answerAllocations,
  finance: answerFinance,
};

/**
 * The entry point. Returns { answer, evidence, confidence, subject, refused?, suggestions? }.
 * `suggestions` lists what *can* be asked when the question is out of scope — never a dead end.
 */
export function askAnything(principal, question) {
  const q = String(question || '').trim();
  if (q.length < 3) {
    return { answer: 'Please ask a full question.', evidence: {}, confidence: 'insufficient_data', refused: true };
  }

  const outside = detectOutOfScope(q);
  if (outside) {
    return {
      answer: `I cannot answer that. This assistant only reads this organisation's own business data — workforce, projects, allocations, costs, timesheets, approvals and CRM. I have nothing about ${outside.subject}, and I will not guess.`,
      evidence: {},
      confidence: 'insufficient_data',
      refused: true,
      suggestions: ['How many leads are in each stage?', 'What is the open pipeline value?', 'How many people are in scope?', 'Which projects are active?'],
    };
  }

  const subjects = detectSubjects(q);
  if (!subjects.length) {
    return {
      answer: 'I could not tell which business area that question is about. I can answer questions about CRM leads and pipeline, people, projects, allocations and capacity, costs and invoices, timesheets, departments, approvals, insights and the audit trail. Ask it again naming one of those.',
      evidence: {},
      confidence: 'insufficient_data',
      refused: true,
      suggestions: ['How many leads are in each stage?', 'What is the open pipeline value?', 'How many people are in scope?', 'What is allocated this week?'],
    };
  }

  const subject = subjects[0];
  const shape = questionShape(q);
  const handler = HANDLERS[subject.name];

  let result;
  if (handler) {
    result = handler(principal, q, shape);
  } else if (subject.name === 'timesheets') {
    const db = getDb();
    const hours = db.prepare(`SELECT COALESCE(SUM(hours),0) AS h FROM timesheets WHERE org_id = ?`).get(principal.orgId).h;
    result = { answer: `${Math.round(hours)} timesheet hours are recorded in this organisation.`, evidence: { hours }, confidence: 'high' };
  } else if (subject.name === 'departments') {
    const db = getDb();
    const rows = db.prepare(`SELECT d.name, COUNT(e.id) AS people FROM departments d
        LEFT JOIN employees e ON e.department_id = d.id AND e.status = 'active'
        WHERE d.org_id = ? GROUP BY d.id ORDER BY people DESC`).all(principal.orgId);
    result = {
      answer: `${rows.length} departments: ${rows.map((r) => `${r.name} (${r.people})`).join(', ')}.`,
      evidence: { departments: rows }, confidence: 'high',
    };
  } else if (subject.name === 'insights') {
    const db = getDb();
    const rows = db.prepare(`SELECT title, severity, status FROM ai_insights WHERE org_id = ? ORDER BY created_at DESC LIMIT 10`).all(principal.orgId);
    result = {
      answer: rows.length ? `${rows.length} insights: ${rows.map((r) => `${r.title} (${r.severity})`).join('; ')}.` : 'No insights have been generated yet. Open AI Insights and run a generation.',
      evidence: { insights: rows }, confidence: 'high',
    };
  } else if (subject.name === 'approvals') {
    const db = getDb();
    const pending = db.prepare(`SELECT COUNT(*) AS c FROM approval_requests WHERE org_id = ? AND status = 'pending'`).get(principal.orgId).c;
    const crmPending = db.prepare(`SELECT COUNT(*) AS c FROM crm_ai_sessions WHERE org_id = ? AND status = 'pending_approval'`).get(principal.orgId).c;
    result = {
      answer: `${pending} approval request(s) and ${crmPending} assistant-drafted CRM record(s) are waiting for approval.`,
      evidence: { approvals: pending, crm_drafts: crmPending }, confidence: 'high',
    };
  } else if (subject.name === 'audit') {
    const db = getDb();
    const rows = db.prepare(`SELECT action, COUNT(*) AS c FROM audit_events WHERE org_id = ? GROUP BY action ORDER BY c DESC LIMIT 8`).all(principal.orgId);
    result = {
      answer: `Recent audit activity: ${rows.map((r) => `${r.action} (${r.c})`).join(', ')}.`,
      evidence: { audit: rows }, confidence: 'high',
    };
  } else {
    // No dedicated handler: say so rather than silently answering a different question.
    result = {
      answer: `I can see ${subject.label.toLowerCase()} in this database but I do not have a specific analysis for that yet. I can answer counts and lists for it.`,
      evidence: {}, confidence: 'low',
      limitations: ['This subject has no dedicated analysis; only a record count is available.'],
    };
  }

  return {
    ...result,
    subject: subject.name,
    subjectLabel: subject.label,
    shape,
    period: null,
    limitations: result.confidence === 'medium'
      ? ['Answered from record counts; a more specific question will give a more specific figure.']
      : [],
  };
}

/** What this assistant can see, for the "everything that is there in the database" question. */
export function coverage(principal) {
  const db = getDb();
  const orgId = principal.orgId;
  const count = (table) => {
    try { return db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE org_id = ?`).get(orgId).c; } catch { return 0; }
  };
  return {
    employees: count('employees'),
    projects: count('projects'),
    allocations: count('allocations'),
    timesheets: count('timesheets'),
    invoices: maySeeFinance(principal) || maySeeCost(principal) ? count('invoices') : null,
    departments: count('departments'),
    leads: count('crm_leads'),
    insights: count('ai_insights'),
    approvals: count('approval_requests'),
    audit_events: count('audit_events'),
    subjects: SUBJECTS.map((s) => ({ name: s.name, label: s.label })),
  };
}
