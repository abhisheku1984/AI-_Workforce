import React, { useState } from 'react';
import { useApi, useAuth } from '../lib/auth';
import { FilterBar, toPeriodParams, toFilterParams, periodLabel } from '../components/FilterBar';
import { PageHeader, Card, Kpi, Loading, ErrorState, InfoNote, Badge, Tabs } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { CostBreakdownChart } from '../components/charts';
import { fmtMoney, fmtNumber, fmtPct, currentMonth } from '../lib/format';
import { api, downloadFile } from '../lib/api';

export default function FinancePage() {
  const { can, org } = useAuth();
  const [filter, setFilter] = useState({ periodType: 'month', month: currentMonth() });
  const [tab, setTab] = useState('overview');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);
  const structure = useApi('/api/admin/structure', { skip: !can('org.view') });

  const params = { ...toPeriodParams(filter), ...toFilterParams(filter) };
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
  const fin = useApi(`/api/analytics/financial?${query}`, { deps: [query] });
  const d = fin.data;
  const currency = org?.currency || 'INR';
  const costVisible = can('workforce.cost.view');
  const financeVisible = can('finance.view');

  async function exportCost() {
    setExporting(true); setExportError(null);
    try {
      const res = await api.post('/api/reports/generate', { code: 'workforce_cost', format: 'xlsx', period: params.month ? { month: params.month } : { from: params.from, to: params.to } });
      await downloadFile(res.data.downloadUrl, res.data.filename);
    } catch (e) { setExportError(e.message); } finally { setExporting(false); }
  }

  return (
    <div>
      <PageHeader
        title="Financial intelligence"
        description="Workforce cost, invoiced revenue and margin where the inputs exist. Cost, billing and revenue are separate concepts here and are never presented as interchangeable."
        actions={costVisible && <button type="button" className="btn-secondary btn-sm" onClick={exportCost} disabled={exporting}>{exporting ? 'Preparing…' : 'Export cost report'}</button>}
        meta={d && <><Badge tone="brand">{periodLabel(filter)}</Badge>{d.availability.margin_computable ? <Badge tone="green">margin calculable</Badge> : <Badge tone="amber">partial inputs</Badge>}</>}
      />

      <FilterBar value={filter} onChange={setFilter} structure={structure.data} show={['businessUnit', 'department']} />
      {exportError && <div className="mb-3"><ErrorState message={exportError} /></div>}
      {fin.error && <ErrorState message={fin.error} onRetry={fin.reload} />}
      {fin.loading || !d ? <Loading rows={5} label="Building financial analysis…" /> : (
        <>
          {!d.availability.margin_computable && (
            <div className="mb-4">
              <InfoNote tone="caution" title="Why margin may not be available">
                {d.availability.notes.length
                  ? <ul className="list-disc pl-4 space-y-0.5">{d.availability.notes.map((n) => <li key={n}>{n}</li>)}</ul>
                  : 'Margin requires invoiced revenue plus workforce cost plus operating expenses for the same period.'}
              </InfoNote>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <Kpi
              label="Invoiced revenue"
              value={financeVisible ? fmtMoney(d.totals.invoiced_revenue, currency) : 'Not permitted'}
              sub={financeVisible ? `${fmtMoney(d.totals.paid_revenue, currency)} collected` : 'finance.view permission required'}
              info="Value of invoices issued in the period. This is not cash collected and not the same as potential billable value."
            />
            <Kpi
              label="Workforce cost"
              value={costVisible ? fmtMoney(d.totals.workforce_cost, currency) : 'Not permitted'}
              sub={costVisible ? `${fmtPct(d.availability.employee_cost_coverage_pct)} of employees have cost data` : 'cost permission required'}
              tone={d.availability.employee_cost_coverage_pct < 100 ? 'caution' : 'neutral'}
              info="Employer cost of workforce capacity in the period, derived from annual cost pro-rated to working days."
            />
            <Kpi
              label="Cost of unallocated time"
              value={costVisible ? fmtMoney(d.totals.idle_workforce_cost, currency) : 'Not permitted'}
              sub="capacity not planned onto work"
              tone="caution"
              info="Employee period cost × the share of capacity not allocated to any project. It is the cost of carrying spare capacity — not a saving already achieved."
            />
            <Kpi
              label="Gross margin"
              value={d.totals.gross_margin == null ? 'Not calculable' : fmtMoney(d.totals.gross_margin, currency)}
              sub={d.totals.gross_margin_pct == null ? 'incomplete inputs' : fmtPct(d.totals.gross_margin_pct)}
              tone={d.totals.gross_margin_pct == null ? 'neutral' : d.totals.gross_margin_pct >= 20 ? 'positive' : 'danger'}
              info="Invoiced revenue − workforce cost − operating expenses. Only shown when all three inputs exist; assumptions are stated in the notes."
            />
          </div>

          <div className="mt-4">
            <Tabs
              tabs={[
                { id: 'overview', label: 'Overview' },
                { id: 'projects', label: 'By project', count: d.byProject.length },
                ...(costVisible ? [{ id: 'people', label: 'Cost by person', count: d.costRows.length }] : []),
                { id: 'method', label: 'Method & assumptions' },
              ]}
              active={tab}
              onChange={setTab}
            />

            {tab === 'overview' && (
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <Card className="xl:col-span-2" title="Workforce cost by department" subtitle="Employer cost of capacity split by allocated and unallocated time" bodyClass="px-2 pt-3 pb-2">
                  {costVisible ? <CostBreakdownChart data={d.byDepartment} currency={currency} height={280} /> : <p className="p-4 text-sm text-ink-500">Cost data is hidden for your role.</p>}
                </Card>
                <Card title="Revenue vs cost" bodyClass="p-4">
                  <dl className="space-y-3 text-sm">
                    <Row label="Invoiced revenue" value={financeVisible ? fmtMoney(d.totals.invoiced_revenue, currency) : '—'} />
                    <Row label="Operating expenses" value={financeVisible ? fmtMoney(d.totals.expenses, currency) : '—'} />
                    <Row label="Workforce cost" value={costVisible ? fmtMoney(d.totals.workforce_cost, currency) : '—'} />
                    <Row label="Gross margin" value={d.totals.gross_margin == null ? 'Not calculable' : fmtMoney(d.totals.gross_margin, currency)} strong />
                    <div className="pt-3 border-t border-ink-100">
                      <Row label="Potential billable value" value={d.totals.billable_value == null ? 'Rates not available' : fmtMoney(d.totals.billable_value, currency)} />
                      <p className="text-[11px] text-ink-500 mt-1">
                        Billable value = billable timesheet hours × project billing rate. It is <strong>not</strong> invoiced revenue and is shown only for comparison.
                      </p>
                    </div>
                  </dl>
                </Card>
                <Card className="xl:col-span-3" title="Department cost detail" bodyClass="p-0">
                  <DataTable
                    columns={[
                      { key: 'name', label: 'Department', render: (r) => <span className="font-medium">{r.name}</span> },
                      { key: 'headcount', label: 'People', type: 'num', align: 'right' },
                      { key: 'period_cost', label: 'Workforce cost', align: 'right', render: (r) => (costVisible ? fmtMoney(r.period_cost, currency) : '—') },
                      { key: 'idle_cost', label: 'Cost of unallocated time', align: 'right', render: (r) => (costVisible ? <span className="text-caution-700">{fmtMoney(r.idle_cost, currency)}</span> : '—') },
                      { key: 'cost_coverage_pct', label: 'Cost data coverage', align: 'right', render: (r) => <Badge tone={r.cost_coverage_pct >= 95 ? 'green' : r.cost_coverage_pct > 0 ? 'amber' : 'red'}>{fmtPct(r.cost_coverage_pct, 0)}</Badge> },
                    ]}
                    rows={d.byDepartment}
                    pageSize={10}
                    emptyTitle="No cost data"
                  />
                </Card>
              </div>
            )}

            {tab === 'projects' && (
              <Card bodyClass="p-0">
                <DataTable
                  columns={[
                    { key: 'name', label: 'Project', render: (r) => <span className="font-medium">{r.name}<span className="block text-[11px] text-ink-400">{r.code} · {r.client_name || 'internal'}</span></span> },
                    { key: 'billable_hours', label: 'Billable hours', align: 'right', render: (r) => fmtNumber(r.billable_hours, 1) },
                    { key: 'billing_rate_hour', label: 'Rate / h', align: 'right', render: (r) => (r.billing_rate_hour == null ? <span className="text-ink-400">not set</span> : fmtMoney(r.billing_rate_hour, r.currency || currency, { compact: false })) },
                    { key: 'billable_value', label: 'Billable value', align: 'right', render: (r) => (r.billable_value == null ? <span className="text-ink-400">not calculable</span> : fmtMoney(r.billable_value, r.currency || currency)) },
                    { key: 'invoiced', label: 'Invoiced', align: 'right', render: (r) => (financeVisible ? fmtMoney(r.invoiced, r.currency || currency) : '—') },
                  ]}
                  rows={d.byProject}
                  pageSize={15}
                  emptyTitle="No project billing data"
                  emptyDescription="Billable value needs project billing rates and billable timesheet hours."
                />
              </Card>
            )}

            {tab === 'people' && costVisible && (
              <Card bodyClass="p-0">
                <DataTable
                  columns={[
                    { key: 'full_name', label: 'Employee', render: (r) => <span className="font-medium">{r.full_name}<span className="block text-[11px] text-ink-400">{r.employee_code} · {r.grade || 'no grade'}</span></span> },
                    { key: 'annual_cost', label: 'Annual cost', align: 'right', render: (r) => (r.annual_cost == null ? <span className="text-caution-700 text-xs">not provided</span> : fmtMoney(r.annual_cost, currency)) },
                    { key: 'period_cost', label: 'Period cost', align: 'right', render: (r) => (r.period_cost == null ? '—' : fmtMoney(r.period_cost, currency)) },
                    { key: 'allocated_period_cost', label: 'Allocated cost', align: 'right', render: (r) => (r.allocated_period_cost == null ? '—' : fmtMoney(r.allocated_period_cost, currency)) },
                    { key: 'idle_period_cost', label: 'Cost of idle time', align: 'right', render: (r) => (r.idle_period_cost == null ? '—' : <span className="text-caution-700">{fmtMoney(r.idle_period_cost, currency)}</span>) },
                    { key: 'allocated_hours', label: 'Allocated h', align: 'right', render: (r) => fmtNumber(r.allocated_hours, 1) },
                    { key: 'available_hours', label: 'Available h', align: 'right', render: (r) => fmtNumber(r.available_hours, 1) },
                  ]}
                  rows={d.costRows}
                  searchable
                  pageSize={25}
                  initialSort={{ key: 'idle_period_cost', dir: 'desc' }}
                  emptyTitle="No employee cost records"
                />
              </Card>
            )}

            {tab === 'method' && (
              <Card title="How these figures are produced" bodyClass="p-5 space-y-4">
                <div>
                  <h4 className="text-sm font-semibold text-ink-800">Workforce cost</h4>
                  <p className="text-sm text-ink-600 mt-1">Annual employer cost ÷ 12 × (working days in the period ÷ 21). Only employees with a recorded cost are included; coverage is shown so partial totals are never presented as complete.</p>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-ink-800">Cost of unallocated time</h4>
                  <p className="text-sm text-ink-600 mt-1">Employee period cost multiplied by the share of their capacity that is not allocated to any project. This measures the cost of carrying capacity. It is not a saving, and reducing it has employment implications that require a management decision.</p>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-ink-800">Invoiced revenue</h4>
                  <p className="text-sm text-ink-600 mt-1">Sum of invoices issued in the period, excluding cancelled invoices. Cancelled and draft invoices are excluded. Collected cash is shown separately as paid invoices.</p>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-ink-800">Gross margin</h4>
                  <p className="text-sm text-ink-600 mt-1">Invoiced revenue − workforce cost − operating expenses. Shown only when all three exist for the same period. This is a gross operating view, not a full P&amp;L: it excludes overheads not recorded in the platform.</p>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-ink-800">Potential billable value</h4>
                  <p className="text-sm text-ink-600 mt-1">Billable timesheet hours × project billing rate. It estimates revenue implied by work done, which may be invoiced later. It is never added to invoiced revenue.</p>
                </div>
                <InfoNote tone="caution">No profitability or saving is claimed unless every input exists and the coverage stated supports it. Rates and costs are supplied by the customer.</InfoNote>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, value, strong }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className={strong ? 'font-medium text-ink-800' : 'text-ink-600'}>{label}</dt>
      <dd className={`tabular-nums ${strong ? 'font-semibold text-ink-900' : 'text-ink-800'}`}>{value}</dd>
    </div>
  );
}
