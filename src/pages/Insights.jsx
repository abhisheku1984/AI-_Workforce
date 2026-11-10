import React, { useState } from 'react';
import { useApi, useAuth } from '../lib/auth';
import { PageHeader, Card, Badge, Loading, ErrorState, InfoNote, SeverityBadge, Tabs, EmptyState } from '../components/ui';
import { fmtMoney, fmtPct, fmtNumber, fmtDateTime, fmtMonth } from '../lib/format';
import { api } from '../lib/api';

export default function InsightsPage() {
  const { can, org } = useAuth();
  const [status, setStatus] = useState('open');
  const [category, setCategory] = useState('');
  const [selected, setSelected] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  const q = new URLSearchParams();
  if (status) q.set('status', status);
  if (category) q.set('category', category);
  const list = useApi(`/api/ai/insights?${q.toString()}`, { deps: [status, category] });

  async function generate() {
    setGenerating(true); setMessage(null); setError(null);
    try {
      const res = await api.post('/api/ai/insights/generate', {});
      setMessage(`Generated ${res.data.generated} insight(s) for ${fmtMonth(res.data.period.start.slice(0, 7))}.`);
      list.reload();
    } catch (e) { setError(e.message); } finally { setGenerating(false); }
  }

  const items = list.data || [];

  return (
    <div>
      <PageHeader
        title="AI insights & recommendations"
        description="Findings produced from your own data by the rules and analytics engine. Each one shows what was identified, the supporting evidence, the business explanation, assumptions, limitations and the suggested next step. Nothing is actioned automatically."
        actions={<button type="button" className="btn-primary btn-sm" onClick={generate} disabled={generating}>{generating ? 'Analysing…' : 'Regenerate insights'}</button>}
      />

      {message && <div className="mb-3"><InfoNote tone="positive">{message}</InfoNote></div>}
      {error && <div className="mb-3"><ErrorState message={error} /></div>}

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="label" htmlFor="i-status">Status</label>
          <select id="i-status" className="input w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setSelected(null); }}>
            <option value="open">Open</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="actioned">Actioned</option>
            <option value="dismissed">Dismissed</option>
            <option value="">All</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="i-cat">Category</label>
          <select id="i-cat" className="input w-auto" value={category} onChange={(e) => { setCategory(e.target.value); setSelected(null); }}>
            <option value="">All categories</option>
            <option value="capacity">Capacity</option>
            <option value="allocation">Allocation</option>
            <option value="demand">Demand</option>
            <option value="cost">Cost</option>
            <option value="data_quality">Data quality</option>
          </select>
        </div>
        <p className="text-xs text-ink-500 pb-2">{items.length} insight{items.length === 1 ? '' : 's'}</p>
      </div>

      {list.loading ? <Loading rows={4} /> : list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : items.length === 0 ? (
        <Card><EmptyState title="No insights in this view" description="Regenerate insights after a data refresh, or change the filters." /></Card>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
          <div className="xl:col-span-2 space-y-2">
            {items.map((i) => (
              <button
                key={i.id}
                type="button"
                onClick={() => setSelected(i)}
                className={`w-full text-left card p-4 transition-colors ${selected?.id === i.id ? 'ring-2 ring-brand-500' : 'hover:border-brand-300'}`}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <SeverityBadge severity={i.severity} />
                  <Badge tone="neutral">{i.category.replace('_', ' ')}</Badge>
                  {i.status !== 'open' && <Badge tone="green">{i.status}</Badge>}
                  {i.requires_approval && <Badge tone="amber">needs approval</Badge>}
                </div>
                <p className="text-sm font-semibold text-ink-900">{i.title}</p>
                <p className="text-[12px] text-ink-500 mt-1 line-clamp-2">{i.finding}</p>
                <p className="text-[11px] text-ink-400 mt-2">{fmtDateTime(i.generated_at)} · {fmtMonth((i.period_start || '').slice(0, 7))}</p>
              </button>
            ))}
          </div>
          <div className="xl:col-span-3">
            {selected ? <InsightDetail insight={items.find((x) => x.id === selected.id) || selected} onReviewed={() => { list.reload(); setSelected(null); }} currency={org?.currency} canReview={can('ai.insights')} /> : (
              <Card><EmptyState title="Select an insight" description="Choose an item on the left to see its full evidence, assumptions and suggested next step." /></Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function InsightDetail({ insight, onReviewed, currency, canReview }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [showRaw, setShowRaw] = useState(false);
  const reviews = useApi(`/api/ai/insights/${insight.id}/reviews`);

  async function decide(decision) {
    setBusy(true); setError(null);
    try {
      await api.post(`/api/ai/insights/${insight.id}/review`, { decision, note: note || undefined });
      onReviewed();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const ev = insight.evidence || {};

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <SeverityBadge severity={insight.severity} />
          <Badge tone="neutral">{insight.code}</Badge>
          <Badge tone={insight.status === 'open' ? 'brand' : 'green'}>{insight.status}</Badge>
        </div>
        <h2 className="text-base font-semibold text-ink-900">{insight.title}</h2>
        <p className="text-sm text-ink-700 mt-2">{insight.finding}</p>

        <Section title="Why this matters">{insight.explanation}</Section>

        <Section title="Supporting evidence">
          <dl className="text-[13px] space-y-1.5">
            {ev.metric && <div className="flex gap-2"><dt className="text-ink-500 min-w-[150px]">Measure</dt><dd className="font-medium">{ev.metric.replace(/_/g, ' ')}: {fmtNumber(ev.value, 1)} {ev.unit || ''}</dd></div>}
            {ev.period && <div className="flex gap-2"><dt className="text-ink-500 min-w-[150px]">Period</dt><dd>{ev.period.label} ({ev.period.start} to {ev.period.end})</dd></div>}
            {ev.source && <div className="flex gap-2"><dt className="text-ink-500 min-w-[150px]">Source</dt><dd>{ev.source}</dd></div>}
            {ev.filters && Object.keys(ev.filters).length > 0 && <div className="flex gap-2"><dt className="text-ink-500 min-w-[150px]">Filters</dt><dd>{JSON.stringify(ev.filters)}</dd></div>}
          </dl>
          <button type="button" className="link text-xs mt-2" onClick={() => setShowRaw((v) => !v)}>{showRaw ? 'Hide raw evidence' : 'Show raw evidence (JSON)'}</button>
          {showRaw && <pre className="mt-2 text-[11px] bg-ink-50 border border-ink-200 rounded-lg p-3 overflow-x-auto">{JSON.stringify(ev, null, 2)}</pre>}
        </Section>

        {insight.impact && (
          <Section title="Estimated impact">
            <p className="text-[13px] text-ink-700">
              <strong>{fmtMoney(insight.impact.value, insight.impact.unit || currency)}</strong> — {insight.impact.type.replace(/_/g, ' ')}
            </p>
            <p className="text-[12px] text-ink-500 mt-1">{insight.impact.basis}</p>
          </Section>
        )}

        {insight.assumptions?.length > 0 && <Section title="Assumptions">{<ul className="list-disc pl-4 text-[13px] space-y-1">{insight.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>}</Section>}
        {insight.limitations?.length > 0 && <Section title="Limitations"><ul className="list-disc pl-4 text-[13px] space-y-1">{insight.limitations.map((a) => <li key={a}>{a}</li>)}</ul></Section>}
        {insight.risks?.length > 0 && <Section title="Risks"><ul className="list-disc pl-4 text-[13px] space-y-1">{insight.risks.map((a) => <li key={a}>{a}</li>)}</ul></Section>}

        {insight.next_step && (
          <div className="mt-4 rounded-lg bg-brand-50 border border-brand-200 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">Suggested next step</p>
            <p className="text-[13px] text-brand-900 mt-1">{insight.next_step}</p>
          </div>
        )}

        {insight.requires_approval && (
          <div className="mt-3"><InfoNote tone="caution">This recommendation affects people&apos;s work. Any change needs approval from the responsible manager; the platform will not act on it automatically.</InfoNote></div>
        )}
      </Card>

      {canReview && insight.status === 'open' && (
        <Card title="Record your decision" subtitle="Decisions are logged with your name and the time.">
          {error && <div className="mb-2"><ErrorState message={error} /></div>}
          <label className="label" htmlFor="review-note">Note (optional)</label>
          <textarea id="review-note" className="input min-h-[70px]" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was decided and why…" />
          <div className="flex flex-wrap gap-2 mt-3">
            <button type="button" className="btn-primary btn-sm" onClick={() => decide('actioned')} disabled={busy}>Mark actioned</button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => decide('acknowledged')} disabled={busy}>Acknowledge</button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => decide('dismissed')} disabled={busy}>Dismiss</button>
          </div>
        </Card>
      )}

      {reviews.data?.length > 0 && (
        <Card title="Review history" bodyClass="p-4">
          <ol className="space-y-2 text-[13px]">
            {reviews.data.map((r) => (
              <li key={r.id} className="border-l-2 border-ink-200 pl-3">
                <p className="font-medium capitalize">{r.decision} by {r.reviewer || 'unknown'}</p>
                <p className="text-[11px] text-ink-500">{fmtDateTime(r.created_at)}</p>
                {r.note && <p className="text-ink-600 mt-0.5">{r.note}</p>}
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mt-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-ink-400 mb-1.5">{title}</h3>
      <div className="text-[13px] text-ink-700">{children}</div>
    </div>
  );
}
