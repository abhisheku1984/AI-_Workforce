/**
 * Commercial model configuration.
 *
 * Prices live in the database per organization (subscriptions table) and are
 * intentionally NOT presented as validated market prices. This module exposes the
 * pricing model so the founder can configure tiers and module bundles.
 */
import { getDb } from '../db/index.js';

export const PLAN_TIERS = [
  {
    code: 'starter',
    name: 'Starter',
    description: 'For a single delivery unit getting visibility for the first time.',
    includes: ['org_admin', 'data_ingestion', 'workforce', 'utilization', 'dashboards', 'reports'],
    optional: ['ai_assistant', 'ai_insights'],
    seatGuidance: 'Up to 10 named users',
    employeeBand: 'Up to 250 resources',
  },
  {
    code: 'professional',
    name: 'Professional',
    description: 'Full workforce + financial intelligence with AI assistance and recommendations.',
    includes: ['org_admin', 'data_ingestion', 'workforce', 'utilization', 'allocation', 'finance', 'dashboards', 'reports', 'ai_assistant', 'ai_insights'],
    optional: ['forecasting', 'automation'],
    seatGuidance: 'Up to 40 named users',
    employeeBand: 'Up to 2,000 resources',
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    description: 'Multi-business-unit governance, forecasting, automation and integration readiness.',
    includes: ['org_admin', 'data_ingestion', 'workforce', 'utilization', 'allocation', 'finance', 'dashboards', 'reports', 'ai_assistant', 'ai_insights', 'forecasting', 'automation', 'crm'],
    optional: [],
    seatGuidance: 'Unlimited named users',
    employeeBand: 'Unlimited resources',
  },
];

export function getSubscription(orgId) {
  const db = getDb();
  return db.prepare('SELECT * FROM subscriptions WHERE org_id = ? ORDER BY id DESC LIMIT 1').get(orgId) || null;
}

export function entitlementsFor(orgId) {
  return getDb().prepare(`SELECT e.module_code, e.status, e.limit_value, m.name, m.stage
      FROM org_entitlements e JOIN modules m ON m.code = e.module_code WHERE e.org_id = ? ORDER BY m.sort_order`).all(orgId);
}

export function usageSummary(orgId) {
  const db = getDb();
  const employees = db.prepare('SELECT COUNT(*) c FROM employees WHERE org_id = ?').get(orgId).c;
  const users = db.prepare('SELECT COUNT(*) c FROM users WHERE org_id = ?').get(orgId).c;
  const sub = getSubscription(orgId);
  const plan = PLAN_TIERS.find((p) => p.code === sub?.plan_code);
  return {
    employees, users,
    seats_limit: sub?.seats ?? null,
    seat_utilisation_pct: sub?.seats ? Math.round((users / sub.seats) * 100) : null,
    plan: plan?.code ?? null,
    plan_name: plan?.name ?? null,
    employee_band: plan?.employeeBand ?? null,
    warnings: [
      sub?.seats && users >= sub.seats ? 'All subscribed user seats are in use.' : null,
      sub?.status === 'trial' ? 'This organization is on a trial subscription.' : null,
    ].filter(Boolean),
  };
}
