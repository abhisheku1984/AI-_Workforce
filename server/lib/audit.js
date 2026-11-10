import { getDb, now } from '../db/index.js';

/**
 * Append-only audit trail. Every state-changing action and every sensitive read
 * (financial cost data, cross-scope analytics, AI queries) is recorded here.
 */
export function audit(req, { action, entityType, entityId, summary, meta, orgId }) {
  const u = req?.user;
  getDb()
    .prepare(
      `INSERT INTO audit_events (org_id, actor_user_id, actor_email, actor_role, action, entity_type, entity_id,
        summary, meta, ip, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      orgId ?? req?.orgId ?? u?.orgId ?? null,
      u?.user?.id ?? null,
      u?.user?.email ?? 'system',
      u?.roles?.map((r) => r.code).join(',') || null,
      action,
      entityType ?? null,
      entityId != null ? String(entityId) : null,
      summary,
      meta ? JSON.stringify(meta) : null,
      req?.ip ?? null,
      String(req?.headers?.['user-agent'] || '').slice(0, 250) || null,
      now()
    );
}

export function auditAi(req, { action, intent, provider, dataSent, resultStatus, detail, orgId }) {
  getDb()
    .prepare(
      `INSERT INTO ai_audit_events (org_id, user_id, action, intent, provider, data_sent, result_status, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      orgId ?? req?.orgId ?? req?.user?.orgId ?? null,
      req?.user?.user?.id ?? null,
      action,
      intent ?? null,
      provider ?? null,
      dataSent ? JSON.stringify(dataSent).slice(0, 4000) : null,
      resultStatus ?? null,
      detail ? String(detail).slice(0, 2000) : null,
      now()
    );
}
