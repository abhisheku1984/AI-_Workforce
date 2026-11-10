import React, { useState } from 'react';
import { useApi, useAuth } from '../lib/auth';
import { PageHeader, Card, Badge, Loading, ErrorState, InfoNote } from '../components/ui';
import { api } from '../lib/api';

export default function SettingsPage() {
  const { can, org } = useAuth();
  const settings = useApi('/api/admin/organization');
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [form, setForm] = useState(null);

  if (settings.loading) return <Loading rows={4} />;
  if (settings.error) return <ErrorState message={settings.error} onRetry={settings.reload} />;
  if (!settings.data) return <ErrorState message="Settings are unavailable." onRetry={settings.reload} />;

  const s = settings.data.settings;
  const editable = can('org.manage');
  const current = form || {
    utilization: s.utilization || {},
    cost: s.cost || {},
    ai: s.ai || {},
    data: s.data || {},
    notifications: s.notifications || {},
  };

  async function save(key) {
    setError(null); setMessage(null);
    try {
      await api.put(`/api/admin/settings/${key}`, current[key]);
      setMessage(`${key} settings saved.`);
      settings.reload();
    } catch (e) { setError(e.message); }
  }

  const externalAiAvailable = Boolean(settings.data?.ai_provider_configured);

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Organization-level configuration. Utilization and capacity formulas themselves are fixed by the platform so results stay reproducible; targets and inclusion rules are configurable."
      />
      {message && <div className="mb-3"><InfoNote tone="positive">{message}</InfoNote></div>}
      {error && <div className="mb-3"><ErrorState message={error} /></div>}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card title="Utilization targets" subtitle="Used by dashboards and insights to flag below-target teams.">
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="u-target">Target utilization %</label>
              <input id="u-target" type="number" min="0" max="100" className="input max-w-[140px]" disabled={!editable}
                value={current.utilization.target_utilization_pct ?? 75}
                onChange={(e) => setForm({ ...current, utilization: { ...current.utilization, target_utilization_pct: Number(e.target.value) } })} />
              <p className="hint mt-1">Shown as the reference line on utilization charts. It does not change any calculation.</p>
            </div>
            <div>
              <label className="label" htmlFor="u-basis">Utilization definition basis</label>
              <select id="u-basis" className="input max-w-xs" disabled={!editable} value={current.utilization.basis || 'available_hours'}
                onChange={(e) => setForm({ ...current, utilization: { ...current.utilization, basis: e.target.value } })}>
                <option value="available_hours">Recorded hours ÷ available capacity (recommended)</option>
              </select>
              <p className="hint mt-1">Alternative definitions (e.g. ÷ billable-only capacity) are on the roadmap; today only the documented definition is offered so numbers stay comparable.</p>
            </div>
            {editable && <button type="button" className="btn-primary btn-sm" onClick={() => save('utilization')}>Save</button>}
          </div>
        </Card>

        <Card title="Cost visibility" subtitle="Controls whether cost fields appear in reports by default.">
          <div className="space-y-3">
            <label className="flex items-start gap-2 text-[13px]">
              <input type="checkbox" className="mt-0.5 rounded border-ink-300" disabled={!editable} checked={Boolean(current.cost.include_cost_in_reports)}
                onChange={(e) => setForm({ ...current, cost: { ...current.cost, include_cost_in_reports: e.target.checked } })} />
              <span>Include cost columns in reports for users with cost permission</span>
            </label>
            <div>
              <label className="label" htmlFor="c-basis">Cost basis</label>
              <select id="c-basis" className="input max-w-xs" disabled={!editable} value={current.cost.cost_basis || 'annual_cost'}
                onChange={(e) => setForm({ ...current, cost: { ...current.cost, cost_basis: e.target.value } })}>
                <option value="annual_cost">Annual employer cost</option>
              </select>
            </div>
            {editable && <button type="button" className="btn-primary btn-sm" onClick={() => save('cost')}>Save</button>}
            <InfoNote tone="caution">Cost data is always hidden at the server for roles without cost permission, regardless of this setting.</InfoNote>
          </div>
        </Card>

        <Card title="AI governance" subtitle="How the business assistant may use your data.">
          <div className="space-y-3">
            <label className="flex items-start gap-2 text-[13px]">
              <input type="checkbox" className="mt-0.5 rounded border-ink-300" disabled={!editable} checked={Boolean(current.ai.enabled)}
                onChange={(e) => setForm({ ...current, ai: { ...current.ai, enabled: e.target.checked } })} />
              <span>AI assistant enabled for this organization</span>
            </label>
            <label className="flex items-start gap-2 text-[13px]">
              <input type="checkbox" className="mt-0.5 rounded border-ink-300" disabled={!editable || !externalAiAvailable} checked={Boolean(current.ai.external_model_allowed)}
                onChange={(e) => setForm({ ...current, ai: { ...current.ai, external_model_allowed: e.target.checked } })} />
              <span>Allow an external AI provider <span className="block text-[11px] text-ink-500">Requires server configuration (AI_PROVIDER, AI_BASE_URL, AI_MODEL, AI_API_KEY). {!externalAiAvailable && 'Not configured on this deployment.'}</span></span>
            </label>
            <label className="flex items-start gap-2 text-[13px]">
              <input type="checkbox" className="mt-0.5 rounded border-ink-300" disabled={!editable} checked={Boolean(current.ai.allow_employee_names)}
                onChange={(e) => setForm({ ...current, ai: { ...current.ai, allow_employee_names: e.target.checked } })} />
              <span>Send employee names to an external provider <span className="block text-[11px] text-ink-500">Off by default. Aggregates are used wherever possible.</span></span>
            </label>
            {editable && <button type="button" className="btn-primary btn-sm" onClick={() => save('ai')}>Save</button>}
            <InfoNote tone="brand">No customer data leaves this deployment unless an external provider is configured and permitted. The assistant blocks prompt-injection attempts and logs all AI activity.</InfoNote>
          </div>
        </Card>

        <Card title="Data retention & export" subtitle="Retention periods and data portability.">
          <div className="space-y-3">
            <div>
              <label className="label" htmlFor="d-ret">Retention for processed data (days)</label>
              <input id="d-ret" type="number" min="30" className="input max-w-[140px]" disabled={!editable} value={current.data.retention_days ?? 1095}
                onChange={(e) => setForm({ ...current, data: { ...current.data, retention_days: Number(e.target.value) } })} />
            </div>
            <div>
              <label className="label" htmlFor="d-raw">Retention for raw uploads (days)</label>
              <input id="d-raw" type="number" min="30" className="input max-w-[140px]" disabled={!editable} value={current.data.raw_retention_days ?? 365}
                onChange={(e) => setForm({ ...current, data: { ...current.data, raw_retention_days: Number(e.target.value) } })} />
            </div>
            <label className="flex items-start gap-2 text-[13px]">
              <input type="checkbox" className="mt-0.5 rounded border-ink-300" disabled={!editable} checked={Boolean(current.data.allow_export)}
                onChange={(e) => setForm({ ...current, data: { ...current.data, allow_export: e.target.checked } })} />
              <span>Allow administrators to export all organization data</span>
            </label>
            {editable && <button type="button" className="btn-primary btn-sm" onClick={() => save('data')}>Save</button>}
            {can('org.manage') && (
              <a className="btn-secondary btn-sm block text-center" href="/api/governance/data/export">Download full organization export (JSON)</a>
            )}
            <InfoNote tone="caution">
              Retention periods are recorded as configuration. Automated purging is not enabled in this build — deletion is
              performed through approved deletion requests so nothing is removed without a second administrator&apos;s sign-off.
            </InfoNote>
          </div>
        </Card>
      </div>

      <Card className="mt-4" title="Currency & locale" bodyClass="p-4">
        <p className="text-[13px] text-ink-600">
          Organization currency is <strong>{org?.currency}</strong> and timezone is <strong>{org?.timezone}</strong>. These are set on the Organization tab and apply to all financial figures and date handling.
          The interface is English in this release; the data model and label layer are ready for additional languages.
        </p>
      </Card>
    </div>
  );
}
