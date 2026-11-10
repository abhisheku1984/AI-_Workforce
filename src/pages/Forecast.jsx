import React, { useState } from 'react';
import { useApi, useAuth } from '../lib/auth';
import { PageHeader, Card, Badge, Loading, ErrorState, InfoNote, Kpi, EmptyState } from '../components/ui';
import { ForecastChart } from '../components/charts';
import { DataTable } from '../components/DataTable';
import { fmtPct, fmtNumber, fmtMonth, fmtDateTime, fmtMoney } from '../lib/format';
import { api } from '../lib/api';

export default function ForecastPage() {
  const { org } = useAuth();
  const [kind, setKind] = useState('utilization');
  const [horizon, setHorizon] = useState(3);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const history = useApi('/api/ai/forecast/history');

  async function generate() {
    setBusy(true); setError(null);
    try {
      const res = await api.post('/api/ai/forecast', { kind, horizonMonths: Number(horizon) });
      setResult(res.data);
      history.reload();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div>
      <PageHeader
        title="Forecasting"
        description="Trend-based estimates for the next few months. Forecasts are only produced when enough history exists, and they are always shown separately from actual results with their method and limitations."
      />

      <Card className="mb-4" bodyClass="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="f-kind">Forecast</label>
            <select id="f-kind" className="input w-auto" value={kind} onChange={(e) => { setKind(e.target.value); setResult(null); }}>
              <option value="utilization">Utilization</option>
              <option value="cost">Workforce cost</option>
            </select>
          </div>
          <div>
            <label className="label" htmlFor="f-horizon">Horizon</label>
            <select id="f-horizon" className="input w-auto" value={horizon} onChange={(e) => setHorizon(e.target.value)}>
              {[1, 2, 3, 6, 9, 12].map((n) => <option key={n} value={n}>{n} month{n > 1 ? 's' : ''}</option>)}
            </select>
          </div>
          <button type="button" className="btn-primary" onClick={generate} disabled={busy}>{busy ? 'Modelling…' : 'Generate forecast'}</button>
        </div>
        <p className="hint mt-2">Method: ordinary least squares trend on monthly history (minimum 4 months). No seasonality or demand-driver modelling. Results are capped to a plausible range.</p>
      </Card>

      {error && <div className="mb-4"><ErrorState message={error} /></div>}
      {busy && <Loading rows={3} label="Building forecast…" />}

      {result?.refused && (
        <Card>
          <div className="p-5">
            <div className="flex items-center gap-2 mb-2"><Badge tone="amber">forecast not produced</Badge></div>
            <h3 className="text-sm font-semibold text-ink-900">There is not enough history to forecast reliably</h3>
            <p className="text-sm text-ink-600 mt-1">{result.reason}</p>
            <div className="grid sm:grid-cols-2 gap-3 mt-3">
              <div className="rounded-lg border border-ink-200 p-3"><p className="text-[11px] uppercase tracking-wide text-ink-400">Required</p><p className="text-sm font-medium">{result.missing?.required}</p></div>
              <div className="rounded-lg border border-ink-200 p-3"><p className="text-[11px] uppercase tracking-wide text-ink-400">Available</p><p className="text-sm font-medium">{result.missing?.have}</p></div>
            </div>
            {result.actuals?.length > 0 && (
              <div className="mt-4">
                <h4 className="text-[13px] font-semibold mb-2">Actual history (no forecast)</h4>
                <DataTable
                  columns={[
                    { key: 'month', label: 'Month', render: (r) => fmtMonth(r.month) },
                    { key: 'headcount', label: 'Headcount', align: 'right' },
                    { key: 'allocation_pct', label: 'Allocation %', align: 'right', render: (r) => fmtPct(r.allocation_pct) },
                    { key: 'utilization_pct', label: 'Utilization %', align: 'right', render: (r) => (r.utilization_pct == null ? 'not measurable' : fmtPct(r.utilization_pct)) },
                  ]}
                  rows={result.actuals}
                  pageSize={12}
                />
              </div>
            )}
          </div>
        </Card>
      )}

      {result && !result.refused && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <Kpi
              label={`${kind === 'cost' ? 'Cost' : 'Utilization'} forecast (${fmtMonth(result.series[0]?.month)})`}
              value={kind === 'cost'
                ? fmtMoney(result.series[0]?.forecast_cost, org?.currency)
                : fmtPct(result.series[0]?.forecast_utilization_pct)}
              sub="first forecast month"
              tone="caution"
            />
            <Kpi label="Trend quality (R²)" value={result.quality.r2 == null ? '—' : fmtNumber(result.quality.r2, 2)} sub={result.quality.r2 < 0.3 ? 'weak linear trend — direction only' : 'moderate linear fit'} info="How much of the historical variation the linear trend explains. Low values mean the exact number is unreliable." />
            <Kpi label="History used" value={`${result.quality.months_of_history} months`} sub="minimum 4 required" />
          </div>

          <Card title="Actuals and forecast" subtitle="Solid = recorded actuals. Dashed amber = forecast estimate. Shaded band = forecast range." bodyClass="px-2 pt-3 pb-2" className="mb-4">
            {kind === 'cost' ? (
              <DataTable
                columns={[
                  { key: 'month', label: 'Month', render: (r) => fmtMonth(r.month) },
                  { key: 'forecast_cost', label: 'Forecast cost', align: 'right', render: (r) => fmtMoney(r.forecast_cost, org?.currency) },
                  { key: 'lower', label: 'Lower bound', align: 'right', render: (r) => fmtMoney(r.lower, org?.currency) },
                  { key: 'upper', label: 'Upper bound', align: 'right', render: (r) => fmtMoney(r.upper, org?.currency) },
                ]}
                rows={result.series}
                pageSize={12}
              />
            ) : (
              <ForecastChart actuals={result.actuals} forecast={result.series} height={300} />
            )}
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card title="Forecast values" bodyClass="p-0">
              <DataTable
                columns={kind === 'cost' ? [
                  { key: 'month', label: 'Month', render: (r) => fmtMonth(r.month) },
                  { key: 'forecast_cost', label: 'Forecast', align: 'right', render: (r) => fmtMoney(r.forecast_cost, org?.currency) },
                  { key: 'lower', label: 'Range low', align: 'right', render: (r) => fmtMoney(r.lower, org?.currency) },
                  { key: 'upper', label: 'Range high', align: 'right', render: (r) => fmtMoney(r.upper, org?.currency) },
                ] : [
                  { key: 'month', label: 'Month', render: (r) => fmtMonth(r.month) },
                  { key: 'forecast_utilization_pct', label: 'Forecast', align: 'right', render: (r) => fmtPct(r.forecast_utilization_pct) },
                  { key: 'lower_pct', label: 'Range low', align: 'right', render: (r) => fmtPct(r.lower_pct) },
                  { key: 'upper_pct', label: 'Range high', align: 'right', render: (r) => fmtPct(r.upper_pct) },
                ]}
                rows={result.series}
                pageSize={12}
              />
            </Card>
            <Card title="Method and limitations" bodyClass="p-4">
              <p className="text-[13px] text-ink-700"><strong>Method:</strong> {result.method}</p>
              <p className="text-[13px] text-ink-700 mt-1"><strong>Quality note:</strong> {result.quality.method_note}</p>
              <ul className="list-disc pl-4 text-[13px] text-caution-700 mt-3 space-y-1">
                {result.limitations.map((l) => <li key={l}>{l}</li>)}
              </ul>
              <div className="mt-3"><InfoNote>{result.note}</InfoNote></div>
            </Card>
          </div>
        </>
      )}

      {!result && !busy && (
        <Card><EmptyState title="No forecast generated yet" description="Choose a forecast type and horizon above. The platform will refuse to forecast if there is not enough history rather than produce a guess." /></Card>
      )}

      <Card className="mt-4" title="Forecast history" subtitle="Every generated forecast is stored with its inputs and limitations" bodyClass="p-0">
        {history.loading ? <div className="p-4"><Loading rows={2} /></div> : (
          <DataTable
            columns={[
              { key: 'created_at', label: 'Generated', render: (r) => fmtDateTime(r.created_at) },
              { key: 'kind', label: 'Type', render: (r) => <span className="capitalize">{r.kind}</span> },
              { key: 'horizon_months', label: 'Horizon', align: 'right', render: (r) => `${r.horizon_months} mo` },
              { key: 'method', label: 'Method' },
              { key: 'quality', label: 'R²', align: 'right', render: (r) => (r.quality?.r2 == null ? '—' : fmtNumber(r.quality.r2, 2)) },
            ]}
            rows={history.data || []}
            pageSize={8}
            emptyTitle="No forecasts generated"
          />
        )}
      </Card>
    </div>
  );
}
