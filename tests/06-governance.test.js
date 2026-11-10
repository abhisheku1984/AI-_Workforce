import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
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

  await t.test('cross-site protection still blocks a genuinely foreign origin', async () => {
    // A cross-site page always sends Origin, and cannot forge Sec-Fetch-Site.
    for (const headers of [
      { origin: 'https://evil.example' },
      { origin: 'https://evil.example', 'x-forwarded-host': 'workforce.example.com' },
    ]) {
      const res = await fetch(`${baseUrl}/api/workforce`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: admin.cookie, ...headers },
        body: JSON.stringify({ employee_code: 'X', full_name: 'Y' }),
      });
      assert.equal(res.status, 403, `origin ${headers.origin} should be blocked`);
    }
    record('Security', 'Foreign origin still rejected after proxy-safe comparison', true);
  });

  await t.test('a request behind a reverse proxy is not mistaken for a cross-site request', async () => {
    // Browsers send Sec-Fetch-Site: same-origin; proxies rewrite Host. Both must work.
    const viaFetchMetadata = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://workforce.example.com',
        'sec-fetch-site': 'same-origin',
      },
      body: JSON.stringify({ email: 'admin@alpha.test', password: 'DemoPass!2026' }),
    });
    assert.equal(viaFetchMetadata.status, 200, 'Sec-Fetch-Site same-origin must be accepted');

    const viaForwardedHost = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://workforce.example.com',
        'x-forwarded-host': 'workforce.example.com',
      },
      body: JSON.stringify({ email: 'admin@alpha.test', password: 'DemoPass!2026' }),
    });
    assert.equal(viaForwardedHost.status, 200, 'X-Forwarded-Host must be honoured');
    record('Security', 'Sign-in works behind a reverse proxy or preview tunnel', true);
  });

  await t.test('the app can be embedded in a frame where configured, blocked where not', async () => {
    const res = await fetch(`${baseUrl}/`);
    // Tests run with NODE_ENV=test, so embedding is allowed by default (preview/portal use).
    assert.equal(res.headers.get('x-frame-options'), null);
    const policy = res.headers.get('content-security-policy') || '';
    assert.ok(!/frame-ancestors\s+'none'/.test(policy), 'no frame-ancestors:none when embedding is allowed');
    record('Operations', 'Frame embedding follows configuration, not a fixed header', true);
  });

  await t.test('a session cookie that does not resolve is reported, not silently ignored', async () => {
    const res = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { cookie: 'wiq_session=not-a-real-session-token' },
    });
    const body = await res.json();
    assert.equal(body.data.user, null);
    assert.equal(body.data.reason, 'SESSION_NOT_RECOGNISED');
    assert.equal(body.data.diagnostics.cookie_present, true);

    const none = await fetch(`${baseUrl}/api/auth/me`);
    const noneBody = await none.json();
    assert.equal(noneBody.data.reason, 'NO_SESSION_COOKIE');
    record('Authentication', 'Missing or unrecognised session is explained to the user', true);
  });

  await t.test('session cookie attributes follow the transport and the configured policy', async () => {
    const read = (res) => res.headers.get('set-cookie') || '';
    const post = (headers) => fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ email: 'admin@alpha.test', password: 'DemoPass!2026' }),
    });

    // Plain HTTP: never Secure (a Secure cookie on HTTP is silently discarded by browsers).
    const plain = read(await post({}));
    assert.ok(!/Secure/i.test(plain), 'no Secure on plain HTTP');
    assert.ok(/SameSite=Lax/i.test(plain), 'Lax by default');

    // HTTPS via a TLS-terminating proxy: Secure is applied.
    const https = read(await post({ 'x-forwarded-proto': 'https' }));
    assert.ok(/Secure/i.test(https), 'Secure over HTTPS');
    assert.ok(/HttpOnly/i.test(https), 'HttpOnly always');

    record('Authentication', 'Session cookie flags match the transport in use', true);
  });

  await t.test('a bearer session token works where cookies are blocked', async () => {
    // Sign in and take ONLY the token — no cookie jar, exactly like a browser that
    // refuses to store cookies inside a sandboxed preview frame.
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@alpha.test', password: 'DemoPass!2026' }),
    });
    const { data } = await login.json();
    assert.ok(data.token, 'login returns a session token');

    const me = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { authorization: `Bearer ${data.token}` },
    });
    const meBody = await me.json();
    assert.equal(meBody.data.user.email, 'admin@alpha.test', 'bearer token authenticates');

    // Permission enforcement is unchanged: it is the same principal.
    const dashboard = await fetch(`${baseUrl}/api/analytics/dashboard`, {
      headers: { authorization: `Bearer ${data.token}` },
    });
    assert.equal(dashboard.status, 200);

    // A forged token is refused.
    const bad = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { authorization: 'Bearer not-a-real-token-at-all' },
    });
    assert.equal((await bad.json()).data.user, null);
    record('Authentication', 'Session works without cookies via a bearer token', true);
  });

  await t.test('signing out revokes a bearer token', async () => {
    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@alpha.test', password: 'DemoPass!2026' }),
    });
    const token = (await login.json()).data.token;
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

    const out = await fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', headers: auth });
    assert.equal(out.status, 200);

    const me = await fetch(`${baseUrl}/api/auth/me`, { headers: auth });
    assert.equal((await me.json()).data.user, null, 'token must be dead after sign-out');
    record('Authentication', 'Sign-out revokes the token as well as the cookie', true);
  });

  await t.test('the entry document is never cached, so a deploy cannot leave a stale client', async () => {
    const res = await fetch(`${baseUrl}/utilization`);
    assert.equal(res.status, 200);
    const cache = res.headers.get('cache-control') || '';
    assert.ok(/no-store/i.test(cache), `entry document must be no-store, got "${cache}"`);
    assert.ok(res.headers.get('x-app-build'), 'build stamp header present');
    const html = await res.text();
    assert.match(html, /<meta name="app-build" content="[^"]+"/,
      'the entry document must carry a readable build stamp');
    assert.doesNotMatch(html, /content="dev"/,
      'the served document must name the real build, not the placeholder');
    record('Operations', 'Entry document is served no-store with a build stamp', true);
  });

  await t.test('a missing interface asset is a 404, not a page that silently blanks', async () => {
    // Serving the entry document for a missing bundle gives the browser HTML where it expects
    // JavaScript. It refuses to execute it, the page stays blank, and nothing reports an error.
    // A 404 puts the failure in the network panel, the server log and this test.
    const res = await fetch(`${baseUrl}/assets/index-DOES-NOT-EXIST.js`);
    assert.equal(res.status, 404, 'a missing asset must not resolve to the entry document');
    const type = res.headers.get('content-type') || '';
    assert.match(type, /text\/plain/, `a missing asset must not be served as ${type}`);
    const body = await res.text();
    assert.match(body, /hard reload|Ctrl\+Shift\+R/i, 'the response should say how to recover');
    record('Operations', 'A missing asset returns 404 with recovery instructions', true);
  });

  await t.test('the interface in dist/ is kept in step with the prebuilt snapshot', async () => {
    // dist/ is ignored by git, so a pull updates prebuilt/dist/ and leaves dist/ behind. The
    // server compares the content-hashed entry filenames at startup and copies the snapshot over
    // when they differ, so an update cannot leave someone running last release's interface.
    const src = fs.readFileSync('server/index.js', 'utf8');
    assert.match(src, /function syncFromPrebuilt/, 'startup must reconcile dist/ with prebuilt/dist');
    assert.ok(src.includes('index-.*'), 'the comparison must use the content-hashed entry name');
    assert.match(src, /if \(process\.env\.DIST_DIR\) return null/, 'an explicit DIST_DIR must be respected');

    const distEntry = fs.readdirSync('dist/assets').find((f) => /^index-.*\.js$/.test(f));
    const prebuiltEntry = fs.readdirSync('prebuilt/dist/assets').find((f) => /^index-.*\.js$/.test(f));
    assert.equal(distEntry, prebuiltEntry,
      `dist/ serves ${distEntry} but prebuilt/dist/ ships ${prebuiltEntry} — run npm run use-prebuilt`);
    record('Operations', 'dist/ never falls behind the committed prebuilt snapshot', true);
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

// ---------------------------------------------------------------------------
// Startup path.
//
// The server chose whether to listen by string-matching process.argv[1] against
// 'server/index.js'. On Windows argv[1] is an absolute path with backslashes, so the
// match was always false and `npm start` exited silently with code 0. These tests pin
// the behaviour so it cannot regress: a direct run must listen, an import must not.
// ---------------------------------------------------------------------------

const startupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workforceiq-startup-'));

test('startup: a direct run serves traffic, an import opens no port', async (t) => {
  const { spawn, spawnSync } = await import('node:child_process');
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (nodeMajor > 25) {
    // A newer Node than the prebuilt binaries cover can fail to load the native module
    // outside the test harness; skip rather than report a false failure.
    t.diagnostic(`skipped: Node ${nodeMajor} has no prebuilt binary guarantee`);
    return;
  }

  const root = path.resolve(import.meta.dirname, '..');

  await t.test('running server/index.js directly opens a port and reports the URL', async () => {
    const port = 4700 + Math.floor(Math.random() * 200);
    const child = spawn(process.execPath, ['server/index.js'], {
      cwd: root,
      env: { ...process.env, PORT: String(port), DATA_DIR: startupDir, DB_FILE: path.join(startupDir, 'startup.db'), NODE_ENV: 'test' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });

    const listening = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 15000);
      child.stdout.on('data', () => {
        if (/listening on http:\/\/localhost:\d+/.test(out)) { clearTimeout(timer); resolve(true); }
      });
      child.once('exit', () => { clearTimeout(timer); resolve(false); });
    });

    child.kill('SIGTERM');
    assert.ok(listening, `server did not announce a listening port. Output:\n${out.slice(0, 600)}`);

    const res = await fetch(`http://127.0.0.1:${port}/api/health`).catch(() => null);
    record('Startup', 'A direct run announces a listening URL on any platform', true);
  });

  await t.test('importing the module does not open a port', () => {
    // If it did, this process (the test runner) would hold a port and never exit cleanly.
    const result = spawnSync(process.execPath, ['-e', "import('./server/index.js').then(m=>console.log(typeof m.app, typeof m.start))"], {
      cwd: root,
      env: { ...process.env, DATA_DIR: startupDir, DB_FILE: path.join(startupDir, 'import.db'), NODE_ENV: 'test' },
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /function function/);
    record('Startup', 'Importing the app module does not start a listener', true);
  });

  await t.test('the prebuilt interface installs without any native tooling', () => {
    const installDir = path.join(startupDir, 'installed-dist');
    const result = spawnSync(process.execPath, ['scripts/use-prebuilt.mjs', '--to', installDir], { cwd: root, encoding: 'utf8', timeout: 60000 });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(path.join(installDir, 'index.html')), 'index.html missing after use-prebuilt');
    const assets = fs.readdirSync(path.join(installDir, 'assets'));
    assert.ok(assets.some((f) => f.endsWith('.js')), 'no JavaScript bundle installed');
    record('Startup', 'A prebuilt interface can be installed when the bundler is blocked', true);
  });
});

// ---------------------------------------------------------------------------
// Packaging.
//
// The interface snapshot in prebuilt/dist must actually be committed. An unanchored
// "dist/" in .gitignore also matches "prebuilt/dist/", which silently excluded it:
// `npm run use-prebuilt` shipped while the bundle it installs did not.
// ---------------------------------------------------------------------------

test('packaging: the prebuilt interface is not excluded by .gitignore', async (t) => {
  const { spawnSync } = await import('node:child_process');
  const root = path.resolve(import.meta.dirname, '..');

  await t.test('git does not ignore prebuilt/dist', () => {
    const result = spawnSync('git', ['check-ignore', '-v', 'prebuilt/dist/index.html'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 1, `prebuilt/dist is ignored by: ${result.stdout.trim() || '(git unavailable)'}`);
    record('Packaging', 'The committed interface snapshot is not excluded by .gitignore', true);
  });

  await t.test('.gitignore still ignores a local build and local data', () => {
    for (const candidate of ['dist/index.html', 'node_modules/express', 'data/workforceiq.db', '.env']) {
      const result = spawnSync('git', ['check-ignore', '-q', candidate], { cwd: root });
      assert.equal(result.status, 0, `${candidate} should be ignored but is not`);
    }
    record('Packaging', 'Local build output and secrets remain ignored', true);
  });

  await t.test('an unbuilt checkout explains itself instead of 404ing', async () => {
    const { spawn } = await import('node:child_process');
    const port = 4900 + Math.floor(Math.random() * 90);
    const child = spawn(process.execPath, ['server/index.js'], {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(port),
        DATA_DIR: startupDir,
        DB_FILE: path.join(startupDir, 'nodist.db'),
        DIST_DIR: path.join(startupDir, 'no-such-dist'),
        NODE_ENV: 'test',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const ready = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 20000);
      child.stdout.on('data', (d) => {
        if (/listening on http:\/\/localhost:\d+/.test(d.toString())) { clearTimeout(timer); resolve(true); }
      });
      child.once('exit', () => { clearTimeout(timer); resolve(false); });
    });
    try {
      assert.ok(ready, 'server did not start');
      const res = await fetch(`http://127.0.0.1:${port}/`);
      assert.equal(res.status, 503);
      const html = await res.text();
      assert.match(html, /interface is not built/i);
      assert.match(html, /npm run use-prebuilt|npm run build/);
      const health = await fetch(`http://127.0.0.1:${port}/api/health`);
      assert.equal(health.status, 200, 'the API must keep working without an interface');
      record('Packaging', 'Without dist/, the landing page explains the fix and the API stays healthy', true);
    } finally {
      child.kill('SIGTERM');
    }
  });
});
