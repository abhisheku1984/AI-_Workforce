import React from 'react';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, AreaChart, Area, Cell, ReferenceLine,
} from 'recharts';
import { fmtNumber, fmtMonth, fmtPct } from '../lib/format';

const AXIS = { stroke: '#8492a6', fontSize: 11 };
const GRID = { stroke: '#eceef2' };

export function ChartFrame({ children, height = 260 }) {
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
    </div>
  );
}

const tooltipStyle = {
  contentStyle: { borderRadius: 10, border: '1px solid #d5dae2', fontSize: 12, boxShadow: '0 4px 12px rgba(16,24,40,.08)' },
  labelStyle: { fontWeight: 600, color: '#1b2230' },
};

/** Utilization + allocation trend. Actuals only — nulls are gaps, never zero. */
export function UtilizationTrendChart({ data, height = 280 }) {
  const rows = data.map((d) => ({ ...d, monthLabel: fmtMonth(d.month) }));
  return (
    <ChartFrame height={height}>
      <LineChart data={rows} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="monthLabel" {...AXIS} tickLine={false} axisLine={false} />
        <YAxis {...AXIS} tickLine={false} axisLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
        <Tooltip {...tooltipStyle} formatter={(v, n) => [v == null ? 'Not measurable' : `${v}%`, n]} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
        <ReferenceLine y={100} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'Capacity', fontSize: 10, fill: '#ef4444', position: 'insideTopRight' }} />
        <Line type="monotone" dataKey="utilization_pct" name="Utilization (actual work)" stroke="#4f46e5" strokeWidth={2} dot={{ r: 3 }} connectNulls={false} />
        <Line type="monotone" dataKey="allocation_pct" name="Allocation (plan)" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 3" dot={{ r: 3 }} connectNulls={false} />
      </LineChart>
    </ChartFrame>
  );
}

/** Forecast + actuals on one axis, forecast visually distinct. */
export function ForecastChart({ actuals = [], forecast = [], height = 280, valueKey = 'utilization_pct', forecastKey = 'forecast_utilization_pct', upperKey = 'upper_pct', lowerKey = 'lower_pct' }) {
  const merged = [
    ...actuals.filter((a) => a.headcount > 0).map((a) => ({
      monthLabel: fmtMonth(a.month), actual: a[valueKey] ?? null, allocation: a.allocation_pct ?? null,
    })),
    ...forecast.map((f) => ({ monthLabel: fmtMonth(f.month), forecast: f[forecastKey] ?? null, upper: f[upperKey], lower: f[lowerKey], isForecast: true })),
  ];
  return (
    <ChartFrame height={height}>
      <AreaChart data={merged} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
        <defs>
          <linearGradient id="band" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#a5b4fc" stopOpacity={0.5} />
            <stop offset="100%" stopColor="#a5b4fc" stopOpacity={0.08} />
          </linearGradient>
        </defs>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="monthLabel" {...AXIS} tickLine={false} axisLine={false} />
        <YAxis {...AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
        <Tooltip {...tooltipStyle} formatter={(v, n) => [v == null ? '—' : `${Math.round(v * 10) / 10}%`, n]} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
        <Area type="monotone" dataKey="upper" name="Forecast range (upper)" stroke="none" fill="url(#band)" />
        <Area type="monotone" dataKey="lower" name="Forecast range (lower)" stroke="none" fill="#ffffff" fillOpacity={1} />
        <Line type="monotone" dataKey="actual" name="Actual utilization" stroke="#4f46e5" strokeWidth={2} dot={{ r: 3 }} connectNulls />
        <Line type="monotone" dataKey="forecast" name="Forecast (estimate)" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 3 }} connectNulls />
      </AreaChart>
    </ChartFrame>
  );
}

export function DepartmentBarChart({ data, height = 300, dataKey = 'allocated_hours', secondaryKey = 'unallocated_hours' }) {
  const rows = data.map((d) => ({ ...d, label: d.key || 'Unassigned' }));
  return (
    <ChartFrame height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid {...GRID} horizontal={false} />
        <XAxis type="number" {...AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => fmtNumber(v)} />
        <YAxis type="category" dataKey="label" {...AXIS} width={140} tickLine={false} axisLine={false} />
        <Tooltip {...tooltipStyle} formatter={(v) => fmtNumber(v, 1)} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey={dataKey} name="Allocated hours" stackId="a" fill="#6366f1" radius={[0, 0, 0, 0]} />
        <Bar dataKey={secondaryKey} name="Unallocated hours" stackId="a" fill="#c7d2fe" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ChartFrame>
  );
}

export function UtilizationByGroupChart({ data, height = 280 }) {
  const rows = data.map((d) => ({ ...d, label: d.key || 'Unassigned' }));
  return (
    <ChartFrame height={height}>
      <BarChart data={rows} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="label" {...AXIS} tickLine={false} axisLine={false} interval={0} angle={rows.length > 5 ? -18 : 0} textAnchor={rows.length > 5 ? 'end' : 'middle'} height={rows.length > 5 ? 58 : 30} />
        <YAxis {...AXIS} tickLine={false} axisLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
        <Tooltip {...tooltipStyle} formatter={(v) => (v == null ? 'Not measurable' : `${v}%`)} />
        <ReferenceLine y={75} stroke="#10b981" strokeDasharray="4 4" label={{ value: 'Target 75%', fontSize: 10, fill: '#059669', position: 'insideTopLeft' }} />
        <Bar dataKey="utilization_pct" name="Utilization" radius={[4, 4, 0, 0]} maxBarSize={44}>
          {rows.map((row, i) => (
            <Cell key={i} fill={row.utilization_pct == null ? '#d5dae2' : row.utilization_pct >= 75 ? '#10b981' : row.utilization_pct >= 60 ? '#f59e0b' : '#ef4444'} />
          ))}
        </Bar>
        <Bar dataKey="allocation_pct" name="Allocation (plan)" fill="#c7d2fe" radius={[4, 4, 0, 0]} maxBarSize={44} />
      </BarChart>
    </ChartFrame>
  );
}

export function MiniSparkline({ data, dataKey = 'utilization_pct' }) {
  return (
    <ChartFrame height={44}>
      <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <Area type="monotone" dataKey={dataKey} stroke="#6366f1" fill="#e0e7ff" strokeWidth={1.5} connectNulls />
      </AreaChart>
    </ChartFrame>
  );
}

export function CostBreakdownChart({ data, currency = 'INR', height = 280 }) {
  const rows = data.map((d) => ({ ...d, label: d.name || d.key || 'Unassigned' }));
  return (
    <ChartFrame height={height}>
      <BarChart data={rows} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
        <CartesianGrid {...GRID} vertical={false} />
        <XAxis dataKey="label" {...AXIS} tickLine={false} axisLine={false} interval={0} angle={rows.length > 4 ? -18 : 0} textAnchor={rows.length > 4 ? 'end' : 'middle'} height={rows.length > 4 ? 60 : 30} />
        <YAxis {...AXIS} tickLine={false} axisLine={false} tickFormatter={(v) => `${(v / 100000).toFixed(0)}L`} />
        <Tooltip {...tooltipStyle} formatter={(v) => `₹${fmtNumber(v)}`} />
        <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="period_cost" name="Workforce cost" stackId="c" fill="#4f46e5" radius={[0, 0, 0, 0]} maxBarSize={44} />
        <Bar dataKey="idle_cost" name="Cost of unallocated time" stackId="c" fill="#fbbf24" radius={[4, 4, 0, 0]} maxBarSize={44} />
      </BarChart>
    </ChartFrame>
  );
}

export { fmtPct };
