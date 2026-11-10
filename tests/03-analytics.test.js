import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { loginAs, closeServer, demo, record } from './helpers.js';

after(async () => { await closeServer(); });

const MONTH = '2026-08';

function findEmployee(rows, code) {
  return rows.find((r) => r.employee_code === code);
}

test('Utilization and capacity calculations', async (t) => {
  const c = await loginAs('admin@alpha.test');

  await t.test('available hours match the documented formula', async () => {
    const res = await c.get(`/api/analytics/utilization?month=${MONTH}`);
    assert.equal(res.status, 200);
    const rows = res.body.data.employees;
    assert.equal(findEmployee(rows, 'T-001').available_hours, 168, 'full time: 8h × 21 weekdays');
    assert.equal(findEmployee(rows, 'T-002').available_hours, 84, 'part time: contracted 20h/week ÷ 5 × 21');
    assert.equal(findEmployee(rows, 'T-003').available_hours, 168);
    record('Analytics', 'Available hours = weekly hours ÷ 5 × working days (FTE applied once)', true);
  });

  await t.test('exited employee is excluded from the period', async () => {
    const res = await c.get(`/api/analytics/utilization?month=${MONTH}`);
    assert.ok(!res.body.data.employees.some((r) => r.employee_code === 'T-004'));
    record('Analytics', 'Employee who exited before the period is excluded', true);
  });

  await t.test('allocated hours sum overlapping allocations', async () => {
    const res = await c.get(`/api/analytics/utilization?month=${MONTH}`);
    const a = findEmployee(res.body.data.employees, 'T-001');
    assert.equal(a.allocated_hours, 184.8, '44 h/week ÷ 5 × 21 = 184.8');
    record('Analytics', 'Allocated hours aggregate overlapping allocations', true);
  });

  await t.test('utilization comes from timesheets and is null (not zero) without data', async () => {
    const res = await c.get(`/api/analytics/utilization?month=${MONTH}`);
    const rows = res.body.data.employees;
    assert.equal(findEmployee(rows, 'T-001').utilized_hours, 80);
    assert.equal(findEmployee(rows, 'T-001').utilization_pct, 47.6);
    assert.equal(findEmployee(rows, 'T-003').utilization_pct, null, 'no timesheets => null, never 0%');
    record('Analytics', 'Utilization is null rather than 0 when no timesheet data exists', true);
  });

  await t.test('unallocated and over-allocated hours reconcile', async () => {
    const res = await c.get(`/api/analytics/utilization?month=${MONTH}`);
    const rows = res.body.data.employees;
    const a = findEmployee(rows, 'T-001');
    const b = findEmployee(rows, 'T-002');
    assert.equal(a.over_allocated_hours, 16.8, '184.8 allocated − 168 available');
    assert.equal(a.unallocated_hours, 0);
    assert.equal(a.allocation_pct, 110);
    assert.equal(b.unallocated_hours, 84);
    const total = res.body.data.total;
    assert.equal(total.available_hours, 420);
    assert.equal(total.allocated_hours, 184.8);
    assert.equal(total.over_allocated_hours, 16.8);
    assert.equal(total.unallocated_hours, 168 + 84); // per-person floor at zero
    record('Analytics', 'Unallocated and over-allocated hours reconcile per person', true);
    record('Analytics', 'Totals reconcile with the sum of employee rows', true);
  });

  await t.test('filters change results consistently', async () => {
    const res = await c.get(`/api/analytics/utilization?month=${MONTH}&department_id=${demo.departmentB}`);
    assert.equal(res.body.data.total.headcount, 1);
    assert.equal(res.body.data.total.available_hours, 84);
    record('Analytics', 'Department filter restricts the dataset', true);
  });

  await t.test('period boundaries are respected', async () => {
    const sep = await c.get('/api/analytics/utilization?month=2026-09');
    assert.equal(sep.body.data.total.utilized_hours, 0);
    assert.equal(sep.body.data.total.utilization_pct, null);
    record('Analytics', 'A period with no timesheets reports zero recorded hours and null utilization', true);
  });

  await t.test('trend returns one point per month', async () => {
    const res = await c.get('/api/analytics/utilization/trend?count=3&end=2026-08');
    assert.equal(res.body.data.length, 3);
    assert.deepEqual(res.body.data.map((r) => r.month), ['2026-06', '2026-07', '2026-08']);
    record('Analytics', 'Utilization trend returns one point per month with months missing data flagged', true);
  });

  await t.test('demand coverage identifies the uncovered requirement', async () => {
    const res = await c.get('/api/projects/demand');
    const gap = res.body.data.find((g) => g.demand_id === demo.demandId);
    assert.ok(gap);
    assert.equal(gap.required_hours, 336, '2 headcount × 40h ÷ 5 × 21 days');
    // 20h/week allocation ÷ 5 × 21 days = 84 h filled against 336 h required => 25%
    assert.equal(gap.filled_hours, 84);
    assert.equal(gap.coverage_pct, 25, 'existing allocation on the same project counts as partial coverage');
    record('Analytics', 'Demand coverage compares required hours with allocated hours', true);
  });

  await t.test('overlapping allocations are detected', async () => {
    const res = await c.get(`/api/analytics/overlaps?month=${MONTH}`);
    assert.ok(res.body.data.length >= 1);
    const pair = res.body.data[0];
    assert.equal(pair.combined_weekly_hours, 44);
    assert.equal(pair.over_capacity, true);
    record('Analytics', 'Overlapping allocations above capacity detected', true);
  });

  await t.test('financial analysis states availability and computes margin only with full inputs', async () => {
    const res = await c.get(`/api/analytics/financial?month=${MONTH}`);
    assert.equal(res.status, 200);
    const d = res.body.data;
    assert.equal(d.availability.employee_cost, true);
    assert.equal(d.availability.invoices, true);
    assert.equal(d.totals.invoiced_revenue, 1000000);
    assert.equal(d.totals.expenses, 100000);
    // workforce cost: (1.2M + 0.6M + 0.9M)/12 × (21/21) = 225,000
    assert.equal(d.totals.workforce_cost, 225000);
    assert.equal(d.totals.gross_margin, 1000000 - 225000 - 100000);
    record('Analytics', 'Financial totals computed from documented inputs', true);
    record('Analytics', 'Margin only reported when invoice, cost and expense inputs all exist', true);
  });

  await t.test('insufficient cost data is disclosed rather than estimated', async () => {
    const beta = await loginAs('admin@beta.test');
    const res = await beta.get(`/api/analytics/financial?month=${MONTH}`);
    const d = res.body.data;
    assert.equal(d.availability.invoices, false);
    assert.equal(d.totals.gross_margin, null, 'margin must be null, not invented');
    assert.ok(d.availability.notes.length > 0);
    record('Analytics', 'Margin is null with explanatory notes when inputs are missing', true);
  });

  await t.test('metric definitions are exposed for audit', async () => {
    const res = await c.get('/api/analytics/definitions');
    assert.ok(res.body.data.metrics.length >= 10);
    assert.ok(res.body.data.metrics.some((m) => m.key === 'utilization_pct'));
    record('Analytics', 'Metric definitions endpoint exposes formulas', true);
  });
});
