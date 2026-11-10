import React, { useState } from 'react';
import { useApi } from '../lib/auth';
import { PageHeader, Card, Loading, ErrorState, Badge, EmptyState, InfoNote } from '../components/ui';
import { api } from '../lib/api';

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

// Badge supports neutral | brand | green | amber | red only. Inventing a tone name would
// silently render the default, which is exactly the class of bug that broke the sidebar.
const STAGE_TONE = {
  new: 'neutral', contacted: 'brand', qualified: 'brand', proposal: 'amber',
  negotiation: 'amber', won: 'green', lost: 'red', disqualified: 'red',
};

export default function CrmPage({ onDataChanged }) {
  const summary = useApi('/api/crm/summary');
  const leads = useApi('/api/crm/leads');
  const pending = useApi('/api/crm/ai/pending');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(null);

  async function decide(id, decision, note) {
    setBusy(true); setError(null);
    try {
      await api.post(`/api/crm/ai/sessions/${id}/${decision}`, decision === 'reject' ? { note } : {});
      pending.reload?.();
      leads.reload?.();
      summary.reload?.();
      onDataChanged?.();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const s = summary.data;

  return (
    <div className="space-y-4">
      <PageHeader
        title="CRM"
        description="Leads and pipeline. Records can be drafted by the assistant by voice or text, but they only enter the dataset when a human approves them."
      />

      {error && <ErrorState message={error} />}

      {/* Approval queue first: this is the screen that stops bad data entering. */}
      <Card
        title="Waiting for approval"
        subtitle="Drafted by the assistant. Nothing here has been saved to the CRM yet."
        bodyClass="p-4"
      >
        {pending.loading && <Loading rows={2} />}
        {!pending.loading && !(pending.data?.length) && (
          <EmptyState
            title="Nothing waiting"
            description="When someone drafts a record with the AI author button, it appears here for approval."
          />
        )}
        <div className="space-y-2">
          {(pending.data || []).map((p) => (
            <div key={p.id} className="rounded-lg border border-caution-500/40 bg-caution-50/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[13px] font-semibold text-ink-800">
                    {p.topic.replace(/_/g, ' ')} · {p.fields.company || p.fields.fullName || 'untitled'}
                  </p>
                  <p className="text-[11px] text-ink-500">
                    Drafted by {p.requestedBy || 'unknown'} · submitted {new Date(p.submittedAt).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => decide(p.id, 'approve')}>Approve</button>
                  <button type="button" className="btn-ghost btn-sm" disabled={busy} onClick={() => decide(p.id, 'reject', 'Rejected from the approval queue')}>Reject</button>
                  <button type="button" className="link text-xs" onClick={() => setExpanded(expanded === p.id ? null : p.id)}>
                    {expanded === p.id ? 'Hide' : 'Details'}
                  </button>
                </div>
              </div>
              {expanded === p.id && (
                <div className="mt-2 pt-2 border-t border-caution-500/30 text-[12px] space-y-2">
                  <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5">
                    {Object.entries(p.fields).map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-2">
                        <dt className="text-ink-500">{k.replace(/_/g, ' ')}</dt>
                        <dd className="text-ink-800 text-right">{String(v)}</dd>
                      </div>
                    ))}
                  </dl>
                  {p.transcripts?.length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-ink-400 mb-0.5">What was said</p>
                      <ul className="space-y-0.5">
                        {p.transcripts.map((t, i) => (
                          <li key={i} className="text-[11px] text-ink-600">“{t.text}”{t.via === 'voice' ? ' (voice)' : ''}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Pipeline */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          ['Leads', s?.total ?? '—'],
          ['Open', s?.open_count ?? '—'],
          ['Open value', s ? money(s.open_value) : '—'],
          ['Won value', s ? money(s.won_value) : '—'],
        ].map(([label, value]) => (
          <Card key={label} bodyClass="p-4">
            <p className="text-[11px] uppercase tracking-wide text-ink-400">{label}</p>
            <p className="kpi-value">{value}</p>
          </Card>
        ))}
      </div>

      <Card title="Pipeline by stage" bodyClass="p-4">
        {summary.loading && <Loading rows={2} />}
        {s && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(s.by_stage || []).map((r) => (
              <div key={r.stage} className="rounded-lg border border-ink-200 px-3 py-2">
                <p className="text-[11px] text-ink-500 capitalize">{r.stage}</p>
                <p className="text-lg font-semibold text-ink-900">{r.count}</p>
                <p className="text-[11px] text-ink-500">{money(r.value)}</p>
              </div>
            ))}
            {!(s.by_stage || []).length && <p className="text-[13px] text-ink-500">No leads yet.</p>}
          </div>
        )}
      </Card>

      <Card title="Leads" bodyClass="p-0">
        {leads.loading && <div className="p-4"><Loading rows={4} /></div>}
        {!leads.loading && !(leads.data?.length) && (
          <div className="p-4">
            <EmptyState
              title="No leads yet"
              description="Use the AI author button at the bottom right, choose 'Add a record', and dictate the details. It will come back here for approval."
            />
          </div>
        )}
        {leads.data?.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="bg-ink-50 text-ink-500">
                <tr>
                  {['Code', 'Company', 'Contact', 'Stage', 'Value', 'Next step', 'Updated'].map((h) => (
                    <th key={h} className="text-left font-medium px-3 py-2 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leads.data.map((l) => (
                  <tr key={l.id} className="border-t border-ink-100">
                    <td className="px-3 py-2 text-ink-500 whitespace-nowrap">{l.lead_code}</td>
                    <td className="px-3 py-2 font-medium text-ink-800">{l.company}</td>
                    <td className="px-3 py-2">{l.contact_name || '—'}<span className="block text-[10px] text-ink-400">{l.contact_email || ''}</span></td>
                    <td className="px-3 py-2"><Badge tone={STAGE_TONE[l.stage] || 'neutral'}>{l.stage}</Badge></td>
                    <td className="px-3 py-2 whitespace-nowrap">{l.estimated_value ? money(l.estimated_value) : '—'}</td>
                    <td className="px-3 py-2">{l.next_step || '—'}<span className="block text-[10px] text-ink-400">{l.next_step_date || ''}</span></td>
                    <td className="px-3 py-2 text-ink-500 whitespace-nowrap">{new Date(l.updated_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <InfoNote tone="info" title="How approval works">
        The assistant writes a draft, never the dataset. A draft is submitted for approval, and
        approval is the only path that creates or changes a lead. Both the draft and the decision
        are recorded in the audit trail, with who asked, what was said, and what was applied.
      </InfoNote>
    </div>
  );
}
