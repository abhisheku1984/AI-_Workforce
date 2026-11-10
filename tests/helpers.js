/**
 * Test harness: boots the real Express app against an isolated test database,
 * seeded with the fictional demonstration data.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { appendFileSync } from 'node:fs';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workforceiq-test-'));
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.DATA_DIR = tmpDir;
process.env.DB_FILE = path.join(tmpDir, 'test.db');
process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough-000000';
process.env.AI_PROVIDER = 'local';
process.env.PORT = '0';

const { app } = await import('../server/index.js');
const { getDb, migrate } = await import('../server/db/index.js');

migrate({ quiet: true });
const seeded = await import('./seed-test-data.js');

export const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
export const baseUrl = `http://127.0.0.1:${server.address().port}`;
export const db = getDb();
export const demo = seeded.default;

export async function closeServer() {
  await new Promise((resolve) => server.close(resolve));
  try { getDb().close(); } catch { /* ignore */ }
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

/** Cookie-aware fetch helper. */
export function client() {
  let cookie = '';
  async function request(method, url, body, extraHeaders = {}) {
    const headers = { ...extraHeaders };
    if (cookie) headers.cookie = cookie;
    if (body !== undefined && !(body instanceof FormData)) headers['content-type'] = 'application/json';
    const res = await fetch(`${baseUrl}${url}`, {
      method,
      headers,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: res.status, body: json, text, headers: res.headers };
  }
  return {
    get: (url, h) => request('GET', url, undefined, h),
    post: (url, body, h) => request('POST', url, body, h),
    patch: (url, body, h) => request('PATCH', url, body, h),
    put: (url, body, h) => request('PUT', url, body, h),
    del: (url, h) => request('DELETE', url, undefined, h),
    upload: (url, formData) => request('POST', url, formData),
    get cookie() { return cookie; },
    setCookie(c) { cookie = c; },
  };
}

export async function loginAs(email, password = 'DemoPass!2026') {
  const c = client();
  const res = await c.post('/api/auth/login', { email, password });
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${res.status} ${res.text}`);
  return c;
}

export function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

/** Results collector for the test report. */
export const results = [];
export function record(suite, name, passed, detail = '') {
  // Attribute the record to the suite file that called it, so the generated
  // report can group real results per file.
  const caller = (new Error().stack || '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /[/\\]tests[/\\]\d\d-.*\.test\.js/.test(l)) || '';
  const parentFile = (caller.match(/(\d\d-[^/\\:]+?\.test\.js)/) || [])[1] || null;
  const entry = { file: parentFile, suite, name, passed: Boolean(passed), detail, at: new Date().toISOString() };
  results.push(entry);
  // When the report runner is driving the suite, persist each assertion group as
  // it happens so the written report reflects real executions, not a plan.
  const file = process.env.TEST_RESULTS_FILE;
  if (file) {
    try {
      appendFileSync(file, `${JSON.stringify(entry)}\n`);
    } catch {
      /* reporting must never fail a test run */
    }
  }
}
