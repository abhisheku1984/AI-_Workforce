/**
 * FICTIONAL demonstration data.
 *
 * Every organization, person, project and amount below is invented for
 * demonstration and testing. It must never be mixed with real customer data.
 * All seeded employees carry is_demo = 1 and all orgs are named "(Demo)".
 */
import { getDb, now, today } from '../db/index.js';
import { hashPassword } from '../auth/passwords.js';
import { seedOrgDefaults } from '../services/onboarding.js';

const CUR_MONTH = new Date().toISOString().slice(0, 7);

/** Deterministic PRNG so seeded demos are reproducible. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const between = (r, a, b) => a + r() * (b - a);
const intBetween = (r, a, b) => Math.floor(between(r, a, b + 1));

function monthList(endMonth = CUR_MONTH, count = 6) {
  const [y, m] = endMonth.split('-').map(Number);
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

function monthDays(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = [];
  for (let d = 1; d <= last; d++) {
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCDay() >= 1 && date.getUTCDay() <= 5) days.push(date.toISOString().slice(0, 10));
  }
  return days;
}

const FIRST_NAMES = ['Asha', 'Rahul', 'Priya', 'Vikram', 'Meera', 'Arjun', 'Sneha', 'Karthik', 'Divya', 'Rohit',
  'Ananya', 'Suresh', 'Neha', 'Manoj', 'Ishita', 'Ravi', 'Pooja', 'Amit', 'Kavya', 'Nikhil', 'Lakshmi', 'Sanjay',
  'Deepa', 'Rajesh', 'Shweta', 'Vivek', 'Anjali', 'Hari', 'Trisha', 'Gaurav', 'Bhavna', 'Siddharth', 'Ritu',
  'Akash', 'Nandini', 'Pranav', 'Swati', 'Yash', 'Rekha', 'Varun'];
const LAST_NAMES = ['Rao', 'Sharma', 'Iyer', 'Patel', 'Nair', 'Reddy', 'Menon', 'Gupta', 'Singh', 'Kulkarni',
  'Bhat', 'Verma', 'Chandra', 'Das', 'Joshi', 'Pillai', 'Mehta', 'Kapoor', 'Raman', 'Shetty', 'Bose', 'Agarwal'];

function personName(r, used) {
  for (let i = 0; i < 50; i++) {
    const n = `${pick(r, FIRST_NAMES)} ${pick(r, LAST_NAMES)}`;
    if (!used.has(n)) { used.add(n); return n; }
  }
  const n = `${pick(r, FIRST_NAMES)} ${pick(r, LAST_NAMES)} ${used.size}`;
  used.add(n);
  return n;
}

const SKILL_SETS = {
  it: ['Java', 'Spring Boot', 'React', 'Node.js', 'Python', 'SQL', 'AWS', 'Azure', 'Kubernetes', 'Docker',
    'Terraform', 'SAP ABAP', 'Salesforce', 'QA Automation', 'Selenium', 'Data Engineering', 'Snowflake',
    'Power BI', 'Business Analysis', 'Scrum Mastery', '.NET', 'Angular'],
  bpo: ['Customer Service', 'Technical Support', 'Voice Process', 'Chat Support', 'Quality Assurance',
    'Workforce Planning', 'Team Leadership', 'Collections', 'Healthcare BPO', 'Spanish Language',
    'Process Improvement', 'CRM Tools', 'Escalation Handling', 'Training Delivery'],
  gcc: ['Financial Analysis', 'SAP FICO', 'IFRS Reporting', 'Internal Audit', 'Treasury', 'Data Analytics',
    'Python', 'RPA', 'Power BI', 'Shared Services', 'Vendor Management', 'Compliance', 'Procurement'],
};

/**
 * Create one demo organization with a full, internally consistent data set.
 */
export async function seedScenario(cfg) {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM organizations WHERE slug = ?').get(cfg.slug);
  if (existing) {
    console.log(`[seed] ${cfg.slug} already exists (org ${existing.id}) — skipped`);
    return { orgId: existing.id, skipped: true };
  }
  const r = rng(cfg.seed);
  const ts = now();
  const orgId = db.prepare(`INSERT INTO organizations (name, slug, industry, country, currency, timezone, fiscal_start_month, created_at, updated_at)
      VALUES (?, ?, ?, 'IN', 'INR', 'Asia/Kolkata', 4, ?, ?)`)
    .run(cfg.orgName, cfg.slug, cfg.industry, ts, ts).lastInsertRowid;
  seedOrgDefaults(orgId, { modules: cfg.modules, planCode: cfg.planCode, seats: cfg.seats });

  console.log(`[seed] creating demo organization "${cfg.orgName}" (id ${orgId})`);

  // ---- locations
  const locationIds = cfg.locations.map((l) =>
    db.prepare(`INSERT INTO locations (org_id, name, country, timezone, hours_per_day, working_days, holidays, created_at)
        VALUES (?, ?, 'IN', 'Asia/Kolkata', ?, '[1,2,3,4,5]', ?, ?)`)
      .run(orgId, l.name, l.hoursPerDay ?? 8, JSON.stringify(l.holidays ?? []), ts).lastInsertRowid);

  // ---- business units & departments
  const buIds = {};
  for (const bu of cfg.businessUnits) {
    buIds[bu.name] = db.prepare('INSERT INTO business_units (org_id, name, code, leader, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(orgId, bu.name, bu.code, bu.leader ?? null, ts).lastInsertRowid;
  }
  const deptIds = {};
  for (const d of cfg.departments) {
    deptIds[d.name] = db.prepare('INSERT INTO departments (org_id, business_unit_id, name, code, cost_center, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(orgId, buIds[d.businessUnit], d.name, d.code, d.costCenter ?? null, ts).lastInsertRowid;
  }

  // ---- skills catalogue
  const skillIds = new Map();
  for (const s of SKILL_SETS[cfg.skillProfile]) {
    skillIds.set(s, db.prepare('INSERT INTO skills (org_id, name, category, created_at) VALUES (?, ?, ?, ?)')
      .run(orgId, s, null, ts).lastInsertRowid);
  }

  // ---- employees
  const usedNames = new Set();
  const employees = [];
  const manager = { name: null };
  let codeSeq = 1000;
  for (const spec of cfg.headcount) {
    for (let i = 0; i < spec.count; i++) {
      codeSeq += 1;
      const name = personName(r, usedNames);
      const locId = pick(r, locationIds);
      const joinOffset = intBetween(r, -intBetween(r, 30, 2200), -30);
      const joinDate = new Date(Date.UTC(2026, 10, 10) + joinOffset * 86400000).toISOString().slice(0, 10);
      const employment = spec.employment || (r() < 0.08 ? 'contractor' : 'full_time');
      const fte = employment === 'part_time' ? 0.6 : employment === 'intern' ? 0.5 : 1;
      const costPerYear = Math.round(spec.cost * between(r, 0.82, 1.22) / 1000) * 1000;
      const billRate = Math.round(spec.cost / 2000 * between(r, 1.4, 2.2) / 10) * 10;
      const id = db.prepare(`INSERT INTO employees (org_id, employee_code, full_name, email, department_id, business_unit_id,
          location_id, designation, grade, employment_type, status, join_date, fte, annual_cost, cost_currency, bill_rate_hour,
          data_source, is_demo, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, 'INR', ?, 'demo-seed', 1, ?, ?)`)
        .run(orgId, `${cfg.codePrefix}-${codeSeq}`, name,
          `${name.toLowerCase().replace(/\s+/g, '.')}@${cfg.emailDomain}`, deptIds[spec.department], buIds[spec.businessUnit],
          spec.fixedLocation ?? locId, spec.designation, spec.grade, employment, joinDate, fte, costPerYear, billRate, ts, ts)
        .lastInsertRowid;

      // skills
      const empSkills = new Set();
      const skillCount = intBetween(r, 2, 5);
      for (let k = 0; k < skillCount; k++) {
        const s = pick(r, spec.skills);
        if (empSkills.has(s)) continue;
        empSkills.add(s);
        db.prepare('INSERT INTO employee_skills (org_id, employee_id, skill_id, proficiency, years, verified) VALUES (?, ?, ?, ?, ?, ?)')
          .run(orgId, id, skillIds.get(s) ?? [...skillIds.values()][0], intBetween(r, 2, 5), Math.round(between(r, 1, 12)), r() < 0.6 ? 1 : 0);
      }
      employees.push({ id, name, departmentId: deptIds[spec.department], buId: buIds[spec.businessUnit], locId, billRate, costPerYear, spec });
    }
  }

  // managers
  for (const spec of cfg.headcount) {
    const inDept = employees.filter((e) => e.departmentId === deptIds[spec.department]);
    if (!inDept.length) continue;
    const mgr = inDept[Math.floor(r() * inDept.length)];
    manager.name = mgr.name;
    for (const e of inDept) {
      if (e.id !== mgr.id) db.prepare('UPDATE employees SET manager_id = ? WHERE id = ?').run(mgr.id, e.id);
    }
  }

  // ---- projects
  const months = monthList(CUR_MONTH, 6);
  const projects = [];
  for (const p of cfg.projects) {
    const start = p.startsMonthsAgo != null
      ? new Date(Date.UTC(Number(CUR_MONTH.slice(0, 4)), Number(CUR_MONTH.slice(5)) - 1 - p.startsMonthsAgo, 1)).toISOString().slice(0, 10)
      : p.start;
    const end = new Date(Date.UTC(Number(CUR_MONTH.slice(0, 4)), Number(CUR_MONTH.slice(5)) - 1 + p.endsInMonths, 0)).toISOString().slice(0, 10);
    const id = db.prepare(`INSERT INTO projects (org_id, code, name, client_name, business_unit_id, department_id, start_date,
        end_date, status, contract_type, budget_amount, currency, billing_rate_hour, priority, health, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?)`)
      .run(orgId, p.code, p.name, p.client, buIds[p.businessUnit], deptIds[p.department], start, end,
        p.status ?? 'active', p.contractType ?? 'time_material', p.budget, p.billRate, p.priority ?? 'medium',
        p.health ?? 'green', ts, ts).lastInsertRowid;
    projects.push({ id, code: p.code, name: p.name, billRate: p.billRate, departmentId: deptIds[p.department], buId: buIds[p.businessUnit], cfg: p, start, end });
  }

  // ---- demand records
  const demandIds = [];
  for (const p of projects) {
    const dspecs = p.cfg.demand || [];
    for (const d of dspecs) {
      const start = d.startsInMonths != null
        ? new Date(Date.UTC(Number(CUR_MONTH.slice(0, 4)), Number(CUR_MONTH.slice(5)) - 1 + d.startsInMonths, 1)).toISOString().slice(0, 10)
        : p.start;
      const end = new Date(Date.UTC(Number(CUR_MONTH.slice(0, 4)), Number(CUR_MONTH.slice(5)) - 1 + (d.endsInMonths ?? 2), 0)).toISOString().slice(0, 10);
      const id = db.prepare(`INSERT INTO project_demand (org_id, project_id, role_title, required_skill_id, headcount, hours_per_week,
          start_date, end_date, priority, status, notes, created_at)
          VALUES (?, ?, ?, ?, ?, 40, ?, ?, ?, ?, ?, ?)`)
        .run(orgId, p.id, d.role, skillIds.get(d.skill) ?? null, d.headcount, start, end, d.priority ?? 'medium',
          d.status ?? 'open', d.note ?? null, ts).lastInsertRowid;
      demandIds.push({ id, projectId: p.id, spec: d, start, end });
    }
  }

  // ---- allocations + timesheets
  const insertAlloc = db.prepare(`INSERT INTO allocations (org_id, employee_id, project_id, demand_id, start_date, end_date,
      hours_per_week, allocation_pct, billable, bill_rate_hour, status, note, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?)`);
  const insertTs = db.prepare(`INSERT OR IGNORE INTO timesheets (org_id, employee_id, project_id, work_date, hours, billable, source, import_id)
      VALUES (?, ?, ?, ?, ?, ?, 'demo-seed', NULL)`);

  const allocSummary = [];
  for (const emp of employees) {
    // Department-appropriate projects
    const candidates = projects.filter((p) => p.departmentId === emp.departmentId || p.buId === emp.buId);
    const pool = candidates.length ? candidates : projects;
    const assignedCount = r() < emp.spec.benchProbability ? 0 : intBetween(r, 1, emp.spec.maxProjects ?? 2);
    let totalWeekly = 0;
    const chosen = new Set();
    for (let i = 0; i < assignedCount; i++) {
      const proj = pick(r, pool);
      if (chosen.has(proj.id)) continue;
      chosen.add(proj.id);
      // Deliberate over-allocation in a small share of people to make over-allocation realistic.
      const hrs = emp.spec.overAllocated && i === 0 ? 52 : intBetween(r, 16, 40);
      totalWeekly += hrs;
      const aStart = proj.start > months[0] + '-01' ? proj.start : `${months[0]}-01`;
      const aEnd = proj.end < `${CUR_MONTH}-28` ? proj.end : `${CUR_MONTH}-28`;
      const demandMatch = demandIds.find((d) => d.projectId === proj.id && d.start <= aEnd && d.end >= aStart);
      insertAlloc.run(orgId, emp.id, proj.id, demandMatch?.id ?? null, aStart, aEnd, hrs,
        emp.spec.billable === false ? 0 : 1, proj.billRate, 'confirmed',
        `Demo allocation for ${emp.name}`, ts, ts);
      allocSummary.push({ employeeId: emp.id, projectId: proj.id, weekly: hrs });
    }

    // Timesheets: actual utilization designed per cohort, for the last 6 months.
    const target = emp.spec.utilizationTarget ?? 0.85;
    for (const m of months) {
      const util = Math.min(Math.max(target + between(r, -0.14, 0.14), 0.35), 1.05);
      for (const day of monthDays(m)) {
        if (r() < 0.02) continue; // occasional leave / missing day
        const dailyCapacity = 8 * (emp.spec.fteScale ?? 1);
        const worked = Math.min(dailyCapacity * util, 12);
        if (totalWeekly === 0) {
          // Bench people: small non-billable internal/training time
          insertTs.run(orgId, emp.id, null, day, Math.round(worked * 0.55 * 2) / 2, 0);
        } else {
          const billableShare = emp.spec.billable === false ? 0 : between(r, 0.78, 0.96);
          const billableHours = Math.round(worked * billableShare * 2) / 2;
          const project = allocSummary.filter((a) => a.employeeId === emp.id)[0];
          if (billableHours > 0) insertTs.run(orgId, emp.id, project?.projectId ?? pool[0].id, day, billableHours, 1);
          const nonBillable = Math.round((worked - billableHours) * 2) / 2;
          if (nonBillable > 0) insertTs.run(orgId, emp.id, null, day, nonBillable, 0);
        }
      }
    }
  }

  // ---- invoices & expenses
  for (const p of projects) {
    for (const m of months) {
      if (p.cfg.invoiceable === false) continue;
      if (r() < 0.08) continue;
      const amount = Math.round((p.cfg.monthlyInvoice ?? 1500000) * between(r, 0.72, 1.1) / 1000) * 1000;
      const paid = m < CUR_MONTH && r() < 0.86;
      db.prepare(`INSERT INTO invoices (org_id, project_id, invoice_number, period_month, amount, currency, status,
          issued_date, due_date, paid_date, created_at) VALUES (?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?)`)
        .run(orgId, p.id, `INV-${p.code}-${m.replace('-', '')}`, m, amount, paid ? 'paid' : 'issued',
          `${m}-05`, `${m}-30`, paid ? `${m}-25` : null, ts);
    }
  }

  const expenseCats = cfg.expenseCategories || ['software', 'facilities', 'travel', 'subcontractor'];
  for (const m of months) {
    for (const d of cfg.departments) {
      if (r() < 0.25) continue;
      db.prepare(`INSERT INTO expenses (org_id, project_id, department_id, category, period_month, amount, currency, description, created_at)
          VALUES (?, NULL, ?, ?, ?, ?, 'INR', 'Demo operating expense', ?)`)
        .run(orgId, deptIds[d.name], pick(r, expenseCats), m, Math.round(between(r, 60000, 420000) / 100) * 100, ts);
    }
  }

  // ---- users, one per persona
  const tempPassword = cfg.tempPassword || 'DemoPass!2026';
  const hash = await hashPassword(tempPassword);
  const users = [];
  const userSpecs = [
    { email: `admin@${cfg.emailDomain}`, name: `${cfg.orgName.split(' ')[0]} Administrator`, title: 'Organization Administrator', role: 'org_admin' },
    { email: `coo@${cfg.emailDomain}`, name: `COO ${cfg.orgName.split(' ')[0]}`, title: 'Chief Operating Officer', role: 'executive' },
    { email: `finance@${cfg.emailDomain}`, name: `Finance Lead`, title: 'Finance Controller', role: 'finance' },
    { email: `wfm@${cfg.emailDomain}`, name: `Workforce Manager`, title: 'Resource Manager', role: 'workforce_manager' },
    { email: `pm@${cfg.emailDomain}`, name: `Delivery Manager`, title: 'Project Manager', role: 'project_manager' },
    { email: `analyst@${cfg.emailDomain}`, name: `Business Analyst`, title: 'Analyst', role: 'analyst' },
    { email: `viewer@${cfg.emailDomain}`, name: `Read Only User`, title: 'Business Partner', role: 'viewer' },
  ];
  for (const u of userSpecs) {
    const id = db.prepare(`INSERT INTO users (org_id, email, full_name, title, password_hash, status, must_change_password, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'active', 0, ?, ?)`).run(orgId, u.email, u.name, u.title, hash, ts, ts).lastInsertRowid;
    const roleId = db.prepare('SELECT id FROM roles WHERE org_id = ? AND code = ?').get(orgId, u.role).id;
    db.prepare('INSERT INTO user_roles (user_id, role_id, assigned_at) VALUES (?, ?, ?)').run(id, roleId, ts);
    users.push({ ...u, id });
  }

  // Department-scoped demo user to prove data-scope enforcement.
  const scopedDept = cfg.departments[0];
  const scopedId = db.prepare(`INSERT INTO users (org_id, email, full_name, title, password_hash, status, must_change_password, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'active', 0, ?, ?)`)
    .run(orgId, `dept.manager@${cfg.emailDomain}`, `${scopedDept.name} Manager`, 'Department Manager', hash, ts, ts).lastInsertRowid;
  const wfmRole = db.prepare('SELECT id FROM roles WHERE org_id = ? AND code = ?').get(orgId, 'workforce_manager').id;
  db.prepare('INSERT INTO user_roles (user_id, role_id, department_id, assigned_at) VALUES (?, ?, ?, ?)')
    .run(scopedId, wfmRole, deptIds[scopedDept.name], ts);
  users.push({ email: `dept.manager@${cfg.emailDomain}`, role: 'workforce_manager (scoped)', department: scopedDept.name });

  const counts = {
    employees: db.prepare('SELECT COUNT(*) c FROM employees WHERE org_id = ?').get(orgId).c,
    projects: db.prepare('SELECT COUNT(*) c FROM projects WHERE org_id = ?').get(orgId).c,
    allocations: db.prepare('SELECT COUNT(*) c FROM allocations WHERE org_id = ?').get(orgId).c,
    timesheets: db.prepare('SELECT COUNT(*) c FROM timesheets WHERE org_id = ?').get(orgId).c,
    invoices: db.prepare('SELECT COUNT(*) c FROM invoices WHERE org_id = ?').get(orgId).c,
  };
  console.log(`[seed] ${cfg.orgName}: ${JSON.stringify(counts)}`);
  return { orgId, counts, users, tempPassword };
}

export const SCENARIOS = [
  {
    slug: 'demo-it-services',
    orgName: 'Nexora IT Services (Demo)',
    industry: 'IT Services',
    codePrefix: 'NX',
    emailDomain: 'nexora-demo.example',
    seed: 20261110,
    planCode: 'professional',
    seats: 25,
    skillProfile: 'it',
    modules: ['org_admin', 'data_ingestion', 'workforce', 'utilization', 'allocation', 'finance', 'dashboards', 'reports', 'ai_assistant', 'ai_insights', 'forecasting'],
    locations: [
      { name: 'Hyderabad (Madhapur)', holidays: [`${CUR_MONTH}-02`] },
      { name: 'Pune (Hinjewadi)', holidays: [] },
      { name: 'Bengaluru (Whitefield)', holidays: [] },
    ],
    businessUnits: [
      { name: 'IT Services', code: 'ITS', leader: 'Delivery Head' },
      { name: 'Digital Engineering', code: 'DIG', leader: 'Practice Head' },
      { name: 'Managed Services', code: 'MS', leader: 'Service Delivery Head' },
    ],
    departments: [
      { name: 'Application Development', code: 'APPD', businessUnit: 'IT Services', costCenter: 'CC-1101' },
      { name: 'Quality Engineering', code: 'QE', businessUnit: 'IT Services', costCenter: 'CC-1102' },
      { name: 'Cloud & DevOps', code: 'CLOUD', businessUnit: 'Digital Engineering', costCenter: 'CC-1201' },
      { name: 'Data & Analytics', code: 'DATA', businessUnit: 'Digital Engineering', costCenter: 'CC-1202' },
      { name: 'Enterprise Platforms', code: 'ERP', businessUnit: 'Managed Services', costCenter: 'CC-1301' },
    ],
    headcount: [
      // department, businessUnit, count, designation, grade, cost (annual INR), skills, benches, over-allocation, utilization
      { department: 'Application Development', businessUnit: 'IT Services', count: 18, designation: 'Software Engineer', grade: 'G3', cost: 950000, skills: ['Java', 'Spring Boot', 'React', 'Node.js', 'SQL'], benchProbability: 0.1, utilizationTarget: 0.86, maxProjects: 2 },
      { department: 'Application Development', businessUnit: 'IT Services', count: 6, designation: 'Senior Engineer', grade: 'G4', cost: 1600000, skills: ['Java', 'Spring Boot', 'Kubernetes', 'SQL'], benchProbability: 0.05, utilizationTarget: 0.92, overAllocated: true },
      { department: 'Quality Engineering', businessUnit: 'IT Services', count: 10, designation: 'QA Engineer', grade: 'G3', cost: 780000, skills: ['QA Automation', 'Selenium', 'SQL'], benchProbability: 0.25, utilizationTarget: 0.7 },
      { department: 'Cloud & DevOps', businessUnit: 'Digital Engineering', count: 9, designation: 'DevOps Engineer', grade: 'G4', cost: 1450000, skills: ['AWS', 'Kubernetes', 'Docker', 'Terraform'], benchProbability: 0.08, utilizationTarget: 0.9, overAllocated: true },
      { department: 'Data & Analytics', businessUnit: 'Digital Engineering', count: 8, designation: 'Data Engineer', grade: 'G4', cost: 1500000, skills: ['Python', 'Data Engineering', 'Snowflake', 'Power BI', 'SQL'], benchProbability: 0.3, utilizationTarget: 0.68 },
      { department: 'Enterprise Platforms', businessUnit: 'Managed Services', count: 7, designation: 'SAP Consultant', grade: 'G4', cost: 1700000, skills: ['SAP ABAP', 'Salesforce', 'Business Analysis'], benchProbability: 0.15, utilizationTarget: 0.8 },
      { department: 'Quality Engineering', businessUnit: 'IT Services', count: 3, designation: 'QA Lead', grade: 'G5', cost: 2100000, skills: ['QA Automation', 'Process Improvement'], benchProbability: 0, utilizationTarget: 0.9, employment: 'full_time' },
    ],
    projects: [
      { code: 'PRJ-2041', name: 'Meridian Bank Payments Modernisation', client: 'Meridian Bank', businessUnit: 'IT Services', department: 'Application Development', startsMonthsAgo: 7, endsInMonths: 5, billRate: 2650, budget: 48000000, monthlyInvoice: 3600000, priority: 'critical', health: 'amber', demand: [{ role: 'Backend Engineer', skill: 'Java', headcount: 3, startsInMonths: 0, endsInMonths: 3, priority: 'high' }, { role: 'QA Automation Engineer', skill: 'QA Automation', headcount: 2, startsInMonths: 1, endsInMonths: 4 }] },
      { code: 'PRJ-2055', name: 'Orbit Retail Cloud Migration', client: 'Orbit Retail', businessUnit: 'Digital Engineering', department: 'Cloud & DevOps', startsMonthsAgo: 5, endsInMonths: 7, billRate: 3100, budget: 36000000, monthlyInvoice: 2400000, priority: 'high', demand: [{ role: 'DevOps Engineer', skill: 'Kubernetes', headcount: 2, startsInMonths: 0, endsInMonths: 2, priority: 'critical' }] },
      { code: 'PRJ-2062', name: 'Halcyon Insurance Data Platform', client: 'Halcyon Insurance', businessUnit: 'Digital Engineering', department: 'Data & Analytics', startsMonthsAgo: 3, endsInMonths: 9, billRate: 2850, budget: 42000000, monthlyInvoice: 1900000, priority: 'high', health: 'red', demand: [{ role: 'Data Engineer', skill: 'Data Engineering', headcount: 4, startsInMonths: 0, endsInMonths: 4, priority: 'critical' }, { role: 'Analytics Engineer', skill: 'Power BI', headcount: 1, startsInMonths: 1, endsInMonths: 5 }] },
      { code: 'PRJ-2070', name: 'Crestline ERP Support', client: 'Crestline Group', businessUnit: 'Managed Services', department: 'Enterprise Platforms', startsMonthsAgo: 11, endsInMonths: 4, billRate: 2200, budget: 22000000, monthlyInvoice: 1400000, contractType: 'retainer', priority: 'medium', demand: [{ role: 'SAP Consultant', skill: 'SAP ABAP', headcount: 2, startsInMonths: 0, endsInMonths: 3 }] },
      { code: 'PRJ-2078', name: 'Sunfield Telecom QA Managed Service', client: 'Sunfield Telecom', businessUnit: 'IT Services', department: 'Quality Engineering', startsMonthsAgo: 2, endsInMonths: 10, billRate: 1750, budget: 16000000, monthlyInvoice: 900000, contractType: 'retainer', priority: 'medium', health: 'green', demand: [{ role: 'QA Engineer', skill: 'QA Automation', headcount: 3, startsInMonths: 0, endsInMonths: 6 }] },
      { code: 'PRJ-2083', name: 'Internal Platform Enablement', client: null, businessUnit: 'IT Services', department: 'Application Development', startsMonthsAgo: 4, endsInMonths: 6, billRate: 0, budget: 0, monthlyInvoice: 0, invoiceable: false, contractType: 'internal', priority: 'low' },
    ],
    expenseCategories: ['software', 'facilities', 'travel', 'subcontractor', 'training'],
  },
  {
    slug: 'demo-bpo',
    orgName: 'ContactBridge BPO (Demo)',
    industry: 'BPO / Contact Centre',
    codePrefix: 'CB',
    emailDomain: 'contactbridge-demo.example',
    seed: 771102,
    planCode: 'starter',
    seats: 15,
    skillProfile: 'bpo',
    modules: ['org_admin', 'data_ingestion', 'workforce', 'utilization', 'allocation', 'finance', 'dashboards', 'reports', 'ai_assistant', 'ai_insights'],
    locations: [
      { name: 'Hyderabad Contact Centre', hoursPerDay: 8 },
      { name: 'Kochi Contact Centre', hoursPerDay: 8 },
    ],
    businessUnits: [
      { name: 'Customer Experience', code: 'CX', leader: 'VP Operations' },
      { name: 'Technical Support', code: 'TS', leader: 'Head of Support' },
    ],
    departments: [
      { name: 'Voice Inbound', code: 'VOICE', businessUnit: 'Customer Experience', costCenter: 'CC-2101' },
      { name: 'Chat & Email Support', code: 'CHAT', businessUnit: 'Customer Experience', costCenter: 'CC-2102' },
      { name: 'Technical Helpdesk', code: 'THD', businessUnit: 'Technical Support', costCenter: 'CC-2201' },
      { name: 'Quality & Training', code: 'QT', businessUnit: 'Technical Support', costCenter: 'CC-2202' },
    ],
    headcount: [
      { department: 'Voice Inbound', businessUnit: 'Customer Experience', count: 34, designation: 'Customer Service Associate', grade: 'L1', cost: 340000, skills: ['Customer Service', 'Voice Process', 'CRM Tools'], benchProbability: 0.14, utilizationTarget: 0.88, maxProjects: 1 },
      { department: 'Voice Inbound', businessUnit: 'Customer Experience', count: 6, designation: 'Team Lead', grade: 'L2', cost: 620000, skills: ['Team Leadership', 'Escalation Handling', 'Customer Service'], benchProbability: 0.05, utilizationTarget: 0.82, maxProjects: 2 },
      { department: 'Chat & Email Support', businessUnit: 'Customer Experience', count: 22, designation: 'Chat Support Associate', grade: 'L1', cost: 320000, skills: ['Chat Support', 'Customer Service', 'Spanish Language'], benchProbability: 0.2, utilizationTarget: 0.78, maxProjects: 1 },
      { department: 'Technical Helpdesk', businessUnit: 'Technical Support', count: 16, designation: 'Technical Support Associate', grade: 'L2', cost: 430000, skills: ['Technical Support', 'Escalation Handling', 'CRM Tools'], benchProbability: 0.1, utilizationTarget: 0.9, overAllocated: true, maxProjects: 1 },
      { department: 'Quality & Training', businessUnit: 'Technical Support', count: 5, designation: 'Quality Analyst', grade: 'L2', cost: 560000, skills: ['Quality Assurance', 'Training Delivery', 'Process Improvement'], benchProbability: 0.25, utilizationTarget: 0.7 },
      { department: 'Voice Inbound', businessUnit: 'Customer Experience', count: 4, designation: 'Workforce Planner', grade: 'L3', cost: 780000, skills: ['Workforce Planning', 'Process Improvement'], benchProbability: 0, utilizationTarget: 0.8, billable: false },
    ],
    projects: [
      { code: 'CL-ASPIRE', name: 'Aspire Telecom Inbound Support', client: 'Aspire Telecom', businessUnit: 'Customer Experience', department: 'Voice Inbound', startsMonthsAgo: 14, endsInMonths: 6, billRate: 620, budget: 36000000, monthlyInvoice: 3100000, contractType: 'retainer', priority: 'high', demand: [{ role: 'Voice Associate', skill: 'Voice Process', headcount: 8, startsInMonths: 0, endsInMonths: 3, priority: 'high' }] },
      { code: 'CL-NOVA', name: 'Nova Health Patient Support', client: 'Nova Health', businessUnit: 'Customer Experience', department: 'Chat & Email Support', startsMonthsAgo: 8, endsInMonths: 8, billRate: 540, budget: 24000000, monthlyInvoice: 1800000, priority: 'medium', demand: [{ role: 'Chat Associate', skill: 'Chat Support', headcount: 6, startsInMonths: 1, endsInMonths: 4 }] },
      { code: 'CL-ZEN', name: 'Zenith Devices Technical Helpdesk', client: 'Zenith Devices', businessUnit: 'Technical Support', department: 'Technical Helpdesk', startsMonthsAgo: 20, endsInMonths: 10, billRate: 720, budget: 30000000, monthlyInvoice: 2200000, contractType: 'retainer', priority: 'high', health: 'amber', demand: [{ role: 'Technical Associate', skill: 'Technical Support', headcount: 5, startsInMonths: 0, endsInMonths: 5, priority: 'critical' }] },
      { code: 'CL-SUN', name: 'Sunrise Retail Seasonal Peak Support', client: 'Sunrise Retail', businessUnit: 'Customer Experience', department: 'Voice Inbound', startsMonthsAgo: 1, endsInMonths: 2, billRate: 580, budget: 6000000, monthlyInvoice: 1500000, priority: 'medium', demand: [{ role: 'Seasonal Associate', skill: 'Customer Service', headcount: 12, startsInMonths: 0, endsInMonths: 2, priority: 'high' }] },
    ],
    expenseCategories: ['facilities', 'software', 'training', 'telecom'],
  },
  {
    slug: 'demo-gcc',
    orgName: 'Helios Financial GCC (Demo)',
    industry: 'Global Capability Centre',
    codePrefix: 'HG',
    emailDomain: 'heliosgcc-demo.example',
    seed: 55291,
    planCode: 'enterprise',
    seats: 40,
    skillProfile: 'gcc',
    modules: ['org_admin', 'data_ingestion', 'workforce', 'utilization', 'allocation', 'finance', 'dashboards', 'reports', 'ai_assistant', 'ai_insights', 'forecasting', 'automation'],
    locations: [
      { name: 'Hyderabad GCC Campus', hoursPerDay: 8, holidays: [] },
      { name: 'Mumbai Shared Services', hoursPerDay: 8, holidays: [] },
      { name: 'Gurugram Finance Centre', hoursPerDay: 8, holidays: [] },
    ],
    businessUnits: [
      { name: 'Finance Shared Services', code: 'FSS', leader: 'Global Finance Director' },
      { name: 'Risk & Compliance', code: 'RAC', leader: 'Head of Risk' },
      { name: 'Digital & Automation', code: 'DNA', leader: 'Automation Lead' },
    ],
    departments: [
      { name: 'Record to Report', code: 'R2R', businessUnit: 'Finance Shared Services', costCenter: 'CC-3101' },
      { name: 'Procure to Pay', code: 'P2P', businessUnit: 'Finance Shared Services', costCenter: 'CC-3102' },
      { name: 'Internal Audit', code: 'IA', businessUnit: 'Risk & Compliance', costCenter: 'CC-3201' },
      { name: 'Automation & Analytics', code: 'AUTO', businessUnit: 'Digital & Automation', costCenter: 'CC-3301' },
    ],
    headcount: [
      { department: 'Record to Report', businessUnit: 'Finance Shared Services', count: 14, designation: 'Finance Analyst', grade: 'B2', cost: 920000, skills: ['Financial Analysis', 'IFRS Reporting', 'SAP FICO'], benchProbability: 0.12, utilizationTarget: 0.84 },
      { department: 'Record to Report', businessUnit: 'Finance Shared Services', count: 4, designation: 'Senior Finance Analyst', grade: 'B3', cost: 1550000, skills: ['IFRS Reporting', 'Treasury', 'Compliance'], benchProbability: 0.05, utilizationTarget: 0.9 },
      { department: 'Procure to Pay', businessUnit: 'Finance Shared Services', count: 10, designation: 'AP Specialist', grade: 'B1', cost: 640000, skills: ['SAP FICO', 'Procurement', 'Vendor Management'], benchProbability: 0.18, utilizationTarget: 0.8 },
      { department: 'Internal Audit', businessUnit: 'Risk & Compliance', count: 7, designation: 'Audit Associate', grade: 'B2', cost: 1080000, skills: ['Internal Audit', 'Compliance', 'Financial Analysis'], benchProbability: 0.3, utilizationTarget: 0.66 },
      { department: 'Automation & Analytics', businessUnit: 'Digital & Automation', count: 8, designation: 'Automation Engineer', grade: 'B2', cost: 1320000, skills: ['RPA', 'Python', 'Power BI', 'Data Analytics'], benchProbability: 0.08, utilizationTarget: 0.88, overAllocated: true },
      { department: 'Automation & Analytics', businessUnit: 'Digital & Automation', count: 3, designation: 'Analytics Lead', grade: 'B4', cost: 2400000, skills: ['Data Analytics', 'Power BI', 'Shared Services'], benchProbability: 0, utilizationTarget: 0.86, billable: false },
    ],
    projects: [
      { code: 'GCC-R2R-EU', name: 'Europe Record-to-Report Consolidation', client: 'Helios Group (internal)', businessUnit: 'Finance Shared Services', department: 'Record to Report', startsMonthsAgo: 10, endsInMonths: 8, billRate: 1450, budget: 30000000, monthlyInvoice: 2200000, contractType: 'internal', priority: 'high', demand: [{ role: 'Finance Analyst', skill: 'IFRS Reporting', headcount: 4, startsInMonths: 0, endsInMonths: 4, priority: 'high' }] },
      { code: 'GCC-P2P-APAC', name: 'APAC Procure-to-Pay Optimisation', client: 'Helios Group (internal)', businessUnit: 'Finance Shared Services', department: 'Procure to Pay', startsMonthsAgo: 6, endsInMonths: 6, billRate: 1180, budget: 18000000, monthlyInvoice: 1200000, contractType: 'internal', priority: 'medium', demand: [{ role: 'AP Specialist', skill: 'Procurement', headcount: 3, startsInMonths: 1, endsInMonths: 5 }] },
      { code: 'GCC-AUDIT-26', name: 'FY26 Internal Audit Programme', client: 'Helios Group (internal)', businessUnit: 'Risk & Compliance', department: 'Internal Audit', startsMonthsAgo: 3, endsInMonths: 9, billRate: 1600, budget: 24000000, monthlyInvoice: 1400000, contractType: 'internal', priority: 'critical', health: 'red', demand: [{ role: 'Audit Associate', skill: 'Internal Audit', headcount: 5, startsInMonths: 0, endsInMonths: 6, priority: 'critical' }] },
      { code: 'GCC-RPA-COE', name: 'RPA Centre of Excellence', client: 'Helios Group (internal)', businessUnit: 'Digital & Automation', department: 'Automation & Analytics', startsMonthsAgo: 12, endsInMonths: 12, billRate: 1900, budget: 34000000, monthlyInvoice: 2100000, contractType: 'internal', priority: 'high', demand: [{ role: 'Automation Engineer', skill: 'RPA', headcount: 3, startsInMonths: 0, endsInMonths: 3, priority: 'high' }, { role: 'Analytics Engineer', skill: 'Power BI', headcount: 1, startsInMonths: 2, endsInMonths: 6 }] },
    ],
    expenseCategories: ['software', 'facilities', 'travel', 'professional_fees'],
  },
];

export async function seedAll() {
  const results = [];
  for (const s of SCENARIOS) results.push({ slug: s.slug, ...(await seedScenario(s)) });
  return results;
}

export async function seedPlatformAdmin() {
  const db = getDb();
  const email = process.env.PLATFORM_ADMIN_EMAIL || 'platform@workforceiq.example';
  const existing = db.prepare('SELECT id FROM users WHERE LOWER(email) = LOWER(?)').get(email);
  if (existing) return { email, created: false };
  const password = process.env.PLATFORM_ADMIN_PASSWORD || 'PlatformAdmin!2026';
  const hash = await hashPassword(password);
  const ts = now();
  db.prepare(`INSERT INTO users (org_id, email, full_name, title, password_hash, is_platform_admin, status, must_change_password, created_at, updated_at)
      VALUES (NULL, ?, 'Platform Administrator', 'WorkforceIQ Platform', ?, 1, 'active', 1, ?, ?)`)
    .run(email, hash, ts, ts);
  return { email, password, created: true };
}
