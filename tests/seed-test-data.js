/**
 * Intentional, fully deterministic fixture data for tests.
 * Small enough to reason about, large enough to exercise the analytics.
 */
import { getDb, now } from '../server/db/index.js';
import { hashPassword } from '../server/auth/passwords.js';
import { seedOrgDefaults } from '../server/services/onboarding.js';

const db = getDb();
const ts = now();

async function makeOrg({ name, slug, withCosts = true, adminEmail }) {
  const orgId = db.prepare(`INSERT INTO organizations (name, slug, industry, country, currency, created_at, updated_at)
      VALUES (?, ?, 'Testing', 'IN', 'INR', ?, ?)`).run(name, slug, ts, ts).lastInsertRowid;
  seedOrgDefaults(orgId, { planCode: 'professional', seats: 10 });
  const hash = await hashPassword('DemoPass!2026');
  const userId = db.prepare(`INSERT INTO users (org_id, email, full_name, title, password_hash, status, created_at, updated_at)
      VALUES (?, ?, ?, 'Admin', ?, 'active', ?, ?)`).run(orgId, adminEmail, `${name} Admin`, hash, ts, ts).lastInsertRowid;
  const roleId = db.prepare('SELECT id FROM roles WHERE org_id = ? AND code = ?').get(orgId, 'org_admin').id;
  db.prepare('INSERT INTO user_roles (user_id, role_id, assigned_at) VALUES (?, ?, ?)').run(userId, roleId, ts);
  return { orgId, userId };
}

async function addUser(orgId, email, roleCode, scope = {}) {
  const hash = await hashPassword('DemoPass!2026');
  const userId = db.prepare(`INSERT INTO users (org_id, email, full_name, title, password_hash, status, created_at, updated_at)
      VALUES (?, ?, 'Test User', 'Tester', ?, 'active', ?, ?)`).run(orgId, email, hash, ts, ts).lastInsertRowid;
  const roleId = db.prepare('SELECT id FROM roles WHERE org_id = ? AND code = ?').get(orgId, roleCode).id;
  db.prepare('INSERT INTO user_roles (user_id, role_id, business_unit_id, department_id, assigned_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId, roleId, scope.businessUnitId ?? null, scope.departmentId ?? null, ts);
  return userId;
}

/* ---------------- Org A: the main deterministic fixture -------------------- */
const a = await makeOrg({ name: 'Test Alpha Ltd', slug: 'test-alpha', adminEmail: 'admin@alpha.test' });

const locId = db.prepare(`INSERT INTO locations (org_id, name, country, timezone, hours_per_day, working_days, holidays, created_at)
    VALUES (?, 'Alpha HQ', 'IN', 'Asia/Kolkata', 8, '[1,2,3,4,5]', '[]', ?)`).run(a.orgId, ts).lastInsertRowid;

const buA = db.prepare('INSERT INTO business_units (org_id, name, code, created_at) VALUES (?, ?, ?, ?)').run(a.orgId, 'Delivery', 'DLV', ts).lastInsertRowid;
const buB = db.prepare('INSERT INTO business_units (org_id, name, code, created_at) VALUES (?, ?, ?, ?)').run(a.orgId, 'Support', 'SUP', ts).lastInsertRowid;
const deptA = db.prepare('INSERT INTO departments (org_id, business_unit_id, name, code, created_at) VALUES (?, ?, ?, ?, ?)').run(a.orgId, buA, 'Engineering', 'ENG', ts).lastInsertRowid;
const deptB = db.prepare('INSERT INTO departments (org_id, business_unit_id, name, code, created_at) VALUES (?, ?, ?, ?, ?)').run(a.orgId, buB, 'Service Desk', 'SD', ts).lastInsertRowid;

const skillJava = db.prepare('INSERT INTO skills (org_id, name, created_at) VALUES (?, ?, ?)').run(a.orgId, 'Java', ts).lastInsertRowid;
const skillSql = db.prepare('INSERT INTO skills (org_id, name, created_at) VALUES (?, ?, ?)').run(a.orgId, 'SQL', ts).lastInsertRowid;

/**
 * Two employees with exactly known capacity:
 *   empA: 40 h/week, full time  -> August 2026 (21 weekdays) = 168 available hours
 *   empB: 20 h/week (0.5 FTE)   -> 84 available hours
 * Allocations are sized so expected values are checkable by hand.
 */
const empA = db.prepare(`INSERT INTO employees (org_id, employee_code, full_name, email, department_id, business_unit_id, location_id,
    designation, employment_type, status, fte, weekly_hours, annual_cost, cost_currency, bill_rate_hour, data_source, created_at, updated_at)
    VALUES (?, 'T-001', 'Alex Full', 'alex@alpha.test', ?, ?, ?, 'Engineer', 'full_time', 'active', 1, 40, 1200000, 'INR', 2000, 'test', ?, ?)`)
  .run(a.orgId, deptA, buA, locId, ts, ts).lastInsertRowid;
const empB = db.prepare(`INSERT INTO employees (org_id, employee_code, full_name, email, department_id, business_unit_id, location_id,
    designation, employment_type, status, fte, weekly_hours, annual_cost, cost_currency, bill_rate_hour, data_source, created_at, updated_at)
    VALUES (?, 'T-002', 'Blair Half', 'blair@alpha.test', ?, ?, ?, 'Engineer', 'part_time', 'active', 0.5, 20, 600000, 'INR', 1500, 'test', ?, ?)`)
  .run(a.orgId, deptB, buB, locId, ts, ts).lastInsertRowid;
// empC is a bench employee with no allocations at all.
const empC = db.prepare(`INSERT INTO employees (org_id, employee_code, full_name, email, department_id, business_unit_id, location_id,
    designation, employment_type, status, fte, weekly_hours, annual_cost, cost_currency, data_source, created_at, updated_at)
    VALUES (?, 'T-003', 'Casey Bench', 'casey@alpha.test', ?, ?, ?, 'Engineer', 'full_time', 'active', 1, 40, 900000, 'INR', 'test', ?, ?)`)
  .run(a.orgId, deptA, buA, locId, ts, ts).lastInsertRowid;
const empExited = db.prepare(`INSERT INTO employees (org_id, employee_code, full_name, email, department_id, business_unit_id, location_id,
    designation, employment_type, status, exit_date, fte, weekly_hours, data_source, created_at, updated_at)
    VALUES (?, 'T-004', 'Dana Exited', 'dana@alpha.test', ?, ?, ?, 'Engineer', 'full_time', 'exited', '2026-06-30', 1, 40, 'test', ?, ?)`)
  .run(a.orgId, deptA, buA, locId, ts, ts).lastInsertRowid;

db.prepare('INSERT INTO employee_skills (org_id, employee_id, skill_id, proficiency) VALUES (?, ?, ?, 4)').run(a.orgId, empA, skillJava);
db.prepare('INSERT INTO employee_skills (org_id, employee_id, skill_id, proficiency) VALUES (?, ?, ?, 3)').run(a.orgId, empB, skillJava);
db.prepare('INSERT INTO employee_skills (org_id, employee_id, skill_id, proficiency) VALUES (?, ?, ?, 3)').run(a.orgId, empC, skillSql);

const proj = db.prepare(`INSERT INTO projects (org_id, code, name, client_name, business_unit_id, department_id, start_date, end_date,
    status, contract_type, budget_amount, currency, billing_rate_hour, priority, health, created_at, updated_at)
    VALUES (?, 'P-1', 'Alpha Platform', 'Alpha Client', ?, ?, '2026-01-01', '2026-12-31', 'active', 'time_material', 12000000, 'INR', 2500, 'high', 'green', ?, ?)`)
  .run(a.orgId, buA, deptA, ts, ts).lastInsertRowid;

// August 2026 has 21 weekdays: 2026-08-03 .. 2026-08-31 minus weekends.
const MONTH = '2026-08';
db.prepare(`INSERT INTO allocations (org_id, employee_id, project_id, start_date, end_date, hours_per_week, billable, bill_rate_hour, status, created_at, updated_at)
    VALUES (?, ?, ?, '2026-08-01', '2026-08-31', 20, 1, 2500, 'confirmed', ?, ?)`).run(a.orgId, empA, proj, ts, ts);
// empA also has an overlapping internal allocation: 24 h/week -> total 44 > 40 capacity (over-allocation)
db.prepare(`INSERT INTO allocations (org_id, employee_id, project_id, start_date, end_date, hours_per_week, billable, status, created_at, updated_at)
    VALUES (?, ?, NULL, '2026-08-01', '2026-08-31', 24, 0, 'confirmed', ?, ?)`).run(a.orgId, empA, ts, ts);

// Timesheets: empA records 8h billable on each of 10 weekdays = 80 hours.
for (const day of ['03', '04', '05', '06', '07', '10', '11', '12', '13', '14']) {
  db.prepare(`INSERT INTO timesheets (org_id, employee_id, project_id, work_date, hours, billable, source) VALUES (?, ?, ?, ?, 8, 1, 'test')`)
    .run(a.orgId, empA, proj, `2026-08-${day}`);
}
// empB records 4h on 5 days = 20 hours (non-billable)
for (const day of ['03', '04', '05', '06', '07']) {
  db.prepare(`INSERT INTO timesheets (org_id, employee_id, project_id, work_date, hours, billable, source) VALUES (?, ?, NULL, ?, 4, 0, 'test')`)
    .run(a.orgId, empB, `2026-08-${day}`);
}
// empC has no timesheets at all -> utilization must be null, not zero.

// Demand record with no matching allocation -> 0% coverage
const demand = db.prepare(`INSERT INTO project_demand (org_id, project_id, role_title, required_skill_id, headcount, hours_per_week,
    start_date, end_date, priority, status, created_at) VALUES (?, ?, 'Backend Engineer', ?, 2, 40, '2026-08-01', '2026-08-31', 'critical', 'open', ?)`)
  .run(a.orgId, proj, skillJava, ts).lastInsertRowid;

const invoice = db.prepare(`INSERT INTO invoices (org_id, project_id, invoice_number, period_month, amount, currency, status, issued_date, created_at)
    VALUES (?, ?, 'INV-T-1', '2026-08', 1000000, 'INR', 'paid', '2026-08-05', ?)`).run(a.orgId, proj, ts).lastInsertRowid;
db.prepare(`INSERT INTO expenses (org_id, project_id, department_id, category, period_month, amount, currency, created_at)
    VALUES (?, ?, ?, 'software', '2026-08', 100000, 'INR', ?)`).run(a.orgId, proj, deptA, ts);

// A second department user, restricted to Engineering only.
const scopedUserId = await addUser(a.orgId, 'scoped@alpha.test', 'analyst', { departmentId: deptA });
const viewerUserId = await addUser(a.orgId, 'viewer@alpha.test', 'viewer');
const financeUserId = await addUser(a.orgId, 'finance@alpha.test', 'finance');

/* ---------------- Org B: isolation fixture --------------------------------- */
const b = await makeOrg({ name: 'Test Beta Ltd', slug: 'test-beta', adminEmail: 'admin@beta.test' });
db.prepare('INSERT INTO business_units (org_id, name, code, created_at) VALUES (?, ?, ?, ?)').run(b.orgId, 'Beta Unit', 'BU', ts);
const empBeta = db.prepare(`INSERT INTO employees (org_id, employee_code, full_name, email, designation, employment_type, status, fte,
    weekly_hours, annual_cost, data_source, created_at, updated_at)
    VALUES (?, 'B-001', 'Beta Person', 'beta@beta.test', 'Analyst', 'full_time', 'active', 1, 40, 5000000, 'test', ?, ?)`)
  .run(b.orgId, ts, ts).lastInsertRowid;

export default {
  orgA: { id: a.orgId, adminEmail: 'admin@alpha.test', scopedUserId, viewerUserId, financeUserId },
  orgB: { id: b.orgId, adminEmail: 'admin@beta.test', employeeId: empBeta },
  employees: { empA, empB, empC, empExited },
  departmentA: deptA,
  departmentB: deptB,
  businessUnitA: buA,
  businessUnitB: buB,
  project: proj,
  projectCode: 'P-1',
  demandId: demand,
  invoiceId: invoice,
  month: MONTH,
  // Expected values, documented for the assertions:
  expected: {
    empA_available_hours: 168,  // 8h/day × 21 weekdays × 1 FTE
    empB_available_hours: 84,   // 8h/day × 21 weekdays × 0.5 FTE
    empA_allocated_hours: 184.8, // 44 h/week ÷ 5 × 21 weekdays
    empB_allocated_hours: 0,
    empA_utilized_hours: 80,
    empB_utilized_hours: 20,
    empC_utilized_hours: 0,
    total_available_hours: 168 + 84 + 168,
    total_allocated_hours: 184.8,
    total_utilized_hours: 100,
  },
};
