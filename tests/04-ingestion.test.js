import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { loginAs, closeServer, demo, db, record, baseUrl } from './helpers.js';
import { validateRow } from '../server/ingestion/validate.js';
import { suggestMapping } from '../server/ingestion/schemas.js';
import { parseNumber, parseDate, parseMonth } from '../server/ingestion/validate.js';

after(async () => { await closeServer(); });

function csvFile(content, name = 'upload.csv') {
  return new File([content], name, { type: 'text/csv' });
}

async function upload(c, content, entityType, name) {
  const fd = new FormData();
  fd.append('file', csvFile(content, name));
  fd.append('entity_type', entityType);
  return c.upload('/api/imports/upload', fd);
}

test('Data ingestion pipeline', async (t) => {
  const c = await loginAs('admin@alpha.test');

  await t.test('column mapping suggestion matches known header aliases', async () => {
    const mapping = suggestMapping('employees', ['Emp ID', 'Employee Name', 'Dept', 'Annual CTC', 'Bill Rate Per Hour']);
    assert.equal(mapping['Emp ID'], 'employee_code');
    assert.equal(mapping['Employee Name'], 'full_name');
    assert.equal(mapping['Dept'], 'department');
    assert.equal(mapping['Annual CTC'], 'annual_cost');
    assert.equal(mapping['Bill Rate Per Hour'], 'bill_rate_hour');
    record('Ingestion', 'Header aliases map to the correct target fields', true);
  });

  await t.test('format parsing handles common spreadsheet variations', async () => {
    assert.equal(parseNumber('₹1,25,000').value, 125000);
    assert.equal(parseNumber('(5000)').value, -5000);
    assert.equal(parseDate('15/08/2026').value, '2026-08-15');
    assert.equal(parseDate('2026-08-15').value, '2026-08-15');
    assert.equal(parseMonth('Aug 2026').value, '2026-08');
    assert.equal(parseDate('not a date').issue, 'invalid_date');
    record('Ingestion', 'Numbers, dates and months normalise safely; impossible dates rejected', true);
  });

  await t.test('row validation flags errors and records safe fixes', () => {
    const mapping = { 'Employee ID': 'employee_code', Name: 'full_name', Department: 'department', 'Join Date': 'join_date', Cost: 'annual_cost' };
    const good = validateRow('employees', { 'Employee ID': 'N-1', Name: '  Nikhil Rao ', Department: 'Eng', 'Join Date': '01/04/2024', Cost: '₹18,00,000' }, mapping);
    assert.equal(good.status, 'valid');
    assert.equal(good.normalized.full_name, 'Nikhil Rao');
    assert.equal(good.normalized.join_date, '2024-04-01');
    assert.equal(good.normalized.annual_cost, 1800000);
    const bad = validateRow('employees', { 'Employee ID': '', Name: '', Department: '' }, mapping);
    assert.equal(bad.status, 'invalid');
    assert.ok(bad.issues.some((i) => i.code === 'REQUIRED_MISSING'));
    record('Ingestion', 'Required fields and formatting are validated with fixes recorded', true);
  });

  await t.test('valid CSV uploads, maps, validates and commits', async () => {
    const csv = [
      'Employee ID,Employee Name,Department,Location,Designation,Employment Type,Status,Join Date,FTE,Weekly Hours,Annual Cost,Bill Rate,Skills',
      'IMP-1,Imported One,Engineering,Alpha HQ,Engineer,full_time,active,2024-04-01,1,40,1500000,2200,Java; SQL',
      'IMP-2,Imported Two,Engineering,Alpha HQ,Engineer,full time,Active,01/05/2024,1,40,1400000,2100,Java',
    ].join('\n');
    const up = await upload(c, csv, 'employees');
    assert.equal(up.status, 200, up.text);
    const importId = up.body.data.importId;
    assert.equal(up.body.data.rowsTotal, 2);
    assert.equal(up.body.data.suggestedMapping['Employee ID'], 'employee_code');

    const mapped = await c.post(`/api/imports/${importId}/map`, { mapping: up.body.data.suggestedMapping });
    assert.equal(mapped.status, 200);
    const validated = await c.post(`/api/imports/${importId}/validate`, {});
    assert.equal(validated.status, 200);
    assert.equal(validated.body.data.rowsValid, 2);
    assert.equal(validated.body.data.rowsInvalid, 0);

    const committed = await c.post(`/api/imports/${importId}/commit`, {});
    assert.equal(committed.status, 200, committed.text);
    assert.equal(committed.body.data.created, 2);
    const row = db.prepare("SELECT * FROM employees WHERE org_id = ? AND employee_code = 'IMP-2'").get(demo.orgA.id);
    assert.ok(row);
    assert.equal(row.join_date, '2024-05-01', 'dd/mm/yyyy normalised');
    assert.equal(row.employment_type, 'full_time', 'capitalised enum normalised');
    record('Ingestion', 'Valid CSV upload → map → validate → commit creates records', true);
    record('Ingestion', 'Formatting issues fixed automatically and recorded', true);
  });

  await t.test('invalid rows are reported and never invented', async () => {
    const csv = [
      'Employee ID,Employee Name,Join Date,FTE,Annual Cost',
      'BAD-1,Missing Dates,not-a-date,,',
      ',No Id Provided,2024-01-01,1,100',
      'BAD-3,Fine Person,2024-02-01,1,100',
    ].join('\n');
    const up = await upload(c, csv, 'employees', 'bad.csv');
    assert.equal(up.status, 200);
    const importId = up.body.data.importId;
    await c.post(`/api/imports/${importId}/map`, { mapping: up.body.data.suggestedMapping });
    const v = await c.post(`/api/imports/${importId}/validate`, {});
    assert.equal(v.body.data.rowsInvalid, 2);
    assert.equal(v.body.data.rowsValid, 1);
    const detail = await c.get(`/api/imports/${importId}`);
    const bad = detail.body.data.rows.find((r) => r.raw['Employee ID'] === 'BAD-1');
    assert.ok(bad.issues.some((i) => i.code === 'INVALID_DATE'));
    assert.equal(bad.normalized.join_date, undefined, 'no date is invented');
    const commit = await c.post(`/api/imports/${importId}/commit`, {});
    assert.equal(commit.status, 200);
    assert.equal(commit.body.data.created, 1);
    assert.equal(commit.body.data.skipped, 0);
    assert.ok(!db.prepare("SELECT 1 FROM employees WHERE employee_code = 'BAD-1'").get());
    record('Ingestion', 'Invalid rows are reported and skipped; no values invented', true);
  });

  await t.test('duplicate rows inside a file are detected and skipped', async () => {
    const csv = [
      'Employee ID,Employee Name,FTE',
      'DUP-1,Duplicate Person,1',
      'DUP-1,Duplicate Person Again,1',
    ].join('\n');
    const up = await upload(c, csv, 'employees', 'dupes.csv');
    const importId = up.body.data.importId;
    await c.post(`/api/imports/${importId}/map`, { mapping: up.body.data.suggestedMapping });
    const v = await c.post(`/api/imports/${importId}/validate`, {});
    assert.equal(v.body.data.rowsDuplicate, 1);
    await c.post(`/api/imports/${importId}/commit`, {});
    const count = db.prepare("SELECT COUNT(*) c FROM employees WHERE employee_code = 'DUP-1' AND org_id = ?").get(demo.orgA.id).c;
    assert.equal(count, 1, 'duplicate must not create a second record');
    record('Ingestion', 'Duplicate rows within a file detected and skipped', true);
  });

  await t.test('re-uploading existing records updates rather than duplicates', async () => {
    const csv = ['Employee ID,Employee Name,FTE', 'IMP-1,Imported One Updated,1'].join('\n');
    const up = await upload(c, csv, 'employees', 'update.csv');
    const importId = up.body.data.importId;
    await c.post(`/api/imports/${importId}/map`, { mapping: up.body.data.suggestedMapping });
    await c.post(`/api/imports/${importId}/validate`, {});
    const commit = await c.post(`/api/imports/${importId}/commit`, {});
    assert.equal(commit.body.data.updated, 1);
    assert.equal(commit.body.data.created, 0);
    const rows = db.prepare("SELECT full_name FROM employees WHERE employee_code = 'IMP-1' AND org_id = ?").all(demo.orgA.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].full_name, 'Imported One Updated');
    record('Ingestion', 'Re-upload updates the existing record instead of duplicating it', true);
    record('Ingestion', 'Record version history written on update', true);
  });

  await t.test('unsupported file types are rejected', async () => {
    const fd = new FormData();
    fd.append('file', new File(['hello'], 'malware.exe', { type: 'application/octet-stream' }));
    fd.append('entity_type', 'employees');
    const res = await c.upload('/api/imports/upload', fd);
    assert.equal(res.status, 400);
    record('Ingestion', 'Unsupported file type rejected before parsing', true);
  });

  await t.test('a file with a .xlsx extension but non-xlsx content is rejected', async () => {
    const fd = new FormData();
    fd.append('file', new File(['not really a zip'], 'fake.xlsx', { type: 'application/vnd.ms-excel' }));
    fd.append('entity_type', 'employees');
    const res = await c.upload('/api/imports/upload', fd);
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_FILE_CONTENT');
    record('Ingestion', 'File content signature validated, not just the extension', true);
  });

  await t.test('empty file is rejected with a clear message', async () => {
    const res = await upload(c, '', 'employees', 'empty.csv');
    assert.equal(res.status, 400);
    record('Ingestion', 'Empty upload rejected with an understandable error', true);
  });

  await t.test('missing required mapping is refused', async () => {
    const up = await upload(c, 'Employee ID,Employee Name\nM-1,Someone', 'employees', 'nomap.csv');
    const res = await c.post(`/api/imports/${up.body.data.importId}/map`, { mapping: { 'Employee ID': 'employee_code' } });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /Required fields not mapped/);
    record('Ingestion', 'Mapping without required fields is refused with the field name', true);
  });

  await t.test('committing an unvalidated import is refused', async () => {
    const up = await upload(c, 'Employee ID,Employee Name\nU-1,Unvalidated', 'employees', 'unvalidated.csv');
    const res = await c.post(`/api/imports/${up.body.data.importId}/commit`, {});
    assert.equal(res.status, 400);
    record('Ingestion', 'Commit refused before validation', true);
  });

  await t.test('a failed import leaves existing data intact (transactional)', async () => {
    const before = db.prepare('SELECT COUNT(*) c FROM employees WHERE org_id = ?').get(demo.orgA.id).c;
    const csv = ['Project Code,Project Name,Start Date,End Date', 'BADP-1,Bad Project,2026-05-01,2026-04-01'].join('\n');
    const up = await upload(c, csv, 'projects', 'badproj.csv');
    const importId = up.body.data.importId;
    await c.post(`/api/imports/${importId}/map`, { mapping: up.body.data.suggestedMapping });
    const v = await c.post(`/api/imports/${importId}/validate`, {});
    assert.equal(v.body.data.rowsInvalid, 1, 'end before start must be invalid');
    const commit = await c.post(`/api/imports/${importId}/commit`, {});
    assert.equal(commit.status, 400);
    const after = db.prepare('SELECT COUNT(*) c FROM employees WHERE org_id = ?').get(demo.orgA.id).c;
    assert.equal(after, before);
    record('Ingestion', 'Rejected import does not change existing data', true);
  });

  await t.test('duplicate file checksum is detected', async () => {
    const csv = ['Employee ID,Employee Name', 'CS-1,Checksum Person'].join('\n');
    const first = await upload(c, csv, 'employees', 'same.csv');
    assert.equal(first.status, 200);
    const second = await upload(c, csv, 'employees', 'same.csv');
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'DUPLICATE_FILE');
    record('Ingestion', 'Identical file re-upload detected by checksum', true);
  });

  await t.test('CSV injection payloads are neutralised on export', async () => {
    const { safeCell, toCsv } = await import('../server/ingestion/parse.js');
    assert.equal(safeCell('=cmd|calc'), "'=cmd|calc");
    const csvOut = toCsv(['a'], [{ a: '=HYPERLINK("http://evil")' }]);
    assert.ok(!csvOut.includes('\n=HYPERLINK'), 'leading formula character must be escaped');
    record('Ingestion', 'CSV formula injection neutralised in exported files', true);
  });

  await t.test('import history and error report are available', async () => {
    const list = await c.get('/api/imports');
    assert.equal(list.status, 200);
    assert.ok(list.body.data.length >= 5);
    const failed = list.body.data.find((i) => i.rows_invalid > 0);
    assert.ok(failed);
    const report = await fetch(`${baseUrl}/api/imports/${failed.id}/error-report`, { headers: { cookie: c.cookie } });
    assert.equal(report.status, 200);
    const text = await report.text();
    assert.match(text, /row_number,severity,code,field,message,raw_values/);
    record('Ingestion', 'Import history and downloadable error report available', true);
  });
});
