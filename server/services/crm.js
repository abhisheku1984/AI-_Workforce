/**
 * CRM drafting and retrieval.
 *
 * Two responsibilities, both narrow:
 *
 *  1. **Drafting.** Take a topic ("create a lead") and a series of utterances — typed or spoken,
 *     including ones that begin with "and" — and fill a structured record incrementally. The
 *     result is a *draft*: it is written to crm_ai_sessions, never to crm_leads. A human
 *     approves it, and only then does it append to the dataset.
 *
 *  2. **Answering.** Turn a plain question into an answer from the CRM tables, with the same
 *     discipline as the rest of the assistant: it says what it does not have rather than
 *     inventing a value.
 */
import { getDb, now } from '../db/index.js';
import { ApiError } from '../lib/http.js';
import { audit } from '../lib/audit.js';
import { parseDate, parseNumber } from './assistantActions.js';

/* ------------------------------------------------------------------ field definitions */

export const FIELDS = {
  create_lead: {
    label: 'New lead',
    fields: [
      { key: 'company', label: 'Company', required: true, aliases: ['company', 'organisation', 'organization', 'client', 'account', 'firm'] },
      { key: 'contact_name', label: 'Contact name', required: true, aliases: ['contact', 'contact name', 'person', 'name'] },
      { key: 'contact_email', label: 'Email', required: false, aliases: ['email', 'mail', 'email id', 'e mail'] },
      { key: 'contact_phone', label: 'Phone', required: false, aliases: ['phone', 'mobile', 'number', 'contact number', 'cell'] },
      { key: 'industry', label: 'Industry', required: false, aliases: ['industry', 'sector', 'vertical', 'domain'] },
      { key: 'city', label: 'City', required: false, aliases: ['city', 'location', 'town'] },
      { key: 'source', label: 'Source', required: false, aliases: ['source', 'came from', 'referred by', 'lead source'] },
      { key: 'estimated_value', label: 'Estimated value', required: false, aliases: ['value', 'deal value', 'amount', 'budget', 'worth'] },
      { key: 'stage', label: 'Stage', required: false, aliases: ['stage', 'status', 'pipeline'] },
      { key: 'next_step', label: 'Next step', required: false, aliases: ['next step', 'follow up', 'action'] },
      { key: 'next_step_date', label: 'Next step date', required: false, aliases: ['next step date', 'next step on', 'next date', 'follow up on', 'follow up date', 'by'] },
      { key: 'notes', label: 'Notes', required: false, aliases: ['note', 'notes', 'remark', 'remarks', 'comment'] },
    ],
  },
  update_lead: {
    label: 'Update a lead',
    fields: [
      { key: 'company', label: 'Lead (company)', required: true, aliases: ['company', 'client', 'account', 'lead'] },
      { key: 'stage', label: 'Stage', required: false, aliases: ['stage', 'status', 'move to'] },
      { key: 'next_step', label: 'Next step', required: false, aliases: ['next step', 'follow up'] },
      { key: 'next_step_date', label: 'Next step date', required: false, aliases: ['next step date', 'next step on', 'next date', 'follow up date', 'by'] },
      { key: 'estimated_value', label: 'Estimated value', required: false, aliases: ['value', 'amount', 'budget'] },
      { key: 'probability', label: 'Probability %', required: false, aliases: ['probability', 'chance', 'confidence'] },
      { key: 'notes', label: 'Notes', required: false, aliases: ['note', 'notes', 'remark'] },
    ],
  },
  log_activity: {
    label: 'Log an activity',
    fields: [
      { key: 'company', label: 'Lead (company)', required: true, aliases: ['company', 'client', 'lead'] },
      { key: 'activity', label: 'What happened', required: true, aliases: ['activity', 'happened', 'did', 'spoke', 'call', 'meeting'] },
      { key: 'next_step', label: 'Next step', required: false, aliases: ['next step', 'follow up'] },
    ],
  },
};

export const TOPICS = Object.entries(FIELDS).map(([name, def]) => ({
  name,
  label: def.label,
  required: def.fields.filter((f) => f.required).map((f) => f.label),
  fields: def.fields.map(({ key, label, required }) => ({ key, label, required })),
}));

export const STAGES = ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost', 'disqualified'];

/* ------------------------------------------------------------------ utterance parsing */

/** Normalise a label to a field key ("Contact name" -> "contact_name"). */
const slug = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

/** Find the field an alias refers to, longest alias first so "next step date" beats "date". */
function fieldForAlias(topic, phrase) {
  const def = FIELDS[topic];
  if (!def) return null;
  const needle = String(phrase || '').toLowerCase().trim();
  if (!needle) return null;
  let best = null;
  let bestLen = 0;
  for (const field of def.fields) {
    for (const alias of field.aliases || []) {
      // Word-boundary match: "value" must not match inside "estimated value" for a *different*
      // field, and "next step" must not win over "next step date".
      const re = new RegExp(`(^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
      if (re.test(needle) && alias.length > bestLen) {
        best = field.key;
        bestLen = alias.length;
      }
    }
  }
  return best;
}

/**
 * Parse one utterance into field values.
 *
 * Handles the three shapes people actually use:
 *   "Company is Acme Corp"                → key/value
 *   "Acme Corp, contact is Priya Sharma"  → implicit first value, then key/value
 *   "and the value is 25 lakh"            → continuation; "and" carries no meaning
 */
export function parseUtterance(topic, text, existing = {}) {
  const def = FIELDS[topic];
  if (!def) return { values: {}, unmatched: String(text || '') };

  // Strip leading connectives so a continuation reads the same as a fresh sentence.
  // Deliberately NOT "next": "next step" is a field, and stripping it turned
  // "next step is call the CFO" into the company name "step is call the CFO".
  let working = String(text || '').trim()
    .replace(/^(and|also|plus|then|ok(ay)?|add|please|now)\b[\s,:-]*/i, '')
    .trim();

  const values = {};
  const aliasPattern = def.fields
    .flatMap((f) => (f.aliases || []).map((a) => ({ key: f.key, alias: a })))
    .sort((a, b) => b.alias.length - a.alias.length)
    .map((x) => x.alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  // Alias alternatives, longest first, so "next step date" is tried before "next step" and
  // "contact name" before "contact". Alternation order is the only thing deciding that.
  const marker = new RegExp(
    `(?:^|[,;]|\\band\\b)\\s*(?:the|a|an|its|it's|their)?\\s*(?:${aliasPattern.join('|')})\\s*(?:is|was|are|were|'s|=|:)?\\s*`,
    'gi',
  );
  const matches = [...working.matchAll(marker)];

  if (matches.length === 0) {
    // No explicit label: assign to the first required field that is still empty, which is what
    // "Acme Corp" means when the assistant has just asked for the company.
    const target = def.fields.find((f) => f.required && existing[f.key] == null)
      || def.fields.find((f) => existing[f.key] == null);
    if (target && working) values[target.key] = working.replace(/[.,;]$/, '').trim();
    return { values, unmatched: target ? '' : working };
  }

  // Text before the first marker is an implicit value for the first empty required field.
  const preamble = working.slice(0, matches[0].index).replace(/[,;]$/, '').trim();
  if (preamble) {
    const target = def.fields.find((f) => f.required && existing[f.key] == null);
    if (target) values[target.key] = preamble;
  }

  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const key = fieldForAlias(topic, match[0]);
    const start = match.index + match[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : working.length;
    let value = working.slice(start, end).replace(/^[\s,;:-]+|[\s,;]+$/g, '').trim();
    // "next step date is 1 Dec" — the date alias wins, but the *previous* field captured
    // "date is 1 Dec" because it matched first. Hand that text over.
    if (key === 'next_step_date' && i > 0) {
      const prev = fieldForAlias(topic, matches[i - 1][0]);
      if (prev === 'next_step') {
        const cleaned = value.replace(/^date\s*(?:is|was|on|:)?\s*/i, '').trim();
        if (cleaned) {
          values.next_step = String(values.next_step || '').replace(/\s*date\s*(?:is|was|on|:)?\s*[\s\S]*$/i, '').trim();
          value = cleaned;
        }
      }
    }
    if (key && value) values[key] = value;
  }

  return { values, unmatched: '' };
}

/** Coerce and validate parsed strings into stored values. */
export function coerceFields(topic, values = {}) {
  const out = {};
  const problems = [];
  for (const [key, raw] of Object.entries(values)) {
    if (raw == null || raw === '') continue;
    if (['estimated_value'].includes(key)) {
      // "25 lakh", "1.2 crore", "25,00,000" — Indian numbering, which people use in speech.
      const text = String(raw).toLowerCase().replace(/,/g, '');
      const lakh = text.match(/(\d+(?:\.\d+)?)\s*(lakh|lac|lakhs)/);
      const crore = text.match(/(\d+(?:\.\d+)?)\s*crore/);
      const plain = parseNumber(text);
      if (crore) out[key] = Number(crore[1]) * 10000000;
      else if (lakh) out[key] = Number(lakh[1]) * 100000;
      else if (plain != null) out[key] = plain;
      else problems.push(`${key}: "${raw}" is not a number`);
    } else if (['probability'].includes(key)) {
      const n = parseNumber(raw);
      if (n == null || n < 0 || n > 100) problems.push('probability must be between 0 and 100');
      else out[key] = n;
    } else if (['next_step_date'].includes(key)) {
      const d = parseDate(raw);
      if (!d) problems.push(`${key}: "${raw}" is not a date`);
      else out[key] = d;
    } else if (key === 'stage') {
      const s = STAGES.find((x) => x === String(raw).toLowerCase().trim())
        || STAGES.find((x) => String(raw).toLowerCase().includes(x));
      if (!s) problems.push(`stage must be one of ${STAGES.join(', ')}`);
      else out[key] = s;
    } else if (key === 'contact_email') {
      const email = String(raw).replace(/\s+at\s+/gi, '@').replace(/\s+dot\s+/gi, '.').replace(/\s/g, '');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) problems.push(`"${raw}" is not a valid email`);
      else out[key] = email;
    } else if (key === 'contact_phone') {
      const digits = String(raw).replace(/[^\d+]/g, '');
      if (digits.replace(/\D/g, '').length < 7) problems.push(`"${raw}" is not a valid phone number`);
      else out[key] = digits;
    } else {
      out[key] = String(raw).trim();
    }
  }
  return { values: out, problems };
}

/** Which required fields are still empty. */
export function missingRequired(topic, fields = {}) {
  const def = FIELDS[topic];
  if (!def) return [];
  return def.fields.filter((f) => f.required && (fields[f.key] == null || fields[f.key] === '')).map((f) => f.key);
}

/** A spoken/typed recap of the draft so far. Also used as the confirmation prompt. */
export function describeDraft(topic, fields = {}) {
  const def = FIELDS[topic];
  if (!def) return '';
  const parts = def.fields
    .filter((f) => fields[f.key] != null && fields[f.key] !== '')
    .map((f) => `${f.label}: ${fields[f.key]}`);
  return parts.join('. ');
}

/* ------------------------------------------------------------------ sessions */

export function createDraft(principal, { topic }) {
  if (!FIELDS[topic]) throw new ApiError(400, 'UNKNOWN_TOPIC', `Topic must be one of ${Object.keys(FIELDS).join(', ')}.`);
  const db = getDb();
  const ts = now();
  const id = db.prepare(`INSERT INTO crm_ai_sessions (org_id, user_id, topic, fields, transcripts, missing, status, created_at, updated_at)
      VALUES (?, ?, ?, '{}', '[]', ?, 'drafting', ?, ?)`)
    .run(principal.orgId, principal.user?.id ?? null, topic, JSON.stringify(missingRequired(topic, {})), ts, ts).lastInsertRowid;
  audit(principal.req ?? null, {
    action: 'crm.ai.draft_started', entityType: 'crm_ai_session', entityId: id,
    summary: `Assistant CRM draft started (${topic})`, orgId: principal.orgId,
  });
  return getDraft(principal, id);
}

export function getDraft(principal, id) {
  const row = getDb().prepare('SELECT * FROM crm_ai_sessions WHERE id = ? AND org_id = ?').get(id, principal.orgId);
  if (!row) throw new ApiError(404, 'NOT_FOUND', 'Draft not found.');
  // A draft is private until it is submitted for approval.
  if (row.user_id !== principal.user?.id && !principal.permissions?.has?.('crm.approve') && !principal.isPlatformAdmin) {
    throw new ApiError(403, 'FORBIDDEN', 'That draft belongs to another user.');
  }
  return {
    id: row.id,
    topic: row.topic,
    status: row.status,
    fields: JSON.parse(row.fields || '{}'),
    transcripts: JSON.parse(row.transcripts || '[]'),
    missing: JSON.parse(row.missing || '[]'),
    confidence: row.confidence,
    leadId: row.lead_id,
    submittedAt: row.submitted_at,
    decidedAt: row.decided_at,
    decisionNote: row.decision_note,
    updatedAt: row.updated_at,
  };
}

/**
 * Append one utterance to a draft. Returns the draft plus a plain-language reply, so the same
 * endpoint serves typed input and a voice command.
 */
export function appendUtterance(principal, id, text, { via = 'text' } = {}) {
  const draft = getDraft(principal, id);
  if (draft.status !== 'drafting') {
    throw new ApiError(409, 'DRAFT_LOCKED', `This draft is ${draft.status.replace('_', ' ')} and can no longer be edited.`);
  }
  if (!String(text || '').trim()) throw new ApiError(400, 'VALIDATION_FAILED', 'Say or type what to add.');

  const parsed = parseUtterance(draft.topic, text, draft.fields);
  const coerced = coerceFields(draft.topic, parsed.values);
  const fields = { ...draft.fields, ...coerced.values };
  const unknown = {};
  const missing = missingRequired(draft.topic, fields);

  // Merge target: if this topic is about an existing lead, resolve it once and keep the id.
  let leadId = draft.leadId;
  if (['update_lead', 'log_activity'].includes(draft.topic) && fields.company && !leadId) {
    const found = findLead(principal, fields.company);
    if (found.match) leadId = found.match.id;
  }

  const transcripts = [...draft.transcripts, { at: now(), role: 'user', text: String(text), via }];
  const problems = coerced.problems;

  let reply;
  if (problems.length) {
    reply = `I could not use that: ${problems.join('; ')}. Try again?`;
  } else if (missing.length) {
    const next = FIELDS[draft.topic].fields.find((f) => f.key === missing[0]);
    reply = `Got it. I still need the ${next.label.toLowerCase()}.`;
  } else {
    reply = `That is everything I need. ${describeDraft(draft.topic, fields)}. Submit it for approval when you are ready.`;
  }

  getDb().prepare(`UPDATE crm_ai_sessions SET fields = ?, transcripts = ?, missing = ?, lead_id = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(fields), JSON.stringify(transcripts), JSON.stringify(missing),
      leadId ?? null, now(), id);

  return {
    draft: getDraft(principal, id),
    reply,
    captured: coerced.values,
    notUnderstood: problems.length ? problems : [],
  };
}

/** Move a draft into the approval queue. Nothing is written to crm_leads yet. */
export function submitDraft(principal, id) {
  const draft = getDraft(principal, id);
  if (draft.status !== 'drafting') throw new ApiError(409, 'DRAFT_LOCKED', `This draft is already ${draft.status.replace('_', ' ')}.`);
  if (draft.missing.length) {
    throw new ApiError(400, 'INCOMPLETE', `Still missing: ${draft.missing.join(', ')}.`);
  }
  getDb().prepare("UPDATE crm_ai_sessions SET status = 'pending_approval', submitted_at = ?, updated_at = ? WHERE id = ?")
    .run(now(), now(), id);
  audit(principal.req ?? null, {
    action: 'crm.ai.draft_submitted', entityType: 'crm_ai_session', entityId: id,
    summary: `CRM draft submitted for approval (${draft.topic})`, orgId: principal.orgId,
  });
  return getDraft(principal, id);
}

/**
 * Approve a draft. This is the only path into the dataset: it writes the lead (or updates one),
 * records a revision in record_versions, writes a CRM event, and audits the decision.
 */
export function approveDraft(req, id) {
  const principal = req.user;
  const db = getDb();
  const draft = getDraft(principal, id);
  if (draft.status !== 'pending_approval') {
    throw new ApiError(409, 'NOT_PENDING', `This draft is ${draft.status.replace('_', ' ')} and cannot be approved.`);
  }
  const ts = now();
  const fields = draft.fields;

  const run = db.transaction(() => {
    let leadId = draft.leadId;
    if (draft.topic === 'create_lead') {
      leadId = db.prepare(`INSERT INTO crm_leads (org_id, lead_code, company, contact_name, contact_email, contact_phone,
          industry, city, country, source, stage, owner_user_id, owner_email, estimated_value, currency, probability,
          expected_close_date, next_step, next_step_date, notes, data_source, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'India', ?, ?, ?, ?, ?, 'INR', ?, ?, ?, ?, ?, 'assistant', ?, ?)`)
        .run(principal.orgId, nextLeadCode(principal.orgId), fields.company, fields.contact_name ?? null,
          fields.contact_email ?? null, fields.contact_phone ?? null, fields.industry ?? null, fields.city ?? null,
          fields.source ?? null, fields.stage ?? 'new', principal.user?.id ?? null, principal.user?.email ?? null,
          fields.estimated_value ?? null, fields.probability ?? null, fields.expected_close_date ?? null,
          fields.next_step ?? null, fields.next_step_date ?? null, fields.notes ?? null, ts, ts).lastInsertRowid;
      recordVersion(principal, 'crm_lead', leadId, 1, null, fields, 'create');
      logEvent(principal, leadId, 'created', null, fields.stage ?? 'new', `Lead created by assistant, approved by ${principal.user?.email}`);
    } else if (draft.topic === 'update_lead') {
      if (!leadId) throw new ApiError(400, 'NOT_FOUND', 'That lead no longer exists.');
      const current = db.prepare('SELECT * FROM crm_leads WHERE id = ? AND org_id = ?').get(leadId, principal.orgId);
      const allowed = ['stage', 'next_step', 'next_step_date', 'estimated_value', 'probability', 'notes'];
      const changes = Object.fromEntries(Object.entries(fields).filter(([k]) => allowed.includes(k)));
      if (!Object.keys(changes).length) throw new ApiError(400, 'VALIDATION_FAILED', 'Nothing to change on that lead.');
      const before = Object.fromEntries(Object.keys(changes).map((k) => [k, current[k]]));
      db.prepare(`UPDATE crm_leads SET ${Object.keys(changes).map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
        .run(...Object.values(changes), ts, leadId);
      recordVersion(principal, 'crm_lead', leadId, nextVersion('crm_lead', leadId), before, changes);
      logEvent(principal, leadId, changes.stage && changes.stage !== current.stage ? 'stage_changed' : 'updated',
        current.stage, changes.stage ?? current.stage, `Updated by assistant, approved by ${principal.user?.email}`);
    } else if (draft.topic === 'log_activity') {
      if (!leadId) throw new ApiError(400, 'NOT_FOUND', 'That lead no longer exists.');
      const current = db.prepare('SELECT * FROM crm_leads WHERE id = ?').get(leadId);
      db.prepare('UPDATE crm_leads SET next_step = COALESCE(?, next_step), notes = COALESCE(notes, ?) || ?, updated_at = ? WHERE id = ?')
        .run(fields.next_step ?? null, '', `\n[${ts.slice(0, 10)}] ${fields.activity}`, ts, leadId);
      logEvent(principal, leadId, 'updated', current.stage, current.stage, `Activity logged via assistant: ${fields.activity}`);
    }

    db.prepare("UPDATE crm_ai_sessions SET status = 'approved', decided_at = ?, decided_by = ?, lead_id = ?, updated_at = ? WHERE id = ?")
      .run(ts, principal.user?.id ?? null, leadId ?? null, ts, id);
    return leadId;
  });

  const leadId = run();
  audit(req, {
    action: 'crm.ai.draft_approved', entityType: 'crm_lead', entityId: leadId,
    summary: `Approved an assistant-drafted ${draft.topic.replace('_', ' ')} (draft ${id})`,
    meta: { draft_id: id, topic: draft.topic, fields },
  });
  return { draft: getDraft(principal, id), leadId, lead: leadId ? getLead(principal, leadId) : null };
}

export function rejectDraft(req, id, note) {
  const principal = req.user;
  const draft = getDraft(principal, id);
  if (draft.status !== 'pending_approval') throw new ApiError(409, 'NOT_PENDING', `This draft is ${draft.status.replace('_', ' ')}.`);
  getDb().prepare("UPDATE crm_ai_sessions SET status = 'rejected', decided_at = ?, decided_by = ?, decision_note = ?, updated_at = ? WHERE id = ?")
    .run(now(), principal.user?.id ?? null, String(note || '').slice(0, 500) || null, now(), id);
  audit(req, {
    action: 'crm.ai.draft_rejected', entityType: 'crm_ai_session', entityId: id,
    summary: `Rejected an assistant-drafted ${draft.topic.replace('_', ' ')}`, meta: { draft_id: id, note: note || null },
  });
  return getDraft(principal, id);
}

/* ------------------------------------------------------------------ leads */

export function nextLeadCode(orgId) {
  const row = getDb().prepare("SELECT lead_code FROM crm_leads WHERE org_id = ? AND lead_code LIKE 'LD-%' ORDER BY id DESC LIMIT 1").get(orgId);
  const n = row ? Number(String(row.lead_code).replace('LD-', '')) + 1 : 1001;
  return `LD-${n}`;
}

function nextVersion(entityType, entityId) {
  const row = getDb().prepare('SELECT MAX(version) AS v FROM record_versions WHERE entity_type = ? AND entity_id = ?').get(entityType, String(entityId));
  return (row?.v || 0) + 1;
}
function recordVersion(principal, entityType, entityId, version, before, after, changeType = 'update') {
  // The table stores a full snapshot per version plus what changed, which is what a reviewer
  // needs to reconstruct the record at any point in time.
  getDb().prepare(`INSERT INTO record_versions (org_id, entity_type, entity_id, version, snapshot, changed_by, change_type, changed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(principal.orgId, entityType, String(entityId), version,
      JSON.stringify({ before: before ?? null, after }), principal.user?.id ?? null, changeType, now());
}
function logEvent(principal, leadId, action, fromStage, toStage, summary) {
  getDb().prepare(`INSERT INTO crm_lead_events (org_id, lead_id, action, from_stage, to_stage, actor_user_id, actor_email, summary, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(principal.orgId, leadId, action, fromStage ?? null, toStage ?? null,
      principal.user?.id ?? null, principal.user?.email ?? null, summary, now());
}

export function findLead(principal, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (needle.length < 2) return { match: null, candidates: [] };
  const rows = getDb().prepare('SELECT * FROM crm_leads WHERE org_id = ?').all(principal.orgId);
  const scored = rows.map((l) => {
    const company = String(l.company || '').toLowerCase();
    const code = String(l.lead_code || '').toLowerCase();
    const contact = String(l.contact_name || '').toLowerCase();
    let score = 0;
    if (company === needle || code === needle) score = 3;
    else if (company.startsWith(needle)) score = 2;
    else if (company.includes(needle) || contact.includes(needle)) score = 1;
    return { lead: l, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score);
  if (!scored.length) return { match: null, candidates: [] };
  const top = scored.filter((x) => x.score === scored[0].score);
  if (top.length > 1) return { match: null, candidates: top.map((x) => x.lead) };
  return { match: scored[0].lead, candidates: [] };
}

export function getLead(principal, id) {
  const lead = getDb().prepare('SELECT * FROM crm_leads WHERE id = ? AND org_id = ?').get(id, principal.orgId);
  if (!lead) throw new ApiError(404, 'NOT_FOUND', 'Lead not found.');
  const events = getDb().prepare('SELECT * FROM crm_lead_events WHERE lead_id = ? ORDER BY created_at DESC LIMIT 50').all(id);
  return { ...lead, events };
}

export function listLeads(principal, { stage, search, limit = 50 } = {}) {
  const params = [principal.orgId];
  let sql = 'SELECT * FROM crm_leads WHERE org_id = ?';
  if (stage) { sql += ' AND stage = ?'; params.push(stage); }
  if (search) { sql += ' AND (company LIKE ? OR contact_name LIKE ? OR lead_code LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  sql += ' ORDER BY updated_at DESC LIMIT ?';
  params.push(Math.min(Number(limit) || 50, 200));
  return getDb().prepare(sql).all(...params);
}

/** Pipeline summary: counts and value by stage, which is what a CRM question usually means. */
export function pipelineSummary(principal) {
  const rows = getDb().prepare(`SELECT stage, COUNT(*) AS count, COALESCE(SUM(estimated_value), 0) AS value
      FROM crm_leads WHERE org_id = ? GROUP BY stage`).all(principal.orgId);
  const total = rows.reduce((a, r) => a + r.count, 0);
  const open = rows.filter((r) => !['won', 'lost', 'disqualified'].includes(r.stage));
  return {
    total,
    by_stage: rows,
    open_count: open.reduce((a, r) => a + r.count, 0),
    open_value: open.reduce((a, r) => a + r.value, 0),
    won_value: rows.find((r) => r.stage === 'won')?.value || 0,
  };
}

/** Counts of everything the assistant can answer about, for the "what can you see?" answer. */
export function crmCoverage(principal) {
  const db = getDb();
  const leads = db.prepare('SELECT COUNT(*) AS c FROM crm_leads WHERE org_id = ?').get(principal.orgId).c;
  const pending = db.prepare("SELECT COUNT(*) AS c FROM crm_ai_sessions WHERE org_id = ? AND status = 'pending_approval'").get(principal.orgId).c;
  return { leads, pending_approvals: pending, stages: STAGES };
}
