import React, { useState } from 'react';
import { useApi, useAuth } from '../lib/auth';
import { PageHeader, Card, Badge, Loading, ErrorState, InfoNote, Tabs, EmptyState } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { fmtDate, fmtNumber, fmtHours } from '../lib/format';
import { api } from '../lib/api';

export default function AllocationPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState('register');
  const allocations = useApi('/api/allocations?limit=1000');
  const [error, setError] = useState(null);

  return (
    <div>
      <PageHeader
        title="Resource allocation"
        description="Who is planned onto which project, when, and for how many hours. Allocation is a plan; utilization analytics compare it against recorded work."
      />
      <Tabs
        tabs={[
          { id: 'register', label: 'Allocation register', count: allocations.data?.length },
          { id: 'scenario', label: 'Staffing scenario' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'register' && (
        <>
          {error && <div className="mb-3"><ErrorState message={error} /></div>}
          <Card bodyClass="p-0">
            {allocations.loading ? <div className="p-5"><Loading /></div>
              : allocations.error ? <div className="p-5"><ErrorState message={allocations.error} onRetry={allocations.reload} /></div> : (
                <DataTable
                  columns={[
                    { key: 'full_name', label: 'Person', render: (r) => <span className="font-medium">{r.full_name}<span className="block text-[11px] text-ink-400">{r.employee_code} · {r.department || 'Unassigned'}</span></span> },
                    { key: 'project_name', label: 'Project', render: (r) => (r.project_name ? <span>{r.project_name}<span className="block text-[11px] text-ink-400">{r.project_code}</span></span> : <span className="text-ink-400">Internal / no project</span>) },
                    { key: 'start_date', label: 'From', render: (r) => fmtDate(r.start_date) },
                    { key: 'end_date', label: 'To', render: (r) => fmtDate(r.end_date) },
                    { key: 'hours_per_week', label: 'Hours / week', align: 'right', render: (r) => fmtNumber(r.hours_per_week, 1) },
                    { key: 'billable', label: 'Billable', render: (r) => <Badge tone={r.billable ? 'green' : 'neutral'}>{r.billable ? 'yes' : 'no'}</Badge> },
                    { key: 'status', label: 'Status', render: (r) => <span className="capitalize text-[13px]">{r.status}</span> },
                    ...(can('allocation.manage') ? [{
                      key: 'actions', label: '', sortable: false, render: (r) => (
                        <button
                          type="button"
                          className="link text-xs"
                          onClick={async () => {
                            if (!window.confirm(`Cancel this allocation for ${r.full_name}? The record is retained as cancelled for history and audit.`)) return;
                            try { await api.del(`/api/allocations/${r.id}`); allocations.reload(); } catch (e) { setError(e.message); }
                          }}
                        >
                          Cancel
                        </button>
                      ),
                    }] : []),
                  ]}
                  rows={allocations.data || []}
                  searchable
                  pageSize={25}
                  initialSort={{ key: 'start_date', dir: 'desc' }}
                  emptyTitle="No allocations"
                  emptyDescription="Upload an allocation file or create allocations against projects."
                />
              )}
          </Card>
        </>
      )}

      {tab === 'scenario' && <ScenarioPanel />}
    </div>
  );
}

function ScenarioPanel() {
  const [form, setForm] = useState({ start_date: '', end_date: '', required_skill: '', hours_per_week: 40 });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function run(e) {
    e.preventDefault();
    setBusy(true); setError(null); setResult(null);
    try {
      const res = await api.post('/api/allocations/scenario', form);
      setResult(res.data);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <Card title="Define the requirement" subtitle="Decision support only — nothing is assigned automatically" className="lg:col-span-1">
        <form onSubmit={run} className="space-y-3">
          <div><label className="label" htmlFor="s-start">Needed from</label><input id="s-start" type="date" required className="input" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></div>
          <div><label className="label" htmlFor="s-end">Needed to</label><input id="s-end" type="date" required className="input" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></div>
          <div><label className="label" htmlFor="s-skill">Required skill</label><input id="s-skill" className="input" placeholder="e.g. Kubernetes" value={form.required_skill} onChange={(e) => setForm({ ...form, required_skill: e.target.value })} /></div>
          <div><label className="label" htmlFor="s-hours">Hours per week</label><input id="s-hours" type="number" className="input" value={form.hours_per_week} onChange={(e) => setForm({ ...form, hours_per_week: e.target.value })} /></div>
          <button type="submit" className="btn-primary w-full" disabled={busy}>{busy ? 'Calculating…' : 'Find candidates'}</button>
        </form>
        <div className="mt-4"><InfoNote tone="brand">Candidates are people in your data scope with free capacity in the window. Skills come from recorded employee skills — missing skill data understates suitable people.</InfoNote></div>
      </Card>

      <Card title="Candidate list" subtitle={result ? `${result.total_available_people} people have some free capacity` : 'Run a scenario to see candidates'} className="lg:col-span-2" bodyClass="p-0">
        {error && <div className="p-4"><ErrorState message={error} /></div>}
        {!result ? (!error && <EmptyState title="No scenario run yet" description="Enter the requirement on the left. The platform will list people with capacity, prioritising those with the required skill." />) : (
          <>
            {result.candidates.length === 0 ? <EmptyState title="No free capacity found" description="Either everyone is fully allocated in that window, or the filters exclude them." /> : (
              <DataTable
                columns={[
                  { key: 'full_name', label: 'Person', render: (r) => <span className="font-medium">{r.full_name}<span className="block text-[11px] text-ink-400">{r.employee_code} · {r.designation || '—'}</span></span> },
                  { key: 'free_hours', label: 'Free h/wk', align: 'right', render: (r) => <span className={r.free_hours >= Number(form.hours_per_week) ? 'text-positive-700 font-medium' : 'text-caution-700'}>{fmtNumber(r.free_hours, 1)}</span> },
                  { key: 'meets_hours', label: 'Meets hours', render: (r) => <Badge tone={r.meets_hours ? 'green' : 'amber'}>{r.meets_hours ? 'yes' : 'partial'}</Badge> },
                  { key: 'has_required_skill', label: 'Has skill', render: (r) => (r.has_required_skill == null ? <span className="text-ink-300">n/a</span> : <Badge tone={r.has_required_skill ? 'green' : 'neutral'}>{r.has_required_skill ? 'yes' : 'no'}</Badge>) },
                  { key: 'other_skills', label: 'Recorded skills', sortable: false, render: (r) => <span className="text-[12px] text-ink-500">{r.other_skills.join(', ') || 'none'}</span> },
                ]}
                rows={result.candidates}
                pageSize={10}
              />
            )}
            <div className="p-4 border-t border-ink-100"><InfoNote tone="caution">{result.note}</InfoNote></div>
          </>
        )}
      </Card>
    </div>
  );
}
