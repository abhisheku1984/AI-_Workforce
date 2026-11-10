import React, { useState } from 'react';
import { useAuth } from '../lib/auth';
import { PageHeader, Card, Badge, InfoNote, ErrorState } from '../components/ui';
import { api } from '../lib/api';
import { fmtDateTime } from '../lib/format';

export default function AccountPage() {
  const { user, roles, permissions, scopes, org, isPlatformAdmin } = useAuth();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);
  const [busy, setBusy] = useState(false);

  async function changePassword(e) {
    e.preventDefault();
    setError(null); setDone(null);
    if (form.newPassword !== form.confirm) { setError('The new passwords do not match.'); return; }
    setBusy(true);
    try {
      await api.post('/api/auth/change-password', { currentPassword: form.currentPassword, newPassword: form.newPassword });
      setDone('Password changed. Your other sessions have been signed out.');
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div>
      <PageHeader title="Account & security" description="Your identity, access level and session controls." />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Your access">
          <dl className="text-[13px] space-y-2.5">
            <Row label="Name">{user?.full_name}</Row>
            <Row label="Email">{user?.email}</Row>
            <Row label="Title">{user?.title || '—'}</Row>
            <Row label="Organization">{org?.name || 'Platform account'}</Row>
            <Row label="Roles">{roles?.length ? roles.map((r) => <Badge key={r.id} tone="brand">{r.name}</Badge>) : <span className="text-ink-400">none assigned</span>}</Row>
            <Row label="Platform administrator">{isPlatformAdmin ? <Badge tone="amber">yes</Badge> : 'no'}</Row>
            <Row label="Data scope">
              {scopes?.restricted
                ? <span className="text-caution-700">Restricted to {scopes.businessUnitIds?.length || 0} business unit(s) and {scopes.departmentIds?.length || 0} department(s)</span>
                : 'All organization data'}
            </Row>
          </dl>
          {scopes?.restricted && (
            <div className="mt-3"><InfoNote tone="caution">Your view is limited to specific parts of the organization. Totals elsewhere in the platform reflect only your scope, and the server excludes other records before any calculation.</InfoNote></div>
          )}
        </Card>

        <Card title="Change password" subtitle="Minimum 10 characters with upper case, lower case and a number.">
          {done && <div className="mb-3"><InfoNote tone="positive">{done}</InfoNote></div>}
          {error && <div className="mb-3"><ErrorState message={error} /></div>}
          <form onSubmit={changePassword} className="space-y-3">
            <div><label className="label" htmlFor="c-cur">Current password</label><input id="c-cur" type="password" required autoComplete="current-password" className="input" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} /></div>
            <div><label className="label" htmlFor="c-new">New password</label><input id="c-new" type="password" required autoComplete="new-password" className="input" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} /></div>
            <div><label className="label" htmlFor="c-conf">Confirm new password</label><input id="c-conf" type="password" required autoComplete="new-password" className="input" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} /></div>
            <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Updating…' : 'Change password'}</button>
          </form>
        </Card>

        <Card className="xl:col-span-2" title={`Permissions granted (${permissions.length})`} subtitle="These are enforced on the server for every request.">
          <div className="flex flex-wrap gap-1.5">
            {permissions.map((p) => <Badge key={p} tone="neutral">{p}</Badge>)}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-500">{label}</dt>
      <dd className="text-ink-800 text-right">{children}</dd>
    </div>
  );
}
