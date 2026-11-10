/**
 * Organization provisioning: default structure, roles, settings and entitlements.
 * Called when a customer tenant is created and by the demo seeder.
 */
import { getDb, now } from '../db/index.js';
import { ROLE_TEMPLATES } from '../auth/permissions.js';

export const MODULE_CATALOGUE = [
  { code: 'org_admin', name: 'Organization & Administration', description: 'Structure, users, roles, settings and audit.', stage: 'core', sort_order: 1 },
  { code: 'data_ingestion', name: 'Data Ingestion', description: 'Excel/CSV upload, mapping, validation and lineage.', stage: 'core', sort_order: 2 },
  { code: 'workforce', name: 'Workforce Intelligence', description: 'Employee, skill and capacity records.', stage: 'core', sort_order: 3 },
  { code: 'utilization', name: 'Utilization Analytics', description: 'Capacity, allocation and utilization reporting.', stage: 'core', sort_order: 4 },
  { code: 'allocation', name: 'Resource Allocation & Demand', description: 'Project demand, allocations and gap analysis.', stage: 'core', sort_order: 5 },
  { code: 'finance', name: 'Financial Intelligence', description: 'Cost, billing, revenue and margin analysis.', stage: 'core', sort_order: 6 },
  { code: 'dashboards', name: 'Executive Dashboards', description: 'Role-aware dashboards and drill-downs.', stage: 'core', sort_order: 7 },
  { code: 'reports', name: 'Management Reports', description: 'Downloadable reports with lineage metadata.', stage: 'core', sort_order: 8 },
  { code: 'ai_assistant', name: 'AI Business Assistant', description: 'Grounded natural-language answers with evidence.', stage: 'ai', sort_order: 9 },
  { code: 'ai_insights', name: 'AI Recommendations', description: 'Evidence-backed insights and review workflow.', stage: 'ai', sort_order: 10 },
  { code: 'forecasting', name: 'Forecasting & Predictive Intelligence', description: 'Trend forecasts with stated limitations.', stage: 'predictive', sort_order: 11 },
  { code: 'automation', name: 'Workflow Automation', description: 'Approval-gated automation rules and notifications.', stage: 'automation', sort_order: 12 },
];

export function ensureModuleCatalogue() {
  const db = getDb();
  const stmt = db.prepare(`INSERT INTO modules (code, name, description, stage, sort_order) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET name = excluded.name, description = excluded.description, stage = excluded.stage, sort_order = excluded.sort_order`);
  for (const m of MODULE_CATALOGUE) stmt.run(m.code, m.name, m.description, m.stage, m.sort_order);
}

const DEFAULT_MODULES = ['org_admin', 'data_ingestion', 'workforce', 'utilization', 'allocation', 'finance', 'dashboards', 'reports', 'ai_assistant', 'ai_insights'];

export function seedOrgDefaults(orgId, { modules = DEFAULT_MODULES, planCode = 'professional', seats = 10 } = {}) {
  const db = getDb();
  const ts = now();
  ensureModuleCatalogue();

  // System role templates, cloned per organization so they can be customised.
  for (const t of ROLE_TEMPLATES) {
    const exists = db.prepare('SELECT id FROM roles WHERE org_id = ? AND code = ?').get(orgId, t.code);
    if (!exists) {
      db.prepare(`INSERT INTO roles (org_id, code, name, description, permissions, is_system, created_at)
          VALUES (?, ?, ?, ?, ?, 1, ?)`)
        .run(orgId, t.code, t.name, t.description, JSON.stringify(t.permissions), ts);
    }
  }

  for (const code of modules) {
    db.prepare(`INSERT INTO org_entitlements (org_id, module_code, status, activated_at) VALUES (?, ?, 'active', ?)
        ON CONFLICT(org_id, module_code) DO NOTHING`).run(orgId, code, ts);
  }

  const plan = {
    starter: { fee: 25000, setup: 0 },
    professional: { fee: 45000, setup: 25000 },
    enterprise: { fee: 90000, setup: 60000 },
  }[planCode] || { fee: 45000, setup: 25000 };

  const renews = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  db.prepare(`INSERT INTO subscriptions (org_id, plan_code, status, seats, monthly_fee, setup_fee, currency, billing_cycle, started_at, renews_at, notes)
      VALUES (?, ?, 'trial', ?, ?, ?, 'INR', 'monthly', ?, ?, ?)`)
    .run(orgId, planCode, seats, plan.fee, plan.setup, ts.slice(0, 10), renews,
      'Prices are configurable placeholders for internal planning and have not been validated with customers.');

  const settings = {
    utilization: {
      basis: 'available_hours',
      exclude_leave: true,
      count_weekends: false,
      small_firm_threshold_pct: 80,
      target_utilization_pct: 75,
    },
    cost: { include_cost_in_reports: true, cost_basis: 'annual_cost' },
    ai: {
      enabled: true,
      external_model_allowed: false,
      allow_employee_names: false,
      require_evidence: true,
    },
    data: { retention_days: 1095, raw_retention_days: 365, allow_export: true, allow_deletion: true },
    notifications: { email_enabled: false, in_app_enabled: true },
    branding: { display_name: null, accent: 'indigo' },
  };
  for (const [k, v] of Object.entries(settings)) {
    db.prepare(`INSERT INTO org_settings (org_id, key, value, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(org_id, key) DO NOTHING`).run(orgId, k, JSON.stringify(v), ts);
  }

  // Default locations / structure — deliberately empty so no invented data appears.
  return { orgId };
}

export function getOrgSettings(orgId) {
  const rows = getDb().prepare('SELECT key, value FROM org_settings WHERE org_id = ?').all(orgId);
  const out = {};
  for (const r of rows) { try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; } }
  return out;
}

export function setOrgSetting(orgId, key, value, userId) {
  getDb().prepare(`INSERT INTO org_settings (org_id, key, value, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(org_id, key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .run(orgId, key, JSON.stringify(value), userId, now());
}
