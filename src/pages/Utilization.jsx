import React, { useState } from 'react';
import { useApi, useAuth } from '../lib/auth';
import { FilterBar, toPeriodParams, toFilterParams, periodLabel } from '../components/FilterBar';
import { PageHeader, Card, Kpi, Loading, ErrorState, InfoNote, Badge, Tabs, DefinitionTip } from '../components/ui';
import { UtilizationTrendChart, UtilizationByGroupChart, DepartmentBarChart } from '../components/charts';
import { DataTable } from '../components/DataTable';
import { fmtHours, fmtPct, fmtNumber, currentMonth } from '../lib/format';
import { downloadFile, api } from '../lib/api';

function ReportExportButton({ filter }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function run() {
    setBusy(true); setError(null);
    try {
      const res = await api.post('/api/reports/generate', { code: 'department_utilization', format: 'csv', period: filter.periodType === 'month' ? { month: filter.month } : { from: filter.from, to: filter.to } });
      await downloadFile(res.data.downloadUrl, res.data.filename);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-xs text-danger-700">{error}</span>}
      <button type="button" className="btn-secondary btn-sm" onClick={run} disabled={busy}>{busy ? 'Preparing…' : 'Export department report'}</button>
    </span>
  );
}

export default function UtilizationPage() {
  const { can } = useAuth();
  const [filter, setFilter] = useState({ periodType: 'month', month: currentMonth() });
  const [tab, setTab] = useState('departments');
  const [groupBy, setGroupBy] = useState('department');
  const structure = useApi('/api/admin/structure', { skip: !can('org.view') });

  const params = { ...toPeriodParams(filter), ...toFilterParams(filter) };
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
  const report = useApi(`/api/analytics/utilization?${query}`, { deps: [query] });
  const trend = useApi(`/api/analytics/utilization/trend?count=6&end=${(params.month || currentMonth())}${params.business_unit_id ? `&business_unit_id=${params.business_unit_id}` : ''}${params.department_id ? `&department_id=${params.department_id}` : ''}`, { deps: [query] });
  const definitions = useApi('/api/analytics/definitions');

  const d = report.data;
  const total = d?.total;
  const groups = d ? { department: d.byDepartment, business_unit: d.byBusinessUnit, location: d.byLocation }[groupBy] : [];

  const groupColumns = [
    { key: 'key', label: groupBy === 'department' ? 'Department' : groupBy === 'business_unit' ? 'Business unit' : 'Location', render: (r) => r.key || 'Unassigned' },
    { key: 'headcount', label: 'People', type: 'num', align: 'right' },
    { key: 'available_hours', label: 'Available h', align: 'right', render: (r) => fmtNumber(r.available_hours, 1) },
    { key: 'allocated_hours', label: 'Allocated h', align: 'right', render: (r) => fmtNumber(r.allocated_hours, 1) },
    { key: 'utilized_hours', label: 'Recorded h', align: 'right', render: (r) => fmtNumber(r.utilized_hours, 1) },
    { key: 'unallocated_hours', label: 'Unallocated h', align: 'right', render: (r) => <span className={r.unallocated_hours > 0 ? 'text-caution-700 font-medium' : ''}>{fmtNumber(r.unallocated_hours, 1)}</span> },
    { key: 'over_allocated_hours', label: 'Over-allocated h', align: 'right', render: (r) => <span className={r.over_allocated_hours > 0 ? 'text-danger-700 font-medium' : ''}>{fmtNumber(r.over_allocated_hours, 1)}</span> },
    {
      key: 'allocation_pct', label: 'Allocation %', align: 'right',
      render: (r) => <span className={r.allocation_pct > 100 ? 'text-danger-700 font-semibold' : ''}>{fmtPct(r.allocation_pct)}</span>,
    },
    {
      key: 'utilization_pct', label: 'Utilization %', align: 'right',
      render: (r) => (r.utilization_pct == null
        ? <span className="text-[11px] text-ink-400" title="No timesheet records for this group in the period">not measurable</span>
        : <span className={`font-medium ${r.utilization_pct >= 75 ? 'text-positive-700' : r.utilization_pct >= 60 ? 'text-caution-700' : 'text-danger-700'}`}>{fmtPct(r.utilization_pct)}</span>),
    },
    {
      key: 'utilization_confidence', label: 'Coverage', sortable: false,
      render: (r) => <Badge tone={r.utilization_confidence === 'full' ? 'green' : r.utilization_confidence === 'partial' ? 'amber' : 'neutral'}>{r.utilization_confidence === 'full' ? 'full' : r.utilization_confidence === 'partial' ? 'partial' : 'no data'}</Badge>,
    },
  ];

  const employeeColumns = [
    { key: 'full_name', label: 'Employee', render: (r) => (<span className="font-medium">{r.full_name}<span className="block text-[11px] text-ink-400">{r.employee_code}</span></span>) },
    { key: 'department', label: 'Department', render: (r) => r.department || 'Unassigned' },
    { key: 'available_hours', label: 'Available h', align: 'right', render: (r) => fmtNumber(r.available_hours, 1) },
    { key: 'allocated_hours', label: 'Allocated h', align: 'right', render: (r) => fmtNumber(r.allocated_hours, 1) },
    { key: 'unallocated_hours', label: 'Bench h', align: 'right', render: (r) => <span className={r.unallocated_hours > 0 ? 'text-caution-700' : ''}>{fmtNumber(r.unallocated_hours, 1)}</span> },
    { key: 'allocation_pct', label: 'Allocation %', align: 'right', render: (r) => <span className={r.allocation_pct > 100 ? 'text-danger-700 font-semibold' : ''}>{fmtPct(r.allocation_pct)}</span> },
    { key: 'utilization_pct', label: 'Utilization %', align: 'right', render: (r) => (r.utilization_pct == null ? <span className="text-[11px] text-ink-400">no timesheets</span> : fmtPct(r.utilization_pct)) },
    { key: 'project_count', label: 'Projects', type: 'num', align: 'right' },
  ];

  return (
    <div>
      <PageHeader
        title="Utilization & capacity"
        description="How much capacity you have, how much is planned, and how much was actually worked. Each measure has a fixed definition shown below the figures."
        actions={<ReportExportButton filter={filter} />}
        meta={total && (
          <>
            <Badge tone="brand">{periodLabel(filter)}</Badge>
            <span>{fmtPct(total.timesheet_coverage_pct)} timesheet coverage</span>
            <span aria-hidden>·</span>
            <span>{fmtNumber(total.available_hours)} available hours</span>
          </>
        )}
      />

      <FilterBar value={filter} onChange={setFilter} structure={structure.data} show={['businessUnit', 'department']} />

      {report.error && <ErrorState message={report.error} onRetry={report.reload} code={report.code} />}
      {report.loading || !d ? <Loading rows={5} label="Calculating utilization…" /> : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
            <Kpi label="Available capacity" value={fmtHours(total.available_hours)} sub={`${total.headcount} people`} info="Standard capacity after working days, holidays and FTE." />
            <Kpi label="Allocated (plan)" value={fmtHours(total.allocated_hours)} sub={fmtPct(total.allocation_pct)} tone={total.allocation_pct > 100 ? 'danger' : 'neutral'} info="Planned project hours from allocations." />
            <Kpi label="Recorded (actual)" value={fmtHours(total.utilized_hours)} sub={total.utilization_pct == null ? 'not measurable' : `${fmtPct(total.utilization_pct)} utilization`} info="Hours entered on timesheets." />
            <Kpi label="Unallocated" value={fmtHours(total.unallocated_hours)} sub="bench capacity" tone={total.unallocated_hours > 0 ? 'caution' : 'positive'} info="Available minus allocated, floor at zero, calculated per person." />
            <Kpi label="Over-allocated" value={fmtHours(total.over_allocated_hours)} sub={`${total.employees_over_allocated} people`} tone={total.over_allocated_hours > 0 ? 'danger' : 'positive'} info="Allocated minus available, floor at zero." />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4">
            <Card title="Six-month trend" subtitle="Actual utilization versus the allocation plan" bodyClass="px-2 pt-3 pb-2">
              {trend.data ? <UtilizationTrendChart data={trend.data} height={260} /> : <Loading rows={2} />}
            </Card>
            <Card title="Allocation and bench hours by department" subtitle="Stacked: planned hours plus unallocated capacity" bodyClass="px-2 pt-3 pb-2">
              <DepartmentBarChart data={d.byDepartment} height={260} />
            </Card>
          </div>

          <div className="mt-4">
            <Tabs
              tabs={[
                { id: 'departments', label: 'By team' },
                { id: 'people', label: 'By person', count: d.employees.length },
                { id: 'definitions', label: 'Definitions' },
              ]}
              active={tab}
              onChange={setTab}
            />

            {tab === 'departments' && (
              <>
                <div className="flex items-center gap-2 mb-3 no-print">
                  <label className="text-[13px] text-ink-600" htmlFor="groupby">Group by</label>
                  <select id="groupby" className="input w-auto" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
                    <option value="department">Department</option>
                    <option value="business_unit">Business unit</option>
                    <option value="location">Location</option>
                  </select>
                </div>
                <Card bodyClass="p-0"><DataTable columns={groupColumns} rows={groups} emptyTitle="No groups in scope" pageSize={20} /></Card>
                <div className="mt-4"><Card title="Utilization against target" subtitle="Grey bars indicate groups with no timesheet data in the period" bodyClass="px-2 pt-3 pb-2"><UtilizationByGroupChart data={groups} height={280} /></Card></div>
              </>
            )}

            {tab === 'people' && (
              <Card bodyClass="p-0">
                <DataTable
                  columns={employeeColumns}
                  rows={d.employees}
                  searchable
                  pageSize={25}
                  emptyTitle="No employees in scope"
                  initialSort={{ key: 'unallocated_hours', dir: 'desc' }}
                />
              </Card>
            )}

            {tab === 'definitions' && (
              <Card title="How each number is calculated" subtitle="These formulas are fixed by the platform so results are reproducible and auditable." bodyClass="p-0">
                <table className="w-full">
                  <thead><tr><th className="th">Measure</th><th className="th">Formula</th><th className="th">Notes and exclusions</th></tr></thead>
                  <tbody>
                    {Object.entries(d.definitions).filter(([k]) => k !== 'exclusions').map(([k, v]) => (
                      <tr key={k}>
                        <td className="td font-medium whitespace-nowrap">{k.replace(/_/g, ' ')}</td>
                        <td className="td">{v}</td>
                        <td className="td text-ink-500">{k === 'utilization_pct' ? 'Blank, not zero, when no timesheet data exists.' : k === 'allocated_hours' ? 'Allocations are a plan of record.' : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="p-4"><InfoNote tone="caution" title="Exclusions applied to every measure">{d.definitions.exclusions}</InfoNote></div>
              </Card>
            )}
          </div>

          <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card title="Largest unallocated capacity (bench)" subtitle="People with available but unplanned hours" bodyClass="p-0">
              <DataTable
                columns={[
                  { key: 'full_name', label: 'Employee', render: (r) => <span className="font-medium">{r.full_name}</span> },
                  { key: 'department', label: 'Department' },
                  { key: 'allocation_pct', label: 'Allocation %', align: 'right', render: (r) => fmtPct(r.allocation_pct) },
                  { key: 'unallocated_hours', label: 'Bench hours', align: 'right', render: (r) => fmtNumber(r.unallocated_hours, 1) },
                ]}
                rows={d.idle}
                pageSize={8}
                emptyTitle="No bench capacity"
                emptyDescription="Everyone in scope has at least 25% of their capacity allocated."
              />
            </Card>
            <Card title="Over-allocated people" subtitle="Planned hours above available capacity" bodyClass="p-0">
              <DataTable
                columns={[
                  { key: 'full_name', label: 'Employee', render: (r) => <span className="font-medium">{r.full_name}</span> },
                  { key: 'department', label: 'Department' },
                  { key: 'allocation_pct', label: 'Allocation %', align: 'right', render: (r) => <span className="text-danger-700 font-medium">{fmtPct(r.allocation_pct)}</span> },
                  { key: 'over_allocated_hours', label: 'Over hours', align: 'right', render: (r) => fmtNumber(r.over_allocated_hours, 1) },
                ]}
                rows={d.overAllocated}
                pageSize={8}
                emptyTitle="No over-allocation"
                emptyDescription="No one in scope is allocated above their available capacity."
              />
            </Card>
          </div>

          <div className="mt-4">
            <InfoNote tone="brand" title="Why allocation and utilization differ">
              Allocation is what managers planned. Utilization is what people recorded. A team can be fully allocated
              and still show low utilization if time is not recorded — the coverage indicator tells you when that
              is happening. The platform never substitutes one for the other.
            </InfoNote>
          </div>
        </>
      )}
    </div>
  );
}
