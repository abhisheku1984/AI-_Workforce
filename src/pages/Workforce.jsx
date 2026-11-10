import React, { useState } from 'react';
import { useApi, useAuth } from '../lib/auth';
import { PageHeader, Card, Badge, Loading, ErrorState, InfoNote, StatusDot } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { FilterBar, toPeriodParams, toFilterParams, periodLabel } from '../components/FilterBar';
import { fmtHours, fmtMoney, fmtNumber, fmtDate, fmtPct, currentMonth } from '../lib/format';
import { api, downloadFile } from '../lib/api';
import EmployeeDrawer from './workforce/EmployeeDrawer';

export default function WorkforcePage() {
  const { can, org } = useAuth();
  const [filter, setFilter] = useState({ periodType: 'month', month: currentMonth(), department_id: '', location_id: '', status: '', q: '' });
  const structure = useApi('/api/admin/structure', { skip: !can('org.view') });
  const meta = useApi('/api/workforce/meta/skills');
  const [selected, setSelected] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);

  const q = new URLSearchParams();
  if (filter.department_id) q.set('department_id', filter.department_id);
  if (filter.location_id) q.set('location_id', filter.location_id);
  if (filter.status) q.set('status', filter.status);
  if (filter.q) q.set('q', filter.q);
  q.set('limit', '1000');
  const list = useApi(`/api/workforce?${q.toString()}`, { deps: [q.toString()] });

  const costVisible = can('workforce.cost.view');

  const columns = [
    { key: 'full_name', label: 'Employee', render: (r) => (
      <button type="button" className="text-left" onClick={() => setSelected(r.id)}>
        <span className="font-medium text-ink-900 hover:text-brand-700">{r.full_name}</span>
        <span className="block text-[11px] text-ink-400">{r.employee_code} · {r.email || 'no email'}</span>
      </button>
    ) },
    { key: 'designation', label: 'Designation', render: (r) => r.designation || '—' },
    { key: 'department', label: 'Department', render: (r) => r.department || <span className="text-caution-700">Unassigned</span> },
    { key: 'business_unit', label: 'Business unit', render: (r) => r.business_unit || '—' },
    { key: 'location', label: 'Location', render: (r) => r.location || '—' },
    { key: 'status', label: 'Status', render: (r) => (
      <span className="inline-flex items-center gap-1.5 text-[13px] capitalize">
        <StatusDot status={r.status} />{r.status.replace('_', ' ')}
      </span>
    ) },
    { key: 'employment_type', label: 'Type', render: (r) => <span className="text-[13px] capitalize">{r.employment_type.replace('_', ' ')}</span> },
    { key: 'standard_weekly_hours', label: 'Weekly capacity', type: 'num', align: 'right', render: (r) => `${fmtNumber(r.standard_weekly_hours, 1)} h` },
    { key: 'fte', label: 'FTE', type: 'num', align: 'right' },
    { key: 'skills', label: 'Skills', sortable: false, render: (r) => (
      <span className="flex flex-wrap gap-1 max-w-[220px]">
        {(r.skills || []).slice(0, 3).map((s) => <Badge key={s.name} tone="neutral">{s.name}</Badge>)}
        {(r.skills || []).length > 3 && <span className="text-[11px] text-ink-400">+{r.skills.length - 3}</span>}
        {!(r.skills || []).length && <span className="text-[11px] text-ink-400">none recorded</span>}
      </span>
    ) },
    ...(costVisible ? [
      { key: 'annual_cost', label: 'Annual cost', align: 'right', render: (r) => (r.annual_cost == null ? <span className="text-caution-700 text-xs">not provided</span> : fmtMoney(r.annual_cost, r.cost_currency || org?.currency)) },
      { key: 'bill_rate_hour', label: 'Bill rate / h', align: 'right', render: (r) => (r.bill_rate_hour == null ? '—' : fmtMoney(r.bill_rate_hour, org?.currency, { compact: false })) },
    ] : []),
  ];

  async function exportCsv() {
    setExporting(true); setExportError(null);
    try {
      await downloadFile('/api/workforce/export/csv', 'employee_capacity.csv');
    } catch (e) {
      setExportError(e.message);
    } finally { setExporting(false); }
  }

  return (
    <div>
      <PageHeader
        title="Workforce"
        description="Your people, their capacity and their skills. Cost columns appear only if your role permits cost visibility."
        actions={
          <>
            {can('report.view') && <button type="button" className="btn-secondary btn-sm" onClick={exportCsv} disabled={exporting}>{exporting ? 'Preparing…' : 'Export capacity CSV'}</button>}
          </>
        }
        meta={list.meta && <Badge tone="brand">{fmtNumber(list.meta.total)} people in scope</Badge>}
      />

      <Card bodyClass="p-4 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="label" htmlFor="wf-search">Search</label>
            <input id="wf-search" className="input" placeholder="Name, employee ID or email" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="wf-dept">Department</label>
            <select id="wf-dept" className="input" value={filter.department_id} onChange={(e) => setFilter({ ...filter, department_id: e.target.value })}>
              <option value="">All departments</option>
              {(structure.data?.departments || meta.data?.departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="wf-loc">Location</label>
            <select id="wf-loc" className="input" value={filter.location_id} onChange={(e) => setFilter({ ...filter, location_id: e.target.value })}>
              <option value="">All locations</option>
              {(structure.data?.locations || meta.data?.locations || []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="wf-status">Status</label>
            <select id="wf-status" className="input" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
              <option value="">Active (default)</option>
              <option value="active">Active only</option>
              <option value="on_leave">On leave</option>
              <option value="notice">Serving notice</option>
              <option value="exited">Exited</option>
            </select>
          </div>
        </div>
        {!costVisible && (
          <div className="mt-3">
            <InfoNote>Cost and billing columns are hidden because your role does not include cost visibility. The server does not send them to your browser.</InfoNote>
          </div>
        )}
        {exportError && <div className="mt-3"><ErrorState message={exportError} /></div>}
      </Card>

      <Card bodyClass="p-0">
        {list.loading ? <div className="p-5"><Loading rows={5} /></div>
          : list.error ? <div className="p-5"><ErrorState message={list.error} onRetry={list.reload} code={list.code} /></div>
            : <DataTable columns={columns} rows={list.data || []} searchable emptyTitle="No employees match these filters" emptyDescription="Adjust the filters, or upload workforce data from the Data page." pageSize={25} />}
      </Card>

      {selected && (
        <EmployeeDrawer
          employeeId={selected}
          onClose={() => setSelected(null)}
          onChanged={() => { list.reload(); }}
        />
      )}
    </div>
  );
}
