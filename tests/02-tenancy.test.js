import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { client, loginAs, closeServer, demo, db, record } from './helpers.js';

after(async () => { await closeServer(); });

test('Tenant isolation and data scope', async (t) => {
  await t.test("a tenant cannot read another tenant's employees", async () => {
    const alpha = await loginAs('admin@alpha.test');
    const res = await alpha.get(`/api/workforce/${demo.orgB.employeeId}`);
    assert.equal(res.status, 404, 'cross-tenant read must not succeed');
    record('Tenant isolation', "Cross-tenant employee read returns 404 (existence not disclosed)", true);
  });

  await t.test("workforce lists never include another tenant's records", async () => {
    const alpha = await loginAs('admin@alpha.test');
    const beta = await loginAs('admin@beta.test');
    const a = await alpha.get('/api/workforce?limit=1000');
    const b = await beta.get('/api/workforce?limit=1000');
    assert.ok(a.body.data.every((e) => e.org_id === demo.orgA.id));
    assert.ok(b.body.data.every((e) => e.org_id === demo.orgB.id));
    assert.ok(!a.body.data.some((e) => e.email === 'beta@beta.test'));
    record('Tenant isolation', 'Employee lists are strictly per-org', true);
  });

  await t.test('creating a record cannot reference another tenant structure', async () => {
    const alpha = await loginAs('admin@alpha.test');
    const res = await alpha.post('/api/workforce', {
      employee_code: 'X-999', full_name: 'Injected Person', department_id: 99999,
    });
    assert.equal(res.status, 400);
    record('Tenant isolation', 'Foreign department id rejected when creating an employee', true);
  });

  await t.test('organization header cannot be spoofed by a normal user', async () => {
    const alpha = await loginAs('admin@alpha.test');
    const res = await alpha.get('/api/analytics/utilization?month=2026-08', { 'x-org-context': String(demo.orgB.id) });
    assert.equal(res.status, 200);
    // Result must still be alpha data: headcount is 3 in alpha, 1 in beta.
    assert.equal(res.body.data.total.headcount, 3);
    record('Tenant isolation', 'Org-context header ignored for non-platform users', true);
  });

  await t.test('department-scoped user sees only their department', async () => {
    const scoped = await loginAs('scoped@alpha.test');
    const res = await scoped.get('/api/workforce?limit=1000');
    assert.equal(res.status, 200);
    const codes = res.body.data.map((e) => e.employee_code).sort();
    // T-004 (exited) is also in Engineering, so it is in scope for the list view.
    assert.deepEqual(codes, ['T-001', 'T-003', 'T-004'], 'scoped analyst should only see Engineering employees');
    record('Data scope', 'Department-scoped user only sees their department', true);
  });

  await t.test('scoped totals exclude out-of-scope capacity', async () => {
    const scoped = await loginAs('scoped@alpha.test');
    const res = await scoped.get('/api/analytics/utilization?month=2026-08');
    assert.equal(res.body.data.total.headcount, 2);
    assert.equal(res.body.data.total.available_hours, 168 + 168); // excludes 84 for the Support employee
    record('Data scope', 'Scoped analytics exclude out-of-scope employees before calculation', true);
  });

  await t.test('cost fields are stripped for roles without cost permission', async () => {
    const viewer = await loginAs('viewer@alpha.test');
    const list = await viewer.get('/api/workforce?limit=1000');
    assert.equal(list.status, 200);
    assert.ok(list.body.data.length > 0);
    assert.ok(list.body.data.every((e) => e.annual_cost == null && e.bill_rate_hour == null), 'cost must be null');
    assert.ok(list.body.data.every((e) => e.cost_redacted === true));
    record('Permissions', 'Cost fields removed server-side for viewer role', true);
  });

  await t.test('viewer cannot write, cannot regenerate insights, cannot import', async () => {
    const viewer = await loginAs('viewer@alpha.test');
    const writes = [
      await viewer.patch('/api/workforce/1', { full_name: 'Hacked' }),
      await viewer.post('/api/allocations', { employee_id: 1, start_date: '2026-08-01', end_date: '2026-08-02', hours_per_week: 10 }),
      await viewer.post('/api/imports/upload', {}),
      await viewer.post('/api/ai/insights/generate', {}),
    ];
    for (const r of writes) assert.equal(r.status, 403, JSON.stringify(r.body));
    record('Permissions', 'Viewer role blocked from all writes (403 on each)', true);
  });

  await t.test('viewer cannot see financial analytics', async () => {
    const viewer = await loginAs('viewer@alpha.test');
    const res = await viewer.get('/api/analytics/financial?month=2026-08');
    assert.equal(res.status, 403);
    record('Permissions', 'Financial analytics denied to viewer', true);
  });

  await t.test('user cannot escalate their own role', async () => {
    const viewer = await loginAs('viewer@alpha.test');
    const me = await viewer.get('/api/auth/me');
    const res = await viewer.put(`/api/admin/users/${me.body.data.user.id}/roles`, { assignments: [{ role_id: 1 }] });
    assert.equal(res.status, 403);
    record('Permissions', 'Self role escalation blocked', true);
  });

  await t.test('self-approval of a request is blocked', async () => {
    const admin = await loginAs('admin@alpha.test');
    const created = await admin.post('/api/governance/automation/rules', {
      code: 'TEST_SELF_APPROVAL', name: 'Self approval test', triggerType: 'manual',
      actionType: 'refresh_data', requiresApproval: true,
    });
    assert.equal(created.status, 200);
    await admin.post(`/api/governance/automation/rules/${created.body.data.id}/enable`, { enabled: true });
    const run = await admin.post(`/api/governance/automation/rules/${created.body.data.id}/run`, {});
    assert.equal(run.body.data.status, 'awaiting_approval');
    const decide = await admin.post(`/api/governance/approvals/${run.body.data.approvalId}/decide`, { decision: 'approved' });
    assert.equal(decide.status, 403);
    assert.equal(decide.body.error.code, 'SELF_APPROVAL');
    record('Governance', 'User cannot approve their own request', true);
  });
});
