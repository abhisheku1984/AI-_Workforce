-- WorkforceIQ initial schema (SQLite)
-- Conventions:
--  * All tenant data carries org_id (or derives it through a foreign key chain).
--  * Money is stored as REAL with the row's currency code; rounding is applied at presentation.
--  * Dates are ISO-8601 strings (YYYY-MM-DD); timestamps are ISO-8601 UTC strings.
--  * Raw imported data lives in import_rows.raw and is never mutated; validated/normalised
--    data lives in import_rows.normalized and only reaches master tables on explicit commit.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  TEXT NOT NULL
);

-- ---------------------------------------------------------------- tenancy
CREATE TABLE organizations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL,
  slug            TEXT    NOT NULL UNIQUE,
  industry        TEXT,
  country         TEXT,
  currency        TEXT    NOT NULL DEFAULT 'INR',
  timezone        TEXT    NOT NULL DEFAULT 'Asia/Kolkata',
  week_start      TEXT    NOT NULL DEFAULT 'monday',
  fiscal_start_month INTEGER NOT NULL DEFAULT 4,
  status          TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  data_region     TEXT    NOT NULL DEFAULT 'ap-south',
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL
);

CREATE TABLE org_settings (
  org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key         TEXT    NOT NULL,
  value       TEXT    NOT NULL,           -- JSON encoded
  updated_by  INTEGER,
  updated_at  TEXT    NOT NULL,
  PRIMARY KEY (org_id, key)
);

CREATE TABLE modules (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL,
  stage       TEXT NOT NULL CHECK (stage IN ('core','ai','predictive','automation')),
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE org_entitlements (
  org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  module_code TEXT    NOT NULL REFERENCES modules(code),
  status      TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','trial','disabled')),
  limit_value INTEGER,                    -- e.g. max employees, null = unlimited
  activated_at TEXT   NOT NULL,
  PRIMARY KEY (org_id, module_code)
);

CREATE TABLE subscriptions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  plan_code     TEXT    NOT NULL,
  status        TEXT    NOT NULL CHECK (status IN ('trial','active','past_due','cancelled')),
  seats         INTEGER NOT NULL DEFAULT 5,
  monthly_fee   REAL    NOT NULL DEFAULT 0,
  setup_fee     REAL    NOT NULL DEFAULT 0,
  currency      TEXT    NOT NULL DEFAULT 'INR',
  billing_cycle TEXT    NOT NULL DEFAULT 'monthly',
  started_at    TEXT    NOT NULL,
  renews_at     TEXT,
  notes         TEXT
);
CREATE INDEX idx_subscriptions_org ON subscriptions(org_id, status);

-- ---------------------------------------------------------------- identity
CREATE TABLE users (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id            INTEGER REFERENCES organizations(id) ON DELETE CASCADE, -- NULL = platform staff
  email             TEXT    NOT NULL UNIQUE,
  full_name         TEXT    NOT NULL,
  title             TEXT,
  password_hash     TEXT    NOT NULL,
  is_platform_admin INTEGER NOT NULL DEFAULT 0,
  status            TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active','invited','suspended')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_logins     INTEGER NOT NULL DEFAULT 0,
  locked_until      TEXT,
  last_login_at     TEXT,
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL
);
CREATE INDEX idx_users_org ON users(org_id);

CREATE TABLE roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id      INTEGER REFERENCES organizations(id) ON DELETE CASCADE, -- NULL = system role template
  code        TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  description TEXT,
  permissions TEXT    NOT NULL,           -- JSON array of permission codes
  is_system   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL,
  UNIQUE (org_id, code)
);

CREATE TABLE user_roles (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id          INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  business_unit_id INTEGER,              -- optional data scope
  department_id    INTEGER,              -- optional data scope
  assigned_at      TEXT    NOT NULL,
  UNIQUE (user_id, role_id, business_unit_id, department_id)
);
CREATE INDEX idx_user_roles_user ON user_roles(user_id);

CREATE TABLE auth_sessions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT    NOT NULL UNIQUE,
  org_id       INTEGER,
  ip           TEXT,
  user_agent   TEXT,
  created_at   TEXT    NOT NULL,
  expires_at   TEXT    NOT NULL,
  revoked_at   TEXT,
  last_seen_at TEXT
);
CREATE INDEX idx_sessions_user ON auth_sessions(user_id);

-- ---------------------------------------------------------------- org structure
CREATE TABLE business_units (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  code       TEXT    NOT NULL,
  leader     TEXT,
  status     TEXT    NOT NULL DEFAULT 'active',
  created_at TEXT    NOT NULL,
  UNIQUE (org_id, code)
);

CREATE TABLE departments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id          INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  business_unit_id INTEGER REFERENCES business_units(id) ON DELETE SET NULL,
  name            TEXT    NOT NULL,
  code            TEXT    NOT NULL,
  cost_center     TEXT,
  status          TEXT    NOT NULL DEFAULT 'active',
  created_at      TEXT    NOT NULL,
  UNIQUE (org_id, code)
);
CREATE INDEX idx_departments_org ON departments(org_id, business_unit_id);

CREATE TABLE locations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id         INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name           TEXT    NOT NULL,
  country        TEXT,
  timezone       TEXT    NOT NULL DEFAULT 'Asia/Kolkata',
  hours_per_day  REAL    NOT NULL DEFAULT 8,
  working_days   TEXT    NOT NULL DEFAULT '[1,2,3,4,5]', -- JSON array, 0=Sunday
  holidays       TEXT    NOT NULL DEFAULT '[]',          -- JSON array of YYYY-MM-DD
  created_at     TEXT    NOT NULL,
  UNIQUE (org_id, name)
);

-- ---------------------------------------------------------------- workforce
CREATE TABLE skills (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       TEXT    NOT NULL,
  category   TEXT,
  created_at TEXT    NOT NULL,
  UNIQUE (org_id, name)
);

CREATE TABLE employees (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id           INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_code    TEXT    NOT NULL,
  full_name        TEXT    NOT NULL,
  email            TEXT,
  department_id    INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  business_unit_id INTEGER REFERENCES business_units(id) ON DELETE SET NULL,
  location_id      INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  manager_id       INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  designation      TEXT,
  employment_type  TEXT    NOT NULL DEFAULT 'full_time'
                   CHECK (employment_type IN ('full_time','part_time','contractor','intern','furlough')),
  status           TEXT    NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active','on_leave','notice','exited')),
  join_date        TEXT,
  exit_date        TEXT,
  fte              REAL    NOT NULL DEFAULT 1.0,
  weekly_hours     REAL,                  -- override; null = location hours * 5
  annual_cost      REAL,                  -- employer cost, authorized roles only
  cost_currency    TEXT    DEFAULT 'INR',
  bill_rate_hour   REAL,                  -- standard charge-out rate
  annual_bill_rate REAL,
  grade            TEXT,
  data_source      TEXT    NOT NULL DEFAULT 'manual', -- manual | import:<id>
  is_demo          INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT    NOT NULL,
  updated_at       TEXT    NOT NULL,
  UNIQUE (org_id, employee_code)
);
CREATE INDEX idx_employees_org_status ON employees(org_id, status);
CREATE INDEX idx_employees_org_dept ON employees(org_id, department_id);
CREATE INDEX idx_employees_org_bu ON employees(org_id, business_unit_id);

CREATE TABLE employee_skills (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id       INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  skill_id     INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  proficiency  INTEGER NOT NULL DEFAULT 3 CHECK (proficiency BETWEEN 1 AND 5),
  years        REAL,
  verified     INTEGER NOT NULL DEFAULT 0,
  UNIQUE (employee_id, skill_id)
);
CREATE INDEX idx_emp_skills_org ON employee_skills(org_id, skill_id);

-- ---------------------------------------------------------------- projects & demand
CREATE TABLE projects (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id           INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code             TEXT    NOT NULL,
  name             TEXT    NOT NULL,
  client_name      TEXT,
  business_unit_id INTEGER REFERENCES business_units(id) ON DELETE SET NULL,
  department_id    INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  manager_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  manager_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  start_date       TEXT,
  end_date         TEXT,
  status           TEXT    NOT NULL DEFAULT 'active'
                   CHECK (status IN ('planned','active','on_hold','completed','cancelled')),
  contract_type    TEXT    NOT NULL DEFAULT 'time_material'
                   CHECK (contract_type IN ('time_material','fixed_price','retainer','internal')),
  budget_amount    REAL,
  currency         TEXT    NOT NULL DEFAULT 'INR',
  billing_rate_hour REAL,
  priority         TEXT    NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  health           TEXT    NOT NULL DEFAULT 'green' CHECK (health IN ('green','amber','red')),
  created_at       TEXT    NOT NULL,
  updated_at       TEXT    NOT NULL,
  UNIQUE (org_id, code)
);
CREATE INDEX idx_projects_org_status ON projects(org_id, status);

CREATE TABLE project_demand (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id           INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id       INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role_title       TEXT    NOT NULL,
  required_skill_id INTEGER REFERENCES skills(id) ON DELETE SET NULL,
  headcount        INTEGER NOT NULL DEFAULT 1,
  hours_per_week   REAL    NOT NULL DEFAULT 40,
  start_date       TEXT    NOT NULL,
  end_date         TEXT    NOT NULL,
  priority         TEXT    NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high','critical')),
  status           TEXT    NOT NULL DEFAULT 'open' CHECK (status IN ('open','partially_filled','filled','cancelled')),
  notes            TEXT,
  created_at       TEXT    NOT NULL
);
CREATE INDEX idx_demand_org ON project_demand(org_id, project_id, status);

CREATE TABLE allocations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id          INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id     INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  project_id      INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  demand_id       INTEGER REFERENCES project_demand(id) ON DELETE SET NULL,
  start_date      TEXT    NOT NULL,
  end_date        TEXT    NOT NULL,
  hours_per_week  REAL    NOT NULL,
  allocation_pct  REAL,                   -- derived vs standard capacity, stored for traceability
  billable        INTEGER NOT NULL DEFAULT 1,
  bill_rate_hour  REAL,
  cost_rate_hour  REAL,
  status          TEXT    NOT NULL DEFAULT 'planned'
                  CHECK (status IN ('planned','confirmed','cancelled','completed')),
  note            TEXT,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL
);
CREATE INDEX idx_allocations_org_emp ON allocations(org_id, employee_id, start_date);
CREATE INDEX idx_allocations_org_proj ON allocations(org_id, project_id);

CREATE TABLE timesheets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  project_id  INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  work_date   TEXT    NOT NULL,
  hours       REAL    NOT NULL CHECK (hours >= 0 AND hours <= 24),
  billable    INTEGER NOT NULL DEFAULT 1,
  source      TEXT    NOT NULL DEFAULT 'import',
  import_id   INTEGER,
  UNIQUE (org_id, employee_id, project_id, work_date, billable)
);
CREATE INDEX idx_timesheets_org_date ON timesheets(org_id, work_date);
CREATE INDEX idx_timesheets_org_emp ON timesheets(org_id, employee_id, work_date);

-- ---------------------------------------------------------------- finance
CREATE TABLE invoices (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id         INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id     INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  invoice_number TEXT    NOT NULL,
  period_month   TEXT    NOT NULL,        -- YYYY-MM
  amount         REAL    NOT NULL,
  currency       TEXT    NOT NULL DEFAULT 'INR',
  status         TEXT    NOT NULL DEFAULT 'issued'
                 CHECK (status IN ('draft','issued','paid','overdue','cancelled')),
  issued_date    TEXT,
  due_date       TEXT,
  paid_date      TEXT,
  created_at     TEXT    NOT NULL,
  UNIQUE (org_id, invoice_number)
);
CREATE INDEX idx_invoices_org_period ON invoices(org_id, period_month);

CREATE TABLE expenses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id       INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id   INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
  category     TEXT    NOT NULL,          -- travel | software | subcontractor | facilities | other
  period_month TEXT    NOT NULL,
  amount       REAL    NOT NULL,
  currency     TEXT    NOT NULL DEFAULT 'INR',
  description  TEXT,
  created_at   TEXT    NOT NULL
);
CREATE INDEX idx_expenses_org_period ON expenses(org_id, period_month);

-- ---------------------------------------------------------------- ingestion & lineage
CREATE TABLE imports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  uploaded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  entity_type   TEXT    NOT NULL,         -- employees | skills | projects | demand | allocations | timesheets | invoices | expenses
  filename      TEXT    NOT NULL,
  stored_path   TEXT    NOT NULL,
  format        TEXT    NOT NULL,
  size_bytes    INTEGER NOT NULL,
  checksum      TEXT    NOT NULL,
  status        TEXT    NOT NULL DEFAULT 'staged'
                CHECK (status IN ('staged','mapped','validated','committed','failed','discarded')),
  mapping       TEXT,                     -- JSON {sourceColumn: targetField}
  headers       TEXT,                     -- JSON array
  rows_total    INTEGER NOT NULL DEFAULT 0,
  rows_valid    INTEGER NOT NULL DEFAULT 0,
  rows_invalid  INTEGER NOT NULL DEFAULT 0,
  rows_committed INTEGER NOT NULL DEFAULT 0,
  duplicate_rows INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  notes         TEXT,
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  committed_at  TEXT,
  retention_delete_after TEXT
);
CREATE INDEX idx_imports_org ON imports(org_id, created_at);

CREATE TABLE import_rows (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  import_id  INTEGER NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  raw        TEXT    NOT NULL,            -- JSON, exactly as read from file
  normalized TEXT,                        -- JSON after mapping/typing fixes
  status     TEXT    NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending','valid','warning','invalid','duplicate','committed','skipped')),
  issues     TEXT    NOT NULL DEFAULT '[]', -- JSON array of {code, field, message, severity}
  UNIQUE (import_id, row_number)
);
CREATE INDEX idx_import_rows_status ON import_rows(import_id, status);

CREATE TABLE record_versions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type TEXT    NOT NULL,
  entity_id   INTEGER NOT NULL,
  version     INTEGER NOT NULL,
  snapshot    TEXT    NOT NULL,
  changed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  change_type TEXT    NOT NULL DEFAULT 'update',
  changed_at  TEXT    NOT NULL
);
CREATE INDEX idx_versions_entity ON record_versions(org_id, entity_type, entity_id);

CREATE TABLE deletion_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id       INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scope        TEXT    NOT NULL,          -- import | entity | org
  target_id    INTEGER,
  reason       TEXT,
  requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  status       TEXT    NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','approved','executed','rejected')),
  created_at   TEXT    NOT NULL,
  executed_at  TEXT,
  detail       TEXT
);

-- ---------------------------------------------------------------- reporting
CREATE TABLE report_definitions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code        TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  description TEXT,
  kind        TEXT    NOT NULL,           -- utilization | capacity | finance | demand | audit
  params      TEXT    NOT NULL DEFAULT '{}',
  shared      INTEGER NOT NULL DEFAULT 1,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT    NOT NULL,
  UNIQUE (org_id, code)
);

CREATE TABLE report_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id       INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  report_code  TEXT    NOT NULL,
  params       TEXT    NOT NULL DEFAULT '{}',
  format       TEXT    NOT NULL DEFAULT 'csv',
  row_count    INTEGER NOT NULL DEFAULT 0,
  file_path    TEXT,
  generated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL
);

-- ---------------------------------------------------------------- AI
CREATE TABLE ai_conversations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title      TEXT,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);

CREATE TABLE ai_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id          INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id INTEGER NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  role            TEXT    NOT NULL CHECK (role IN ('user','assistant')),
  content         TEXT    NOT NULL,
  intent          TEXT,
  evidence        TEXT,                   -- JSON: metrics, sources, filters, periods
  assumptions     TEXT,                   -- JSON array
  limitations     TEXT,                   -- JSON array
  confidence      TEXT,                   -- high | medium | low | insufficient_data
  provider        TEXT,
  latency_ms      INTEGER,
  created_at      TEXT    NOT NULL
);
CREATE INDEX idx_ai_messages_conv ON ai_messages(conversation_id, created_at);

CREATE TABLE ai_insights (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code          TEXT    NOT NULL,         -- rule code e.g. UNALLOCATED_CAPACITY
  category      TEXT    NOT NULL,         -- capacity | allocation | cost | demand | data_quality | risk
  severity      TEXT    NOT NULL CHECK (severity IN ('info','low','medium','high','critical')),
  title         TEXT    NOT NULL,
  finding       TEXT    NOT NULL,
  explanation   TEXT    NOT NULL,
  evidence      TEXT    NOT NULL,         -- JSON {metric, value, unit, comparison, source, filters, period}
  impact        TEXT,                     -- JSON {type, value, unit, basis} | null
  assumptions   TEXT    NOT NULL DEFAULT '[]',
  limitations   TEXT    NOT NULL DEFAULT '[]',
  risks         TEXT    NOT NULL DEFAULT '[]',
  next_step     TEXT,
  requires_approval INTEGER NOT NULL DEFAULT 0,
  status        TEXT    NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','acknowledged','actioned','dismissed')),
  period_start  TEXT,
  period_end    TEXT,
  generated_by  TEXT    NOT NULL DEFAULT 'rules_engine',
  generated_at  TEXT    NOT NULL,
  UNIQUE (org_id, code, period_start, period_end)
);

CREATE TABLE insight_reviews (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  insight_id INTEGER NOT NULL REFERENCES ai_insights(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decision   TEXT    NOT NULL CHECK (decision IN ('acknowledged','actioned','dismissed')),
  note       TEXT,
  created_at TEXT    NOT NULL
);

CREATE TABLE forecasts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id       INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind         TEXT    NOT NULL,          -- utilization | demand | cost | capacity
  method       TEXT    NOT NULL,
  horizon_months INTEGER NOT NULL,
  params       TEXT    NOT NULL DEFAULT '{}',
  results      TEXT    NOT NULL,          -- JSON {series:[], summary:{}}
  limitations  TEXT    NOT NULL DEFAULT '[]',
  quality      TEXT    NOT NULL DEFAULT '{}', -- JSON {months_of_history, r2, method_note}
  generated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT    NOT NULL
);

-- ---------------------------------------------------------------- automation
CREATE TABLE automation_rules (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id           INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code             TEXT    NOT NULL,
  name             TEXT    NOT NULL,
  description      TEXT,
  trigger_type     TEXT    NOT NULL CHECK (trigger_type IN ('schedule','event','manual')),
  trigger_config   TEXT    NOT NULL DEFAULT '{}',
  action_type      TEXT    NOT NULL CHECK (action_type IN ('generate_report','notify','create_approval','refresh_data','flag_insight')),
  action_config    TEXT    NOT NULL DEFAULT '{}',
  requires_approval INTEGER NOT NULL DEFAULT 1,
  enabled          INTEGER NOT NULL DEFAULT 0,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT    NOT NULL,
  updated_at       TEXT    NOT NULL,
  UNIQUE (org_id, code)
);

CREATE TABLE automation_runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id       INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id      INTEGER NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
  status       TEXT    NOT NULL CHECK (status IN ('queued','awaiting_approval','succeeded','failed','rejected')),
  triggered_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approval_id  INTEGER,
  detail       TEXT,
  executed_at  TEXT,
  created_at   TEXT    NOT NULL
);

CREATE TABLE approval_requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id        INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type          TEXT    NOT NULL,          -- automation | allocation_change | data_deletion | insight_action
  title         TEXT    NOT NULL,
  description   TEXT,
  payload       TEXT    NOT NULL DEFAULT '{}',
  risk_level    TEXT    NOT NULL DEFAULT 'medium' CHECK (risk_level IN ('low','medium','high')),
  status        TEXT    NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected','executed','cancelled')),
  requested_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decision_note TEXT,
  created_at    TEXT    NOT NULL,
  decided_at    TEXT,
  executed_at   TEXT
);
CREATE INDEX idx_approvals_org ON approval_requests(org_id, status);

CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT    NOT NULL,
  title      TEXT    NOT NULL,
  body       TEXT,
  link       TEXT,
  read_at    TEXT,
  created_at TEXT    NOT NULL
);
CREATE INDEX idx_notifications_user ON notifications(user_id, read_at);

-- ---------------------------------------------------------------- governance
CREATE TABLE audit_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id       INTEGER,
  actor_user_id INTEGER,
  actor_email  TEXT,
  actor_role   TEXT,
  action       TEXT    NOT NULL,
  entity_type  TEXT,
  entity_id    TEXT,
  summary      TEXT    NOT NULL,
  meta         TEXT,
  ip           TEXT,
  user_agent   TEXT,
  created_at   TEXT    NOT NULL
);
CREATE INDEX idx_audit_org_time ON audit_events(org_id, created_at);
CREATE INDEX idx_audit_action ON audit_events(action);

CREATE TABLE ai_audit_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id       INTEGER NOT NULL,
  user_id      INTEGER,
  action       TEXT    NOT NULL,       -- assistant.query | insight.generate | prompt_injection.blocked
  intent       TEXT,
  provider     TEXT,
  data_sent    TEXT,                   -- JSON summary of what facts left the system (never raw PII)
  result_status TEXT,
  detail       TEXT,
  created_at   TEXT    NOT NULL
);
CREATE INDEX idx_ai_audit_org ON ai_audit_events(org_id, created_at);
