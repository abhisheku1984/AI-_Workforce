/**
 * Controlled workflow automation.
 *
 * Safety model:
 *  - Every rule is customer-configured, org-scoped and disabled by default.
 *  - Actions are drawn from a closed allow-list. There is no shell, no external
 *    call and no employment/financial decision available.
 *  - Rules marked requires_approval create an approval request instead of executing.
 *  - Every run records initiator, approval, result and timestamp.
 */
import { getDb, now } from '../db/index.js';
import { generateInsights } from '../ai/insights.js';
import { generateReport } from './reports.js';
import { resolvePeriod, monthRange } from '../lib/capacity.js';

export const ACTION_TYPES = {
  generate_report: {
    label: 'Generate a report',
    description: 'Produces a downloadable report and stores it in report history.',
    defaultRequiresApproval: 0,
    schema: { report_code: ['utilization_summary', 'department_utilization', 'project_demand', 'workforce_cost', 'allocation_register', 'data_quality'] },
  },
  notify: {
    label: 'Send an internal notification',
    description: 'Creates an in-app notification for selected roles. No email is sent without an approved mail provider.',
    defaultRequiresApproval: 0,
    schema: { audience: ['org_admin', 'executive', 'workforce_manager', 'finance'] },
  },
  refresh_data: {
    label: 'Re-run analytics and insights',
    description: 'Recomputes insights for the current period. Read-only recalculation.',
    defaultRequiresApproval: 0,
    schema: {},
  },
  create_approval: {
    label: 'Raise an approval request',
    description: 'Creates a pending approval for a human to decide. Nothing else happens.',
    defaultRequiresApproval: 0,
    schema: {},
  },
  flag_insight: {
    label: 'Flag an insight for review',
    description: 'Marks matching open insights as acknowledged with a note.',
    defaultRequiresApproval: 0,
    schema: {},
  },
};

export const TRIGGER_TYPES = {
  schedule: { label: 'Schedule (monthly, on demand)', description: 'Run manually or at month end.' },
  event: { label: 'Event', description: 'Run after a data import is committed.' },
  manual: { label: 'Manual only', description: 'Run when a user clicks Run.' },
};

export function listRules(orgId) {
  return getDb().prepare('SELECT * FROM automation_rules WHERE org_id = ? ORDER BY name').all(orgId).map((r) => ({
    ...r,
    trigger_config: JSON.parse(r.trigger_config || '{}'),
    action_config: JSON.parse(r.action_config || '{}'),
    requires_approval: Boolean(r.requires_approval),
    enabled: Boolean(r.enabled),
  }));
}

export function createRule(principal, body) {
  const db = getDb();
  const { code, name, description, triggerType, triggerConfig = {}, actionType, actionConfig = {}, requiresApproval } = body;
  if (!code || !/^[A-Z0-9_]{3,40}$/.test(code)) {
    throw Object.assign(new Error('Rule code must be 3–40 characters: uppercase letters, numbers and underscores.'), { status: 400 });
  }
  if (!ACTION_TYPES[actionType]) throw Object.assign(new Error('Unsupported action type.'), { status: 400 });
  if (!TRIGGER_TYPES[triggerType]) throw Object.assign(new Error('Unsupported trigger type.'), { status: 400 });
  for (const [k, allowed] of Object.entries(ACTION_TYPES[actionType].schema)) {
    if (actionConfig[k] && !allowed.includes(actionConfig[k])) {
      throw Object.assign(new Error(`Invalid value for ${k}. Allowed: ${allowed.join(', ')}.`), { status: 400 });
    }
  }
  const info = db.prepare(`INSERT INTO automation_rules (org_id, code, name, description, trigger_type, trigger_config,
      action_type, action_config, requires_approval, enabled, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`)
    .run(principal.orgId, code, name || code, description ?? null, triggerType, JSON.stringify(triggerConfig),
      actionType, JSON.stringify(actionConfig),
      // SQLite accepts only numbers/strings/null — coerce booleans explicitly.
      (requiresApproval ?? ACTION_TYPES[actionType].defaultRequiresApproval) ? 1 : 0,
      principal.user.id, now(), now());
  return { id: info.lastInsertRowid };
}

export function setRuleEnabled(principal, id, enabled) {
  const db = getDb();
  const rule = db.prepare('SELECT * FROM automation_rules WHERE id = ? AND org_id = ?').get(id, principal.orgId);
  if (!rule) throw Object.assign(new Error('Rule not found.'), { status: 404 });
  db.prepare('UPDATE automation_rules SET enabled = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, now(), id);
  return { enabled: Boolean(enabled) };
}

/**
 * Run a rule. Returns either an executed result or an approval request.
 */
export function runRule(principal, ruleId, { approvedRequestId = null } = {}) {
  const db = getDb();
  const rule = db.prepare('SELECT * FROM automation_rules WHERE id = ? AND org_id = ?').get(ruleId, principal.orgId);
  if (!rule) throw Object.assign(new Error('Rule not found.'), { status: 404 });
  if (!rule.enabled && !approvedRequestId) {
    throw Object.assign(new Error('This automation rule is disabled. Enable it in Automation settings first.'), { status: 400 });
  }
  const actionConfig = JSON.parse(rule.action_config || '{}');

  // Sensitive action → create an approval request, do not execute.
  if (rule.requires_approval && !approvedRequestId) {
    const info = db.prepare(`INSERT INTO approval_requests (org_id, type, title, description, payload, risk_level, status, requested_by, created_at)
        VALUES (?, 'automation', ?, ?, ?, ?, 'pending', ?, ?)`)
      .run(principal.orgId, `Approve automation: ${rule.name}`, `Automation rule "${rule.name}" (${rule.action_type}) is configured to require approval before it runs.`,
        JSON.stringify({ rule_id: rule.id, action_type: rule.action_type, action_config: actionConfig }), 'medium', principal.user.id, now());
    db.prepare(`INSERT INTO automation_runs (org_id, rule_id, status, triggered_by, approval_id, detail, created_at)
        VALUES (?, ?, 'awaiting_approval', ?, ?, ?, ?)`)
      .run(principal.orgId, rule.id, principal.user.id, info.lastInsertRowid, 'Approval required before execution.', now());
    notifyRoles(principal.orgId, ['org_admin', 'executive'], 'Approval required', `Automation "${rule.name}" is waiting for approval.`, '/approvals');
    return { status: 'awaiting_approval', approvalId: info.lastInsertRowid };
  }

  const runInfo = db.prepare(`INSERT INTO automation_runs (org_id, rule_id, status, triggered_by, approval_id, created_at)
      VALUES (?, ?, 'queued', ?, ?, ?)`).run(principal.orgId, rule.id, principal.user.id, approvedRequestId, now());
  const runId = runInfo.lastInsertRowid;

  try {
    let detail;
    switch (rule.action_type) {
      case 'generate_report': {
        const code = actionConfig.report_code || 'utilization_summary';
        const period = resolvePeriod({ month: new Date().toISOString().slice(0, 7) });
        const rep = generateReport(principal, { code, period, format: 'csv' });
        detail = `Generated report "${code}" with ${rep.rowCount} rows.`;
        break;
      }
      case 'notify': {
        const audience = actionConfig.audience || 'org_admin';
        const n = notifyRoles(principal.orgId, [audience], 'Automation notification', rule.description || rule.name, '/insights');
        detail = `Sent ${n} in-app notification(s) to ${audience}.`;
        break;
      }
      case 'refresh_data': {
        const period = resolvePeriod({ month: new Date().toISOString().slice(0, 7) });
        const res = generateInsights(principal, { period });
        detail = `Recomputed analytics; ${res.generated} insight(s) refreshed.`;
        break;
      }
      case 'create_approval': {
        const info = db.prepare(`INSERT INTO approval_requests (org_id, type, title, description, payload, risk_level, status, requested_by, created_at)
            VALUES (?, 'insight_action', ?, ?, '{}', 'low', 'pending', ?, ?)`)
          .run(principal.orgId, `Review required: ${rule.name}`, rule.description || 'Automation requested a human review.', principal.user.id, now());
        detail = `Created approval request #${info.lastInsertRowid}.`;
        break;
      }
      case 'flag_insight': {
        const n = db.prepare(`UPDATE ai_insights SET status = 'acknowledged' WHERE org_id = ? AND status = 'open'`).run(principal.orgId).changes;
        detail = `Marked ${n} open insight(s) as acknowledged.`;
        break;
      }
      default:
        throw new Error(`Unsupported action ${rule.action_type}.`);
    }
    db.prepare(`UPDATE automation_runs SET status = 'succeeded', detail = ?, executed_at = ? WHERE id = ?`).run(detail, now(), runId);
    if (approvedRequestId) {
      db.prepare(`UPDATE approval_requests SET status = 'executed', executed_at = ? WHERE id = ?`).run(now(), approvedRequestId);
    }
    return { status: 'succeeded', runId, detail };
  } catch (err) {
    db.prepare(`UPDATE automation_runs SET status = 'failed', detail = ?, executed_at = ? WHERE id = ?`)
      .run(String(err.message).slice(0, 500), now(), runId);
    return { status: 'failed', runId, error: err.message };
  }
}

export function notifyRoles(orgId, roleCodes, title, body, link = null) {
  const db = getDb();
  const placeholders = roleCodes.map(() => '?').join(',');
  const users = db.prepare(`SELECT DISTINCT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id
      JOIN roles r ON r.id = ur.role_id WHERE u.org_id = ? AND u.status = 'active' AND r.code IN (${placeholders})`)
    .all(orgId, ...roleCodes);
  for (const u of users) {
    db.prepare(`INSERT INTO notifications (org_id, user_id, kind, title, body, link, created_at) VALUES (?, ?, 'automation', ?, ?, ?, ?)`)
      .run(orgId, u.id, title, body, link, now());
  }
  return users.length;
}

export function listRuns(orgId) {
  return getDb().prepare(`SELECT ar.*, r.name AS rule_name, u.full_name AS triggered_by_name
      FROM automation_runs ar JOIN automation_rules r ON r.id = ar.rule_id
      LEFT JOIN users u ON u.id = ar.triggered_by
      WHERE ar.org_id = ? ORDER BY ar.created_at DESC LIMIT 100`).all(orgId);
}

export function listApprovals(orgId, { status = null } = {}) {
  const db = getDb();
  const where = ['a.org_id = ?'];
  const params = [orgId];
  if (status) { where.push('a.status = ?'); params.push(status); }
  return db.prepare(`SELECT a.*, u.full_name AS requested_by_name, d.full_name AS decided_by_name
      FROM approval_requests a LEFT JOIN users u ON u.id = a.requested_by LEFT JOIN users d ON d.id = a.decided_by
      WHERE ${where.join(' AND ')} ORDER BY a.created_at DESC`).all(...params)
    .map((r) => ({ ...r, payload: JSON.parse(r.payload || '{}') }));
}

export { monthRange };
