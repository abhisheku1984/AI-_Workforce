import React, { useEffect, useRef, useState } from 'react';
import { useApi, useAuth } from '../lib/auth';
import { PageHeader, Card, Loading, ErrorState, InfoNote, ConfidenceBadge, Badge, EmptyState } from '../components/ui';
import { api } from '../lib/api';
import { fmtMonth } from '../lib/format';

export default function AssistantPage() {
  const { can } = useAuth();
  const suggestions = useApi('/api/ai/assistant/suggestions');
  const governance = useApi('/api/ai/governance');
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [conversationId, setConversationId] = useState(null);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, busy]);

  async function ask(text) {
    const q = String(text || question).trim();
    if (!q || busy) return;
    setError(null);
    setQuestion('');
    setMessages((m) => [...m, { role: 'user', content: q }]);
    setBusy(true);
    try {
      const res = await api.post('/api/ai/assistant/ask', { question: q, conversationId });
      setConversationId(res.data.conversationId);
      setMessages((m) => [...m, { role: 'assistant', ...res.data }]);
    } catch (e) {
      setError(e.message);
      setMessages((m) => [...m, { role: 'error', content: e.message }]);
    } finally { setBusy(false); }
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
      <div>
        <PageHeader
          title="AI business assistant"
          description="Ask plain business questions about your own data. Every answer shows the period, filters, evidence, assumptions and limitations it used — and will say plainly when the data is not sufficient."
        />

        <Card bodyClass="p-0">
          <div className="h-[62vh] min-h-[420px] overflow-y-auto p-4 space-y-4" aria-live="polite">
            {messages.length === 0 && (
              <div className="py-6">
                <EmptyState
                  title="What would you like to understand?"
                  description="The assistant only uses data you are authorised to see. It will not guess, and it will tell you when something cannot be measured."
                />
                <div className="max-w-2xl mx-auto grid gap-2 sm:grid-cols-2 mt-2">
                  {(suggestions.data?.suggestions || []).map((s) => (
                    <button key={s} type="button" onClick={() => ask(s)} className="text-left text-[13px] rounded-lg border border-ink-200 px-3 py-2 hover:border-brand-400 hover:bg-brand-50/50">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, idx) => {
              if (m.role === 'user') {
                return (
                  <div key={idx} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 text-white px-4 py-2.5 text-sm">{m.content}</div>
                  </div>
                );
              }
              if (m.role === 'error') {
                return <div key={idx} className="max-w-[85%]"><ErrorState message={m.content} /></div>;
              }
              return <AssistantAnswer key={idx} answer={m} />;
            })}

            {busy && (
              <div className="flex items-center gap-2 text-sm text-ink-500">
                <span className="w-2 h-2 rounded-full bg-brand-500 animate-pulse" /> Analysing your data…
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={(e) => { e.preventDefault(); ask(); }} className="border-t border-ink-200 p-3 flex gap-2">
            <input
              className="input"
              placeholder="Ask about capacity, allocation, staffing gaps, cost or data quality…"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              aria-label="Your question"
              maxLength={500}
            />
            <button type="submit" className="btn-primary" disabled={busy || !question.trim()}>Ask</button>
          </form>
        </Card>

        {error && <div className="mt-3"><ErrorState message={error} /></div>}
      </div>

      <aside className="space-y-4">
        <Card title="How this works" bodyClass="p-4 space-y-2 text-[13px] text-ink-600">
          <p><strong>Grounding.</strong> Answers are computed from {governance.data?.external_provider_configured ? 'your authorised data only, and any external model receives aggregates rather than raw records' : 'your authorised data by a deterministic analytics engine — no external model is called'}.</p>
          <p><strong>Permissions.</strong> Cost and financial questions are refused if your role cannot see that data.</p>
          <p><strong>Safety.</strong> Instructions hidden inside questions or uploaded files are blocked and logged; uploaded content is treated as data, never as commands.</p>
          <p><strong>Evidence.</strong> Each answer lists the figures, the period and the source report used.</p>
        </Card>

        <Card title="Provider" bodyClass="p-4">
          <p className="text-[13px] text-ink-800 font-medium">{governance.data?.provider || 'checking…'}</p>
          <p className="text-[11px] text-ink-500 mt-1">
            {governance.data?.external_provider_configured
              ? 'An external model is configured. Only aggregate, permission-filtered facts are sent; employee names are withheld unless the organisation explicitly allows them.'
              : 'No external AI service is used. No data leaves this deployment.'}
          </p>
          <button type="button" className="link text-xs mt-2" onClick={() => window.open('/api/ai/assistant/fact-preview?question=' + encodeURIComponent('Which departments have the highest unallocated capacity?'), '_blank')}>
            Inspect the exact facts used
          </button>
        </Card>

        {governance.data && (
          <Card title="Recent AI activity" bodyClass="p-4">
            {governance.data.recent_activity?.length ? (
              <ul className="text-[12px] space-y-1">
                {governance.data.recent_activity.slice(0, 8).map((a, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="text-ink-600 truncate">{a.action}</span>
                    <span className="text-ink-400">{a.c}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[13px] text-ink-500">No AI activity recorded yet.</p>}
          </Card>
        )}

        <InfoNote tone="caution" title="Important">
          The assistant is decision support. It does not make employment, hiring, pay or termination decisions, and it will not
          present an estimate as an actual result.
        </InfoNote>
      </aside>
    </div>
  );
}

function AssistantAnswer({ answer }) {
  const [showDetail, setShowDetail] = useState(false);
  if (answer.blocked) {
    return (
      <div className="max-w-[90%]">
        <div className="rounded-2xl rounded-bl-md bg-caution-50 border border-caution-500/30 px-4 py-3 text-sm text-caution-700">
          {answer.answer}
        </div>
      </div>
    );
  }
  return (
    <div className="max-w-[92%]">
      <div className="rounded-2xl rounded-bl-md bg-ink-50 border border-ink-200 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <ConfidenceBadge confidence={answer.confidence} />
          {answer.period && <Badge tone="neutral">{answer.period.label}</Badge>}
          {answer.insufficient && <Badge tone="red">data insufficient</Badge>}
        </div>
        <p className="text-sm text-ink-800 whitespace-pre-line leading-relaxed">{answer.answer}</p>

        {answer.assumptions?.length > 0 && (
          <div className="mt-3 pt-2 border-t border-ink-200">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400 mb-1">Assumptions</p>
            <ul className="list-disc pl-4 text-[12px] text-ink-600 space-y-0.5">
              {answer.assumptions.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          </div>
        )}
        {answer.limitations?.length > 0 && (
          <div className="mt-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400 mb-1">Limitations</p>
            <ul className="list-disc pl-4 text-[12px] text-caution-700 space-y-0.5">
              {answer.limitations.map((a, i) => <li key={i}>{a}</li>)}
            </ul>
          </div>
        )}
        {answer.nextStep && (
          <div className="mt-3 rounded-lg bg-brand-50 border border-brand-200 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700">Suggested next step</p>
            <p className="text-[12px] text-brand-900 mt-0.5">{answer.nextStep}</p>
          </div>
        )}
        {answer.sources?.length > 0 && (
          <p className="text-[11px] text-ink-400 mt-2">Sources: {answer.sources.join(' · ')}</p>
        )}

        {answer.evidence?.length > 0 && (
          <>
            <button type="button" className="link text-xs mt-2" onClick={() => setShowDetail((v) => !v)}>
              {showDetail ? 'Hide evidence' : 'Show evidence'}
            </button>
            {showDetail && (
              <pre className="mt-2 text-[11px] bg-white border border-ink-200 rounded-lg p-3 overflow-x-auto max-h-64">
                {JSON.stringify(answer.evidence, null, 2)}
              </pre>
            )}
          </>
        )}
        {answer.modelNote && <p className="text-[11px] text-caution-700 mt-2">{answer.modelNote}</p>}
        <p className="text-[10px] text-ink-400 mt-2">{answer.latencyMs} ms · {answer.provider}</p>
      </div>
    </div>
  );
}
