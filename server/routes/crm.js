import express from 'express';
import { ah, requireAuth, requirePermission, tenantContext } from '../auth/middleware.js';
import { requireOrg } from '../lib/guards.js';
import { ok } from '../lib/http.js';
import { getDb } from '../db/index.js';
import { audit } from '../lib/audit.js';
import {
  TOPICS, STAGES, appendUtterance, approveDraft, createDraft, getDraft, getLead,
  listLeads, pipelineSummary, rejectDraft, submitDraft,
} from '../services/crm.js';

const router = express.Router();
router.use(requireAuth, tenantContext, requireOrg);

/* ------------------------------------------------------------------ meta */

router.get('/meta', requirePermission('crm.view'), ah(async (_req, res) => ok(res, {
  topics: TOPICS,
  stages: STAGES,
  note: 'A draft never writes to the dataset. It is submitted for approval, and approval is what appends it.',
})));

router.get('/summary', requirePermission('crm.view'), ah(async (req, res) => ok(res, pipelineSummary(req.user))));

/* ------------------------------------------------------------------ leads */

router.get('/leads', requirePermission('crm.view'), ah(async (req, res) => ok(res, listLeads(req.user, {
  stage: req.query.stage, search: req.query.search, limit: req.query.limit,
}))));

router.get('/leads/:id', requirePermission('crm.view'), ah(async (req, res) => ok(res, getLead(req.user, req.params.id))));

/* ------------------------------------------------------------------ AI drafting
 *
 * The topic is selected first ("create a lead"), then the client sends one utterance at a time —
 * including continuations beginning with "and". Each call returns the draft plus a plain reply
 * the client can speak. Nothing lands in crm_leads until a human approves.
 */

router.post('/ai/sessions', requirePermission('crm.draft'), ah(async (req, res) => {
  const { topic } = req.body || {};
  const draft = createDraft(req.user, { topic });
  return ok(res, { draft, reply: `Starting a ${draft.topic.replace('_', ' ')}. Tell me the details, or ask me to stop.` });
}));

router.get('/ai/sessions/:id', requirePermission('crm.draft'), ah(async (req, res) =>
  ok(res, getDraft(req.user, req.params.id))));

router.post('/ai/sessions/:id/utterance', requirePermission('crm.draft'), ah(async (req, res) => {
  const { text, via = 'text' } = req.body || {};
  const result = appendUtterance(req.user, req.params.id, text, { via });
  return ok(res, result);
}));

router.post('/ai/sessions/:id/submit', requirePermission('crm.draft'), ah(async (req, res) =>
  ok(res, submitDraft(req.user, req.params.id))));

router.get('/ai/pending', requirePermission('crm.approve'), ah(async (req, res) => {
  const rows = getDb().prepare(`SELECT s.*, u.email AS requested_by_email FROM crm_ai_sessions s
      LEFT JOIN users u ON u.id = s.user_id
      WHERE s.org_id = ? AND s.status = 'pending_approval' ORDER BY s.submitted_at`).all(req.orgId);
  return ok(res, rows.map((r) => ({
    id: r.id,
    topic: r.topic,
    requestedBy: r.requested_by_email,
    submittedAt: r.submitted_at,
    fields: JSON.parse(r.fields || '{}'),
    confidence: r.confidence,
    transcripts: JSON.parse(r.transcripts || '[]'),
  })));
}));

router.post('/ai/sessions/:id/approve', requirePermission('crm.approve'), ah(async (req, res) =>
  ok(res, approveDraft(req, req.params.id))));

router.post('/ai/sessions/:id/reject', requirePermission('crm.approve'), ah(async (req, res) =>
  ok(res, rejectDraft(req, req.params.id, req.body?.note))));

/* ------------------------------------------------------------------ direct edits (non-AI)
 *
 * Kept narrow on purpose: a human editing a lead directly is a different action from approving
 * what the assistant drafted, and it is audited as such.
 */
router.patch('/leads/:id', requirePermission('crm.manage'), ah(async (req, res) => {
  const db = getDb();
  const lead = db.prepare('SELECT * FROM crm_leads WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!lead) return ok(res, null);
  const allowed = ['stage', 'next_step', 'next_step_date', 'probability', 'estimated_value', 'notes', 'owner_email'];
  const changes = Object.fromEntries(Object.entries(req.body || {}).filter(([k]) => allowed.includes(k)));
  if (!Object.keys(changes).length) return ok(res, { changed: 0 });
  db.prepare(`UPDATE crm_leads SET ${Object.keys(changes).map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
    .run(...Object.values(changes), new Date().toISOString(), lead.id);
  audit(req, {
    action: 'crm.lead.updated', entityType: 'crm_lead', entityId: lead.id,
    summary: `Lead ${lead.lead_code} updated (${Object.keys(changes).join(', ')})`,
    meta: { before: Object.fromEntries(Object.keys(changes).map((k) => [k, lead[k]])), after: changes },
  });
  return ok(res, getLead(req.user, lead.id));
}));

export default router;
