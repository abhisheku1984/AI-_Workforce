import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi, useAuth } from '../lib/auth';
import { FilterBar, toPeriodParams, toFilterParams, periodLabel } from '../components/FilterBar';
import { Card, Kpi, PageHeader, Loading, ErrorState, InfoNote, Badge, SeverityBadge, ProgressBar, EmptyState } from '../components/ui';
import { UtilizationTrendChart, DepartmentBarChart, UtilizationByGroupChart, CostBreakdownChart } from '../components/charts';
import { fmtHours, fmtPct, fmtMoney, fmtNumber, relativeTime, fmtMonth, currentMonth } from '../lib/format';

export default function DashboardPage() {
  const { can, org } = useAuth();
  const [filter, setFilter] = useState({ periodType: 'month', month: currentMonth() });
  const structure = useApi('/api/admin/structure', { skip: !can('org.view') });

  const params = { ...toPeriodParams(filter), ...toFilterParams(filter) };
  const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
  const dash = useApi(`/api/analytics/dashboard?${query}`, { deps: [query] });
  const insights = useApi('/api/ai/insights?status=open', { skip: !can('ai.insights') });

  const d = dash.data;
  const util = d?.utilization?.total;
  const fin = d?.finance;
  const isExec = can('analytics.executive');

  const topInsights = useMemo(() => (insights.data || []).slice(0, 3), [insights.data]);

  if (dash.error) return <ErrorState message={dash.error} onRetry={dash.reload} code={dash.code} />;

  return (
    <div>
      <PageHeader
        title={isExec ? 'Executive overview' : 'Operations overview'}
        description="Workforce capacity, project demand and financial performance for the selected period. Every figure links to its definition and source data."
        actions={
          <>
            <Link to="/assistant" className="btn-secondary btn-sm">Ask the assistant</Link>
            <Link to="/reports" className="btn-primary btn-sm">Management reports</Link>
          </>
        }
        meta={d && (
          <>
            <Badge tone="brand">{periodLabel(filter)}</Badge>
            <span>Data last updated: {relativeTime(d.dataFreshness.last_import_at)}</span>
            <span aria-hidden>·</span>
            <span>Timesheets to {d.dataFreshness.last_timesheet_date || '—'}</span>
          </>
        )}
      />

      <FilterBar value={filter} onChange={setFilter} structure={structure.data} show={['businessUnit', 'department', 'location']} />

      {dash.loading || !d ? <Loading rows={5} label="Calculating capacity and utilization…" /> : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <Kpi
              label="Headcount in scope"
              value={fmtNumber(util.headcount)}
              sub={`${fmtNumber(util.available_hours)} available hours`}
              info="Active employees including those on leave or serving notice. Exited employees are excluded."
            />
            <Kpi
              label="Allocation (plan)"
              value={fmtPct(util.allocation_pct)}
              sub={`${fmtHours(util.allocated_hours)} planned onto projects`}
              tone={util.allocation_pct > 100 ? 'danger' : util.allocation_pct >= 80 ? 'positive' : 'caution'}
              info="Allocated hours ÷ available hours. Above 100% means the plan exceeds capacity."
            />
            <Kpi
              label="Utilization (actual)"
              value={util.utilization_pct == null ? 'Not measurable' : fmtPct(util.utilization_pct)}
              sub={util.utilization_pct == null
                ? 'No timesheet data in this period'
                : `${fmtHours(util.utilized_hours)} recorded · ${fmtPct(util.timesheet_coverage_pct)} coverage`}
              tone={util.utilization_pct == null ? 'neutral' : util.utilization_pct >= 75 ? 'positive' : 'caution'}
              info="Timesheet hours ÷ available hours. This is actual work, not the allocation plan."
            />
            <Kpi
              label="Unallocated capacity"
              value={fmtHours(util.unallocated_hours)}
              sub={`${util.employees_bench} people below 1% allocation`}
              tone={util.unallocated_hours > util.available_hours * 0.2 ? 'caution' : 'neutral'}
              info="Available hours not planned onto any project (bench capacity). Calculated per person, so over-allocation elsewhere does not offset it."
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mt-4">
            <Kpi
              label="Over-allocated people"
              value={fmtNumber(util.employees_over_allocated)}
              sub={util.over_allocated_hours > 0 ? `${fmtHours(util.over_allocated_hours)} above capacity` : 'None above capacity'}
              tone={util.employees_over_allocated > 0 ? 'danger' : 'positive'}
              info="People whose planned allocation exceeds their available hours in the period."
            />
            <Kpi
              label="Open staffing demand"
              value={fmtNumber(d.demand.total_gaps)}
              sub={`${d.demand.gaps.filter((g) => (g.coverage_pct ?? 0) < 80).length} below 80% coverage`}
              tone={d.demand.gaps.some((g) => (g.coverage_pct ?? 0) < 50) ? 'danger' : 'neutral'}
              info="Open demand records compared with dated allocations. Coverage below 100% means unfilled hours."
            />
            <Kpi
              label="Billable share of work"
              value={util.billable_pct == null ? 'Not measurable' : fmtPct(util.billable_pct)}
              sub={`${fmtHours(util.billable_hours)} billable of ${fmtHours(util.utilized_hours)} recorded`}
              info="Billable timesheet hours ÷ total timesheet hours."
            />
            <Kpi
              label="Open AI insights"
              value={fmtNumber(d.openInsights)}
              sub={insights.data?.length ? `${insights.data.filter((i) => i.severity === 'high' || i.severity === 'critical').length} high severity` : 'None open'}
              tone={d.openInsights > 0 ? 'brand' : 'neutral'}
              info="Recommendations generated from your data that have not yet been reviewed."
            />
          </div>

          {/* Trends + department */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-4">
            <Card
              className="xl:col-span-2"
              title="Utilization and allocation trend"
              subtitle="Solid line = actual work from timesheets. Dashed line = allocation plan. Gaps mean no data rather than zero."
              bodyClass="px-2 pt-3 pb-2"
            >
              <UtilizationTrendChart data={d.trend} height={276} />
            </Card>

            <Card
              title="Insights requiring attention"
              subtitle={insights.data ? `${insights.data.length} open` : 'Insights unavailable for your role'}
              actions={<Link to="/insights" className="link text-xs">View all</Link>}
              bodyClass="p-4"
            >
              {!can('ai.insights') ? (
                <p className="text-sm text-ink-500">Your role does not include access to AI insights.</p>
              ) : topInsights.length === 0 ? (
                <EmptyState title="No open insights" description="Generate insights from the AI Insights page after your next data refresh." />
              ) : (
                <ul className="space-y-3">
                  {topInsights.map((i) => (
                    <li key={i.id} className="border border-ink-200 rounded-lg p-3 hover:border-brand-300 transition-colors">
                      <div className="flex items-center gap-2 mb-1">
                        <SeverityBadge severity={i.severity} />
                        <span className="text-[11px] text-ink-500">{i.category.replace('_', ' ')}</span>
                      </div>
                      <Link to="/insights" className="text-[13px] font-medium text-ink-800 hover:text-brand-700">{i.title}</Link>
                      <p className="text-[11px] text-ink-500 mt-1 line-clamp-2">{i.finding}</p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* Departments + cost */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mt-4">
            <Card
              title="Capacity by department"
              subtitle="Allocated versus unallocated hours for the period"
              bodyClass="px-2 pt-3 pb-2"
              actions={<Link to="/utilization" className="link text-xs">Details</Link>}
            >
              {d.utilization.byDepartment.length ? (
                <DepartmentBarChart data={d.utilization.byDepartment} height={280} />
              ) : <EmptyState title="No department data" description="Assign employees to departments to see this breakdown." />}
            </Card>

            <Card
              title="Utilization by department"
              subtitle="Green ≥ 75% target, amber 60–75%, red below 60%, grey = no timesheet data"
              bodyClass="px-2 pt-3 pb-2"
            >
              {d.utilization.byDepartment.length ? (
                <UtilizationByGroupChart data={d.utilization.byDepartment} height={280} />
              ) : <EmptyState title="No department data" />}
            </Card>
          </div>

          {fin && (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-4">
              <Card
                className="xl:col-span-1"
                title="Financial position"
                subtitle={fin.availability.margin_computable ? 'Margin is calculable for this period' : 'Partial inputs — see notes'}
                bodyClass="p-4"
              >
                <dl className="space-y-2.5 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-600">Invoiced revenue</dt>
                    <dd className="font-medium tabular-nums">{fin.totals.invoiced_revenue == null ? 'Not visible' : fmtMoney(fin.totals.invoiced_revenue, org?.currency)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-600">Workforce cost</dt>
                    <dd className="font-medium tabular-nums">{fin.totals.workforce_cost == null ? 'Not visible' : fmtMoney(fin.totals.workforce_cost, org?.currency)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-600">Cost of unallocated time</dt>
                    <dd className="font-medium tabular-nums text-caution-700">{fin.totals.idle_workforce_cost == null ? '—' : fmtMoney(fin.totals.idle_workforce_cost, org?.currency)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-ink-600">Operating expenses</dt>
                    <dd className="font-medium tabular-nums">{fin.totals.expenses == null ? '—' : fmtMoney(fin.totals.expenses, org?.currency)}</dd>
                  </div>
                  <div className="flex justify-between gap-3 pt-2 border-t border-ink-100">
                    <dt className="font-medium text-ink-800">Gross margin</dt>
                    <dd className="font-semibold tabular-nums">{fin.totals.gross_margin == null ? 'Not calculable' : `${fmtMoney(fin.totals.gross_margin, org?.currency)} (${fmtPct(fin.totals.gross_margin_pct)})`}</dd>
                  </div>
                </dl>
                {fin.availability.notes.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-ink-100 space-y-1">
                    {fin.availability.notes.map((n) => <p key={n} className="text-[11px] text-caution-700">• {n}</p>)}
                  </div>
                )}
                <Link to="/finance" className="btn-secondary btn-sm mt-3 w-full">Open finance analysis</Link>
              </Card>

              <Card
                className="xl:col-span-2"
                title="Workforce cost by department"
                subtitle="Employer cost of capacity, split into allocated and unallocated time"
                bodyClass="px-2 pt-3 pb-2"
              >
                <CostBreakdownChart data={fin.byDepartment} currency={org?.currency} height={280} />
              </Card>
            </div>
          )}

          {/* Over-allocation + freshness */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-4">
            <Card className="xl:col-span-2" title="People over their available capacity" subtitle="Ordered by hours above capacity. Any change is a management decision, not automatic." bodyClass="p-0">
              {d.utilization.overAllocated.length === 0 ? (
                <div className="p-5 text-sm text-ink-500">No one is over-allocated in this period.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead><tr><th className="th">Employee</th><th className="th">Department</th><th className="th text-right">Available</th><th className="th text-right">Allocated</th><th className="th text-right">Allocation %</th><th className="th">Over</th></tr></thead>
                    <tbody>
                      {d.utilization.overAllocated.map((e) => (
                        <tr key={e.employee_id} className="hover:bg-ink-50/60">
                          <td className="td font-medium">{e.full_name}<span className="block text-[11px] text-ink-400">{e.employee_code}</span></td>
                          <td className="td">{e.department}</td>
                          <td className="td text-right tabular-nums">{fmtHours(e.available_hours)}</td>
                          <td className="td text-right tabular-nums">{fmtHours(e.allocated_hours)}</td>
                          <td className="td text-right tabular-nums font-medium text-danger-700">{fmtPct(e.allocation_pct)}</td>
                          <td className="td w-28"><ProgressBar value={e.allocated_hours} max={e.available_hours} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <div className="space-y-4">
              <Card title="Data freshness" bodyClass="p-4">
                <ul className="space-y-2 text-[13px]">
                  <li className="flex justify-between gap-2"><span className="text-ink-600">Last data import</span><span className="font-medium">{relativeTime(d.dataFreshness.last_import_at)}</span></li>
                  <li className="flex justify-between gap-2"><span className="text-ink-600">Latest timesheet date</span><span className="font-medium">{d.dataFreshness.last_timesheet_date || '—'}</span></li>
                  <li className="flex justify-between gap-2"><span className="text-ink-600">Insights generated</span><span className="font-medium">{relativeTime(d.dataFreshness.last_insight_at)}</span></li>
                  <li className="flex justify-between gap-2"><span className="text-ink-600">Timesheet coverage</span><span className="font-medium">{fmtPct(util.timesheet_coverage_pct)}</span></li>
                </ul>
                <Link to="/metrics" className="link text-xs mt-3 inline-block">See how each metric is calculated</Link>
              </Card>

              <InfoNote tone="brand" title="Reading these numbers">
                <p className="mb-1"><strong>Allocation</strong> is the plan. <strong>Utilization</strong> is what was actually recorded. They are never combined.</p>
                <p>Unallocated capacity is measured per person, so a team can show spare capacity and a high allocation percentage at the same time.</p>
              </InfoNote>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
