import React, { useEffect, useState } from 'react';
import { useApi, useAuth } from '../../lib/auth';
import { Badge, ErrorState, InfoNote, Loading, StatusDot, Tabs } from '../../components/ui';
import { DataTable } from '../../components/DataTable';
import { fmtDate, fmtHours, fmtMoney, fmtNumber, fmtPct } from '../../lib/format';
import { api } from '../../lib/api';

export default function ProjectDrawer({ projectId, onClose }) {
  const { can, org } = useAuth();
  const detail = useApi(`/api/projects/${projectId}`);
  const [tab, setTab] = useState('overview');
  const [addingDemand, setAddingDemand] = useState(false);
  const [form, setForm] = useState({ role_title: '', required_skill: '', headcount: 1, hours_per_week: 40, start_date: '', end_date: '', priority: 'medium' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  async function addDemand(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.post(`/api/projects/${projectId}/demand`, form);
      setAddingDemand(false);
      setForm({ role_title: '', required_skill: '', headcount: 1, hours_per_week: 40, start_date: '', end_date: '', priority: 'medium' });
      detail.reload();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  const p = detail.data?.project;
  const financeVisible = can('finance.view');

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Project details">
      <button type="button" className="absolute inset-0 bg-ink-950/40" aria-label="Close" onClick={onClose} />
      <div className="relative w-full max-w-3xl h-full bg-white shadow-2xl overflow-y-auto">
        <header className="sticky top-0 z-10 bg-white border-b border-ink-200 px-5 py-3 flex items-start justify-between gap-3">
          <div>
            {p ? (
              <>
                <h2 className="text-base font-semibold text-ink-900">{p.name}</h2>
                <p className="text-xs text-ink-500">{p.code} · {p.client_name || 'Internal project'}</p>
              </>
            ) : <p className="text-sm text-ink-500">Loading…</p>}
          </div>
          <button type="button" className="btn-ghost btn-sm" onClick={onClose} aria-label="Close panel">✕</button>
        </header>

        {detail.error ? <div className="p-5"><ErrorState message={detail.error} onRetry={detail.reload} /></div>
          : detail.loading || !p ? <div className="p-5"><Loading rows={6} /></div> : (
            <div className="p-5">
              <Tabs
                tabs={[
                  { id: 'overview', label: 'Overview' },
                  { id: 'demand', label: 'Demand', count: detail.data.demand.length },
                  { id: 'team', label: 'Allocated team', count: detail.data.allocations.length },
                  ...(financeVisible ? [{ id: 'finance', label: 'Billing', count: detail.data.invoices.length }] : []),
                ]}
                active={tab}
                onChange={setTab}
              />

              {tab === 'overview' && (
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <F label="Status"><span className="inline-flex items-center gap-1.5 capitalize"><StatusDot status={p.status} />{p.status.replace('_', ' ')}</span></F>
                  <F label="Health"><Badge tone={p.health === 'green' ? 'green' : p.health === 'amber' ? 'amber' : 'red'}>{p.health}</Badge></F>
                  <F label="Priority"><span className="capitalize">{p.priority}</span></F>
                  <F label="Contract type"><span className="capitalize">{p.contract_type.replace('_', ' ')}</span></F>
                  <F label="Start date">{fmtDate(p.start_date)}</F>
                  <F label="End date">{fmtDate(p.end_date)}</F>
                  <F label="Planned hours / week">{fmtNumber(detail.data.allocations.reduce((s, a) => s + a.hours_per_week, 0), 1)} h</F>
                  <F label="People allocated">{new Set(detail.data.allocations.map((a) => a.employee_id)).size}</F>
                  {financeVisible ? (
                    <>
                      <F label="Budget">{p.budget_amount == null ? <span className="text-caution-700">Not set</span> : fmtMoney(p.budget_amount, p.currency || org?.currency)}</F>
                      <F label="Billing rate / hour">{p.billing_rate_hour == null ? <span className="text-caution-700">Not set — billable value cannot be calculated</span> : fmtMoney(p.billing_rate_hour, p.currency || org?.currency, { compact: false })}</F>
                    </>
                  ) : <F label="Commercial data"><span className="text-ink-400">Hidden for your role</span></F>}
                </dl>
              )}

              {tab === 'demand' && (
                <div>
                  <div className="flex justify-between items-center mb-3">
                    <p className="text-sm text-ink-600">Staffing requirements for this project.</p>
                    {can('project.manage') && <button type="button" className="btn-secondary btn-sm" onClick={() => setAddingDemand((v) => !v)}>{addingDemand ? 'Cancel' : 'Add demand'}</button>}
                  </div>
                  {addingDemand && (
                    <form onSubmit={addDemand} className="border border-ink-200 rounded-lg p-3 mb-3 space-y-2">
                      {error && <ErrorState message={error} />}
                      <div className="grid grid-cols-2 gap-2">
                        <input required className="input" placeholder="Role (e.g. Backend Engineer)" value={form.role_title} onChange={(e) => setForm({ ...form, role_title: e.target.value })} aria-label="Role" />
                        <input className="input" placeholder="Required skill" value={form.required_skill} onChange={(e) => setForm({ ...form, required_skill: e.target.value })} aria-label="Required skill" />
                        <input required type="number" min="1" className="input" placeholder="Headcount" value={form.headcount} onChange={(e) => setForm({ ...form, headcount: e.target.value })} aria-label="Headcount" />
                        <input type="number" className="input" placeholder="Hours / week" value={form.hours_per_week} onChange={(e) => setForm({ ...form, hours_per_week: e.target.value })} aria-label="Hours per week" />
                        <input required type="date" className="input" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} aria-label="Start date" />
                        <input required type="date" className="input" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} aria-label="End date" />
                      </div>
                      <button type="submit" className="btn-primary btn-sm" disabled={busy}>{busy ? 'Saving…' : 'Save demand'}</button>
                    </form>
                  )}
                  <DataTable
                    columns={[
                      { key: 'role_title', label: 'Role', render: (r) => <span className="font-medium">{r.role_title}</span> },
                      { key: 'skill_name', label: 'Skill', render: (r) => (r.skill_name ? <Badge tone="brand">{r.skill_name}</Badge> : '—') },
                      { key: 'headcount', label: 'Headcount', align: 'right' },
                      { key: 'start_date', label: 'From', render: (r) => fmtDate(r.start_date) },
                      { key: 'end_date', label: 'To', render: (r) => fmtDate(r.end_date) },
                      { key: 'status', label: 'Status', render: (r) => <span className="capitalize text-[13px]">{r.status.replace('_', ' ')}</span> },
                      { key: 'priority', label: 'Priority', render: (r) => <Badge tone={r.priority === 'critical' ? 'red' : r.priority === 'high' ? 'amber' : 'neutral'}>{r.priority}</Badge> },
                    ]}
                    rows={detail.data.demand}
                    pageSize={10}
                    emptyTitle="No demand recorded"
                    emptyDescription="Without demand records, staffing gap analysis cannot run for this project."
                  />
                </div>
              )}

              {tab === 'team' && (
                <DataTable
                  columns={[
                    { key: 'full_name', label: 'Person', render: (r) => <span className="font-medium">{r.full_name}<span className="block text-[11px] text-ink-400">{r.employee_code} · {r.designation || '—'}</span></span> },
                    { key: 'start_date', label: 'From', render: (r) => fmtDate(r.start_date) },
                    { key: 'end_date', label: 'To', render: (r) => fmtDate(r.end_date) },
                    { key: 'hours_per_week', label: 'Hours / week', align: 'right', render: (r) => fmtNumber(r.hours_per_week, 1) },
                    { key: 'billable', label: 'Billable', render: (r) => <Badge tone={r.billable ? 'green' : 'neutral'}>{r.billable ? 'yes' : 'no'}</Badge> },
                    { key: 'status', label: 'Status', render: (r) => <span className="capitalize text-[13px]">{r.status}</span> },
                  ]}
                  rows={detail.data.allocations}
                  pageSize={15}
                  emptyTitle="No one allocated"
                  emptyDescription="Allocations created here flow straight into utilization and demand coverage figures."
                />
              )}

              {tab === 'finance' && (
                <div>
                  <DataTable
                    columns={[
                      { key: 'invoice_number', label: 'Invoice', render: (r) => <span className="font-mono text-[12px]">{r.invoice_number}</span> },
                      { key: 'period_month', label: 'Month' },
                      { key: 'amount', label: 'Amount', align: 'right', render: (r) => fmtMoney(r.amount, r.currency) },
                      { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'paid' ? 'green' : r.status === 'overdue' ? 'red' : 'amber'}>{r.status}</Badge> },
                      { key: 'due_date', label: 'Due', render: (r) => fmtDate(r.due_date) },
                    ]}
                    rows={detail.data.invoices}
                    pageSize={12}
                    emptyTitle="No invoices"
                    emptyDescription="No invoices are recorded against this project."
                  />
                  <div className="mt-3">
                    <InfoNote>Revenue is invoiced value, not cash collected. Billing information is separate from workforce cost and is never combined without stating the calculation.</InfoNote>
                  </div>
                </div>
              )}
            </div>
          )}
      </div>
    </div>
  );
}

function F({ label, children }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-400">{label}</dt>
      <dd className="text-ink-800 mt-0.5">{children}</dd>
    </div>
  );
}
