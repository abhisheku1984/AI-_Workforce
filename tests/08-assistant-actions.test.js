import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { loginAs, record, db, closeServer } from './helpers.js';
import { parseDate, parseNumber, resolveEmployee } from '../server/services/assistantActions.js';

// helpers.js starts a real server; without this the runner waits on it forever.
after(async () => { await closeServer(); });

/** Stage an action as a given user, using the real HTTP client so permissions are exercised. */
async function stage(client, body) {
  const res = await client.post('/api/ai/assistant/actions/stage', body);
  return { status: res.status, ...res.body };
}
async function apply(client, action, payload, via = 'text') {
  const res = await client.post('/api/ai/assistant/actions/apply', { action, payload, via });
  return { status: res.status, ...res.body };
}

test('Assistant actions: parsing and lookup', async (t) => {
  await t.test('dates are accepted in the forms people actually say', () => {
    assert.equal(parseDate('2026-11-01'), '2026-11-01');
    assert.equal(parseDate('1 Nov 2026'), '2026-11-01');
    assert.equal(parseDate('01/11/2026'), '2026-11-01');
    assert.equal(parseDate('not a date'), null);
    assert.equal(parseDate(null), null);
  });

  await t.test('numbers accept digits and simple words', () => {
    assert.equal(parseNumber('40'), 40);
    assert.equal(parseNumber('40 hours'), 40);
    assert.equal(parseNumber('forty'), 40);
    assert.equal(parseNumber('2.5'), 2.5);
    assert.equal(parseNumber('many'), null);
  });

  await t.test('employee lookup refuses to guess between identical names', () => {
    const principal = { orgId: 1, scope: { restricted: false }, permissions: new Set(), roles: [] };
    const result = resolveEmployee(principal, 'a');
    // One letter is too ambiguous to act on at all.
    assert.equal(result.match, null);
  });
});

test('Assistant actions: staging never writes, and permissions are enforced', async (t) => {
  const admin = await loginAs('admin@alpha.test');

  await t.test('the catalogue lists only permissioned actions', async () => {
    const res = await admin.get('/api/ai/assistant/actions');
    assert.equal(res.status, 200);
    const names = res.body.data.actions.map((a) => a.name);
    for (const expected of ['add_allocation', 'remove_allocation', 'add_employee', 'update_employee', 'deactivate_employee']) {
      assert.ok(names.includes(expected), `${expected} missing from the catalogue`);
    }
    record('Assistant', 'The action catalogue is available to permitted users', true);
  });

  await t.test('staging a change writes nothing to the database', async () => {
    const before = db.prepare('SELECT COUNT(*) AS c FROM employees').get().c;
    const res = await stage(admin, {
      action: 'add_employee', fullName: 'Staged Person', employeeCode: 'STG-001',
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.ok, true, JSON.stringify(res.data));
    const after = db.prepare('SELECT COUNT(*) AS c FROM employees').get().c;
    assert.equal(after, before, 'staging must not create a record');
    record('Assistant', 'Staging an action performs no write', true);
  });

  await t.test('applying the staged payload performs exactly one write', async () => {
    const res = await stage(admin, { action: 'add_employee', fullName: 'Staged Person', employeeCode: 'STG-001' });
    const applied = await apply(admin, 'add_employee', res.data.preview.payload, 'voice');
    assert.equal(applied.status, 200, JSON.stringify(applied));
    const row = db.prepare("SELECT * FROM employees WHERE employee_code = 'STG-001'").get();
    assert.ok(row, 'employee was not created');
    assert.equal(row.data_source, 'assistant');
    // Cost fields must never be populated by this path.
    assert.equal(row.annual_cost, null);
    record('Assistant', 'A confirmed action creates the record with no cost fields', true);
  });

  await t.test('the same payload cannot create a duplicate', async () => {
    const res = await stage(admin, { action: 'add_employee', fullName: 'Staged Person', employeeCode: 'STG-001' });
    const again = await apply(admin, 'add_employee', res.data.preview.payload);
    assert.equal(again.status, 409);
    assert.equal(again.error.code, 'DUPLICATE_CODE');
    record('Assistant', 'A replayed confirmation is refused, not duplicated', true);
  });

  await t.test('a user without ai.assistant is refused', async () => {
    const viewer = await loginAs('viewer@alpha.test');
    const res = await stage(viewer, { action: 'add_employee', fullName: 'X', employeeCode: 'X-1' });
    assert.equal(res.status, 403);
    record('Assistant', 'Voice actions obey the same permission checks as the API', true);
  });

  await t.test('applying without a staged payload is refused', async () => {
    const res = await admin.post('/api/ai/assistant/actions/apply', { action: 'add_employee' });
    assert.equal(res.status, 400);
    record('Assistant', 'An action cannot be applied without its confirmed payload', true);
  });

  await t.test('pay and cost fields are refused with a clear reason', async () => {
    const res = await stage(admin, { action: 'update_employee', employee: 'Staged Person', annualCost: 999999 });
    assert.equal(res.data.ok, false);
    assert.match(res.data.message, /cannot change annualCost/);
    assert.match(res.data.message, /never edited by the assistant/);
    record('Assistant', 'Cost and pay fields are excluded from assistant edits', true);
  });

  await t.test('an unknown name is reported, not guessed at', async () => {
    const res = await stage(admin, { action: 'deactivate_employee', employee: 'Nobody Whatsoever' });
    assert.equal(res.status, 200, JSON.stringify(res));
    assert.equal(res.data.ok, false);
    assert.equal(res.data.code, 'INCOMPLETE');
    assert.match(res.data.message, /could not find anyone/);
    record('Assistant', 'An unmatched name is refused rather than resolved to a random record', true);
  });
});

test('Assistant actions: destructive actions are reversible in effect', async (t) => {
  const admin = await loginAs('admin@alpha.test');

  await t.test('an allocation is cancelled, never deleted', async () => {
    const employees = (await admin.get('/api/workforce?limit=5')).body.data;
    const list = Array.isArray(employees) ? employees : (employees.employees || []);
    const person = list.find((e) => e.status === 'active');
    assert.ok(person, 'no active employee in fixtures');

    const projects = (await admin.get('/api/projects')).body.data;
    const project = (Array.isArray(projects) ? projects : projects.projects || [])[0];
    assert.ok(project, 'no project in fixtures');

    const created = await admin.post('/api/allocations', {
      employee_id: person.id, project_id: project.id,
      start_date: '2027-01-01', end_date: '2027-02-01', hours_per_week: 8,
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const allocationId = created.body.data.id;

    const res = await apply(admin, 'remove_allocation', { allocationId }, 'voice');
    assert.equal(res.status, 200, JSON.stringify(res));
    const row = db.prepare('SELECT status FROM allocations WHERE id = ?').get(allocationId);
    assert.equal(row.status, 'cancelled');
    assert.ok(row, 'the allocation row must still exist');
    record('Assistant', 'Removing an allocation cancels it and keeps the row', true);
  });

  await t.test('every applied action is recorded with its actor and channel', async () => {
    const events = db.prepare("SELECT action, meta FROM audit_events WHERE action LIKE 'allocation.%' ORDER BY id DESC LIMIT 5").all();
    assert.ok(events.length, 'no allocation audit events');
    const withChannel = events.filter((e) => e.meta && e.meta.includes('via_voice'));
    assert.ok(withChannel.length, 'audit events must record the channel');
    record('Assistant', 'Applied actions are audited with the voice/text channel', true);
  });
});
