import React from 'react';
import { fmtNumber, fmtPct } from '../lib/format';

export function Card({ title, subtitle, actions, children, className = '', bodyClass = 'card-pad' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-ink-100">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-semibold text-ink-900">{title}</h3>}
            {subtitle && <p className="text-xs text-ink-500 mt-0.5">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0 no-print">{actions}</div>}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function Kpi({ label, value, sub, tone = 'neutral', info, footer }) {
  const tones = {
    neutral: 'text-ink-900',
    positive: 'text-positive-700',
    caution: 'text-caution-700',
    danger: 'text-danger-700',
    brand: 'text-brand-700',
  };
  return (
    <div className="card card-pad">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-medium text-ink-500">{label}</p>
        {info && (
          <span
            title={info}
            aria-label={info}
            className="shrink-0 w-4 h-4 rounded-full bg-ink-100 text-ink-500 text-[10px] font-bold grid place-items-center cursor-help"
          >
            i
          </span>
        )}
      </div>
      <p className={`kpi-value mt-1.5 ${tones[tone]}`}>{value}</p>
      {sub && <p className="text-xs text-ink-500 mt-1">{sub}</p>}
      {footer}
    </div>
  );
}

export function Badge({ children, tone = 'neutral', title }) {
  const map = { neutral: 'badge-neutral', brand: 'badge-brand', green: 'badge-green', amber: 'badge-amber', red: 'badge-red' };
  return <span className={map[tone] || 'badge-neutral'} title={title}>{children}</span>;
}

export function SeverityBadge({ severity }) {
  const tone = { critical: 'red', high: 'red', medium: 'amber', low: 'brand', info: 'neutral' }[severity] || 'neutral';
  return <Badge tone={tone}>{severity}</Badge>;
}

export function ConfidenceBadge({ confidence }) {
  const map = {
    high: { tone: 'green', text: 'high confidence' },
    medium: { tone: 'amber', text: 'medium confidence' },
    low: { tone: 'amber', text: 'low confidence' },
    insufficient_data: { tone: 'red', text: 'insufficient data' },
  };
  const c = map[confidence] || map.medium;
  return <Badge tone={c.tone}>{c.text}</Badge>;
}

export function StatusDot({ status }) {
  const color = {
    green: 'bg-positive-500', amber: 'bg-caution-500', red: 'bg-danger-500', active: 'bg-positive-500',
    planned: 'bg-ink-400', completed: 'bg-brand-500', on_hold: 'bg-caution-500', cancelled: 'bg-ink-300',
    exited: 'bg-ink-300', notice: 'bg-caution-500', on_leave: 'bg-brand-400',
  }[status] || 'bg-ink-300';
  return <span className={`inline-block w-2 h-2 rounded-full ${color}`} aria-hidden />;
}

export function ProgressBar({ value, max = 100, tone, label }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const over = value > max;
  const color = tone || (over ? 'bg-danger-500' : pct > 85 ? 'bg-positive-500' : pct > 60 ? 'bg-caution-500' : 'bg-ink-400');
  return (
    <div>
      <div className="h-1.5 w-full rounded-full bg-ink-100 overflow-hidden" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemax={max} aria-label={label || 'progress'}>
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function EmptyState({ title, description, action, icon }) {
  return (
    <div className="text-center py-10 px-4">
      {icon && <div className="mx-auto mb-3 text-ink-300">{icon}</div>}
      <p className="text-sm font-semibold text-ink-800">{title}</p>
      {description && <p className="text-sm text-ink-500 mt-1 max-w-md mx-auto">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Loading({ label = 'Loading…', rows = 3 }) {
  return (
    <div className="animate-pulse space-y-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 bg-ink-100 rounded-lg" />
      ))}
    </div>
  );
}

export function ErrorState({ message, onRetry, code }) {
  return (
    <div className="rounded-lg border border-danger-500/30 bg-danger-50 p-4" role="alert">
      <p className="text-sm font-medium text-danger-700">{message || 'Something went wrong.'}</p>
      {code && <p className="text-xs text-danger-700/70 mt-1 font-mono">{code}</p>}
      {onRetry && <button type="button" onClick={onRetry} className="btn-secondary btn-sm mt-3">Try again</button>}
    </div>
  );
}

export function PageHeader({ title, description, actions, meta }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-5">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-ink-900 tracking-tight">{title}</h1>
        {description && <p className="text-sm text-ink-500 mt-1 max-w-3xl">{description}</p>}
        {meta && <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-500">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0 no-print">{actions}</div>}
    </div>
  );
}

export function InfoNote({ children, tone = 'neutral', title }) {
  const tones = {
    neutral: 'bg-ink-50 border-ink-200 text-ink-700',
    brand: 'bg-brand-50 border-brand-200 text-brand-900',
    caution: 'bg-caution-50 border-caution-500/30 text-caution-700',
    danger: 'bg-danger-50 border-danger-500/30 text-danger-700',
    positive: 'bg-positive-50 border-positive-500/30 text-positive-700',
  };
  return (
    <div className={`rounded-lg border px-3.5 py-3 text-[13px] leading-relaxed ${tones[tone]}`}>
      {title && <p className="font-semibold mb-1">{title}</p>}
      {children}
    </div>
  );
}

export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-xl bg-ink-100/70 p-1 mb-4 no-print" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={`tab ${active === t.id ? 'tab-active' : ''}`}
        >
          {t.label}
          {t.count != null && <span className="ml-1.5 text-xs text-ink-400">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function DefinitionTip({ text }) {
  return (
    <span
      title={text}
      tabIndex={0}
      aria-label={text}
      className="inline-grid place-items-center w-4 h-4 rounded-full border border-ink-300 text-[10px] font-bold text-ink-500 cursor-help hover:bg-ink-100"
    >
      i
    </span>
  );
}

export function formatCell(value, type) {
  if (value == null || value === '') return '—';
  if (type === 'pct') return fmtPct(value);
  if (type === 'num') return fmtNumber(value, 1);
  return String(value);
}
