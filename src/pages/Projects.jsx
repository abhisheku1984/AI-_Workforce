import React, { useState } from 'react';
import { useApi, useAuth } from '../lib/auth';
import { PageHeader, Card, Badge, Loading, ErrorState, InfoNote, Tabs, StatusDot, EmptyState } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { fmtMoney, fmtDate, fmtNumber, fmtPct, fmtHours } from '../lib/format';
import { api } from '../lib/api';
import ProjectDrawer from './projects/ProjectDrawer';

const STATUS_TONE = { active: 'green', planned: 'brand', on_hold: 'amber', completed: 'neutral', cancelled: 'neutral' };
const HEALTH_TONE = { green: 'green', amber: 'amber', red: 'red' };

export default function ProjectsPage() {
  const { can, org } = useAuth();
  const [tab, setTab] = useState('projects');
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const projects = useApi('/api/projects');
  const demand = useApi('/api/projects/demand');
  const overlaps = useApi('/api/projects/overlaps', { skip: !can('allocation.view') });

  const financeVisible = can('finance.view');

  const projectColumns = [
    {
      key: 'name', label: 'Project',
      render: (r) => (
        <button type="button" className="text-left" onClick={() => setSelected(r.id)}>
          <span className="font-medium text-ink-900 hover:text-brand-700">{r.name}</span>
          <span className="block text-[11px] text-ink-400">{r.code}{r.client_name ? ` · ${r.client_name}` : ''}</span>
        </button>
      ),
    },
    { key: 'status', label: 'Status', render: (r) => <span className="inline-flex items-center gap-1.5 capitalize"><StatusDot status={r.status} />{r.status.replace('_', ' ')}</span> },
    { key: 'health', label: 'Health', render: (r) => <Badge tone={HEALTH_TONE[r.health]}>{r.health}</Badge> },
    { key: 'priority', label: 'Priority', render: (r) => <span className="capitalize text-[13px]">{r.priority}</span> },
    { key: 'start_date', label: 'Start', render: (r) => fmtDate(r.start_date) },
    { key: 'end_date', label: 'End', render: (r) => fmtDate(r.end_date) },
    { key: 'allocated_people', label: 'People', type: 'num', align: 'right' },
    { key: 'allocated_weekly_hours', label: 'Planned h/wk', align: 'right', render: (r) => fmtNumber(r.allocated_weekly_hours, 1) },
    { key: 'open_demand_headcount', label: 'Open demand', align: 'right', render: (r) => (r.open_demand_headcount ? <Badge tone="amber">{r.open_demand_headcount} req</Badge> : <span className="text-ink-300">—</span>) },
    ...(financeVisible ? [
      { key: 'budget_amount', label: 'Budget', align: 'right', render: (r) => (r.finance_redacted ? 'hidden' : r.budget_amount == null ? '—' : fmtMoney(r.budget_amount, r.currency || org?.currency)) },
      { key: 'billing_rate_hour', label: 'Bill rate/h', align: 'right', render: (r) => (r.finance_redacted ? 'hidden' : r.billing_rate_hour == null ? '—' : fmtMoney(r.billing_rate_hour, r.currency || org?.currency, { compact: false })) },
    ] : []),
  ];

  const demandColumns = [
    { key: 'project_name', label: 'Project', render: (r) => <span className="font-medium">{r.project_name}<span className="block text-[11px] text-ink-400">{r.project_code}</span></span> },
    { key: 'role_title', label: 'Role' },
    { key: 'required_skill', label: 'Skill', render: (r) => r.required_skill ? <Badge tone="brand">{r.required_skill}</Badge> : <span className="text-[11px] text-ink-400">not specified</span> },
    { key: 'headcount', label: 'Needed', type: 'num', align: 'right' },
    { key: 'start_date', label: 'From', render: (r) => fmtDate(r.start_date) },
    { key: 'end_date', label: 'To', render: (r) => fmtDate(r.end_date) },
    { key: 'required_hours', label: 'Required h', align: 'right', render: (r) => fmtNumber(r.required_hours, 1) },
    { key: 'filled_hours', label: 'Filled h', align: 'right', render: (r) => fmtNumber(r.filled_hours, 1) },
    {
      key: 'coverage_pct', label: 'Coverage', align: 'right',
      render: (r) => (r.coverage_pct == null ? '—' : (
        <span className={r.coverage_pct >= 100 ? 'text-positive-700 font-medium' : r.coverage_pct >= 80 ? 'text-caution-700 font-medium' : 'text-danger-700 font-semibold'}>
          {fmtPct(Math.min(r.coverage_pct, 999))}
        </span>
      )),
    },
    { key: 'priority', label: 'Priority', render: (r) => <Badge tone={r.priority === 'critical' ? 'red' : r.priority === 'high' ? 'amber' : 'neutral'}>{r.priority}</Badge> },
    { key: 'skill_matched_candidates', label: 'Matched people', align: 'right', render: (r) => (r.skill_matched_candidates?.length ? `${r.skill_matched_candidates.length}` : <span className="text-ink-300">none</span>) },
  ];

  return (
    <div>
      <PageHeader
        title="Projects & demand"
        description="Project delivery commitments alongside the staffing requirements behind them. Coverage compares dated allocations with each demand record; skill suitability is shown separately."
        actions={can('project.manage') && <button type="button" className="btn-primary btn-sm" onClick={() => setCreating(true)}>New project</button>}
      />

      <Tabs
        tabs={[
          { id: 'projects', label: 'Projects', count: projects.data?.length },
          { id: 'demand', label: 'Staffing demand', count: demand.data?.length },
          ...(can('allocation.view') ? [{ id: 'overlaps', label: 'Overlaps & double-booking', count: overlaps.data?.length }] : []),
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'projects' && (
        <Card bodyClass="p-0">
          {projects.loading ? <div className="p-5"><Loading /></div>
            : projects.error ? <div className="p-5"><ErrorState message={projects.error} onRetry={projects.reload} /></div>
              : <DataTable columns={projectColumns} rows={projects.data || []} searchable emptyTitle="No projects yet" emptyDescription="Create a project or upload project data from the Data page." />}
        </Card>
      )}

      {tab === 'demand' && (
        <>
          <InfoNote tone="brand" title="How coverage is measured">
            Required hours are the headcount × weekly hours for the demand window. Filled hours come from allocations linked
            to the demand, or failing that, allocations on the same project overlapping the same dates. A person without the
            required skill still counts toward hours, which is why matched candidates are listed separately. The platform
            never assigns anyone automatically.
          </InfoNote>
          <div className="mt-4 card p-0">
            {demand.loading ? <div className="p-5"><Loading /></div>
              : demand.error ? <div className="p-5"><ErrorState message={demand.error} onRetry={demand.reload} /></div>
                : <DataTable
                    columns={demandColumns}
                    rows={demand.data || []}
                    searchable
                    pageSize={20}
                    initialSort={{ key: 'coverage_pct', dir: 'asc' }}
                    emptyTitle="No open staffing demand"
                    emptyDescription="Add demand records to a project to track staffing gaps."
                  />}
          </div>
        </>
      )}

      {tab === 'overlaps' && (
        <>
          <InfoNote tone="caution" title="Overlapping allocations are a signal, not a verdict">
            Two allocations overlapping in time is normal when someone splits their week. Combined weekly hours above
            standard capacity is the real warning sign. Confirm before changing anything — the platform will not rebalance automatically.
          </InfoNote>
          <div className="mt-4 card p-0">
            {overlaps.loading ? <div className="p-5"><Loading /></div> : overlaps.error ? <div className="p-5"><ErrorState message={overlaps.error} onRetry={overlaps.reload} /></div> : (
              <DataTable
                columns={[
                  { key: 'employee_name', label: 'Employee', render: (r) => <span className="font-medium">{r.employee_name}</span> },
                  { key: 'overlap_from', label: 'Overlap from', render: (r) => fmtDate(r.overlap_from) },
                  { key: 'overlap_to', label: 'Overlap to', render: (r) => fmtDate(r.overlap_to) },
                  { key: 'combined_weekly_hours', label: 'Combined h/wk', align: 'right', render: (r) => fmtNumber(r.combined_weekly_hours, 1) },
                  { key: 'standard_weekly_hours', label: 'Standard h/wk', align: 'right', render: (r) => fmtNumber(r.standard_weekly_hours, 1) },
                  { key: 'over_capacity', label: 'Above capacity', render: (r) => <Badge tone={r.over_capacity ? 'red' : 'neutral'}>{r.over_capacity ? 'yes' : 'no'}</Badge> },
                ]}
                rows={overlaps.data || []}
                pageSize={15}
                emptyTitle="No overlapping allocations"
                emptyDescription="No person has two allocations covering the same dates in this period."
              />
            )}
          </div>
        </>
      )}

      {selected && <ProjectDrawer projectId={selected} onClose={() => { setSelected(null); projects.reload(); demand.reload(); }} />}
      {creating && <NewProjectModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); projects.reload(); }} />}
    </div>
  );
}

function NewProjectModal({ onClose, onCreated }) {
  const structure = useApi('/api/admin/structure');
  const [form, setForm] = useState({ code: '', name: '', client_name: '', business_unit_id: '', department_id: '', start_date: '', end_date: '', status: 'active', contract_type: 'time_material', priority: 'medium', budget_amount: '', billing_rate_hour: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.post('/api/projects', form);
      onCreated();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Create project">
      <button type="button" className="absolute inset-0 bg-ink-950/40" onClick={onClose} aria-label="Close" />
      <form onSubmit={submit} className="relative card p-5 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h2 className="text-base font-semibold mb-3">New project</h2>
        {error && <div className="mb-3"><ErrorState message={error} /></div>}
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label" htmlFor="p-code">Project code *</label><input id="p-code" required className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="PRJ-3001" /></div>
          <div><label className="label" htmlFor="p-name">Name *</label><input id="p-name" required className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="label" htmlFor="p-client">Client</label><input id="p-client" className="input" value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })} /></div>
          <div>
            <label className="label" htmlFor="p-bu">Business unit</label>
            <select id="p-bu" className="input" value={form.business_unit_id} onChange={(e) => setForm({ ...form, business_unit_id: e.target.value })}>
              <option value="">Not set</option>
              {(structure.data?.business_units || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div><label className="label" htmlFor="p-start">Start date</label><input id="p-start" type="date" className="input" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
          <div><label className="label" htmlFor="p-end">End date</label><input id="p-end" type="date" className="input" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
          <div>
            <label className="label" htmlFor="p-contract">Contract type</label>
            <select id="p-contract" className="input" value={form.contract_type} onChange={(e) => setForm({ ...form, contract_type: e.target.value })}>
              <option value="time_material">Time & material</option><option value="fixed_price">Fixed price</option><option value="retainer">Retainer</option><option value="internal">Internal</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="p-priority">Priority</label>
            <select id="p-priority" className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
            </select>
          </div>
          <div><label className="label" htmlFor="p-budget">Budget</label><input id="p-budget" type="number" className="input" value={form.budget_amount} onChange={(e) => setForm({ ...form, budget_amount: e.target.value })} /></div>
          <div><label className="label" htmlFor="p-rate">Billing rate / hour</label><input id="p-rate" type="number" className="input" value={form.billing_rate_hour} onChange={(e) => setForm({ ...form, billing_rate_hour: e.target.value })} /></div>
        </div>
        <div className="flex gap-2 mt-4">
          <button type="submit" className="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create project'}</button>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
