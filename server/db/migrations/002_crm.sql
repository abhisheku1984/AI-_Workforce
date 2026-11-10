-- CRM: leads, opportunities and an approval queue for AI-drafted records.
--
-- The central idea is that the assistant never writes straight into the dataset. It writes a
-- *draft* into crm_ai_sessions, the human reviews it, and approval copies the fields into the
-- real record and files a revision in record_versions. That is what the brief asks for: "then
-- it will be there for human approval and once someone approves it, it will automatically
-- append to that dataset."

CREATE TABLE IF NOT EXISTS crm_leads (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id            INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_code         TEXT    NOT NULL,
  company           TEXT    NOT NULL,
  contact_name      TEXT,
  contact_email     TEXT,
  contact_phone     TEXT,
  industry          TEXT,
  city              TEXT,
  country           TEXT    DEFAULT 'India',
  source            TEXT,                 -- referral, website, event, outbound, partner
  stage             TEXT    NOT NULL DEFAULT 'new'
                    CHECK (stage IN ('new','contacted','qualified','proposal','negotiation','won','lost','disqualified')),
  owner_user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  owner_email       TEXT,
  estimated_value   REAL,                 -- in org currency
  currency          TEXT    DEFAULT 'INR',
  probability       REAL,                 -- 0..100
  expected_close_date TEXT,
  next_step         TEXT,
  next_step_date    TEXT,
  notes             TEXT,
  data_source       TEXT    DEFAULT 'manual',   -- manual | assistant | import
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_leads_code ON crm_leads(org_id, lead_code);
CREATE INDEX IF NOT EXISTS idx_crm_leads_stage ON crm_leads(org_id, stage);
CREATE INDEX IF NOT EXISTS idx_crm_leads_owner ON crm_leads(org_id, owner_user_id);

-- Stage history: the audit trail for the pipeline, separate from the security audit log.
CREATE TABLE IF NOT EXISTS crm_lead_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id     INTEGER NOT NULL REFERENCES crm_leads(id) ON DELETE CASCADE,
  action      TEXT    NOT NULL,           -- created | updated | stage_changed | ai_draft_approved | ai_draft_rejected
  from_stage  TEXT,
  to_stage    TEXT,
  actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_email TEXT,
  summary     TEXT,
  meta        TEXT,
  created_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crm_events_lead ON crm_lead_events(lead_id, created_at);

-- One AI drafting session: the "topic" the user selected, the fields captured so far, and
-- the approval state. status: drafting -> pending_approval -> approved | rejected | abandoned
CREATE TABLE IF NOT EXISTS crm_ai_sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  topic         TEXT    NOT NULL,          -- create_lead | update_lead | log_activity
  lead_id       INTEGER REFERENCES crm_leads(id) ON DELETE SET NULL,  -- set when updating an existing lead
  fields        TEXT    NOT NULL DEFAULT '{}',  -- JSON of captured values
  transcripts   TEXT    NOT NULL DEFAULT '[]',  -- JSON array of {at, role, text} utterances
  missing       TEXT    NOT NULL DEFAULT '[]',  -- JSON array of required field keys still empty
  confidence    TEXT    DEFAULT 'medium',       -- high | medium | low
  status        TEXT    NOT NULL DEFAULT 'drafting'
                CHECK (status IN ('drafting','pending_approval','approved','rejected','abandoned')),
  submitted_at  TEXT,
  decided_at    TEXT,
  decided_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decision_note TEXT,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_crm_ai_status ON crm_ai_sessions(org_id, status, updated_at);
CREATE INDEX IF NOT EXISTS idx_crm_ai_user ON crm_ai_sessions(org_id, user_id, updated_at);
