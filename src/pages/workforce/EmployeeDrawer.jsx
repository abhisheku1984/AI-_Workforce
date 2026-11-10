import React, { useEffect, useState } from 'react';
import { useApi, useAuth } from '../../lib/auth';
import { Badge, Loading, ErrorState, InfoNote, StatusDot } from '../../components/ui';
import { fmtHours, fmtMoney, fmtDate, fmtDateTime, fmtNumber } from '../../lib/format';
import { api } from '../../lib/api';

export default function EmployeeDrawer({ employeeId, onClose, onChanged }) {
  const { can, org } = useAuth();
  const detail = useApi(`/api/workforce/${employeeId}`);
  const structure = useApi('/api/admin/structure', { skip: !can('org.view') });
  const [tab, setTab] = useState('overview');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(null);
  const [skillForm, setSkillForm] = useState('');

  useEffect(() => {
    if (detail.data?.employee && !editing) {
      const e = detail.data.employee;
      setForm({
        full_name: e.full_name, email: e.email || '', designation: e.designation || '', grade: e.grade || '',
        department_id: e.department_id || '', location_id: e.location_id || '', status: e.status,
        employment_type: e.employment_type, join_date: e.join_date || '', exit_date: e.exit_date || '',
        fte: e.fte ?? 1, weekly_hours: e.weekly_hours ?? '',
        annual_cost: e.annual_cost ?? '', bill_rate_hour: e.bill_rate_hour ?? '',
      });
      setSkillForm((detail.data.skills || []).map((s) => s.name).join(', '));
    }
  }, [detail.data, editing]);

  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  async function save() {
    setSaving(true); setError(null);
    try {
      await api.patch(`/api/workforce/${employeeId}`, form);
      await api.put(`/api/workforce/${employeeId}/skills`, {
        skills: skillForm.split(',').map((s) => s.trim()).filter(Boolean).map((name) => ({ name, proficiency: 3 })),
      });
      setEditing(false);
      detail.reload();
      onChanged?.();
    } catch (e) {
      setError(e.message);
    } finally { setSaving(false); }
  }

  const e = detail.data?.employee;
  const costVisible = can('workforce.cost.view');

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Employee details">
      <button type="button" className="absolute inset-0 bg-ink-950/40" aria-label="Close" onClick={onClose} />
      <div className="relative w-full max-w-2xl h-full bg-white shadow-2xl overflow-y-auto">
        <header className="sticky top-0 bg-white border-b border-ink-200 px-5 py-3 flex items-start justify-between gap-3 z-10">
          <div>
            {detail.loading ? <p className="text-sm text-ink-500">Loading…</p> : e ? (
              <>
                <h2 className="text-base font-semibold text-ink-900">{e.full_name}</h2>
                <p className="text-xs text-ink-500">{e.employee_code} · {e.designation || 'No designation'} · {e.department || 'Unassigned department'}</p>
              </>
            ) : null}
          </div>
          <div className="flex gap-2">
            {can('workforce.manage') && e && !editing && <button type="button" className="btn-secondary btn-sm" onClick={() => setEditing(true)}>Edit</button>}
            <button type="button" className="btn-ghost btn-sm" onClick={onClose} aria-label="Close panel">✕</button>
          </div>
        </header>

        {detail.error ? <div className="p-5"><ErrorState message={detail.error} onRetry={detail.reload} /></div>
          : detail.loading || !e ? <div className="p-5"><Loading rows={6} /></div> : (
            <div className="p-5 space-y-5">
              {error && <ErrorState message={error} />}

              <div className="flex gap-1 rounded-lg bg-ink-100/70 p-1">
                {[['overview', 'Overview'], ['allocations', 'Allocations'], ['skills', 'Skills'], ['history', 'History']].map(([id, label]) => (
                  <button key={id} type="button" className={`tab ${tab === id ? 'tab-active' : ''}`} onClick={() => setTab(id)}>{label}</button>
                ))}
              </div>

              {tab === 'overview' && (
                editing && form ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="label" htmlFor="f-name">Full name</label><input id="f-name" className="input" value={form.full_name} onChange={(ev) => setForm({ ...form, full_name: ev.target.value })} /></div>
                      <div><label className="label" htmlFor="f-email">Email</label><input id="f-email" className="input" value={form.email} onChange={(ev) => setForm({ ...form, email: ev.target.value })} /></div>
                      <div><label className="label" htmlFor="f-desig">Designation</label><input id="f-desig" className="input" value={form.designation} onChange={(ev) => setForm({ ...form, designation: ev.target.value })} /></div>
                      <div><label className="label" htmlFor="f-grade">Grade</label><input id="f-grade" className="input" value={form.grade} onChange={(ev) => setForm({ ...form, grade: ev.target.value })} /></div>
                      <div>
                        <label className="label" htmlFor="f-dept2">Department</label>
                        <select id="f-dept2" className="input" value={form.department_id} onChange={(ev) => setForm({ ...form, department_id: ev.target.value })}>
                          <option value="">Unassigned</option>
                          {(structure.data?.departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="label" htmlFor="f-loc2">Location</label>
                        <select id="f-loc2" className="input" value={form.location_id} onChange={(ev) => setForm({ ...form, location_id: ev.target.value })}>
                          <option value="">Unassigned</option>
                          {(structure.data?.locations || []).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="label" htmlFor="f-status2">Status</label>
                        <select id="f-status2" className="input" value={form.status} onChange={(ev) => setForm({ ...form, status: ev.target.value })}>
                          <option value="active">Active</option><option value="on_leave">On leave</option><option value="notice">Serving notice</option><option value="exited">Exited</option>
                        </select>
                      </div>
                      <div>
                        <label className="label" htmlFor="f-type">Employment type</label>
                        <select id="f-type" className="input" value={form.employment_type} onChange={(ev) => setForm({ ...form, employment_type: ev.target.value })}>
                          <option value="full_time">Full time</option><option value="part_time">Part time</option><option value="contractor">Contractor</option><option value="intern">Intern</option><option value="furlough">Furlough</option>
                        </select>
                      </div>
                      <div><label className="label" htmlFor="f-join">Join date</label><input id="f-join" type="date" className="input" value={form.join_date} onChange={(ev) => setForm({ ...form, join_date: ev.target.value })} /></div>
                      <div><label className="label" htmlFor="f-exit">Exit date</label><input id="f-exit" type="date" className="input" value={form.exit_date} onChange={(ev) => setForm({ ...form, exit_date: ev.target.value })} /></div>
                      <div><label className="label" htmlFor="f-fte">FTE</label><input id="f-fte" type="number" step="0.1" min="0" max="2" className="input" value={form.fte} onChange={(ev) => setForm({ ...form, fte: ev.target.value })} /></div>
                      <div><label className="label" htmlFor="f-weekly">Weekly hours override</label><input id="f-weekly" type="number" className="input" placeholder="Blank = location default" value={form.weekly_hours} onChange={(ev) => setForm({ ...form, weekly_hours: ev.target.value })} /></div>
                      {costVisible && (
                        <>
                          <div><label className="label" htmlFor="f-cost">Annual cost</label><input id="f-cost" type="number" className="input" value={form.annual_cost} onChange={(ev) => setForm({ ...form, annual_cost: ev.target.value })} /></div>
                          <div><label className="label" htmlFor="f-rate">Bill rate / hour</label><input id="f-rate" type="number" className="input" value={form.bill_rate_hour} onChange={(ev) => setForm({ ...form, bill_rate_hour: ev.target.value })} /></div>
                        </>
                      )}
                    </div>
                    <div>
                      <label className="label" htmlFor="f-skills">Skills (comma separated)</label>
                      <input id="f-skills" className="input" value={skillForm} onChange={(ev) => setSkillForm(ev.target.value)} placeholder="Java, SQL, AWS" />
                      <p className="hint mt-1">Saving replaces this person's skill list. Proficiency defaults to 3 (intermediate).</p>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button type="button" className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
                      <button type="button" className="btn-secondary" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
                    </div>
                    <InfoNote tone="caution">Changes are recorded in the audit trail and in the employee's change history. Capacity figures recalculate immediately.</InfoNote>
                  </div>
                ) : (
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <Field label="Status"><span className="inline-flex items-center gap-1.5 capitalize"><StatusDot status={e.status} />{e.status.replace('_', ' ')}</span></Field>
                    <Field label="Employment type"><span className="capitalize">{e.employment_type.replace('_', ' ')}</span></Field>
                    <Field label="Business unit">{e.business_unit || '—'}</Field>
                    <Field label="Location">{e.location || '—'}</Field>
                    <Field label="Join date">{fmtDate(e.join_date)}</Field>
                    <Field label="Exit date">{fmtDate(e.exit_date)}</Field>
                    <Field label="FTE">{fmtNumber(e.fte, 2)}</Field>
                    <Field label="Weekly capacity">{e.weekly_hours ? `${fmtNumber(e.weekly_hours, 1)} h (override)` : 'Location default'}</Field>
                    {costVisible ? (
                      <>
                        <Field label="Annual cost">{e.annual_cost == null ? <span className="text-caution-700">Not provided</span> : fmtMoney(e.annual_cost, e.cost_currency || org?.currency)}</Field>
                        <Field label="Bill rate / hour">{e.bill_rate_hour == null ? '—' : fmtMoney(e.bill_rate_hour, org?.currency, { compact: false })}</Field>
                      </>
                    ) : (
                      <Field label="Cost data"><span className="text-ink-400">Hidden for your role</span></Field>
                    )}
                    <Field label="Data source">{e.data_source?.startsWith('import:') ? `Import #${e.data_source.split(':')[1]}` : 'Manual entry'}</Field>
                    <Field label="Last updated">{fmtDateTime(e.updated_at)}</Field>
                  </dl>
                )
              )}

              {tab === 'allocations' && (
                <div>
                  {(detail.data.allocations || []).length === 0 ? (
                    <InfoNote>No allocations recorded for this person. Unallocated capacity will appear as bench time in utilization reports.</InfoNote>
                  ) : (
                    <div className="space-y-2">
                      {detail.data.allocations.map((a) => (
                        <div key={a.id} className="border border-ink-200 rounded-lg p-3 flex justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-ink-800">{a.project_name || 'No project (internal)'}</p>
                            <p className="text-[11px] text-ink-500">{a.project_code} · {fmtDate(a.start_date)} → {fmtDate(a.end_date)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold tabular-nums">{fmtNumber(a.hours_per_week, 1)} h/wk</p>
                            <p className="text-[11px] text-ink-500 capitalize">{a.status}{a.billable ? ' · billable' : ' · non-billable'}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {tab === 'skills' && (
                <div>
                  {(detail.data.skills || []).length === 0 ? <InfoNote>No skills recorded. Skill matching for staffing gaps will not find this person.</InfoNote> : (
                    <ul className="space-y-2">
                      {detail.data.skills.map((s) => (
                        <li key={s.id} className="flex items-center justify-between border border-ink-200 rounded-lg px-3 py-2">
                          <div>
                            <p className="text-sm font-medium">{s.name}</p>
                            <p className="text-[11px] text-ink-500">{s.years ? `${s.years} years experience · ` : ''}{s.verified ? 'verified' : 'self-reported'}</p>
                          </div>
                          <div className="flex items-center gap-1" aria-label={`Proficiency ${s.proficiency} of 5`}>
                            {[1, 2, 3, 4, 5].map((n) => (
                              <span key={n} className={`w-2.5 h-2.5 rounded-sm ${n <= s.proficiency ? 'bg-brand-500' : 'bg-ink-200'}`} />
                            ))}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {tab === 'history' && (
                <div>
                  {(detail.data.history || []).length === 0 ? <InfoNote>No recorded changes for this employee yet.</InfoNote> : (
                    <ol className="space-y-3">
                      {detail.data.history.map((h) => (
                        <li key={h.version} className="border-l-2 border-brand-200 pl-3">
                          <p className="text-sm font-medium text-ink-800">Version {h.version} · {h.change_type}</p>
                          <p className="text-[11px] text-ink-500">{fmtDateTime(h.changed_at)}</p>
                          {h.snapshot?.full_name && <p className="text-[11px] text-ink-500 mt-1">Previous name: {h.snapshot.full_name}{h.snapshot.annual_cost != null && costVisible ? ` · previous annual cost ${fmtMoney(h.snapshot.annual_cost)}` : ''}</p>}
                        </li>
                      ))}
                    </ol>
                  )}
                  {(detail.data.timesheetSummary || []).length > 0 && (
                    <div className="mt-5">
                      <h3 className="text-sm font-semibold text-ink-800 mb-2">Recent recorded hours</h3>
                      <ul className="text-[13px] space-y-1 max-h-64 overflow-y-auto">
                        {detail.data.timesheetSummary.slice(0, 20).map((t) => (
                          <li key={t.work_date} className="flex justify-between border-b border-ink-100 py-1">
                            <span>{fmtDate(t.work_date)}</span><span className="tabular-nums">{fmtNumber(t.hours, 1)} h</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-400">{label}</dt>
      <dd className="text-ink-800 mt-0.5">{children}</dd>
    </div>
  );
}
