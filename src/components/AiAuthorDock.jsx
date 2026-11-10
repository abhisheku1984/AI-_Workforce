/**
 * The floating "AI author" button, bottom-right on every page.
 *
 * Two modes, both grounded in the database:
 *   Ask  — put a question in words, get an answer from this organisation's own records.
 *   Draft — pick a topic, then dictate detail by detail; each utterance can start with "and".
 *           The draft goes to an approval queue and does not touch the dataset until a human
 *           approves it.
 *
 * It is a single component rather than a page so that it is available while looking at the
 * data it is being asked about — which is the only time a question occurs to anyone.
 */
import React, { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useVoice } from '../lib/useVoice';
import { AssistantAvatar } from './AssistantAvatar';
import { AssistantActions } from './AssistantActions';

export function AiAuthorDock({ onDataChanged }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('ask');       // ask | draft | change
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const [topics, setTopics] = useState([]);
  const [topic, setTopic] = useState('create_lead');
  const [draft, setDraft] = useState(null);
  const [reply, setReply] = useState('');
  const [utterance, setUtterance] = useState('');
  const endRef = useRef(null);

  const voice = useVoice({
    onTranscript: (text) => {
      if (mode === 'draft' && draft) sendUtterance(text, 'voice');
      else if (mode === 'ask') ask(text, 'voice');
    },
    onError: setError,
  });

  // Topics are loaded once the panel opens, not on page load: no request for a closed panel.
  useEffect(() => {
    if (!open || topics.length) return;
    api.get('/api/crm/meta').then((r) => setTopics(r.data?.topics || [])).catch(() => setTopics([]));
  }, [open, topics.length]);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [open, answer, draft, reply]);

  async function ask(text, via = 'text') {
    const q = String(text || '').trim();
    if (!q || busy) return;
    setBusy(true); setError(null); setAnswer(null);
    try {
      const res = await api.post('/api/ai/assistant/ask', { question: q });
      setAnswer({ question: q, ...res.data });
      setQuestion('');
      if (voice.speakAnswers && voice.availability.output) voice.speak(null, { answer: res.data });
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function startDraft() {
    setBusy(true); setError(null); setDraft(null); setReply('');
    try {
      const res = await api.post('/api/crm/ai/sessions', { topic });
      setDraft(res.data.draft);
      setReply(res.data.reply);
      if (voice.speakAnswers) voice.speak(res.data.reply);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function sendUtterance(text, via = 'text') {
    const t = String(text || utterance).trim();
    if (!t || !draft || busy) return;
    setBusy(true); setError(null);
    try {
      const res = await api.post(`/api/crm/ai/sessions/${draft.id}/utterance`, { text: t, via });
      setDraft(res.data.draft);
      setReply(res.data.reply);
      setUtterance('');
      if (voice.speakAnswers) voice.speak(res.data.reply);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function submitDraft() {
    if (!draft) return;
    setBusy(true); setError(null);
    try {
      const res = await api.post(`/api/crm/ai/sessions/${draft.id}/submit`, {});
      setDraft(res.data);
      setReply('Submitted for approval. Nothing is saved until someone with approval permission confirms it.');
      onDataChanged?.();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const missing = draft?.missing || [];
  const fields = draft ? Object.entries(draft.fields || {}) : [];

  return (
    <>
      {/* The button itself: bottom-right, above everything, never inside the flow. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-brand-600 hover:bg-brand-700 text-white pl-2 pr-4 py-2 shadow-raised no-print"
        aria-expanded={open}
        aria-label={open ? 'Close AI author' : 'Open AI author'}
      >
        <AssistantAvatar state={open ? (voice.listening ? 'listening' : busy ? 'thinking' : 'idle') : 'idle'} size={30} />
        <span className="text-sm font-semibold">{open ? 'Close' : 'AI author'}</span>
      </button>

      {open && (
        <div className="fixed bottom-20 right-5 z-50 w-[min(420px,calc(100vw-2.5rem))] max-h-[70vh] flex flex-col card shadow-raised no-print">
          <div className="flex items-center gap-1 p-2 border-b border-ink-100">
            {[['ask', 'Ask'], ['draft', 'Add a record'], ['change', 'Change a record']].map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setMode(k)}
                className={`text-[12px] rounded-md px-2.5 py-1 ${mode === k ? 'bg-brand-600 text-white' : 'text-ink-600 hover:bg-ink-100'}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {error && (
              <div className="rounded border border-danger-500/40 bg-danger-50 px-2.5 py-2 text-[12px] text-danger-700">
                {error}
                <button type="button" className="link ml-2" onClick={() => setError(null)}>Dismiss</button>
              </div>
            )}

            {mode === 'ask' && (
              <>
                {!answer && (
                  <div className="text-[12px] text-ink-600 space-y-1.5">
                    <p className="font-medium text-ink-800">Ask anything about your database.</p>
                    <p>CRM leads and pipeline, people, projects, allocations, costs, timesheets, approvals, insights and the audit trail. Every figure comes from your organisation&apos;s own records.</p>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {['How many leads are in each stage?', 'What is the pipeline worth?', 'How many people are in scope?', 'What is invoiced this month?'].map((s) => (
                        <button key={s} type="button" onClick={() => ask(s)} className="text-left text-[11px] rounded-full border border-ink-200 px-2.5 py-1 hover:border-brand-400">
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {answer && (
                  <div className="space-y-2">
                    <div className="flex justify-end">
                      <div className="max-w-[90%] rounded-2xl rounded-br-md bg-brand-600 text-white px-3 py-2 text-[12px]">{answer.question}</div>
                    </div>
                    <div className="rounded-2xl rounded-bl-md bg-ink-50 border border-ink-200 px-3 py-2">
                      <p className="text-[12px] text-ink-800 whitespace-pre-line">{answer.answer}</p>
                      {answer.sources?.length > 0 && <p className="text-[10px] text-ink-400 mt-1.5">Sources: {answer.sources.join(' · ')}</p>}
                      <div className="flex items-center gap-3 mt-1.5">
                        {voice.availability.output && (
                          <button type="button" className="link text-[11px]" onClick={() => (voice.speaking ? voice.stopSpeaking() : voice.speak(null, { answer }))}>
                            {voice.speaking ? 'Stop' : 'Read aloud'}
                          </button>
                        )}
                        <span className="text-[10px] text-ink-400">{answer.engine === 'refused' ? 'not answerable' : answer.confidence}</span>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={endRef} />
              </>
            )}

            {mode === 'draft' && (
              <>
                {!draft && (
                  <div className="space-y-2">
                    <p className="text-[12px] text-ink-600">Choose what you are recording. Then say the details one at a time — you can start each one with &ldquo;and&rdquo;.</p>
                    {(topics.length ? topics : [{ name: 'create_lead', label: 'New lead' }]).map((t) => (
                      <button
                        key={t.name}
                        type="button"
                        onClick={() => setTopic(t.name)}
                        className={`w-full text-left text-[12px] rounded-lg border px-2.5 py-1.5 ${topic === t.name ? 'border-brand-600 bg-brand-50 text-brand-900' : 'border-ink-200'}`}
                      >
                        <span className="font-medium">{t.label}</span>
                        {t.required?.length > 0 && <span className="block text-[10px] text-ink-500">Needs: {t.required.join(', ')}</span>}
                      </button>
                    ))}
                    <button type="button" className="btn-primary btn-sm w-full" onClick={startDraft} disabled={busy}>
                      {busy ? 'Starting…' : 'Start'}
                    </button>
                  </div>
                )}

                {draft && (
                  <div className="space-y-2">
                    <div className="rounded-lg bg-ink-50 border border-ink-200 px-2.5 py-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400 mb-1">
                        {draft.topic.replace('_', ' ')} · {draft.status.replace('_', ' ')}
                      </p>
                      {fields.length === 0 && <p className="text-[12px] text-ink-500">Nothing captured yet.</p>}
                      <dl className="space-y-0.5">
                        {fields.map(([k, v]) => (
                          <div key={k} className="flex justify-between gap-2 text-[12px]">
                            <dt className="text-ink-500">{k.replace(/_/g, ' ')}</dt>
                            <dd className="text-ink-800 text-right truncate max-w-[60%]">{String(v)}</dd>
                          </div>
                        ))}
                      </dl>
                      {missing.length > 0 && (
                        <p className="text-[11px] text-caution-700 mt-1.5">Still needed: {missing.map((m) => m.replace(/_/g, ' ')).join(', ')}</p>
                      )}
                    </div>
                    {reply && <p className="text-[12px] text-ink-700">{reply}</p>}
                    {draft.status === 'drafting' && (
                      <>
                        <div className="flex gap-1.5">
                          <input
                            className="input text-[12px]"
                            value={utterance}
                            onChange={(e) => setUtterance(e.target.value)}
                            placeholder={missing.length ? `Add the ${missing[0].replace(/_/g, ' ')}…` : 'Add another detail…'}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendUtterance(); } }}
                          />
                          {voice.availability.input && (
                            <button type="button" className="btn-ghost btn-sm" onClick={voice.toggleListening} aria-pressed={voice.listening} title="Speak">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3ZM6 11a6 6 0 0 0 12 0M12 17v4" /></svg>
                            </button>
                          )}
                        </div>
                        {voice.listening && <p className="text-[11px] text-brand-700">Listening… {voice.interim}</p>}
                        <button type="button" className="btn-primary btn-sm w-full" onClick={submitDraft} disabled={busy || missing.length > 0}>
                          Send for approval
                        </button>
                      </>
                    )}
                    {draft.status === 'pending_approval' && (
                      <p className="text-[12px] text-brand-800 bg-brand-50 border border-brand-200 rounded px-2.5 py-2">
                        Waiting for approval. It will be added to the CRM when someone with approval permission confirms it.
                      </p>
                    )}
                  </div>
                )}
                <div ref={endRef} />
              </>
            )}

            {mode === 'change' && (
              <>
                <p className="text-[12px] text-ink-600">Add or remove allocations and people. Every change is previewed before it is applied.</p>
                <AssistantActions actions={[
                  { name: 'add_allocation', label: 'Add an allocation' },
                  { name: 'remove_allocation', label: 'Remove an allocation' },
                  { name: 'add_employee', label: 'Add a person' },
                  { name: 'update_employee', label: 'Update a person' },
                  { name: 'deactivate_employee', label: 'Mark a person as exited' },
                ]} voice={voice} onApplied={() => onDataChanged?.()} />
              </>
            )}
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); ask(); }}
            className="border-t border-ink-200 p-2 flex gap-1.5"
            style={{ display: mode === 'ask' ? 'flex' : 'none' }}
          >
            <input
              className="input text-[12px]"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about leads, people, cost, projects…"
              aria-label="Your question"
            />
            {voice.availability.input && (
              <button type="button" className="btn-ghost btn-sm" onClick={voice.toggleListening} aria-pressed={voice.listening} title="Ask by voice">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3ZM6 11a6 6 0 0 0 12 0M12 17v4" /></svg>
              </button>
            )}
            <button type="submit" className="btn-primary btn-sm" disabled={busy || !question.trim()}>Ask</button>
          </form>
        </div>
      )}
    </>
  );
}
