import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { client, loginAs, closeServer, demo, db, record } from './helpers.js';

after(async () => { await closeServer(); });

test('Authentication', async (t) => {
  await t.test('valid credentials create a session and return the principal', async () => {
    const c = client();
    const res = await c.post('/api/auth/login', { email: 'admin@alpha.test', password: 'DemoPass!2026' });
    assert.equal(res.status, 200);
    const me = await c.get('/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.data.user.email, 'admin@alpha.test');
    assert.ok(me.body.data.permissions.includes('org.manage'));
    record('Authentication', 'Valid sign-in creates session and returns principal', true);
  });

  await t.test('wrong password is rejected with a generic message', async () => {
    const c = client();
    const res = await c.post('/api/auth/login', { email: 'admin@alpha.test', password: 'WrongPassword1!' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
    record('Authentication', 'Wrong password rejected', true);
  });

  await t.test('unknown email returns the same error (no account enumeration)', async () => {
    const c = client();
    const res = await c.post('/api/auth/login', { email: 'nobody@alpha.test', password: 'Whatever1!' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.message, 'Email or password is incorrect.');
    record('Authentication', 'Unknown email returns identical error (no enumeration)', true);
  });

  await t.test('unauthenticated API access is refused', async () => {
    const c = client();
    for (const url of ['/api/analytics/dashboard', '/api/workforce', '/api/ai/insights', '/api/admin/users']) {
      const res = await c.get(url);
      assert.equal(res.status, 401, `${url} should require auth`);
    }
    record('Authentication', 'Unauthenticated API access refused on all protected routes', true);
  });

  await t.test('session cookie is HttpOnly and SameSite', async () => {
    const c = client();
    const res = await c.post('/api/auth/login', { email: 'admin@alpha.test', password: 'DemoPass!2026' });
    const header = res.headers.get('set-cookie') || '';
    assert.match(header, /HttpOnly/i);
    assert.match(header, /SameSite=Lax/i);
    record('Authentication', 'Session cookie is HttpOnly and SameSite=Lax', true);
  });

  await t.test('logout revokes the session server-side', async () => {
    const c = await loginAs('admin@alpha.test');
    const cookie = c.cookie;
    const out = await c.post('/api/auth/logout', {});
    assert.equal(out.status, 200);
    const reused = client();
    reused.setCookie(cookie);
    const res = await reused.get('/api/auth/me');
    assert.equal(res.body.data.user, null);
    record('Authentication', 'Logout revokes the session server-side (cookie reuse fails)', true);
  });

  await t.test('account is temporarily locked after repeated failures', async () => {
    const c = client();
    await c.post('/api/auth/login', { email: 'viewer@alpha.test', password: 'DemoPass!2026' }); // ensure active
    for (let i = 0; i < 6; i++) {
      await client().post('/api/auth/login', { email: 'scoped@alpha.test', password: 'bad-Password1' });
    }
    const res = await client().post('/api/auth/login', { email: 'scoped@alpha.test', password: 'DemoPass!2026' });
    assert.equal(res.status, 423);
    assert.equal(res.body.error.code, 'ACCOUNT_LOCKED');
    // release the lock so later suites can use this account
    db.prepare('UPDATE users SET locked_until = NULL, failed_logins = 0 WHERE email = ?').run('scoped@alpha.test');
    record('Authentication', 'Account locked after 6 failed attempts', true);
  });

  await t.test('weak password change is rejected', async () => {
    const c = await loginAs('admin@alpha.test');
    const res = await c.post('/api/auth/change-password', { currentPassword: 'DemoPass!2026', newPassword: 'short' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'WEAK_PASSWORD');
    record('Authentication', 'Weak new password rejected by policy', true);
  });

  await t.test('password change revokes other sessions', async () => {
    const c1 = await loginAs('admin@alpha.test');
    const c2 = await loginAs('admin@alpha.test');
    const ch = await c1.post('/api/auth/change-password', { currentPassword: 'DemoPass!2026', newPassword: 'NewStrongPass!2026' });
    assert.equal(ch.status, 200);
    const check = await c2.get('/api/auth/me');
    assert.equal(check.body.data.user, null, 'second session should be revoked');
    // restore original password for the rest of the suite
    const c3 = client();
    await c3.post('/api/auth/login', { email: 'admin@alpha.test', password: 'NewStrongPass!2026' });
    const back = await c3.post('/api/auth/change-password', { currentPassword: 'NewStrongPass!2026', newPassword: 'DemoPass!2026' });
    assert.equal(back.status, 200);
    record('Authentication', 'Password change revokes other sessions', true);
  });
});
