/**
 * Record-keeping the assistant can perform, with a confirmation step.
 *
 * The flow is stage → preview → confirm → apply, always. A request that only ever needed one
 * click still goes through the preview, because the dangerous case is the one where the user
 * (or the microphone) was wrong about which record they meant.
 */
import React, { useState } from 'react';
import { api } from '../lib/api';
import { Badge, ErrorState } from './ui';
import { AssistantAvatar } from './AssistantAvatar';

const FIELDS = {
  add_allocation: [
    { key: 'employee', label: 'Person', placeholder: 'name or employee code', required: true },
    { key: 'project', label: 'Project', placeholder: 'project name', required: true },
    { key: 'startDate', label: 'From', placeholder: '2026-11-01', required: true },
    { key: 'endDate', label: 'To', placeholder: '2026-12-31', required: true },
    { key: 'hoursPerWeek', label: 'Hours / week', placeholder: '40', required: true },
  ],
  remove_allocation: [
    { key: 'employee', label: 'Person', placeholder: 'name or employee code', required: true },
    { key: 'project', label: 'Project (optional)', placeholder: 'leave blank to see all', required: false },
  ],
  add_employee: [
    { key: 'fullName', label: 'Full name', placeholder: 'Priya Sharma', required: true },
    { key: 'employeeCode', label: 'Employee code', placeholder: 'NX-1042', required: true },
    { key: 'email', label: 'Email', placeholder: 'priya@example.com', required: false },
    { key: 'department', label: 'Department', placeholder: 'Application Development', required: false },
    { key: 'designation', label: 'Designation', placeholder: 'Senior Engineer', required: false },
  ],
  update_employee: [
    { key: 'employee', label: 'Person', placeholder: 'name or employee code', required: true },
    { key: 'department', label: 'New department', placeholder: 'leave blank to keep', required: false },
    { key: 'designation', label: 'New designation', placeholder: 'leave blank to keep', required: false },
    { key: 'email', label: 'New email', placeholder: 'leave blank to keep', required: false },
  ],
  deactivate_employee: [
    { key: 'employee', label: 'Person', placeholder: 'name or employee code', required: true },
  ],
};

const ACTION_LABEL = {
  add_allocation: 'Add an allocation',
  remove_allocation: 'Remove an allocation',
  add_employee: 'Add a person',
  update_employee: 'Update a person',
  deactivate_employee: 'Mark a person as exited',
};

export function AssistantActions({ actions = [], voice, onApplied }) {
  const available = actions.filter((a) => a && a.name);
  const [action, setAction] = useState('add_allocation');
  const [values, setValues] = useState({});
  const [stage, setStage] = useState(null);   // { ok, preview | message, code }
  const [applied, setApplied] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const fields = FIELDS[action] || [];
  const set = (key, value) => setValues((v) => ({ ...v, [key]: value }));

  function chooseAction(name) {
    setAction(name);
    setValues({});
    setStage(null);
    setApplied(null);
    setError(null);
  }

  async function runStage(e) {
    e?.preventDefault?.();
    setError(null);
    setApplied(null);
    setBusy(true);
    try {
      const body = { action, via: voice?.lastInputWasVoice ? 'voice' : 'text', ...values };
      const res = await api.post('/api/ai/assistant/actions/stage', body);
      setStage(res.data);
      if (res.data.ok && voice?.availability?.output && voice.speakAnswers) {
        voice.speak(`Ready to confirm. ${res.data.preview.summary}`);
      } else if (!res.data.ok && voice?.speakAnswers) {
        voice.speak(res.data.message);
      }
    } catch (e2) { setError(e2.message); } finally { setBusy(false); }
  }

  async function confirm() {
    if (!stage?.ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.post('/api/ai/assistant/actions/apply', {
        action: stage.preview.action,
        payload: stage.preview.payload,
        via: voice?.lastInputWasVoice ? 'voice' : 'text',
      });
      setApplied(res.data);
      setStage(null);
      setValues({});
      if (voice?.availability?.output && voice.speakAnswers) voice.speak(res.data.message);
      onApplied?.(res.data);
    } catch (e2) { setError(e2.message); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 flex-wrap">
        {available.map((a) => (
          <button
            key={a.name}
            type="button"
            onClick={() => chooseAction(a.name)}
            className={`text-[11px] rounded-full border px-2.5 py-1 ${action === a.name
              ? 'border-brand-600 bg-brand-600 text-white'
              : 'border-ink-200 text-ink-600 hover:border-brand-400'}`}
          >
            {ACTION_LABEL[a.name] || a.label}
          </button>
        ))}
      </div>

      <form onSubmit={runStage} className="space-y-2">
        {fields.map((f) => (
          <label key={f.key} className="block">
            <span className="block text-[11px] font-medium text-ink-600 mb-0.5">
              {f.label}{f.required && <span className="text-danger-600"> *</span>}
            </span>
            <input
              className="input text-[13px]"
              value={values[f.key] || ''}
              placeholder={f.placeholder}
              onChange={(e) => set(f.key, e.target.value)}
              aria-required={f.required}
            />
          </label>
        ))}
        <button type="submit" className="btn-ghost btn-sm w-full" disabled={busy}>
          {busy ? 'Checking…' : 'Preview change'}
        </button>
      </form>

      {error && <ErrorState message={error} />}

      {stage && !stage.ok && (
        <div className="rounded-lg border border-caution-500/40 bg-caution-50 px-3 py-2 text-[12px] text-caution-800">
          <p className="font-medium">{stage.code === 'FORBIDDEN' ? 'Not permitted' : 'I need more information'}</p>
          <p className="mt-1">{stage.message}</p>
          {stage.candidates?.length > 0 && (
            <ul className="mt-1 list-disc pl-4">
              {stage.candidates.map((c) => (
                <li key={c.id}>{c.full_name ? `${c.full_name} (${c.employee_code})` : c.project || c.name}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {stage?.ok && (
        <div className={`rounded-lg border px-3 py-2.5 text-[12px] ${stage.preview.destructive
          ? 'border-danger-500/40 bg-danger-50' : 'border-brand-200 bg-brand-50'}`}>
          <div className="flex items-center gap-2 mb-1">
            <AssistantAvatar state="thinking" size={20} />
            <span className="font-semibold text-ink-800">Confirm this change</span>
            {stage.preview.destructive && <Badge tone="red">cannot be undone</Badge>}
          </div>
          <p className="text-ink-800">{stage.preview.summary}</p>
          <dl className="mt-2 space-y-0.5">
            {stage.preview.details.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <dt className="text-ink-500">{k}</dt>
                <dd className="text-ink-800 text-right">{v}</dd>
              </div>
            ))}
          </dl>
          {stage.preview.warning && (
            <p className="mt-2 text-caution-800 bg-caution-50 rounded px-2 py-1">{stage.preview.warning}</p>
          )}
          <div className="flex gap-2 mt-2.5">
            <button type="button" className={stage.preview.destructive ? 'btn-danger btn-sm' : 'btn-primary btn-sm'} onClick={confirm} disabled={busy}>
              {busy ? 'Applying…' : 'Confirm'}
            </button>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setStage(null)} disabled={busy}>Cancel</button>
          </div>
          <p className="text-[10px] text-ink-400 mt-2">
            Logged to the audit trail with your name, the values before and after, and whether this came in by voice.
          </p>
        </div>
      )}

      {applied && (
        <div className="rounded-lg border border-positive-500/40 bg-positive-50 px-3 py-2 text-[12px] text-positive-700">
          <p className="font-medium">Done</p>
          <p className="mt-0.5 text-ink-700">{applied.message}</p>
        </div>
      )}
    </div>
  );
}
