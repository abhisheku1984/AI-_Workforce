import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { loginAs, record, db, closeServer } from './helpers.js';
import { parseUtterance, coerceFields, missingRequired } from '../server/services/crm.js';
import { askAnything, detectSubjects, detectOutOfScope } from '../server/services/askAnything.js';

after(async () => { await closeServer(); });

test('CRM: dictation is parsed the way people actually speak', async (t) => {
  await t.test('a plain sentence fills the first empty required field', () => {
    const r = parseUtterance('create_lead', 'Kelvin Cold Chain', {});
    assert.deepEqual(r.values, { company: 'Kelvin Cold Chain' });
  });

  await t.test('continuations beginning with "and" parse identically', () => {
    const base = { company: 'Kelvin Cold Chain' };
    const r = parseUtterance('create_lead', 'and the contact is Ramesh Iyer', base);
    assert.deepEqual(r.values, { contact_name: 'Ramesh Iyer' });
  });

  await t.test('several fields in one sentence are all captured', () => {
    const r = parseUtterance('create_lead', 'Kelvin Cold Chain, contact Ramesh Iyer, industry logistics, city Chennai');
    assert.equal(r.values.company, 'Kelvin Cold Chain');
    assert.equal(r.values.contact_name, 'Ramesh Iyer');
    assert.equal(r.values.industry, 'logistics');
    assert.equal(r.values.city, 'Chennai');
  });

  await t.test('"next step" is a field, not a connective to be stripped', () => {
    // Stripping "next" turned "next step is call the CFO" into the company "step is call the CFO".
    const r = parseUtterance('create_lead', 'next step is call the CFO', { company: 'X' });
    assert.equal(r.values.next_step, 'call the CFO');
    assert.equal(r.values.company, undefined);
  });

  await t.test('"next step date" is not captured as "next step"', () => {
    const r = parseUtterance('create_lead', 'and next step date is 20 Nov 2026', { company: 'X', contact_name: 'Y' });
    assert.equal(r.values.next_step_date, '20 Nov 2026');
    assert.equal(r.values.next_step, undefined);
  });

  await t.test('a spoken email address is reassembled', () => {
    const r = coerceFields('create_lead', { contact_email: 'ramesh at kelvincold dot com' });
    assert.equal(r.values.contact_email, 'ramesh@kelvincold.com');
  });

  await t.test('Indian number words become numbers', () => {
    assert.equal(coerceFields('create_lead', { estimated_value: '42 lakh' }).values.estimated_value, 4200000);
    assert.equal(coerceFields('create_lead', { estimated_value: '1.5 crore' }).values.estimated_value, 15000000);
    assert.equal(coerceFields('create_lead', { estimated_value: '₹25,00,000' }).values.estimated_value, 2500000);
  });

  await t.test('an invalid value is reported, not silently stored', () => {
    const r = coerceFields('create_lead', { contact_email: 'not an email' });
    assert.equal(Object.keys(r.values).length, 0);
    assert.match(r.problems.join(' '), /not a valid email/);
  });

  await t.test('missing required fields are named', () => {
    assert.deepEqual(missingRequired('create_lead', { company: 'X' }), ['contact_name']);
  });
});

test('CRM: a draft cannot reach the dataset without approval', async (t) => {
  const admin = await loginAs('admin@alpha.test');
  const before = db.prepare('SELECT COUNT(*) AS c FROM crm_leads').get().c;

  const created = await admin.post('/api/crm/ai/sessions', { topic: 'create_lead' });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const id = created.body.data.draft.id;

  await t.test('capture is incremental and the field list is tracked', async () => {
    let r = await admin.post(`/api/crm/ai/sessions/${id}/utterance`, { text: 'Acme Robotics' });
    assert.deepEqual(r.body.data.draft.missing, ['contact_name']);
    r = await admin.post(`/api/crm/ai/sessions/${id}/utterance`, { text: 'and the contact is Priya Sharma' });
    assert.deepEqual(r.body.data.draft.missing, []);
    assert.equal(r.body.data.draft.fields.company, 'Acme Robotics');
    record('CRM', 'Dictation fills a draft one field at a time', true);
  });

  await t.test('nothing is written to the dataset while drafting', () => {
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM crm_leads').get().c, before);
  });

  await t.test('submitting moves it to the approval queue only', async () => {
    const sub = await admin.post(`/api/crm/ai/sessions/${id}/submit`, {});
    assert.equal(sub.body.data.status, 'pending_approval');
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM crm_leads').get().c, before, 'approval queue must not write the dataset');
    const pending = await admin.get('/api/crm/ai/pending');
    assert.ok(pending.body.data.some((p) => p.id === id));
    record('CRM', 'A submitted draft waits in the queue without touching the dataset', true);
  });

  await t.test('approval is what appends it to the dataset', async () => {
    const res = await admin.post(`/api/crm/ai/sessions/${id}/approve`, {});
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.data.lead, 'approval did not return a lead');
    assert.equal(res.body.data.lead.company, 'Acme Robotics');
    assert.equal(db.prepare('SELECT COUNT(*) AS c FROM crm_leads').get().c, before + 1);
    record('CRM', 'Approval appends the record to the dataset', true);
  });

  await t.test('a draft cannot be approved twice', async () => {
    const again = await admin.post(`/api/crm/ai/sessions/${id}/approve`, {});
    assert.equal(again.status, 409);
    record('CRM', 'An approved draft cannot be replayed into a duplicate', true);
  });

  await t.test('rejection keeps the draft out of the dataset permanently', async () => {
    const c = await admin.post('/api/crm/ai/sessions', { topic: 'create_lead' });
    const rid = c.body.data.draft.id;
    await admin.post(`/api/crm/ai/sessions/${rid}/utterance`, { text: 'Rejected Ltd' });
    await admin.post(`/api/crm/ai/sessions/${rid}/utterance`, { text: 'contact Nobody' });
    await admin.post(`/api/crm/ai/sessions/${rid}/submit`, {});
    const rej = await admin.post(`/api/crm/ai/sessions/${rid}/reject`, { note: 'wrong company' });
    assert.equal(rej.body.data.status, 'rejected');
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM crm_leads WHERE company = 'Rejected Ltd'").get().c, 0);
    record('CRM', 'A rejected draft never enters the dataset', true);
  });

  await t.test('a viewer cannot draft or approve', async () => {
    const viewer = await loginAs('viewer@alpha.test');
    const draft = await viewer.post('/api/crm/ai/sessions', { topic: 'create_lead' });
    assert.equal(draft.status, 403);
    const approve = await viewer.post(`/api/crm/ai/sessions/${id}/approve`, {});
    assert.equal(approve.status, 403);
    record('CRM', 'CRM drafting and approval are permissioned, not just hidden in the UI', true);
  });
});

test('AI author: answers from any table, and says so when it cannot', async (t) => {
  const principal = { orgId: 1, user: { id: 2 }, permissions: new Set(['crm.view', 'finance.view', 'workforce.view']), roles: [], scope: { restricted: false } };

  await t.test('the subject of a question is detected, with inflections', () => {
    assert.equal(detectSubjects('how many leads')[0].name, 'crm');
    assert.equal(detectSubjects('how much is invoiced')[0].name, 'finance');
    assert.equal(detectSubjects('how many people are there')[0].name, 'employees');
  });

  await t.test('out-of-scope subjects are recognised explicitly', () => {
    assert.ok(detectOutOfScope('what is the weather in Mumbai'));
    assert.ok(detectOutOfScope('what is the cricket score'));
    assert.equal(detectOutOfScope('how many leads'), null);
  });

  await t.test('a question outside the business data is refused, with alternatives', () => {
    const r = askAnything(principal, 'Tell me about the weather in Mumbai');
    assert.equal(r.refused, true);
    assert.match(r.answer, /only reads this organisation's own business data/);
    assert.doesNotMatch(r.answer, /could not map that question/);
    assert.ok(r.suggestions.length > 0, 'a refusal must offer what it can answer');
    record('AI author', 'A question about the world is refused and redirected, not fobbed off', true);
  });

  await t.test('a CRM question is answered from the CRM tables', () => {
    const r = askAnything(principal, 'How many leads are in each stage?');
    assert.equal(r.refused, undefined);
    assert.equal(r.subject, 'crm');
    assert.match(r.answer, /lead/i);
    assert.ok(r.evidence.by_stage, 'the answer must carry its evidence');
    record('AI author', 'CRM questions are answered from the CRM tables', true);
  });

  await t.test('finance questions are refused without the permission', () => {
    const noFinance = { ...principal, permissions: new Set(['crm.view']) };
    const r = askAnything(noFinance, 'how much is invoiced');
    assert.equal(r.refused, true);
    assert.match(r.answer, /does not include access to cost/);
    record('AI author', 'Financial answers respect permissions, not just the menu', true);
  });

  await t.test('an answer never invents a number for an empty table', () => {
    const r = askAnything(principal, 'how many disqualified leads are there');
    assert.match(r.answer, /\d/);
    assert.doesNotMatch(r.answer, /NaN|undefined/);
  });
});
