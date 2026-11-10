import React, { useState } from 'react';
import { useApi, useAuth } from '../lib/auth';
import { PageHeader, Card, Badge, Loading, ErrorState, InfoNote, Tabs, EmptyState } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { fmtDateTime } from '../lib/format';
import { api } from '../lib/api';

export default function GovernancePage() {
  const { can } = useAuth();
  const [tab, setTab] = useState(can('automation.manage') ? 'rules' : 'approvals');

  const tabs = [
    ...(can('automation.manage') ? [{ id: 'rules', label: 'Automation' }, { id: 'runs', label: 'Run history' }] : []),
    ...(can('approval.manage') ? [{ id: 'approvals', label: 'Approvals' }] : []),
    { id: 'policy', label: 'Safety policy' },
  ];

  return (
    <div>
      <PageHeader
        title="Workflow automation & approvals"
        description="Controlled, customer-configured automation. Actions come from a closed list — there is no way to trigger a payment, a hiring decision or an employment change. Sensitive actions wait for a human decision."
      />
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      {tab === 'rules' && <RulesPanel />}
      {tab === 'runs' && <RunsPanel />}
      {tab === 'approvals' && <ApprovalsPanel />}
      {tab === 'policy' && <PolicyPanel />}
    </div>
  );
}

function RulesPanel() {
  const rules = useApi('/api/governance/automation/rules');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  // The form and the list both read rules.data. While the request is in flight, or if it
  // failed, that is null — and reading into it blanked the page.
  if (rules.loading) return <Loading rows={3} />;
  if (!rules.data) return <ErrorState message={rules.error || 'Automation rules are unavailable.'} onRetry={rules.reload} />;
  const [message, setMessage] = useState(null);
  const [form, setForm] = useState({ code: '', name: '', description: '', triggerType: 'manual', actionType: 'generate_report', report_code: 'utilization_summary', audience: 'executive', requiresApproval: true });

  if (rules.loading) return <Loading rows={4} />;
  if (rules.error) return <ErrorState message={rules.error} onRetry={rules.reload} />;

  async function create(e) {
    e.preventDefault();
    setError(null);
    try {
      const actionConfig = form.actionType === 'generate_report' ? { report_code: form.report_code }
        : form.actionType === 'notify' ? { audience: form.audience } : {};
      await api.post('/api/governance/automation/rules', {
        code: form.code, name: form.name, description: form.description, triggerType: form.triggerType,
        actionType: form.actionType, actionConfig, requiresApproval: form.requiresApproval,
      });
      setCreating(false);
      setForm({ ...form, code: '', name: '', description: '' });
      rules.reload();
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="space-y-4">
      {message && <InfoNote tone="positive">{message}</InfoNote>}
      {error && <ErrorState message={error} />}
      <div className="flex justify-end">
        <button type="button" className="btn-primary btn-sm" onClick={() => setCreating((v) => !v)}>{creating ? 'Cancel' : 'New automation rule'}</button>
      </div>

      {creating && (
        <Card title="Create automation rule" bodyClass="p-4">
          <form onSubmit={create} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="label" htmlFor="a-code">Code (A–Z, 0–9, _)</label><input id="a-code" required className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })} placeholder="MONTHLY_UTIL_REPORT" /></div>
            <div><label className="label" htmlFor="a-name">Name</label><input id="a-name" required className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Monthly utilization report" /></div>
            <div className="sm:col-span-2"><label className="label" htmlFor="a-desc">Description</label><input id="a-desc" className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <div>
              <label className="label" htmlFor="a-trigger">Trigger</label>
              <select id="a-trigger" className="input" value={form.triggerType} onChange={(e) => setForm({ ...form, triggerType: e.target.value })}>
                {(rules.data.triggerTypes ? Object.entries(rules.data.triggerTypes) : []).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="a-action">Action</label>
              <select id="a-action" className="input" value={form.actionType} onChange={(e) => setForm({ ...form, actionType: e.target.value })}>
                {Object.entries(rules.data.actionTypes).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <p className="hint mt-1">{rules.data.actionTypes[form.actionType]?.description}</p>
            </div>
            {form.actionType === 'generate_report' && (
              <div>
                <label className="label" htmlFor="a-report">Report</label>
                <select id="a-report" className="input" value={form.report_code} onChange={(e) => setForm({ ...form, report_code: e.target.value })}>
                  {(rules.data.actionTypes.generate_report.schema.report_code || []).map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
            )}
            {form.actionType === 'notify' && (
              <div>
                <label className="label" htmlFor="a-audience">Audience</label>
                <select id="a-audience" className="input" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })}>
                  {(rules.data.actionTypes.notify.schema.audience || []).map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                </select>
              </div>
            )}
            <div className="sm:col-span-2">
              <label className="flex items-center gap-2 text-[13px]">
                <input type="checkbox" checked={form.requiresApproval} onChange={(e) => setForm({ ...form, requiresApproval: e.target.checked })} className="rounded border-ink-300" />
                Requires a human approval before running (recommended)
              </label>
            </div>
            <div className="sm:col-span-2"><button type="submit" className="btn-primary">Create rule (disabled by default)</button></div>
          </form>
        </Card>
      )}

      {rules.data.rules.length === 0 ? (
        <Card><EmptyState title="No automation rules" description="Create a rule to automate reports, notifications or analytics refreshes — each with explicit approval requirements." /></Card>
      ) : (
        <div className="space-y-2">
          {rules.data.rules.map((r) => (
            <Card key={r.id} bodyClass="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold">{r.name}</h3>
                    <Badge tone={r.enabled ? 'green' : 'neutral'}>{r.enabled ? 'enabled' : 'disabled'}</Badge>
                    {r.requires_approval && <Badge tone="amber">needs approval</Badge>}
                  </div>
                  <p className="text-[13px] text-ink-500 mt-0.5">{r.description || 'No description'}</p>
                  <p className="text-[11px] text-ink-400 mt-1">{r.code} · trigger: {r.trigger_type} · action: {r.action_type} {r.action_config.report_code ? `(${r.action_config.report_code})` : ''}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={async () => {
                      setError(null); setMessage(null);
                      try {
                        const res = await api.post(`/api/governance/automation/rules/${r.id}/run`, {});
                        if (res.data.status === 'awaiting_approval') setMessage(`"${r.name}" is waiting for approval (request #${res.data.approvalId}). Approve it on the Approvals tab.`);
                        else if (res.data.status === 'succeeded') setMessage(`"${r.name}" ran successfully: ${res.data.detail}`);
                        else { setError(res.data.error || 'The automation run failed.'); }
                        rules.reload();
                      } catch (e) { setError(e.message); }
                    }}
                  >
                    Run now
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    onClick={async () => { await api.post(`/api/governance/automation/rules/${r.id}/enable`, { enabled: !r.enabled }); rules.reload(); }}
                  >
                    {r.enabled ? 'Disable' : 'Enable'}
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function RunsPanel() {
  const rules = useApi('/api/governance/automation/rules');
  if (rules.loading) return <Loading rows={3} />;
  if (rules.error) return <ErrorState message={rules.error} onRetry={rules.reload} />;
  return (
    <Card bodyClass="p-0">
      <DataTable
        columns={[
          { key: 'created_at', label: 'When', render: (r) => fmtDateTime(r.created_at) },
          { key: 'rule_name', label: 'Rule' },
          { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'succeeded' ? 'green' : r.status === 'failed' ? 'red' : r.status === 'awaiting_approval' ? 'amber' : 'neutral'}>{r.status.replace('_', ' ')}</Badge> },
          { key: 'triggered_by_name', label: 'Triggered by', render: (r) => r.triggered_by_name || 'system' },
          { key: 'detail', label: 'Result', render: (r) => <span className="text-[12px] text-ink-600">{r.detail || '—'}</span> },
          { key: 'executed_at', label: 'Executed', render: (r) => (r.executed_at ? fmtDateTime(r.executed_at) : '—') },
        ]}
        rows={rules.data.runs}
        pageSize={15}
        emptyTitle="No automation has run yet"
      />
    </Card>
  );
}

function ApprovalsPanel() {
  const approvals = useApi('/api/governance/approvals');
  const [error, setError] = useState(null);
  if (approvals.loading) return <Loading rows={3} />;
  if (approvals.error) return <ErrorState message={approvals.error} onRetry={approvals.reload} />;

  async function decide(id, decision) {
    setError(null);
    try {
      const res = await api.post(`/api/governance/approvals/${id}/decide`, { decision });
      approvals.reload();
      if (res.data.execution?.status === 'failed') setError(`Approved, but the automation then failed: ${res.data.execution.error}`);
    } catch (e) { setError(e.message); }
  }

  return (
    <div className="space-y-3">
      {error && <ErrorState message={error} />}
      <InfoNote tone="brand">You cannot approve your own request. Every decision is recorded with the approver, time and note.</InfoNote>
      <Card bodyClass="p-0">
        <DataTable
          columns={[
            { key: 'created_at', label: 'Requested', render: (r) => fmtDateTime(r.created_at) },
            { key: 'title', label: 'Request', render: (r) => <span><span className="font-medium">{r.title}</span><span className="block text-[11px] text-ink-400">{r.description}</span></span> },
            { key: 'type', label: 'Type', render: (r) => <Badge tone="neutral">{r.type.replace('_', ' ')}</Badge> },
            { key: 'risk_level', label: 'Risk', render: (r) => <Badge tone={r.risk_level === 'high' ? 'red' : r.risk_level === 'medium' ? 'amber' : 'green'}>{r.risk_level}</Badge> },
            { key: 'requested_by_name', label: 'By', render: (r) => r.requested_by_name || '—' },
            { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'approved' || r.status === 'executed' ? 'green' : r.status === 'rejected' ? 'red' : 'amber'}>{r.status}</Badge> },
            {
              key: 'actions', label: '', sortable: false, render: (r) => (r.status === 'pending' ? (
                <span className="flex gap-2">
                  <button type="button" className="link text-xs" onClick={() => decide(r.id, 'approved')}>Approve</button>
                  <button type="button" className="link text-xs text-danger-700" onClick={() => decide(r.id, 'rejected')}>Reject</button>
                </span>
              ) : (r.decided_by_name ? <span className="text-[11px] text-ink-400">{r.decided_by_name}</span> : '—')),
            },
          ]}
          rows={approvals.data || []}
          pageSize={15}
          emptyTitle="No approval requests"
          emptyDescription="Automation or allocation changes configured to need approval will appear here."
        />
      </Card>
    </div>
  );
}

function PolicyPanel() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card title="What automation can do" bodyClass="p-4">
        <ul className="text-[13px] text-ink-700 space-y-2 list-disc pl-4">
          <li>Generate a report and store it in report history.</li>
          <li>Send an in-app notification to a role.</li>
          <li>Recalculate analytics and insights (read-only).</li>
          <li>Raise an approval request for a human to decide.</li>
          <li>Flag insights for review.</li>
        </ul>
        <div className="mt-3"><InfoNote tone="positive">There is no action that pays money, changes pay, hires, terminates or promotes anyone. Those decisions stay outside the automation engine by design.</InfoNote></div>
      </Card>
      <Card title="What automation cannot do" bodyClass="p-4">
        <ul className="text-[13px] text-ink-700 space-y-2 list-disc pl-4">
          <li>Execute arbitrary code or shell commands.</li>
          <li>Call external systems or send email without an approved provider.</li>
          <li>Approve its own request, or bypass a human decision.</li>
          <li>Access another tenant&apos;s data.</li>
          <li>Act while disabled, or without the required permission.</li>
        </ul>
        <div className="mt-3"><InfoNote tone="caution">Every run records the initiator, approval (if required), result and timestamp. Failed runs are logged and reported on the Run history tab.</InfoNote></div>
      </Card>
    </div>
  );
}
