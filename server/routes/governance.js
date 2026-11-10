import express from 'express';
import { getDb, now } from '../db/index.js';
import { ah, requireAuth, requirePermission, tenantContext } from '../auth/middleware.js';
import { requireOrg } from '../lib/guards.js';
import { audit } from '../lib/audit.js';
import { ApiError, ok } from '../lib/http.js';
import {
  listRules, createRule, setRuleEnabled, runRule, listRuns, listApprovals,
  ACTION_TYPES, TRIGGER_TYPES, notifyRoles,
} from '../services/automation.js';
import { usageSummary, PLAN_TIERS, getSubscription } from '../services/billing.js';
import { getOrgSettings, setOrgSetting, MODULE_CATALOGUE } from '../services/onboarding.js';

const router = express.Router();
router.use(requireAuth, tenantContext, requireOrg);

/* ------------------------------------------------------------------ automation */
router.get('/automation/rules', requirePermission('automation.manage'), ah(async (req, res) => ok(res, {
  rules: listRules(req.orgId),
  actionTypes: ACTION_TYPES,
  triggerTypes: TRIGGER_TYPES,
  runs: listRuns(req.orgId),
})));

router.post('/automation/rules', requirePermission('automation.manage'), ah(async (req, res) => {
  const result = createRule(req.user, req.body || {});
  audit(req, { action: 'automation.rule.created', entityType: 'automation_rule', entityId: result.id, summary: `Automation rule created: ${req.body?.name}`, meta: req.body });
  return ok(res, result);
}));

router.post('/automation/rules/:id/enable', requirePermission('automation.manage'), ah(async (req, res) => {
  const enabled = Boolean(req.body?.enabled);
  const result = setRuleEnabled(req.user, Number(req.params.id), enabled);
  audit(req, { action: enabled ? 'automation.rule.enabled' : 'automation.rule.disabled', entityType: 'automation_rule', entityId: req.params.id, summary: `Automation rule ${enabled ? 'enabled' : 'disabled'}` });
  return ok(res, result);
}));

router.post('/automation/rules/:id/run', requirePermission('automation.manage'), ah(async (req, res) => {
  const result = runRule(req.user, Number(req.params.id));
  audit(req, { action: 'automation.rule.run', entityType: 'automation_rule', entityId: req.params.id, summary: `Automation run: ${result.status}`, meta: result });
  if (result.status === 'awaiting_approval') {
    // Sensitive automations create a human decision point. Record the request in the
    // main audit trail too, so an auditor sees it without cross-referencing tables.
    audit(req, {
      action: 'approval.requested',
      entityType: 'approval',
      entityId: result.approvalId,
      summary: `Automation rule #${req.params.id} paused for human approval`,
      meta: { rule_id: Number(req.params.id), approval_id: result.approvalId },
    });
  }
  return ok(res, result);
}));

/* ------------------------------------------------------------------ approvals */
router.get('/approvals', requirePermission('approval.manage'), ah(async (req, res) => ok(res, listApprovals(req.orgId, { status: req.query.status || null }))));

router.post('/approvals/:id/decide', requirePermission('approval.manage'), ah(async (req, res) => {
  const db = getDb();
  const approval = db.prepare('SELECT * FROM approval_requests WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!approval) throw new ApiError(404, 'NOT_FOUND', 'Approval request not found.');
  if (approval.status !== 'pending') throw new ApiError(400, 'ALREADY_DECIDED', 'This request has already been decided.');
  const { decision, note } = req.body || {};
  if (!['approved', 'rejected'].includes(decision)) throw new ApiError(400, 'VALIDATION_FAILED', 'decision must be approved or rejected.');
  if (approval.requested_by === req.user.user.id) {
    throw new ApiError(403, 'SELF_APPROVAL', 'You cannot decide your own approval request. Ask another approver.');
  }
  db.prepare('UPDATE approval_requests SET status = ?, decided_by = ?, decision_note = ?, decided_at = ? WHERE id = ?')
    .run(decision, req.user.user.id, note ?? null, now(), approval.id);
  audit(req, { action: `approval.${decision}`, entityType: 'approval', entityId: approval.id, summary: `Approval "${approval.title}" ${decision}`, meta: { note } });

  let execution = null;
  if (decision === 'approved' && approval.type === 'automation') {
    const payload = JSON.parse(approval.payload || '{}');
    if (payload.rule_id) {
      execution = runRule(req.user, payload.rule_id, { approvedRequestId: approval.id });
      audit(req, { action: 'automation.executed_after_approval', entityType: 'automation_rule', entityId: payload.rule_id, summary: `Automation executed after approval #${approval.id}`, meta: execution });
    }
  }
  return ok(res, { status: decision, execution });
}));

/* ------------------------------------------------------------------ notifications */
router.get('/notifications', requireAuth, ah(async (req, res) => {
  const rows = getDb().prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.user.user.id);
  return ok(res, rows);
}));

router.post('/notifications/:id/read', requireAuth, ah(async (req, res) => {
  getDb().prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?').run(now(), req.params.id, req.user.user.id);
  return ok(res, { read: true });
}));

/* ------------------------------------------------------------------ commercial */
router.get('/subscription', requirePermission('org.view'), ah(async (req, res) => ok(res, {
  subscription: getSubscription(req.orgId),
  usage: usageSummary(req.orgId),
  plan_tiers: PLAN_TIERS,
  currency: req.user.org?.currency || 'INR',
  disclaimer: 'Tier definitions and prices are internal planning placeholders configured in the platform. They have not been validated with customers and are not a published price list.',
  modules: MODULE_CATALOGUE,
})));

/* ------------------------------------------------------------------ data lifecycle */
router.post('/data/deletion-requests', requirePermission('org.manage'), ah(async (req, res) => {
  const { scope, target_id, reason } = req.body || {};
  if (!['import', 'entity', 'org'].includes(scope)) throw new ApiError(400, 'VALIDATION_FAILED', 'scope must be import, entity or org.');
  const id = getDb().prepare(`INSERT INTO deletion_requests (org_id, scope, target_id, reason, requested_by, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)`)
    .run(req.orgId, scope, target_id ?? null, reason ?? null, req.user.user.id, now()).lastInsertRowid;
  audit(req, { action: 'deletion.requested', entityType: 'deletion_request', entityId: id, summary: `Deletion requested for ${scope}`, meta: { scope, target_id, reason } });
  return ok(res, { id, status: 'pending', note: 'A second administrator must approve this request before anything is deleted.' });
}));

router.post('/data/deletion-requests/:id/decide', requirePermission('org.manage'), ah(async (req, res) => {
  const db = getDb();
  const request = db.prepare('SELECT * FROM deletion_requests WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!request) throw new ApiError(404, 'NOT_FOUND', 'Deletion request not found.');
  if (request.status !== 'pending') throw new ApiError(400, 'ALREADY_DECIDED', 'This request has already been processed.');
  if (request.requested_by === req.user.user.id) throw new ApiError(403, 'SELF_APPROVAL', 'A second administrator must approve a deletion.');
  const { decision } = req.body || {};
  if (!['approved', 'rejected'].includes(decision)) throw new ApiError(400, 'VALIDATION_FAILED', 'decision must be approved or rejected.');

  if (decision === 'rejected') {
    db.prepare('UPDATE deletion_requests SET status = ?, approved_by = ?, executed_at = ? WHERE id = ?').run('rejected', req.user.user.id, now(), request.id);
    audit(req, { action: 'deletion.rejected', entityType: 'deletion_request', entityId: request.id, summary: 'Deletion request rejected' });
    return ok(res, { status: 'rejected' });
  }

  let detail = null;
  const run = db.transaction(() => {
    if (request.scope === 'import') {
      const imp = db.prepare('SELECT * FROM imports WHERE id = ? AND org_id = ?').get(request.target_id, req.orgId);
      if (!imp) throw new ApiError(404, 'NOT_FOUND', 'Import not found.');
      db.prepare('DELETE FROM import_rows WHERE import_id = ?').run(imp.id);
      db.prepare('DELETE FROM imports WHERE id = ?').run(imp.id);
      detail = `Import #${imp.id} (${imp.filename}) and its rows deleted. Master records loaded from it remain; see entity scope for those.`;
    } else if (request.scope === 'entity') {
      // Deleting a whole entity type is deliberately not automated.
      throw new ApiError(400, 'MANUAL_REVIEW_REQUIRED', 'Entity-type deletion requires a maintenance window and is not executed in-app. This request has been recorded for your platform administrator.');
    } else {
      throw new ApiError(400, 'MANUAL_REVIEW_REQUIRED', 'Deletion of an entire organization requires platform administrator action and is not performed in the app.');
    }
    db.prepare('UPDATE deletion_requests SET status = ?, approved_by = ?, executed_at = ?, detail = ? WHERE id = ?')
      .run('executed', req.user.user.id, now(), detail, request.id);
  });
  run();
  audit(req, { action: 'deletion.executed', entityType: 'deletion_request', entityId: request.id, summary: detail || 'Deletion executed' });
  return ok(res, { status: 'executed', detail });
}));

router.get('/data/deletion-requests', requirePermission('org.manage'), ah(async (req, res) => ok(res,
  getDb().prepare(`SELECT d.*, u.full_name AS requested_by_name, a.full_name AS approved_by_name FROM deletion_requests d
      LEFT JOIN users u ON u.id = d.requested_by LEFT JOIN users a ON a.id = d.approved_by
      WHERE d.org_id = ? ORDER BY d.created_at DESC`).all(req.orgId))));

/** Full tenant data export (JSON) — portability requirement. */
router.get('/data/export', requirePermission('org.manage'), ah(async (req, res) => {
  const db = getDb();
  const tables = ['organizations', 'business_units', 'departments', 'locations', 'employees', 'skills', 'employee_skills',
    'projects', 'project_demand', 'allocations', 'timesheets', 'invoices', 'expenses', 'imports', 'ai_insights', 'forecasts',
    'automation_rules', 'approval_requests', 'audit_events'];
  const dump = {};
  for (const t of tables) {
    const hasOrg = db.prepare(`PRAGMA table_info(${t})`).all().some((c) => c.name === 'org_id');
    dump[t] = hasOrg ? db.prepare(`SELECT * FROM ${t} WHERE org_id = ?`).all(req.orgId) : [];
  }
  dump.__meta = {
    exported_at: now(), exported_by: req.user.user.email, organization_id: req.orgId,
    note: 'This is a full export of your organization data. It excludes password hashes and session tokens.',
  };
  audit(req, { action: 'data.exported', entityType: 'organization', entityId: req.orgId, summary: 'Full organization data export downloaded', meta: { tables: Object.keys(dump) } });
  res.setHeader('Content-Disposition', `attachment; filename="workforceiq_export_${req.orgId}_${Date.now()}.json"`);
  res.setHeader('Content-Type', 'application/json');
  return res.send(JSON.stringify(dump, null, 2));
}));

/** Platform admin overview (all tenants). Never exposes tenant records, only counts. */
router.get('/platform/organizations', ah(async (req, res) => {
  if (!req.user.isPlatformAdmin) throw new ApiError(403, 'FORBIDDEN', 'Platform administrator access required.');
  const db = getDb();
  const orgs = db.prepare(`SELECT o.*, 
      (SELECT COUNT(*) FROM users u WHERE u.org_id = o.id) users,
      (SELECT COUNT(*) FROM employees e WHERE e.org_id = o.id) employees,
      (SELECT COUNT(*) FROM projects p WHERE p.org_id = o.id) projects
      FROM organizations o ORDER BY o.created_at DESC`).all();
  return ok(res, orgs.map((o) => ({
    id: o.id, name: o.name, slug: o.slug, industry: o.industry, country: o.country, status: o.status,
    created_at: o.created_at, users: o.users, employees: o.employees, projects: o.projects,
  })));
}));

export default router;
