import React, { useEffect, useRef, useState } from 'react';
import { useApi, useAuth } from '../lib/auth';
import { PageHeader, Card, Loading, ErrorState, InfoNote, ConfidenceBadge, Badge, EmptyState } from '../components/ui';
import { api } from '../lib/api';
import { fmtMonth } from '../lib/format';
import { useVoice } from '../lib/useVoice';
import { AssistantAvatar, AVATAR_STATE_LABEL } from '../components/AssistantAvatar';
import { AssistantActions } from '../components/AssistantActions';

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
  // The record of what has been asked. Every question is already stored server-side with its
  // answer, evidence and confidence; this surfaces it so a manager can revisit a decision.
  const history = useApi('/api/ai/assistant/conversations');
  const actions = useApi('/api/ai/assistant/actions');

  // Voice: press to speak the question, hear the answer if the user asked for that.
  const voice = useVoice({
    onTranscript: (text) => { ask(text, { spoken: true }); },
    onError: (message) => setError(message),
  });

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, busy]);

  async function ask(text, { spoken = false } = {}) {
    const q = String(text || question).trim();
    if (!q || busy) return;
    setError(null);
    setQuestion('');
    const askedAt = new Date().toISOString();
    setMessages((m) => [...m, { role: 'user', content: q, at: askedAt, spoken }]);
    setBusy(true);
    try {
      const res = await api.post('/api/ai/assistant/ask', { question: q, conversationId });
      setConversationId(res.data.conversationId);
      setMessages((m) => [...m, { role: 'assistant', ...res.data }]);
      history.reload?.();
      // Speak only when the user has asked for spoken answers. Never surprise them.
      if (voice.speakAnswers && voice.availability.output) voice.speak(null, { answer: res.data });
    } catch (e) {
      setError(e.message);
      setMessages((m) => [...m, { role: 'error', content: e.message }]);
    } finally { setBusy(false); }
  }

  async function openConversation(id) {
    try {
      setError(null);
      const res = await api.get(`/api/ai/assistant/conversations/${id}`);
      setConversationId(id);
      setMessages(
        res.data.messages.map((m) => (m.role === 'user'
          ? { role: 'user', content: m.content, at: m.created_at }
          : {
            role: 'assistant',
            answer: m.content,
            intent: m.intent,
            confidence: m.confidence,
            evidence: m.evidence,
            assumptions: m.assumptions,
            limitations: m.limitations,
            sources: [],
            period: null,
            provider: m.provider,
            latencyMs: null,
            at: m.created_at,
          })),
      );
    } catch (e) { setError(e.message); }
  }

  function startNew() {
    setConversationId(null);
    setMessages([]);
    setError(null);
    voice.stopSpeaking();
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
      <div>
        <PageHeader
          title="AI business assistant"
          description="Ask plain business questions about your own data. Every answer shows the period, filters, evidence, assumptions and limitations it used — and will say plainly when the data is not sufficient."
        />

        <VoiceBar voice={voice} busy={busy} avatarState={voice.listening ? 'listening' : voice.speaking ? 'speaking' : busy ? 'thinking' : 'idle'} />

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
                    <div className="max-w-[85%]">
                      <div className="rounded-2xl rounded-br-md bg-brand-600 text-white px-4 py-2.5 text-sm">{m.content}</div>
                      <p className="text-[10px] text-ink-400 text-right mt-0.5">
                        {m.spoken ? 'spoken · ' : ''}
                        {new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                );
              }
              if (m.role === 'error') {
                return <div key={idx} className="max-w-[85%]"><ErrorState message={m.content} /></div>;
              }
              return <AssistantAnswer key={idx} answer={m} voice={voice} />;
            })}

            {busy && (
              <div className="flex items-center gap-2 text-sm text-ink-500">
                <span className="w-2 h-2 rounded-full bg-brand-500 animate-pulse" /> Analysing your data…
              </div>
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={(e) => { e.preventDefault(); ask(); }} className="border-t border-ink-200 p-3">
            {voice.listening && (
              <p className="mb-2 text-[12px] text-brand-700 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-danger-500 animate-pulse" />
                Listening… {voice.interim ? <span className="text-ink-600 italic">“{voice.interim}”</span> : 'speak your question, then pause'}
              </p>
            )}
            <div className="flex gap-2">
              <input
                className="input"
                placeholder={
                  voice.availability.input
                    ? 'Ask about capacity, allocation, staffing gaps, cost or data quality — or press the microphone'
                    : 'Ask about capacity, allocation, staffing gaps, cost or data quality…'
                }
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                aria-label="Your question"
                maxLength={500}
              />
              {voice.availability.input && (
                <button
                  type="button"
                  onClick={voice.toggleListening}
                  className={`btn-ghost shrink-0 ${voice.listening ? 'text-danger-700 border-danger-500' : ''}`}
                  aria-label={voice.listening ? 'Stop listening' : 'Ask by voice'}
                  aria-pressed={voice.listening}
                  title={voice.listening ? 'Stop listening' : 'Ask by voice'}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z" />
                    <path d={voice.listening ? 'M6 11a6 6 0 0 0 12 0M9 20h6' : 'M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6'} />
                  </svg>
                </button>
              )}
              <button type="submit" className="btn-primary" disabled={busy || !question.trim()}>Ask</button>
            </div>
          </form>
        </Card>

        {error && <div className="mt-3"><ErrorState message={error} /></div>}
      </div>

      <aside className="space-y-4">
        <Card
          title="Your recent questions"
          bodyClass="p-2"
          actions={<button type="button" className="link text-xs" onClick={startNew}>New</button>}
        >
          {history.loading && <p className="px-2 py-1 text-[12px] text-ink-400">Loading…</p>}
          {!history.loading && !(history.data?.length) && (
            <p className="px-2 py-1 text-[12px] text-ink-500">Nothing asked yet. Every question you ask is recorded here, with the figures behind the answer.</p>
          )}
          <ul className="text-[12px]">
            {(history.data || []).map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => openConversation(c.id)}
                  className={`w-full text-left rounded-md px-2 py-1.5 hover:bg-ink-100 ${conversationId === c.id ? 'bg-brand-50 text-brand-800' : 'text-ink-700'}`}
                  title={c.title}
                >
                  <span className="block truncate">{c.title}</span>
                  <span className="block text-[10px] text-ink-400">
                    {new Date(c.updated_at).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Keep records by asking" bodyClass="p-4">
          <p className="text-[12px] text-ink-600 mb-3">
            The assistant can add or remove allocations and people. Every change is previewed before it is applied,
            and recorded in the audit trail. Pay and billing fields are never set this way.
          </p>
          <AssistantActions actions={actions.data?.actions || []} voice={voice} onApplied={() => { history.reload?.(); }} />
        </Card>

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

/**
 * Voice controls, stated plainly. If speech is unavailable the reason is shown, with the
 * fix, rather than a disabled button with no explanation.
 */
function VoiceBar({ voice, busy, avatarState = 'idle' }) {
  const { availability, speakAnswers, setSpeakAnswers, speaking, error, clearError,
    voices = [], voiceName, setVoiceName, preferredVoice } = voice;
  const [showVoices, setShowVoices] = useState(false);
  const indian = voices.filter((v) => /^en[-_]IN$/i.test(v.lang));
  const others = voices.filter((v) => !/^en[-_]IN$/i.test(v.lang));
  return (
    <div className="mb-3 rounded-lg border border-ink-200 bg-white px-3 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px]">
      <span className="flex items-center gap-2">
        <AssistantAvatar state={avatarState} size={34} />
        <span>
          <span className="block font-semibold text-ink-800 leading-tight">Ask AI</span>
          <span className="block text-[11px] text-ink-500 leading-tight">
            {AVATAR_STATE_LABEL[avatarState]}
            {preferredVoice && availability.output ? ` · ${preferredVoice.name}` : ''}
          </span>
        </span>
      </span>

      {availability.input ? (
        <span className="text-ink-500">Press the microphone to ask out loud.</span>
      ) : (
        <span className="text-caution-700">
          {availability.reason === 'insecure'
            ? 'Microphone needs a secure page — use https or localhost.'
            : 'This browser has no speech recognition. Chrome and Edge do.'}
        </span>
      )}

      <label className={`flex items-center gap-1.5 ${availability.output ? 'cursor-pointer' : 'opacity-50'}`}>
        <input
          type="checkbox"
          checked={speakAnswers}
          disabled={!availability.output}
          onChange={(e) => setSpeakAnswers(e.target.checked)}
          className="accent-brand-600"
        />
        Read answers aloud
      </label>

      {availability.output && (
        <span className="relative">
          <button type="button" className="link" onClick={() => setShowVoices((v) => !v)} aria-expanded={showVoices}>
            {voiceName ? 'Change voice' : 'Choose voice'}
          </button>
          {showVoices && (
            <div className="absolute left-0 top-6 z-30 w-64 card p-2 shadow-raised">
              <p className="text-[10px] uppercase tracking-wide text-ink-400 px-1 pb-1">
                {indian.length ? 'Indian English voices found' : 'No Indian English voice on this device'}
              </p>
              <button
                type="button"
                className="w-full text-left text-[11px] rounded px-2 py-1 hover:bg-ink-100"
                onClick={() => { setVoiceName(''); setShowVoices(false); }}
              >
                Automatic {preferredVoice ? `(${preferredVoice.name})` : ''}
              </button>
              <div className="max-h-48 overflow-y-auto mt-1">
                {[...indian, ...others].slice(0, 40).map((v) => (
                  <button
                    key={v.name}
                    type="button"
                    className={`w-full text-left text-[11px] rounded px-2 py-1 hover:bg-ink-100 ${voiceName === v.name ? 'bg-brand-50 text-brand-800' : ''}`}
                    onClick={() => { setVoiceName(v.name); setShowVoices(false); voice.speak('This is how I will sound when I read your answers.'); }}
                  >
                    <span className="block truncate">{v.name}</span>
                    <span className="block text-[10px] text-ink-400">{v.lang}{v.localService ? ' · on this device' : ''}</span>
                  </button>
                ))}
              </div>
              {!indian.length && (
                <p className="text-[10px] text-ink-500 px-1 pt-1">
                  Install an Indian English voice in Windows: Settings → Time &amp; language → Speech → Add voices.
                </p>
              )}
            </div>
          )}
        </span>
      )}
      {speaking && (
        <button type="button" className="link" onClick={voice.stopSpeaking}>Stop reading</button>
      )}
      {busy && <span className="text-ink-400">working…</span>}
      {error && (
        <span className="text-danger-700 flex items-center gap-2">
          {error}
          <button type="button" className="link" onClick={clearError}>Dismiss</button>
        </span>
      )}
    </div>
  );
}

function AssistantAnswer({ answer, voice }) {
  const canSpeak = voice?.availability?.output;
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
        <div className="flex items-center gap-3 mt-2">
          {canSpeak && (
            <button
              type="button"
              className="link text-xs inline-flex items-center gap-1"
              onClick={() => (voice.speaking ? voice.stopSpeaking() : voice.speak(null, { answer }))}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                {voice.speaking ? <path d="M22 9l-6 6M16 9l6 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a9 9 0 0 1 0 12" />}
              </svg>
              {voice.speaking ? 'Stop' : 'Read aloud'}
            </button>
          )}
          <span className="text-[10px] text-ink-400">{answer.latencyMs} ms · {answer.provider}</span>
        </div>
      </div>
    </div>
  );
}
