import express from 'express';
import { getDb, now } from '../db/index.js';
import { ah, requireAuth, requirePermission, tenantContext } from '../auth/middleware.js';
import { requireOrg } from '../lib/guards.js';
import { ApiError, ok } from '../lib/http.js';
import { answerQuestion } from '../ai/assistant.js';
import { generateInsights, listInsights } from '../ai/insights.js';
import { generateForecast, listForecasts } from '../services/forecasting.js';
import { resolvePeriod } from '../lib/capacity.js';
import { audit } from '../lib/audit.js';
import { buildFactPack, scanForInjection } from '../services/grounding.js';
import { askAnything, coverage } from '../services/askAnything.js';
import { aiConfigured, config } from '../config.js';
import { applyAction, listActions, stageAction } from '../services/assistantActions.js';

const router = express.Router();
router.use(requireAuth, tenantContext, requireOrg);

/* ------------------------------------------------------------------ assistant */
/**
 * Ask the assistant anything.
 *
 * Order of preference:
 *   1. The specific intent engine (capacity, allocation, cost, forecast …) because it produces
 *      the richest answer with evidence and assumptions.
 *   2. The general engine, which answers from whatever table the question refers to.
 *   3. Neither: the intent engine's refusal is returned, but with the general engine's
 *      suggestions attached, so the user is never left at a dead end.
 */
router.post('/assistant/ask', requirePermission('ai.assistant'), ah(async (req, res) => {
  const { question, period, filters = {}, conversationId = null } = req.body || {};
  if (!question || String(question).trim().length < 3) throw new ApiError(400, 'VALIDATION_FAILED', 'Please type a question.');
  const resolved = period ? resolvePeriod(period) : resolvePeriod({ month: new Date().toISOString().slice(0, 7) });

  const result = await answerQuestion(req.user, { question, period: resolved, filters, conversationId });
  if (result.intent !== 'unknown' && !result.refused) return ok(res, result);

  // Fall through to the general engine.
  const general = askAnything(req.user, question);
  if (!general.refused) {
    return ok(res, {
      ...result,
      answer: general.answer,
      intent: general.subject ? `general:${general.subject}` : 'general',
      evidence: general.evidence,
      confidence: general.confidence,
      limitations: general.limitations || result.limitations,
      assumptions: [],
      sources: [general.subjectLabel || 'Record counts from this organisation’s data'],
      nextStep: null,
      engine: 'general',
    });
  }

  return ok(res, {
    ...result,
    answer: general.answer || result.answer,
    suggestions: general.suggestions || [],
    engine: 'refused',
  });
}));

/** Everything this assistant can see, so "what is in the database?" has a real answer. */
router.get('/assistant/coverage', requirePermission('ai.assistant'), ah(async (req, res) =>
  ok(res, coverage(req.user))));

router.get('/assistant/suggestions', requirePermission('ai.assistant'), ah(async (_req, res) => ok(res, {
  suggestions: [
    'Which departments have the highest unallocated capacity?',
    'Where are we experiencing over-allocation?',
    'Which projects have staffing gaps?',
    'How has utilization changed this quarter?',
    'Which business units have increasing workforce costs?',
    'What operational risks should management review?',
    'What additional information is required to produce a reliable forecast?',
    'How many people are in scope and how much capacity do they have?',
  ],
  provider: aiConfigured() ? `${config.ai.provider}:${config.ai.model}` : 'local-deterministic',
  note: 'Answers are generated from your authorised data only. Every answer shows its evidence, assumptions and limitations.',
})));

router.get('/assistant/conversations', requirePermission('ai.assistant'), ah(async (req, res) => {
  const rows = getDb().prepare(`SELECT id, title, created_at, updated_at FROM ai_conversations
      WHERE org_id = ? AND user_id = ? ORDER BY updated_at DESC LIMIT 30`).all(req.orgId, req.user.user.id);
  return ok(res, rows);
}));

router.get('/assistant/conversations/:id', requirePermission('ai.assistant'), ah(async (req, res) => {
  const db = getDb();
  const convo = db.prepare('SELECT * FROM ai_conversations WHERE id = ? AND org_id = ? AND user_id = ?')
    .get(req.params.id, req.orgId, req.user.user.id);
  if (!convo) throw new ApiError(404, 'NOT_FOUND', 'Conversation not found.');
  const messages = db.prepare('SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY created_at').all(convo.id)
    .map((m) => ({
      ...m,
      evidence: m.evidence ? JSON.parse(m.evidence) : null,
      assumptions: m.assumptions ? JSON.parse(m.assumptions) : [],
      limitations: m.limitations ? JSON.parse(m.limitations) : [],
    }));
  return ok(res, { conversation: convo, messages });
}));

/** Inspect exactly which facts would be sent for a question (transparency). */
router.get('/assistant/fact-preview', requirePermission('ai.assistant'), ah(async (req, res) => {
  const question = String(req.query.question || '');
  const injection = scanForInjection(question);
  const facts = buildFactPack(req.user, { question });
  return ok(res, {
    provider: aiConfigured() ? `${config.ai.provider}:${config.ai.model}` : 'local-deterministic',
    external_calls_made: aiConfigured(),
    injection_check: injection,
    facts,
  });
}));

/* ------------------------------------------------------------------ insights */
router.get('/insights', requirePermission('ai.insights'), ah(async (req, res) => {
  const rows = listInsights(req.user, { status: req.query.status || null, category: req.query.category || null });
  return ok(res, rows);
}));

router.post('/insights/generate', requirePermission('ai.insights'), ah(async (req, res) => {
  const resolved = req.body?.period ? resolvePeriod(req.body.period) : resolvePeriod({ month: new Date().toISOString().slice(0, 7) });
  const result = generateInsights(req.user, { period: resolved, filters: req.body?.filters || {} });
  audit(req, { action: 'insights.generated', entityType: 'ai_insight', summary: `Generated ${result.generated} insights for ${resolved.label}`, meta: { codes: result.codes } });
  return ok(res, result);
}));

router.post('/insights/:id/review', requirePermission('ai.insights'), ah(async (req, res) => {
  const db = getDb();
  const insight = db.prepare('SELECT * FROM ai_insights WHERE id = ? AND org_id = ?').get(req.params.id, req.orgId);
  if (!insight) throw new ApiError(404, 'NOT_FOUND', 'Insight not found.');
  const { decision, note } = req.body || {};
  if (!['acknowledged', 'actioned', 'dismissed'].includes(decision)) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'decision must be acknowledged, actioned or dismissed.');
  }
  db.prepare('UPDATE ai_insights SET status = ? WHERE id = ?').run(decision, insight.id);
  db.prepare('INSERT INTO insight_reviews (org_id, insight_id, user_id, decision, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.orgId, insight.id, req.user.user.id, decision, note ?? null, now());
  audit(req, { action: 'insight.reviewed', entityType: 'ai_insight', entityId: insight.id, summary: `Insight "${insight.title}" marked ${decision}`, meta: { note } });
  return ok(res, { status: decision });
}));

router.get('/insights/:id/reviews', requirePermission('ai.insights'), ah(async (req, res) => {
  const rows = getDb().prepare(`SELECT r.*, u.full_name AS reviewer FROM insight_reviews r
      LEFT JOIN users u ON u.id = r.user_id WHERE r.org_id = ? AND r.insight_id = ? ORDER BY r.created_at DESC`)
    .all(req.orgId, req.params.id);
  return ok(res, rows);
}));

/* ------------------------------------------------------------------ forecasting */
router.post('/forecast', requirePermission('forecast.view'), ah(async (req, res) => {
  const { kind = 'utilization', horizonMonths = 3, filters = {} } = req.body || {};
  const result = generateForecast(req.user, { kind, horizonMonths, filters });
  audit(req, { action: 'forecast.generated', entityType: 'forecast', entityId: result.id, summary: `Generated ${kind} forecast (${horizonMonths} months)`, meta: { refused: Boolean(result.refused) } });
  return ok(res, result);
}));

router.get('/forecast/history', requirePermission('forecast.view'), ah(async (req, res) => ok(res, listForecasts(req.user))));

/* ------------------------------------------------------------------ assistant actions
 *
 * Two steps, deliberately. `/actions/stage` validates and returns a human-readable preview;
 * `/actions/apply` performs it. Nothing changes on the strength of a single request, which is
 * what makes a misheard voice instruction harmless.
 */
router.get('/assistant/actions', requirePermission('ai.assistant'), ah(async (_req, res) => ok(res, { actions: listActions() })));

router.post('/assistant/actions/stage', requirePermission('ai.assistant'), ah(async (req, res) => {
  const result = stageAction(req.user, req.body || {}, { via: req.body?.via === 'voice' ? 'voice' : 'text' });
  // Staging is not audited as a change — nothing changed. It is logged for traceability.
  audit(req, {
    action: 'ai.action.staged', entityType: 'assistant_action',
    summary: `Assistant staged ${req.body?.action || 'an action'} (${result.ok ? 'ready to confirm' : result.code})`,
    meta: { action: req.body?.action, ok: result.ok, code: result.code ?? null, via: req.body?.via || 'text' },
  });
  return ok(res, result);
}));

router.post('/assistant/actions/apply', requirePermission('ai.assistant'), ah(async (req, res) => {
  const { action, payload, via } = req.body || {};
  if (!action || !payload) throw new ApiError(400, 'VALIDATION_FAILED', 'An action and its confirmed payload are required.');
  const result = applyAction(req, { action, payload, via: via === 'voice' ? 'voice' : 'text' });
  return ok(res, result);
}));

/* ------------------------------------------------------------------ AI governance */
router.get('/governance', requirePermission('ai.assistant'), ah(async (req, res) => {
  const db = getDb();
  const orgSettings = db.prepare(`SELECT key, value FROM org_settings WHERE org_id = ? AND key = 'ai'`).get(req.orgId);
  const recent = db.prepare(`SELECT action, result_status, COUNT(*) c FROM ai_audit_events WHERE org_id = ?
      GROUP BY action, result_status`).all(req.orgId);
  return ok(res, {
    provider: aiConfigured() ? `${config.ai.provider}:${config.ai.model}` : 'local-deterministic',
    external_provider_configured: aiConfigured(),
    organisation_ai_settings: orgSettings ? JSON.parse(orgSettings.value) : null,
    data_handling: {
      employee_names_to_external_model: aiConfigured() ? config.ai.allowEmployeeNames : false,
      facts_only_aggregates: true,
      tenant_filtering: 'Every fact pack is built from the requesting user’s organisation and data scope.',
      injection_protection: 'Injected instructions are detected and blocked before any data is retrieved. Uploaded content is treated as data, never instructions.',
      output_verification: 'If an external model is enabled, every number it produces is checked against the authorised facts; unsupported answers are replaced with the verified analytical answer.',
    },
    recent_activity: recent,
    data_retention_note: 'AI conversations are retained per the organisation data-retention setting and can be deleted by an administrator.',
  });
}));

router.delete('/assistant/conversations/:id', requirePermission('ai.assistant'), ah(async (req, res) => {
  const db = getDb();
  const convo = db.prepare('SELECT * FROM ai_conversations WHERE id = ? AND org_id = ? AND user_id = ?').get(req.params.id, req.orgId, req.user.user.id);
  if (!convo) throw new ApiError(404, 'NOT_FOUND', 'Conversation not found.');
  db.prepare('DELETE FROM ai_conversations WHERE id = ?').run(convo.id);
  audit(req, { action: 'ai.conversation.deleted', entityType: 'ai_conversation', entityId: convo.id, summary: 'AI conversation deleted by owner' });
  return ok(res, { deleted: true });
}));

export default router;
