import React, { useState } from 'react';
import { useApi, useAuth } from '../lib/auth';
import { PageHeader, Card, Badge, Loading, ErrorState, InfoNote, Tabs, EmptyState } from '../components/ui';
import { DataTable } from '../components/DataTable';
import { fmtDateTime, fmtNumber, relativeTime } from '../lib/format';
import { api } from '../lib/api';

export default function AdminPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState('organization');
  const tabs = [
    ...(can('org.view') ? [{ id: 'organization', label: 'Organization' }] : []),
    ...(can('org.view') ? [{ id: 'structure', label: 'Structure' }] : []),
    ...(can('user.view') ? [{ id: 'users', label: 'Users' }, { id: 'roles', label: 'Roles & permissions' }] : []),
    ...(can('org.view') ? [{ id: 'modules', label: 'Modules & subscription' }] : []),
    ...(can('audit.view') ? [{ id: 'audit', label: 'Audit trail' }, { id: 'ai-audit', label: 'AI activity' }] : []),
  ];

  return (
    <div>
      <PageHeader
        title="Administration"
        description="Organization setup, users, roles and governance records. Access is enforced on the server for every request, not just hidden in this interface."
      />
      <Tabs tabs={tabs} active={tab} onChange={setTab} />
      {tab === 'organization' && <OrganizationPanel />}
      {tab === 'structure' && <StructurePanel />}
      {tab === 'users' && <UsersPanel />}
      {tab === 'roles' && <RolesPanel />}
      {tab === 'modules' && <ModulesPanel />}
      {tab === 'audit' && <AuditPanel />}
      {tab === 'ai-audit' && <AiAuditPanel />}
    </div>
  );
}

function OrganizationPanel() {
  const { can } = useAuth();
  const org = useApi('/api/admin/organization');
  const [form, setForm] = useState(null);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  if (org.loading) return <Loading rows={3} />;
  if (org.error) return <ErrorState message={org.error} onRetry={org.reload} />;
  const o = org.data.organization;
  const editable = can('org.manage');

  async function save(e) {
    e.preventDefault();
    setError(null); setMessage(null);
    try {
      await api.patch('/api/admin/organization', form);
      setMessage('Organization profile updated.');
      setForm(null);
      org.reload();
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <Card className="xl:col-span-2" title="Organization profile" subtitle="Currency and working-week settings drive every calculation in the platform.">
        {message && <div className="mb-3"><InfoNote tone="positive">{message}</InfoNote></div>}
        {error && <div className="mb-3"><ErrorState message={error} /></div>}
        {!editable ? (
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <F label="Name">{o.name}</F><F label="Slug">{o.slug}</F>
            <F label="Industry">{o.industry || '—'}</F><F label="Country">{o.country}</F>
            <F label="Currency">{o.currency}</F><F label="Timezone">{o.timezone}</F>
            <F label="Fiscal year starts">Month {o.fiscal_start_month}</F><F label="Data region">{o.data_region}</F>
          </dl>
        ) : (
          <form onSubmit={save} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="label" htmlFor="o-name">Organization name</label><input id="o-name" className="input" defaultValue={o.name} onChange={(e) => setForm({ ...(form || {}), name: e.target.value })} /></div>
            <div><label className="label" htmlFor="o-industry">Industry</label><input id="o-industry" className="input" defaultValue={o.industry || ''} onChange={(e) => setForm({ ...(form || {}), industry: e.target.value })} /></div>
            <div><label className="label" htmlFor="o-country">Country</label><input id="o-country" className="input" defaultValue={o.country || ''} onChange={(e) => setForm({ ...(form || {}), country: e.target.value })} /></div>
            <div><label className="label" htmlFor="o-currency">Currency</label><input id="o-currency" className="input" defaultValue={o.currency} maxLength={3} onChange={(e) => setForm({ ...(form || {}), currency: e.target.value.toUpperCase() })} /></div>
            <div><label className="label" htmlFor="o-tz">Timezone</label><input id="o-tz" className="input" defaultValue={o.timezone} onChange={(e) => setForm({ ...(form || {}), timezone: e.target.value })} /></div>
            <div><label className="label" htmlFor="o-fiscal">Fiscal year starts (month)</label><input id="o-fiscal" type="number" min="1" max="12" className="input" defaultValue={o.fiscal_start_month} onChange={(e) => setForm({ ...(form || {}), fiscal_start_month: Number(e.target.value) })} /></div>
            <div className="sm:col-span-2"><button type="submit" className="btn-primary" disabled={!form}>Save changes</button></div>
          </form>
        )}
        <div className="mt-4 pt-4 border-t border-ink-100 grid grid-cols-3 gap-3 text-center">
          {Object.entries(org.data.counts).map(([k, v]) => (
            <div key={k}><p className="text-lg font-semibold tabular-nums">{fmtNumber(v)}</p><p className="text-[11px] text-ink-500 capitalize">{k.replace(/_/g, ' ')}</p></div>
          ))}
        </div>
      </Card>

      <Card title="Tenant isolation" bodyClass="p-4 space-y-3 text-[13px] text-ink-600">
        <p><strong>Organization ID:</strong> <span className="font-mono">{o.id}</span></p>
        <p>Every query in the platform is filtered by your organization at the database access layer. The API never accepts an organization identifier from the browser — it comes from your signed session.</p>
        <p>Department and business-unit restrictions are applied when data is <em>loaded</em>, so out-of-scope records cannot influence any total you see.</p>
        <InfoNote tone="brand">Attempting to open another organization&apos;s record returns &ldquo;not found&rdquo; rather than a permission error, so record existence is not disclosed.</InfoNote>
      </Card>
    </div>
  );
}

function StructurePanel() {
  const { can } = useAuth();
  const structure = useApi('/api/admin/structure');
  const [kind, setKind] = useState('business_unit');
  const [form, setForm] = useState({ name: '', code: '', business_unit_id: '' });
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  if (structure.loading) return <Loading rows={3} />;
  if (structure.error) return <ErrorState message={structure.error} onRetry={structure.reload} />;

  const endpoint = { business_unit: '/api/admin/business-units', department: '/api/admin/departments', location: '/api/admin/locations' }[kind];

  async function add(e) {
    e.preventDefault();
    setError(null); setMessage(null);
    try {
      await api.post(endpoint, form);
      setMessage(`${kind.replace('_', ' ')} created.`);
      setForm({ name: '', code: '', business_unit_id: '' });
      structure.reload();
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div className="xl:col-span-2 space-y-4">
        <Card title="Business units" bodyClass="p-0">
          <DataTable columns={[
            { key: 'name', label: 'Name' }, { key: 'code', label: 'Code' }, { key: 'leader', label: 'Leader', render: (r) => r.leader || '—' },
            { key: 'status', label: 'Status', render: (r) => <Badge tone="green">{r.status}</Badge> },
          ]} rows={structure.data.business_units} pageSize={10} emptyTitle="No business units" emptyDescription="Add one on the right, or they are created automatically from your imported data." />
        </Card>
        <Card title="Departments" bodyClass="p-0">
          <DataTable columns={[
            { key: 'name', label: 'Name' }, { key: 'code', label: 'Code' }, { key: 'business_unit_name', label: 'Business unit', render: (r) => r.business_unit_name || '—' },
            { key: 'cost_center', label: 'Cost centre', render: (r) => r.cost_center || '—' },
          ]} rows={structure.data.departments} pageSize={10} emptyTitle="No departments" />
        </Card>
        <Card title="Locations & working calendars" subtitle="Hours per day, working weekdays and holidays determine each person's capacity." bodyClass="p-0">
          <DataTable columns={[
            { key: 'name', label: 'Location' }, { key: 'country', label: 'Country' }, { key: 'timezone', label: 'Timezone' },
            { key: 'hours_per_day', label: 'Hours / day', align: 'right' },
            { key: 'working_days', label: 'Working days', render: (r) => { try { const d = JSON.parse(r.working_days); return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].filter((_, i) => d.includes(i)).join(', '); } catch { return '—'; } } },
            { key: 'holidays', label: 'Holidays', render: (r) => { try { return JSON.parse(r.holidays).length; } catch { return 0; } } },
          ]} rows={structure.data.locations} pageSize={10} emptyTitle="No locations" emptyDescription="Without locations, capacity defaults to 8 hours × 5 weekdays." />
        </Card>
      </div>

      {can('org.manage') && (
        <Card title="Add structure" bodyClass="p-4">
          {message && <div className="mb-2"><InfoNote tone="positive">{message}</InfoNote></div>}
          {error && <div className="mb-2"><ErrorState message={error} /></div>}
          <form onSubmit={add} className="space-y-3">
            <div>
              <label className="label" htmlFor="s-kind">Type</label>
              <select id="s-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="business_unit">Business unit</option>
                <option value="department">Department</option>
                <option value="location">Location</option>
              </select>
            </div>
            <div><label className="label" htmlFor="s-name">Name</label><input id="s-name" required className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            {kind !== 'location' && <div><label className="label" htmlFor="s-code">Code</label><input id="s-code" required className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} /></div>}
            {kind === 'department' && (
              <div>
                <label className="label" htmlFor="s-bu">Business unit</label>
                <select id="s-bu" className="input" value={form.business_unit_id} onChange={(e) => setForm({ ...form, business_unit_id: e.target.value })}>
                  <option value="">Not set</option>
                  {structure.data.business_units.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
            )}
            <button type="submit" className="btn-primary w-full">Create</button>
          </form>
        </Card>
      )}
    </div>
  );
}

function UsersPanel() {
  const { can } = useAuth();
  const users = useApi('/api/admin/users');
  const roles = useApi('/api/admin/roles');
  const structure = useApi('/api/admin/structure');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ email: '', full_name: '', title: '', roleCode: 'viewer', business_unit_id: '', department_id: '' });
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null);

  if (users.loading || roles.loading) return <Loading rows={3} />;
  if (users.error) return <ErrorState message={users.error} onRetry={users.reload} />;

  async function create(e) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.post('/api/admin/users', form);
      setCreated({ email: form.email, password: res.data.temporaryPassword });
      setCreating(false);
      setForm({ email: '', full_name: '', title: '', roleCode: 'viewer', business_unit_id: '', department_id: '' });
      users.reload();
    } catch (err) { setError(err.message); }
  }

  return (
    <div className="space-y-4">
      {created && (
        <InfoNote tone="positive" title="User created">
          Share these credentials securely with <strong>{created.email}</strong>. Temporary password: <code className="font-mono bg-white px-1.5 py-0.5 rounded border border-positive-500/30">{created.password}</code>.
          The user must change it at first sign-in. Shown once only.
        </InfoNote>
      )}
      {error && <ErrorState message={error} />}
      {can('user.manage') && (
        <div className="flex justify-end">
          <button type="button" className="btn-primary btn-sm" onClick={() => setCreating((v) => !v)}>{creating ? 'Cancel' : 'Invite user'}</button>
        </div>
      )}
      {creating && (
        <Card title="New user" bodyClass="p-4">
          <form onSubmit={create} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="label" htmlFor="u-email">Email</label><input id="u-email" type="email" required className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <div><label className="label" htmlFor="u-name">Full name</label><input id="u-name" required className="input" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
            <div><label className="label" htmlFor="u-title">Title</label><input id="u-title" className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div>
              <label className="label" htmlFor="u-role">Role</label>
              <select id="u-role" className="input" value={form.roleCode} onChange={(e) => setForm({ ...form, roleCode: e.target.value })}>
                {(roles.data?.roles || []).map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="u-bu">Restrict to business unit (optional)</label>
              <select id="u-bu" className="input" value={form.business_unit_id} onChange={(e) => setForm({ ...form, business_unit_id: e.target.value })}>
                <option value="">All business units</option>
                {(structure.data?.business_units || []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="u-dept">Restrict to department (optional)</label>
              <select id="u-dept" className="input" value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })}>
                <option value="">All departments</option>
                {(structure.data?.departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2"><button type="submit" className="btn-primary">Create user</button></div>
          </form>
        </Card>
      )}
      <Card bodyClass="p-0">
        <DataTable
          columns={[
            { key: 'full_name', label: 'User', render: (r) => <span><span className="font-medium">{r.full_name}</span><span className="block text-[11px] text-ink-400">{r.email}</span></span> },
            { key: 'title', label: 'Title', render: (r) => r.title || '—' },
            { key: 'roles', label: 'Roles & scope', sortable: false, render: (r) => (
              <span className="flex flex-wrap gap-1">
                {r.roles.map((role) => (
                  <Badge key={`${role.id}-${role.business_unit_id}-${role.department_id}`} tone="brand">
                    {role.name}{role.business_unit_name ? ` · ${role.business_unit_name}` : ''}{role.department_name ? ` · ${role.department_name}` : ''}
                  </Badge>
                ))}
                {r.roles.length === 0 && <span className="text-[11px] text-ink-400">no role assigned</span>}
              </span>
            ) },
            { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'active' ? 'green' : r.status === 'suspended' ? 'red' : 'amber'}>{r.status}</Badge> },
            { key: 'last_login_at', label: 'Last sign-in', render: (r) => relativeTime(r.last_login_at) },
            ...(can('user.manage') ? [{
              key: 'actions', label: '', sortable: false, render: (r) => (
                <span className="flex gap-2">
                  <button type="button" className="link text-xs" onClick={async () => {
                    if (!window.confirm(`Reset password for ${r.email}?`)) return;
                    const res = await api.post(`/api/admin/users/${r.id}/reset-password`, {});
                    setCreated({ email: r.email, password: res.data.temporaryPassword });
                  }}>Reset password</button>
                  <button type="button" className="link text-xs" onClick={async () => {
                    const next = r.status === 'active' ? 'suspended' : 'active';
                    try { await api.patch(`/api/admin/users/${r.id}`, { status: next }); users.reload(); } catch (e) { setError(e.message); }
                  }}>{r.status === 'active' ? 'Suspend' : 'Reactivate'}</button>
                </span>
              ),
            }] : []),
          ]}
          rows={users.data || []}
          pageSize={20}
          emptyTitle="No users"
        />
      </Card>
    </div>
  );
}

function RolesPanel() {
  const { can } = useAuth();
  const roles = useApi('/api/admin/roles');
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);

  if (roles.loading) return <Loading rows={3} />;
  if (roles.error) return <ErrorState message={roles.error} onRetry={roles.reload} />;

  async function save(role, perms) {
    setError(null); setMessage(null);
    try {
      await api.put(`/api/admin/roles/${role.id}`, { permissions: perms });
      setMessage(`Permissions updated for ${role.name}.`);
      setEdit(null);
      roles.reload();
    } catch (e) { setError(e.message); }
  }

  const current = edit ? roles.data.roles.find((r) => r.id === edit) : null;

  return (
    <div className="space-y-4">
      {message && <InfoNote tone="positive">{message}</InfoNote>}
      {error && <ErrorState message={error} />}
      <InfoNote tone="brand">
        Permissions control what a role can do. Data scope (which business units or departments a user sees) is set on the user&apos;s role assignment, and is applied to data before any calculation.
      </InfoNote>

      {current && (
        <RoleEditor
          role={current}
          groups={roles.data.permissionGroups}
          catalogue={roles.data.permissionCatalogue}
          readOnly={!can('role.manage')}
          onCancel={() => setEdit(null)}
          onSave={(perms) => save(current, perms)}
        />
      )}

      <Card bodyClass="p-0">
        <DataTable
          columns={[
            { key: 'name', label: 'Role', render: (r) => <span><span className="font-medium">{r.name}</span><span className="block text-[11px] text-ink-400">{r.description}</span></span> },
            { key: 'code', label: 'Code', render: (r) => <span className="font-mono text-[11px]">{r.code}</span> },
            { key: 'user_count', label: 'Users', align: 'right' },
            { key: 'permissions', label: 'Permissions', sortable: false, render: (r) => <Badge tone="neutral">{r.permissions.length} granted</Badge> },
            { key: 'is_system', label: 'Type', render: (r) => <Badge tone={r.is_system ? 'brand' : 'neutral'}>{r.is_system ? 'system' : 'custom'}</Badge> },
            ...(can('role.manage') ? [{ key: 'actions', label: '', sortable: false, render: (r) => <button type="button" className="link text-xs" onClick={() => setEdit(r.id)}>Edit</button> }] : []),
          ]}
          rows={roles.data.roles}
          pageSize={20}
          emptyTitle="No roles"
        />
      </Card>
    </div>
  );
}

function RoleEditor({ role, groups, catalogue, readOnly, onCancel, onSave }) {
  const [perms, setPerms] = useState(role.permissions);
  const toggle = (p) => setPerms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  return (
    <Card title={`Edit "${role.name}"`} subtitle={`${perms.length} permissions selected`} bodyClass="p-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {groups.map((g) => (
          <div key={g.name}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400 mb-2">{g.name}</p>
            <ul className="space-y-1.5">
              {g.perms.map((p) => (
                <li key={p}>
                  <label className="flex items-start gap-2 text-[13px]">
                    <input type="checkbox" disabled={readOnly} checked={perms.includes(p)} onChange={() => toggle(p)} className="mt-0.5 rounded border-ink-300" />
                    <span><span className="font-medium">{p}</span><span className="block text-[11px] text-ink-500">{catalogue[p]}</span></span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {!readOnly && (
        <div className="flex gap-2 mt-4">
          <button type="button" className="btn-primary" onClick={() => onSave(perms)}>Save permissions</button>
          <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        </div>
      )}
      <div className="mt-3"><InfoNote tone="caution">Changing a role&apos;s permissions affects every user holding it immediately, and signs them out so the new permissions take effect.</InfoNote></div>
    </Card>
  );
}

function ModulesPanel() {
  const modules = useApi('/api/admin/modules');
  const sub = useApi('/api/governance/subscription');
  if (modules.loading || sub.loading) return <Loading rows={3} />;
  if (modules.error) return <ErrorState message={modules.error} onRetry={modules.reload} />;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <Card className="xl:col-span-2" title="Enabled modules" subtitle="Modules can be switched on per organization as part of the subscription." bodyClass="p-0">
        <table className="w-full">
          <thead><tr><th className="th">Module</th><th className="th">Stage</th><th className="th">Status</th></tr></thead>
          <tbody>
            {modules.data.modules.map((m) => (
              <tr key={m.code}>
                <td className="td"><span className="font-medium">{m.name}</span><span className="block text-[11px] text-ink-400">{m.description}</span></td>
                <td className="td"><Badge tone={m.stage === 'core' ? 'brand' : m.stage === 'ai' ? 'green' : 'amber'}>{m.stage}</Badge></td>
                <td className="td">{m.enabled ? <Badge tone="green">{m.entitlement.status}</Badge> : <Badge tone="neutral">not enabled</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="space-y-4">
        <Card title="Subscription" bodyClass="p-4">
          {sub.data?.subscription ? (
            <dl className="text-[13px] space-y-2">
              <F label="Plan">{sub.data.subscription.plan_code}</F>
              <F label="Status"><Badge tone={sub.data.subscription.status === 'active' ? 'green' : 'amber'}>{sub.data.subscription.status}</Badge></F>
              <F label="Seats">{sub.data.subscription.seats}</F>
              <F label="Monthly fee">{sub.data.subscription.currency} {fmtNumber(sub.data.subscription.monthly_fee)}</F>
              <F label="Setup fee">{sub.data.subscription.currency} {fmtNumber(sub.data.subscription.setup_fee)}</F>
              <F label="Started">{sub.data.subscription.started_at}</F>
            </dl>
          ) : <p className="text-sm text-ink-500">No subscription record.</p>}
          <div className="mt-3"><InfoNote tone="caution">{sub.data?.disclaimer}</InfoNote></div>
        </Card>
        <Card title="Usage" bodyClass="p-4">
          {sub.data?.usage && (
            <dl className="text-[13px] space-y-2">
              <F label="Employees">{fmtNumber(sub.data.usage.employees)}</F>
              <F label="Users">{fmtNumber(sub.data.usage.users)} of {sub.data.usage.seats_limit ?? '—'} seats</F>
              <F label="Employee band">{sub.data.usage.employee_band || '—'}</F>
            </dl>
          )}
          {sub.data?.usage?.warnings?.map((w) => <div key={w} className="mt-2"><InfoNote tone="caution">{w}</InfoNote></div>)}
        </Card>
      </div>
    </div>
  );
}

function AuditPanel() {
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const q = new URLSearchParams();
  if (action) q.set('action', action);
  if (actor) q.set('actor', actor);
  const audit = useApi(`/api/admin/audit?${q.toString()}`, { deps: [action, actor] });

  return (
    <div className="space-y-3">
      <Card bodyClass="p-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div><label className="label" htmlFor="au-action">Action contains</label><input id="au-action" className="input" value={action} onChange={(e) => setAction(e.target.value)} placeholder="import, login, allocation…" /></div>
          <div><label className="label" htmlFor="au-actor">Actor contains</label><input id="au-actor" className="input" value={actor} onChange={(e) => setActor(e.target.value)} placeholder="email" /></div>
        </div>
      </Card>
      <Card bodyClass="p-0">
        {audit.loading ? <div className="p-4"><Loading /></div> : audit.error ? <div className="p-4"><ErrorState message={audit.error} onRetry={audit.reload} /></div> : (
          <DataTable
            columns={[
              { key: 'created_at', label: 'When', render: (r) => fmtDateTime(r.created_at) },
              { key: 'actor_email', label: 'Actor' },
              { key: 'action', label: 'Action', render: (r) => <span className="font-mono text-[11px]">{r.action}</span> },
              { key: 'summary', label: 'Summary' },
              { key: 'entity_type', label: 'Entity', render: (r) => (r.entity_type ? `${r.entity_type}${r.entity_id ? ` #${r.entity_id}` : ''}` : '—') },
              { key: 'ip', label: 'IP', render: (r) => <span className="font-mono text-[11px]">{r.ip || '—'}</span> },
            ]}
            rows={audit.data || []}
            searchable
            pageSize={25}
            emptyTitle="No audit events"
          />
        )}
      </Card>
      <p className="text-xs text-ink-500">Audit records are append-only. {audit.meta ? `${fmtNumber(audit.meta.total)} events recorded.` : ''}</p>
    </div>
  );
}

function AiAuditPanel() {
  const audit = useApi('/api/admin/ai-audit');
  if (audit.loading) return <Loading rows={3} />;
  if (audit.error) return <ErrorState message={audit.error} onRetry={audit.reload} />;
  return (
    <div className="space-y-3">
      <InfoNote tone="brand">
        Every AI request is logged: what was asked (as an intent), which provider was used, what data was sent, and whether the
        result was accepted, refused or blocked. Blocked prompt-injection attempts appear here.
      </InfoNote>
      <Card bodyClass="p-0">
        <DataTable
          columns={[
            { key: 'created_at', label: 'When', render: (r) => fmtDateTime(r.created_at) },
            { key: 'action', label: 'Action', render: (r) => <span className="font-mono text-[11px]">{r.action}</span> },
            { key: 'intent', label: 'Intent', render: (r) => r.intent || '—' },
            { key: 'provider', label: 'Provider' },
            { key: 'result_status', label: 'Result', render: (r) => <Badge tone={r.result_status === 'ok' ? 'green' : r.result_status === 'blocked' ? 'red' : 'amber'}>{r.result_status || '—'}</Badge> },
            { key: 'detail', label: 'Detail', render: (r) => <span className="text-[12px] text-ink-600">{r.detail || '—'}</span> },
          ]}
          rows={audit.data || []}
          pageSize={20}
          emptyTitle="No AI activity recorded"
        />
      </Card>
    </div>
  );
}

function F({ label, children }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-400">{label}</dt>
      <dd className="text-ink-800 mt-0.5">{children}</dd>
    </div>
  );
}
