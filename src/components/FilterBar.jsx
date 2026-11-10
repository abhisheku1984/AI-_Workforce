import React from 'react';
import { monthOptions, quarterOptions, currentMonth } from '../lib/format';

/**
 * Shared period + dimension filter bar. All pages use the same control so users
 * learn it once and comparisons stay consistent.
 */
export function FilterBar({ value, onChange, structure, show, extra }) {
  const { periodType = 'month', month = currentMonth(), quarter, year, from, to, business_unit_id = '', department_id = '', location_id = '' } = value;

  const set = (patch) => onChange({ ...value, ...patch });
  const qs = quarterOptions(8);
  const currentQuarter = qs[0];

  return (
    <div className="card px-4 py-3 mb-5 no-print">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="period-type">Period</label>
          <select id="period-type" className="input w-auto" value={periodType}
            onChange={(e) => {
              const t = e.target.value;
              if (t === 'quarter') set({ periodType: t, quarter: currentQuarter.quarter, year: currentQuarter.year });
              else set({ periodType: t });
            }}>
            <option value="month">Month</option>
            <option value="quarter">Quarter</option>
            <option value="custom">Custom range</option>
          </select>
        </div>

        {periodType === 'month' && (
          <div>
            <label className="label" htmlFor="period-month">Month</label>
            <select id="period-month" className="input w-auto" value={month} onChange={(e) => set({ month: e.target.value })}>
              {monthOptions(18).map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
        )}

        {periodType === 'quarter' && (
          <div>
            <label className="label" htmlFor="period-quarter">Quarter</label>
            <select id="period-quarter" className="input w-auto" value={`${year}-Q${quarter}`}
              onChange={(e) => { const [y, q] = e.target.value.split('-Q'); set({ year: Number(y), quarter: Number(q) }); }}>
              {qs.map((q) => <option key={q.value} value={q.value}>{q.label}</option>)}
            </select>
          </div>
        )}

        {periodType === 'custom' && (
          <>
            <div>
              <label className="label" htmlFor="period-from">From</label>
              <input id="period-from" type="date" className="input w-auto" value={from || ''} onChange={(e) => set({ from: e.target.value })} />
            </div>
            <div>
              <label className="label" htmlFor="period-to">To</label>
              <input id="period-to" type="date" className="input w-auto" value={to || ''} onChange={(e) => set({ to: e.target.value })} />
            </div>
          </>
        )}

        {show?.includes('businessUnit') && (
          <div>
            <label className="label" htmlFor="f-bu">Business unit</label>
            <select id="f-bu" className="input w-auto max-w-[220px]" value={business_unit_id} onChange={(e) => set({ business_unit_id: e.target.value })}>
              <option value="">All business units</option>
              {(structure?.business_units || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}

        {show?.includes('department') && (
          <div>
            <label className="label" htmlFor="f-dept">Department</label>
            <select id="f-dept" className="input w-auto max-w-[220px]" value={department_id} onChange={(e) => set({ department_id: e.target.value })}>
              <option value="">All departments</option>
              {(structure?.departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        )}

        {show?.includes('location') && (
          <div>
            <label className="label" htmlFor="f-loc">Location</label>
            <select id="f-loc" className="input w-auto max-w-[220px]" value={location_id} onChange={(e) => set({ location_id: e.target.value })}>
              <option value="">All locations</option>
              {(structure?.locations || []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </div>
        )}

        {extra}
      </div>
    </div>
  );
}

/** Converts the UI filter state to API query parameters. */
export function toPeriodParams(value) {
  if (value.periodType === 'custom') return { from: value.from, to: value.to };
  if (value.periodType === 'quarter') return { quarter: value.quarter, year: value.year };
  return { month: value.month };
}

export function toFilterParams(value) {
  const out = {};
  for (const k of ['business_unit_id', 'department_id', 'location_id']) {
    if (value[k]) out[k] = value[k];
  }
  return out;
}

export function periodLabel(value) {
  if (value.periodType === 'custom') return value.from && value.to ? `${value.from} to ${value.to}` : 'Custom range (incomplete)';
  if (value.periodType === 'quarter') return `Q${value.quarter} ${value.year}`;
  return value.month;
}
