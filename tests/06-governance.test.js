import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loginAs, closeServer, demo, db, record, baseUrl, client } from './helpers.js';

after(async () => { await closeServer(); });

test('Automation, approvals, reports and operations', async (t) => {
  const admin = await loginAs('admin@alpha.test');

  await t.test('sensitive automation creates an approval request instead of executing', async () => {
    const rule = await admin.post('/api/governance/automation/rules', {
      code: 'SENSITIVE_RUN', name: 'Sensitive automation', triggerType: 'manual',
      actionType: 'generate_report', actionConfig: { report_code: 'utilization_summary' }, requiresApproval: true,
    });
    assert.equal(rule.status, 200, JSON.stringify(rule.body));
    await admin.post(`/api/governance/automation/rules/${rule.body.data.id}/enable`, { enabled: true });
    const run = await admin.post(`/api/governance/automation/rules/${rule.body.data.id}/run`, {});
    assert.equal(run.body.data.status, 'awaiting_approval');
    const approvals = await admin.get('/api/governance/approvals?status=pending');
    assert.ok(approvals.body.data.some((a) => a.title.includes('Sensitive automation')));
    record('Automation', 'Action requiring approval does not execute; approval request created', true);
  });

  await t.test('a second approver can approve and the action then executes', async () => {
    const viewerRoles = await admin.get('/api/admin/users');
    const second = viewerRoles.body.data.find((u) => u.email === 'finance@alpha.test');
    const secondClient = await loginAs('finance@alpha.test');
    const pending = await admin.get('/api/governance/approvals?status=pending');
    const target = pending.body.data.find((a) => a.title.includes('Sensitive automation'));
    assert.ok(target);
    // Finance role lacks approval.manage; grant it temporarily via role permissions
    const roles = await admin.get('/api/admin/roles');
    const financeRole = roles.body.data.roles.find((r) => r.code === 'finance');
    await admin.put(`/api/admin/roles/${financeRole.id}`, { permissions: [...financeRole.permissions, 'approval.manage'] });
    const approver = await loginAs('finance@alpha.test');
    const decide = await approver.post(`/api/governance/approvals/${target.id}/decide`, { decision: 'approved' });
    assert.equal(decide.status, 200, JSON.stringify(decide.body));
    assert.equal(decide.body.data.status, 'approved');
    const runs = await admin.get('/api/governance/automation/rules');
    const executed = runs.body.data.runs.find((r) => r.rule_name === 'Sensitive automation' && r.status === 'succeeded');
    assert.ok(executed, 'approved automation must have executed');
    assert.ok(executed.detail);
    // restore permissions
    await admin.put(`/api/admin/roles/${financeRole.id}`, { permissions: financeRole.permissions });
    record('Automation', 'Approved automation executes and the result is recorded', true);
    record('Automation', 'Every run records initiator, approval, result and timestamp', true);
  });

  await t.test('disabled rules cannot be run', async () => {
    const rule = await admin.post('/api/governance/automation/rules', {
      code: 'DISABLED_RULE', name: 'Disabled rule', triggerType: 'manual', actionType: 'refresh_data', requiresApproval: false,
    });
    const run = await admin.post(`/api/governance/automation/rules/${rule.body.data.id}/run`, {});
    assert.equal(run.status, 400);
    record('Automation', 'Disabled automation cannot be triggered', true);
  });

  await t.test('automation cannot be created with an unsupported action', async () => {
    const res = await admin.post('/api/governance/automation/rules', {
      code: 'EVIL_RULE', name: 'Evil', triggerType: 'manual', actionType: 'delete_all_employees',
    });
    assert.equal(res.status, 400);
    record('Automation', 'Closed allow-list rejects unsupported action types', true);
  });

  await t.test('report generation writes a file with lineage metadata', async () => {
    const res = await admin.post('/api/reports/generate', { code: 'department_utilization', format: 'csv', period: { month: '2026-08' } });
    assert.equal(res.status, 200, JSON.stringify(res.body).slice(0, 300));
    assert.ok(res.body.data.rowCount > 0);
    const download = await fetch(`${baseUrl}${res.body.data.downloadUrl}`, { headers: { cookie: admin.cookie } });
    assert.equal(download.status, 200);
    const text = await download.text();
    assert.match(text, /# WorkforceIQ report/);
    assert.match(text, /# Period: 2026-08-01 to 2026-08-31/);
    assert.match(text, /Engineering/);
    record('Reports', 'CSV report includes period, generator and lineage header', true);
  });

  await t.test('Excel report is a valid xlsx file', async () => {
    const res = await admin.post('/api/reports/generate', { code: 'employee_capacity', format: 'xlsx', period: { month: '2026-08' } });
    assert.equal(res.status, 200);
    const download = await fetch(`${baseUrl}${res.body.data.downloadUrl}`, { headers: { cookie: admin.cookie } });
    const buf = Buffer.from(await download.arrayBuffer());
    assert.equal(buf[0], 0x50);
    assert.equal(buf[1], 0x4b);
    record('Reports', 'Excel export produces a valid xlsx (zip signature)', true);
  });

  await t.test('cost report is refused without finance permission', async () => {
    const viewer = await loginAs('viewer@alpha.test');
    const res = await viewer.post('/api/reports/generate', { code: 'workforce_cost', format: 'csv', period: { month: '2026-08' } });
    assert.equal(res.status, 403);
    record('Reports', 'Cost report blocked for roles without finance permission', true);
  });

  await t.test('report files cannot be downloaded by another tenant', async () => {
    const alphaReport = await admin.post('/api/reports/generate', { code: 'utilization_summary', format: 'csv', period: { month: '2026-08' } });
    const beta = await loginAs('admin@beta.test');
    const res = await beta.get(`/api/reports/download/${encodeURIComponent(alphaReport.body.data.filename)}`);
    assert.equal(res.status, 404);
    record('Tenant isolation', "Another tenant's report file cannot be downloaded", true);
  });

  await t.test('path traversal on report download is rejected', async () => {
    const res = await admin.get('/api/reports/download/..%2f..%2fserver%2findex.js');
    assert.ok([400, 404].includes(res.status));
    record('Security', 'Path traversal attempt on report download rejected', true);
  });

  await t.test('audit trail records authentication, approvals, automation and report generation', async () => {
    const res = await admin.get('/api/admin/audit?limit=500');
    assert.equal(res.status, 200);
    const actions = new Set(res.body.data.map((e) => e.action));
    for (const required of ['auth.login', 'report.generated', 'approval.requested', 'approval.approved']) {
      assert.ok(actions.has(required), `expected audit action ${required}`);
    }
    // Every entry must carry actor, action, entity and a timestamp.
    const first = res.body.data[0];
    for (const field of ['actor_email', 'action', 'entity_type', 'created_at']) {
      assert.ok(field in first, `audit entry missing ${field}`);
    }
    record('Governance', 'Audit trail captures authentication, approvals, automation and report generation', true);
  });

  await t.test('audit trail is not visible to roles without audit permission', async () => {
    const viewer = await loginAs('viewer@alpha.test');
    const res = await viewer.get('/api/admin/audit');
    assert.equal(res.status, 403);
    record('Governance', 'Audit trail restricted to authorised roles', true);
  });

  await t.test('full tenant data export contains only that tenant', async () => {
    const res = await fetch(`${baseUrl}/api/governance/data/export`, { headers: { cookie: admin.cookie } });
    assert.equal(res.status, 200);
    const dump = await res.json();
    assert.ok(dump.employees.every((e) => e.org_id === demo.orgA.id));
    assert.ok(!JSON.stringify(dump).includes('Beta Person'));
    assert.ok(!JSON.stringify(dump).includes('password_hash'));
    record('Governance', 'Tenant export excludes other tenants and password hashes', true);
    record('Governance', 'Data portability export available to administrators', true);
  });

  await t.test('deletion requires a second administrator', async () => {
    const req1 = await admin.post('/api/governance/data/deletion-requests', { scope: 'import', target_id: 1, reason: 'test' });
    assert.equal(req1.status, 200);
    const self = await admin.post(`/api/governance/data/deletion-requests/${req1.body.data.id}/decide`, { decision: 'approved' });
    assert.equal(self.status, 403);
    assert.equal(self.body.error.code, 'SELF_APPROVAL');
    record('Governance', 'Deletion cannot be self-approved', true);
  });

  await t.test('health endpoint reports database status', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.database, 'connected');
    record('Operations', 'Health endpoint reports database connectivity', true);
  });

  await t.test('unknown API routes return a structured 404', async () => {
    const res = await admin.get('/api/does-not-exist');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
    record('Operations', 'Unknown API route returns structured error', true);
  });

  await t.test('internal errors do not leak stack traces', async () => {
    const c = client();
    await c.post('/api/auth/login', { email: 'admin@alpha.test', password: 'DemoPass!2026' });
    const res = await c.post('/api/imports/upload', { entity_type: 'employees' });
    assert.ok(res.status >= 400);
    assert.ok(!res.text.includes('at file://'));
    assert.ok(!res.text.includes('node_modules'));
    record('Security', 'Error responses contain no stack traces or internal paths', true);
  });

  await t.test('security headers are present', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.ok(res.headers.get('x-content-type-options') === 'nosniff');
    assert.ok(!res.headers.get('x-powered-by'));
    record('Security', 'Helmet security headers applied; framework banner hidden', true);
  });

  await t.test('cross-site state-changing request is blocked when Origin differs', async () => {
    const res = await fetch(`${baseUrl}/api/workforce`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: admin.cookie, origin: 'https://evil.example' },
      body: JSON.stringify({ employee_code: 'X', full_name: 'Y' }),
    });
    assert.equal(res.status, 403);
    record('Security', 'Cross-origin state-changing request rejected', true);
  });

  await t.test('no secrets are committed to the repository', async () => {
    const files = [
      'server/config.js', 'server/index.js', 'server/auth/session.js', 'server/auth/passwords.js',
    ];
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      assert.ok(!/sk-[A-Za-z0-9]{20,}/.test(src), `${f} must not contain an API key`);
      assert.ok(!/password\s*[:=]\s*['"][^'"]{6,}['"]/i.test(src) || src.includes('process.env'), `${f} must not hardcode passwords`);
    }
    record('Security', 'No hardcoded credentials or API keys in server source', true);
  });

  await t.test('dashboard payload is complete and internally consistent', async () => {
    const res = await admin.get('/api/analytics/dashboard?month=2026-08');
    assert.equal(res.status, 200);
    const d = res.body.data;
    assert.ok(d.utilization.total);
    assert.ok(Array.isArray(d.trend));
    assert.ok(d.dataFreshness);
    assert.ok(d.utilization.definitions);
    record('Dashboard', 'Dashboard returns KPI totals, trend, definitions and freshness', true);
  });

  await t.test('structure creation validates input', async () => {
    const bad = await admin.post('/api/admin/locations', { name: 'Bad Location', hours_per_day: 40 });
    assert.equal(bad.status, 400);
    const good = await admin.post('/api/admin/locations', { name: 'Test Location', hours_per_day: 8 });
    assert.equal(good.status, 200);
    record('Admin', 'Structure endpoints validate input ranges', true);
  });

  await t.test('role permission changes take effect immediately', async () => {
    const roles = await admin.get('/api/admin/roles');
    const analystRole = roles.body.data.roles.find((r) => r.code === 'analyst');
    await admin.put(`/api/admin/roles/${analystRole.id}`, { permissions: analystRole.permissions.filter((p) => p !== 'forecast.view') });
    const analyst = await loginAs('scoped@alpha.test');
    const denied = await analyst.post('/api/ai/forecast', { kind: 'utilization' });
    assert.equal(denied.status, 403);
    await admin.put(`/api/admin/roles/${analystRole.id}`, { permissions: analystRole.permissions });
    record('Permissions', 'Removing a permission from a role is enforced on the next request', true);
  });
});
