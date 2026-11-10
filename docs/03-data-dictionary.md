# WorkforceIQ — Data Dictionary and Schema Reference

**Version:** 1.0
**Last updated:** 2026-11-10
**Schema source:** `server/db/migrations/001_init.sql`
**Generated from:** the live schema of a seeded demonstration database (column types, constraints and foreign keys read from the database itself, not transcribed by hand)

---

## 1. How to read this document

Every table below lists its columns exactly as the database enforces them, together with a plain-English purpose. The row count shown is what exists in the fictional demonstration database, which is a useful sanity indicator of what each table holds in practice — it is not a capacity limit.

Conventions used throughout the schema:

| Convention | Meaning |
| --- | --- |
| `org_id` on almost every table | The tenant key. Always `NOT NULL` and indexed. Every query filters on it. A table without `org_id` is either global platform data (`modules`, `schema_migrations`) or a child reached only through its parent. |
| Dates as `TEXT` | ISO-8601 strings (`YYYY-MM-DD` for dates, full ISO timestamp for events). SQLite has no native date type; storing ISO strings keeps them sortable and unambiguous across timezones. |
| Money as `REAL` | Stored in the organisation's own currency. Currency is a column (`currency` / `cost_currency`) so a number is never ambiguous. |
| Booleans as `INTEGER 0/1` | SQLite has no boolean type. The API converts to real booleans on the way out. |
| JSON as `TEXT` | Structured fields (`permissions`, `evidence`, `meta`, `payload`) hold JSON strings. They are never queried structurally; they are read, parsed and returned. |
| `created_at` / `updated_at` | Present on mutable records so freshness and lineage are always answerable. |
| `is_demo` on `employees` | Marks fictional demonstration rows. Queries do not depend on it; it exists so a customer can identify and remove demo data. |

---

## 2. Relationship overview

```
organizations
  ├── users ── user_roles ── roles
  │     └── auth_sessions
  ├── org_settings, org_entitlements, subscriptions
  ├── business_units ── departments ── locations
  ├── employees ── employee_skills ── skills
  │     ├── allocations ── projects ── project_demand
  │     └── timesheets
  ├── invoices, expenses
  ├── imports ── import_rows
  ├── record_versions
  ├── ai_conversations ── ai_messages
  ├── ai_insights ── insight_reviews
  ├── forecasts
  ├── automation_rules ── automation_runs
  ├── approval_requests, deletion_requests, notifications
  ├── audit_events, ai_audit_events
  └── report_definitions, report_runs
```

Every arrow above is also a foreign key in the schema, except `audit_events` and `ai_audit_events`, which deliberately have no foreign keys: an audit row must survive the deletion or renaming of the thing it describes.

---

## 3. Indexes and why they exist

| Index | Table | Serves |
| --- | --- | --- |
| `(org_id, …)` composites on `employees`, `projects`, `allocations`, `timesheets`, `invoices` | Analytical and list queries | Every analytics query filters on `org_id` first; the composite keeps per-tenant scans small. |
| `UNIQUE (org_id, employee_code)` | `employees` | Natural key for imports and upserts. |
| `UNIQUE (org_id, email)` | `users` | Sign-in uniqueness per tenant; the same person may exist in two tenants. |
| `token_hash` | `auth_sessions` | Single lookup per request during authentication. |
| `checksum` lookup on `imports` | `imports` | Duplicate-file detection at upload. |
| Per-entity `record_versions` index | `record_versions` | Fetching the version history of one record. |

---

## 4. Status vocabularies

These are enforced with `CHECK` constraints, so an invalid status cannot be written by an application bug.

| Column | Allowed values |
| --- | --- |
| `organizations.status` | `active`, `suspended`, `closed` |
| `subscriptions.status` | `trial`, `active`, `past_due`, `cancelled` |
| `users.status` | `active`, `invited`, `suspended` |
| `employees.status` | `active`, `on_leave`, `notice`, `exited` |
| `employees.employment_type` | `full_time`, `part_time`, `contractor`, `intern`, `furlough` |
| `projects.status` | `planned`, `active`, `on_hold`, `completed`, `cancelled` |
| `allocations.status` | `planned`, `confirmed`, `completed`, `cancelled` |
| `project_demand.status` | `open`, `partially_filled`, `filled`, `cancelled` |
| `invoices.status` | `draft`, `issued`, `paid`, `overdue`, `cancelled` |
| `imports.status` | `staged`, `mapped`, `validated`, `committed`, `failed`, `discarded` |
| `import_rows.status` | `pending`, `valid`, `warning`, `invalid`, `duplicate`, `committed`, `skipped` |
| `approval_requests.status` | `pending`, `approved`, `rejected`, `executed`, `cancelled` (plus `risk_level`: `low`, `medium`, `high`) |
| `deletion_requests.status` | `pending`, `approved`, `rejected`, `executed`; `scope`: `import`, `entity`, `org` |
| `org_entitlements.status` | `active`, `trial`, `disabled` |

---

## 5. Table reference

Note: "cancelled" allocations and projects are excluded from all capacity and utilisation calculations while remaining in the database for history.

### ai_audit_events  (9 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `org_id` | INTEGER | NOT NULL | — |
| `user_id` | INTEGER | — | — |
| `action` | TEXT | NOT NULL | — |
| `intent` | TEXT | — | — |
| `provider` | TEXT | — | — |
| `data_sent` | TEXT | — | — |
| `result_status` | TEXT | — | — |
| `detail` | TEXT | — | — |
| `created_at` | TEXT | NOT NULL | — |

**Purpose.** Separate audit stream for AI activity: the question intent, provider, what data was sent (shape and size, not raw personal data), result status and detail. Prompt-injection refusals are recorded here.

### ai_conversations  (16 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `org_id` | INTEGER | NOT NULL | organizations.id |
| `user_id` | INTEGER | — | users.id |
| `title` | TEXT | — | — |
| `created_at` | TEXT | NOT NULL | — |
| `updated_at` | TEXT | NOT NULL | — |

**Purpose.** A named thread of assistant interaction, owned by one user in one organisation.

### ai_insights  (15 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `org_id` | INTEGER | NOT NULL | organizations.id |
| `code` | TEXT | NOT NULL | — |
| `category` | TEXT | NOT NULL | — |
| `severity` | TEXT | NOT NULL | — |
| `title` | TEXT | NOT NULL | — |
| `finding` | TEXT | NOT NULL | — |
| `explanation` | TEXT | NOT NULL | — |
| `evidence` | TEXT | NOT NULL | — |
| `impact` | TEXT | — | — |
| `assumptions` | TEXT | NOT NULL default '[]' | — |
| `limitations` | TEXT | NOT NULL default '[]' | — |
| `risks` | TEXT | NOT NULL default '[]' | — |
| `next_step` | TEXT | — | — |
| `requires_approval` | INTEGER | NOT NULL default 0 | — |
| `status` | TEXT | NOT NULL default 'open' | — |
| `period_start` | TEXT | — | — |
| `period_end` | TEXT | — | — |
| `generated_by` | TEXT | NOT NULL default 'rules_engine' | — |
| `generated_at` | TEXT | NOT NULL | — |

**Purpose.** Generated recommendations. Every row must carry a finding, an explanation, evidence, assumptions, limitations and risks, plus whether human approval is required. `status` moves through the review workflow; the review itself is recorded in `insight_reviews`.

### ai_messages  (32 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `org_id` | INTEGER | NOT NULL | organizations.id |
| `conversation_id` | INTEGER | NOT NULL | ai_conversations.id |
| `user_id` | INTEGER | — | users.id |
| `role` | TEXT | NOT NULL | — |
| `content` | TEXT | NOT NULL | — |
| `intent` | TEXT | — | — |
| `evidence` | TEXT | — | — |
| `assumptions` | TEXT | — | — |
| `limitations` | TEXT | — | — |
| `confidence` | TEXT | — | — |
| `provider` | TEXT | — | — |
| `latency_ms` | INTEGER | — | — |
| `created_at` | TEXT | NOT NULL | — |

**Purpose.** Individual question and answer turns, storing the intent, evidence, assumptions, limitations, confidence, provider and latency. Retained so an answer can be re-examined after the fact.

### allocations  (202 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `org_id` | INTEGER | NOT NULL | organizations.id |
| `employee_id` | INTEGER | NOT NULL | employees.id |
| `project_id` | INTEGER | — | projects.id |
| `demand_id` | INTEGER | — | project_demand.id |
| `start_date` | TEXT | NOT NULL | — |
| `end_date` | TEXT | NOT NULL | — |
| `hours_per_week` | REAL | NOT NULL | — |
| `allocation_pct` | REAL | — | — |
| `billable` | INTEGER | NOT NULL default 1 | — |
| `bill_rate_hour` | REAL | — | — |
| `cost_rate_hour` | REAL | — | — |
| `status` | TEXT | NOT NULL default 'planned' | — |
| `note` | TEXT | — | — |
| `created_by` | INTEGER | — | users.id |
| `created_at` | TEXT | NOT NULL | — |
| `updated_at` | TEXT | NOT NULL | — |

**Purpose.** The plan: who is expected to work on what, for how many hours per week, over which window. `status` includes `cancelled`, which excludes the row from capacity maths while preserving history. `billable` and the two rate columns support margin analysis. Overlaps are stored, not merged — an overlap is a signal, not an error.

### approval_requests  (0 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `org_id` | INTEGER | NOT NULL | organizations.id |
| `type` | TEXT | NOT NULL | — |
| `title` | TEXT | NOT NULL | — |
| `description` | TEXT | — | — |
| `payload` | TEXT | NOT NULL default '{}' | — |
| `risk_level` | TEXT | NOT NULL default 'medium' | — |
| `status` | TEXT | NOT NULL default 'pending' | — |
| `requested_by` | INTEGER | — | users.id |
| `decided_by` | INTEGER | — | users.id |
| `decision_note` | TEXT | — | — |
| `created_at` | TEXT | NOT NULL | — |
| `decided_at` | TEXT | — | — |
| `executed_at` | TEXT | — | — |

**Purpose.** Pending and decided human decisions of every type (automation, allocation change, deletion). `requested_by` and `decided_by` are both stored so self-approval is detectable and refusable.

### audit_events  (10 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `org_id` | INTEGER | — | — |
| `actor_user_id` | INTEGER | — | — |
| `actor_email` | TEXT | — | — |
| `actor_role` | TEXT | — | — |
| `action` | TEXT | NOT NULL | — |
| `entity_type` | TEXT | — | — |
| `entity_id` | TEXT | — | — |
| `summary` | TEXT | NOT NULL | — |
| `meta` | TEXT | — | — |
| `ip` | TEXT | — | — |
| `user_agent` | TEXT | — | — |
| `created_at` | TEXT | NOT NULL | — |

**Purpose.** Append-only record of every state-changing action and every sensitive read: organisation, actor, role, action code, entity, human-readable summary, JSON metadata, IP and user agent. `org_id` may be NULL for platform-level events.

### auth_sessions  (11 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `user_id` | INTEGER | NOT NULL | users.id |
| `token_hash` | TEXT | NOT NULL, UNIQUE | — |
| `org_id` | INTEGER | — | — |
| `ip` | TEXT | — | — |
| `user_agent` | TEXT | — | — |
| `created_at` | TEXT | NOT NULL | — |
| `expires_at` | TEXT | NOT NULL | — |
| `revoked_at` | TEXT | — | — |
| `last_seen_at` | TEXT | — | — |

**Purpose.** Server-side sessions. `token_hash` is SHA-256 of the cookie token, so the table alone cannot be used to impersonate anyone. `revoked_at` is set on sign-out and on password change.

### automation_rules  (0 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `org_id` | INTEGER | NOT NULL | organizations.id |
| `code` | TEXT | NOT NULL | — |
| `name` | TEXT | NOT NULL | — |
| `description` | TEXT | — | — |
| `trigger_type` | TEXT | NOT NULL | — |
| `trigger_config` | TEXT | NOT NULL default '{}' | — |
| `action_type` | TEXT | NOT NULL | — |
| `action_config` | TEXT | NOT NULL default '{}' | — |
| `requires_approval` | INTEGER | NOT NULL default 1 | — |
| `enabled` | INTEGER | NOT NULL default 0 | — |
| `created_by` | INTEGER | — | users.id |
| `created_at` | TEXT | NOT NULL | — |
| `updated_at` | TEXT | NOT NULL | — |

**Purpose.** Customer-configured automation. `action_type` must come from a closed allow-list; `requires_approval` routes the run through a human; `enabled` defaults to 0 so a new rule cannot fire until someone turns it on deliberately.

### automation_runs  (0 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `org_id` | INTEGER | NOT NULL | organizations.id |
| `rule_id` | INTEGER | NOT NULL | automation_rules.id |
| `status` | TEXT | NOT NULL | — |
| `triggered_by` | INTEGER | — | users.id |
| `approval_id` | INTEGER | — | — |
| `detail` | TEXT | — | — |
| `executed_at` | TEXT | — | — |
| `created_at` | TEXT | NOT NULL | — |

**Purpose.** One row per run attempt with status, trigger user, linked approval, detail and timestamps. Together with `audit_events` this is the automation trail.

### business_units  (8 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `org_id` | INTEGER | NOT NULL | organizations.id |
| `name` | TEXT | NOT NULL | — |
| `code` | TEXT | NOT NULL | — |
| `leader` | TEXT | — | — |
| `status` | TEXT | NOT NULL default 'active' | — |
| `created_at` | TEXT | NOT NULL | — |

**Purpose.** Top level of the organisational structure (for example "IT Services", "BPO Operations"). Used for grouping, scoping and filtering.

### deletion_requests  (0 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `org_id` | INTEGER | NOT NULL | organizations.id |
| `scope` | TEXT | NOT NULL | — |
| `target_id` | INTEGER | — | — |
| `reason` | TEXT | — | — |
| `requested_by` | INTEGER | — | users.id |
| `approved_by` | INTEGER | — | users.id |
| `status` | TEXT | NOT NULL default 'pending' | — |
| `created_at` | TEXT | NOT NULL | — |
| `executed_at` | TEXT | — | — |
| `detail` | TEXT | — | — |

**Purpose.** A request to delete data at a given scope, with reason, requester, approver, status and execution detail. Two-administrator rule: the approver must not be the requester.

### departments  (13 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `org_id` | INTEGER | NOT NULL | organizations.id |
| `business_unit_id` | INTEGER | — | business_units.id |
| `name` | TEXT | NOT NULL | — |
| `code` | TEXT | NOT NULL | — |
| `cost_center` | TEXT | — | — |
| `status` | TEXT | NOT NULL default 'active' | — |
| `created_at` | TEXT | NOT NULL | — |

**Purpose.** Second level of structure, optionally attached to a business unit. `cost_center` links a department to the customer's own finance coding.

### employee_skills  (429 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `org_id` | INTEGER | NOT NULL | organizations.id |
| `employee_id` | INTEGER | NOT NULL | employees.id |
| `skill_id` | INTEGER | NOT NULL | skills.id |
| `proficiency` | INTEGER | NOT NULL default 3 | — |
| `years` | REAL | — | — |
| `verified` | INTEGER | NOT NULL default 0 | — |

**Purpose.** Skill inventory per employee, with proficiency 1–5, years of experience and a verification flag.

### employees  (194 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `org_id` | INTEGER | NOT NULL | organizations.id |
| `employee_code` | TEXT | NOT NULL | — |
| `full_name` | TEXT | NOT NULL | — |
| `email` | TEXT | — | — |
| `department_id` | INTEGER | — | departments.id |
| `business_unit_id` | INTEGER | — | business_units.id |
| `location_id` | INTEGER | — | locations.id |
| `manager_id` | INTEGER | — | employees.id |
| `designation` | TEXT | — | — |
| `employment_type` | TEXT | NOT NULL default 'full_time' | — |
| `status` | TEXT | NOT NULL default 'active' | — |
| `join_date` | TEXT | — | — |
| `exit_date` | TEXT | — | — |
| `fte` | REAL | NOT NULL default 1.0 | — |
| `weekly_hours` | REAL | — | — |
| `annual_cost` | REAL | — | — |
| `cost_currency` | TEXT | — default 'INR' | — |
| `bill_rate_hour` | REAL | — | — |
| `annual_bill_rate` | REAL | — | — |
| `grade` | TEXT | — | — |
| `data_source` | TEXT | NOT NULL default 'manual' | — |
| `is_demo` | INTEGER | NOT NULL default 0 | — |
| `created_at` | TEXT | NOT NULL | — |
| `updated_at` | TEXT | NOT NULL | — |

**Purpose.** The workforce master record. `employee_code` is the natural key used by imports and is unique per organisation. `weekly_hours` is contracted weekly hours and is used as-is when present; `fte` is applied only when falling back to location-derived hours. `annual_cost`, `cost_currency`, `bill_rate_hour` and `annual_bill_rate` are finance fields redacted server-side for users without cost permission. `is_demo` marks fictional demonstration rows.

### expenses  (53 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `org_id` | INTEGER | NOT NULL | organizations.id |
| `project_id` | INTEGER | — | projects.id |
| `department_id` | INTEGER | — | departments.id |
| `category` | TEXT | NOT NULL | — |
| `period_month` | TEXT | NOT NULL | — |
| `amount` | REAL | NOT NULL | — |
| `currency` | TEXT | NOT NULL default 'INR' | — |
| `description` | TEXT | — | — |
| `created_at` | TEXT | NOT NULL | — |

**Purpose.** Operating expenses by project or department and month, used in gross-margin calculation. Gross margin is only produced when invoices, workforce cost and expenses all exist.

### forecasts  (2 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `org_id` | INTEGER | NOT NULL | organizations.id |
| `kind` | TEXT | NOT NULL | — |
| `method` | TEXT | NOT NULL | — |
| `horizon_months` | INTEGER | NOT NULL | — |
| `params` | TEXT | NOT NULL default '{}' | — |
| `results` | TEXT | NOT NULL | — |
| `limitations` | TEXT | NOT NULL default '[]' | — |
| `quality` | TEXT | NOT NULL default '{}' | — |
| `generated_by` | INTEGER | — | users.id |
| `created_at` | TEXT | NOT NULL | — |

**Purpose.** Stored forecast output: kind, method, horizon, input parameters, result series, limitations and quality metrics (R², months of history). Refusals are recorded too, with the reason and what was missing.

### import_rows  (0 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `org_id` | INTEGER | NOT NULL | organizations.id |
| `import_id` | INTEGER | NOT NULL | imports.id |
| `row_number` | INTEGER | NOT NULL | — |
| `raw` | TEXT | NOT NULL | — |
| `normalized` | TEXT | — | — |
| `status` | TEXT | NOT NULL default 'pending' | — |
| `issues` | TEXT | NOT NULL default '[]' | — |

**Purpose.** The parsed rows of an import, stored as raw and normalised JSON with per-row status and issues. Retained so a past validation can be re-inspected and so an error report can be regenerated.

### imports  (0 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `org_id` | INTEGER | NOT NULL | organizations.id |
| `uploaded_by` | INTEGER | — | users.id |
| `entity_type` | TEXT | NOT NULL | — |
| `filename` | TEXT | NOT NULL | — |
| `stored_path` | TEXT | NOT NULL | — |
| `format` | TEXT | NOT NULL | — |
| `size_bytes` | INTEGER | NOT NULL | — |
| `checksum` | TEXT | NOT NULL | — |
| `status` | TEXT | NOT NULL default 'staged' | — |
| `mapping` | TEXT | — | — |
| `headers` | TEXT | — | — |
| `rows_total` | INTEGER | NOT NULL default 0 | — |
| `rows_valid` | INTEGER | NOT NULL default 0 | — |
| `rows_invalid` | INTEGER | NOT NULL default 0 | — |
| `rows_committed` | INTEGER | NOT NULL default 0 | — |
| `duplicate_rows` | INTEGER | NOT NULL default 0 | — |
| `error_message` | TEXT | — | — |
| `notes` | TEXT | — | — |
| `created_at` | TEXT | NOT NULL | — |
| `updated_at` | TEXT | NOT NULL | — |
| `committed_at` | TEXT | — | — |
| `retention_delete_after` | TEXT | — | — |

**Purpose.** One row per uploaded file: filename, stored path, format, size, SHA-256 checksum, detected headers, chosen mapping, row counts and lifecycle status (staged → mapped → validated → committed, or discarded). This is the lineage record that answers "where did this number come from?".

### insight_reviews  (0 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `org_id` | INTEGER | NOT NULL | organizations.id |
| `insight_id` | INTEGER | NOT NULL | ai_insights.id |
| `user_id` | INTEGER | — | users.id |
| `decision` | TEXT | NOT NULL | — |
| `note` | TEXT | — | — |
| `created_at` | TEXT | NOT NULL | — |

**Purpose.** The decision taken on an insight (acknowledged, acted upon, dismissed) with the reviewer, note and timestamp. This is the evidence that a recommendation was seen by a human.

### invoices  (70 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `org_id` | INTEGER | NOT NULL | organizations.id |
| `project_id` | INTEGER | — | projects.id |
| `invoice_number` | TEXT | NOT NULL | — |
| `period_month` | TEXT | NOT NULL | — |
| `amount` | REAL | NOT NULL | — |
| `currency` | TEXT | NOT NULL default 'INR' | — |
| `status` | TEXT | NOT NULL default 'issued' | — |
| `issued_date` | TEXT | — | — |
| `due_date` | TEXT | — | — |
| `paid_date` | TEXT | — | — |
| `created_at` | TEXT | NOT NULL | — |

**Purpose.** Revenue side of margin: invoice number, period, amount, status and dates. `period_month` (YYYY-MM) is how revenue is matched to the analytics period.

### locations  (8 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `org_id` | INTEGER | NOT NULL | organizations.id |
| `name` | TEXT | NOT NULL | — |
| `country` | TEXT | — | — |
| `timezone` | TEXT | NOT NULL default 'Asia/Kolkata' | — |
| `hours_per_day` | REAL | NOT NULL default 8 | — |
| `working_days` | TEXT | NOT NULL default '[1,2,3,4,5]' | — |
| `holidays` | TEXT | NOT NULL default '[]' | — |
| `created_at` | TEXT | NOT NULL | — |

**Purpose.** Work locations. `hours_per_day`, `working_days` and `holidays` are the inputs to capacity maths when an employee has no explicit weekly hours.

### modules  (12 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `code` | TEXT | PK, UNIQUE | — |
| `name` | TEXT | NOT NULL | — |
| `description` | TEXT | NOT NULL | — |
| `stage` | TEXT | NOT NULL | — |
| `sort_order` | INTEGER | NOT NULL default 0 | — |

**Purpose.** Global catalogue of the twelve product modules with their delivery stage. Platform data, not tenant data — the only table shared by all tenants.

### notifications  (0 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `org_id` | INTEGER | NOT NULL | organizations.id |
| `user_id` | INTEGER | — | users.id |
| `kind` | TEXT | NOT NULL | — |
| `title` | TEXT | NOT NULL | — |
| `body` | TEXT | — | — |
| `link` | TEXT | — | — |
| `read_at` | TEXT | — | — |
| `created_at` | TEXT | NOT NULL | — |

**Purpose.** In-app notifications per user or per role, with kind, title, body, deep link and read timestamp. No email is sent by this system.

### org_entitlements  (33 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `org_id` | INTEGER | PK, NOT NULL | organizations.id |
| `module_code` | TEXT | PK, NOT NULL | modules.code |
| `status` | TEXT | NOT NULL default 'active' | — |
| `limit_value` | INTEGER | — | — |
| `activated_at` | TEXT | NOT NULL | — |

**Purpose.** Which modules a specific organisation has been sold or trialled, plus an optional numeric limit. Drives `requireModule()`.

### org_settings  (18 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `org_id` | INTEGER | PK, NOT NULL | organizations.id |
| `key` | TEXT | PK, NOT NULL | — |
| `value` | TEXT | NOT NULL | — |
| `updated_by` | INTEGER | — | — |
| `updated_at` | TEXT | NOT NULL | — |

**Purpose.** Key/value JSON configuration per organisation: utilization targets and inclusion rules, cost basis, AI permissions, data retention, notification preferences and branding. Written only through `PUT /api/admin/settings/:key`.

### organizations  (3 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `name` | TEXT | NOT NULL | — |
| `slug` | TEXT | NOT NULL, UNIQUE | — |
| `industry` | TEXT | — | — |
| `country` | TEXT | — | — |
| `currency` | TEXT | NOT NULL default 'INR' | — |
| `timezone` | TEXT | NOT NULL default 'Asia/Kolkata' | — |
| `week_start` | TEXT | NOT NULL default 'monday' | — |
| `fiscal_start_month` | INTEGER | NOT NULL default 4 | — |
| `status` | TEXT | NOT NULL default 'active' | — |
| `data_region` | TEXT | NOT NULL default 'ap-south' | — |
| `created_at` | TEXT | NOT NULL | — |
| `updated_at` | TEXT | NOT NULL | — |

**Purpose.** The tenant record itself. One row per customer organisation; `slug` is the URL-safe identifier, `currency` and `timezone` drive all display formatting, `data_region` records where the customer expects data to reside, and `status` gates sign-in.

### project_demand  (16 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `org_id` | INTEGER | NOT NULL | organizations.id |
| `project_id` | INTEGER | NOT NULL | projects.id |
| `role_title` | TEXT | NOT NULL | — |
| `required_skill_id` | INTEGER | — | skills.id |
| `headcount` | INTEGER | NOT NULL default 1 | — |
| `hours_per_week` | REAL | NOT NULL default 40 | — |
| `start_date` | TEXT | NOT NULL | — |
| `end_date` | TEXT | NOT NULL | — |
| `priority` | TEXT | NOT NULL default 'medium' | — |
| `status` | TEXT | NOT NULL default 'open' | — |
| `notes` | TEXT | — | — |
| `created_at` | TEXT | NOT NULL | — |

**Purpose.** Open staffing requirements: role, optional required skill, headcount, weekly hours and window. Coverage is computed against allocations, so demand is a statement of need rather than a reservation.

### projects  (14 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `org_id` | INTEGER | NOT NULL | organizations.id |
| `code` | TEXT | NOT NULL | — |
| `name` | TEXT | NOT NULL | — |
| `client_name` | TEXT | — | — |
| `business_unit_id` | INTEGER | — | business_units.id |
| `department_id` | INTEGER | — | departments.id |
| `manager_user_id` | INTEGER | — | users.id |
| `manager_employee_id` | INTEGER | — | employees.id |
| `start_date` | TEXT | — | — |
| `end_date` | TEXT | — | — |
| `status` | TEXT | NOT NULL default 'active' | — |
| `contract_type` | TEXT | NOT NULL default 'time_material' | — |
| `budget_amount` | REAL | — | — |
| `currency` | TEXT | NOT NULL default 'INR' | — |
| `billing_rate_hour` | REAL | — | — |
| `priority` | TEXT | NOT NULL default 'medium' | — |
| `health` | TEXT | NOT NULL default 'green' | — |
| `created_at` | TEXT | NOT NULL | — |
| `updated_at` | TEXT | NOT NULL | — |

**Purpose.** Delivery engagements. `contract_type`, `budget_amount`, `billing_rate_hour` and `health` support commercial views; `manager_user_id` and `manager_employee_id` both exist because a project may be managed by a platform user or tracked against an employee record.

### record_versions  (0 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `org_id` | INTEGER | NOT NULL | organizations.id |
| `entity_type` | TEXT | NOT NULL | — |
| `entity_id` | INTEGER | NOT NULL | — |
| `version` | INTEGER | NOT NULL | — |
| `snapshot` | TEXT | NOT NULL | — |
| `changed_by` | INTEGER | — | users.id |
| `change_type` | TEXT | NOT NULL default 'update' | — |
| `changed_at` | TEXT | NOT NULL | — |

**Purpose.** Snapshot of a record before it is changed by an import, with version number, change type, actor and timestamp. Provides a per-record history beyond the audit log.

### report_definitions  (0 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `org_id` | INTEGER | NOT NULL | organizations.id |
| `code` | TEXT | NOT NULL | — |
| `name` | TEXT | NOT NULL | — |
| `description` | TEXT | — | — |
| `kind` | TEXT | NOT NULL | — |
| `params` | TEXT | NOT NULL default '{}' | — |
| `shared` | INTEGER | NOT NULL default 1 | — |
| `created_by` | INTEGER | — | users.id |
| `created_at` | TEXT | NOT NULL | — |

**Purpose.** Catalogue of available reports and their parameters. Global definitions live in code; this table allows organisation-level custom definitions.

### report_runs  (0 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `org_id` | INTEGER | NOT NULL | organizations.id |
| `report_code` | TEXT | NOT NULL | — |
| `params` | TEXT | NOT NULL default '{}' | — |
| `format` | TEXT | NOT NULL default 'csv' | — |
| `row_count` | INTEGER | NOT NULL default 0 | — |
| `file_path` | TEXT | — | — |
| `generated_by` | INTEGER | — | users.id |
| `created_at` | TEXT | NOT NULL | — |

**Purpose.** Every generated report file: report code, parameters, format, row count, file path, generator and timestamp. Provides the audit link between a downloaded file and the data state that produced it.

### roles  (21 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `org_id` | INTEGER | — | organizations.id |
| `code` | TEXT | NOT NULL | — |
| `name` | TEXT | NOT NULL | — |
| `description` | TEXT | — | — |
| `permissions` | TEXT | NOT NULL | — |
| `is_system` | INTEGER | NOT NULL default 0 | — |
| `created_at` | TEXT | NOT NULL | — |

**Purpose.** Roles belonging to an organisation. `is_system` marks the seven templates; organisations may add custom roles. `permissions` is a JSON array of permission keys.

### skills  (49 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `org_id` | INTEGER | NOT NULL | organizations.id |
| `name` | TEXT | NOT NULL | — |
| `category` | TEXT | — | — |
| `created_at` | TEXT | NOT NULL | — |

**Purpose.** Skill catalogue per organisation, used for demand matching and skill-gap reporting.

### subscriptions  (3 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `org_id` | INTEGER | NOT NULL | organizations.id |
| `plan_code` | TEXT | NOT NULL | — |
| `status` | TEXT | NOT NULL | — |
| `seats` | INTEGER | NOT NULL default 5 | — |
| `monthly_fee` | REAL | NOT NULL default 0 | — |
| `setup_fee` | REAL | NOT NULL default 0 | — |
| `currency` | TEXT | NOT NULL default 'INR' | — |
| `billing_cycle` | TEXT | NOT NULL default 'monthly' | — |
| `started_at` | TEXT | NOT NULL | — |
| `renews_at` | TEXT | — | — |
| `notes` | TEXT | — | — |

**Purpose.** Commercial record per organisation: plan tier, seats, monthly and setup fee, status, renewal date. Prices are configurable placeholders, explicitly noted in the `notes` column as not validated with customers.

### timesheets  (45,604 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `org_id` | INTEGER | NOT NULL | organizations.id |
| `employee_id` | INTEGER | NOT NULL | employees.id |
| `project_id` | INTEGER | — | projects.id |
| `work_date` | TEXT | NOT NULL | — |
| `hours` | REAL | NOT NULL | — |
| `billable` | INTEGER | NOT NULL default 1 | — |
| `source` | TEXT | NOT NULL default 'import' | — |
| `import_id` | INTEGER | — | — |

**Purpose.** The actuals: hours worked per employee per day, optionally per project, with a billable flag and the originating import. Utilisation is calculated from this table alone; without rows, utilisation is reported as blank rather than zero.

### user_roles  (24 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `user_id` | INTEGER | NOT NULL | users.id |
| `role_id` | INTEGER | NOT NULL | roles.id |
| `business_unit_id` | INTEGER | — | — |
| `department_id` | INTEGER | — | — |
| `assigned_at` | TEXT | NOT NULL | — |

**Purpose.** Assignment of roles to users. A row may carry `business_unit_id` and/or `department_id`, which is how a role becomes scoped to part of the organisation. A user with only scoped assignments sees only that slice.

### users  (25 rows in demo db)

| Column | Type | Constraints | References |
| --- | --- | --- | --- |
| `id` | INTEGER | PK | — |
| `org_id` | INTEGER | — | organizations.id |
| `email` | TEXT | NOT NULL, UNIQUE | — |
| `full_name` | TEXT | NOT NULL | — |
| `title` | TEXT | — | — |
| `password_hash` | TEXT | NOT NULL | — |
| `is_platform_admin` | INTEGER | NOT NULL default 0 | — |
| `status` | TEXT | NOT NULL default 'active' | — |
| `must_change_password` | INTEGER | NOT NULL default 0 | — |
| `failed_logins` | INTEGER | NOT NULL default 0 | — |
| `locked_until` | TEXT | — | — |
| `last_login_at` | TEXT | — | — |
| `created_at` | TEXT | NOT NULL | — |
| `updated_at` | TEXT | NOT NULL | — |

**Purpose.** Sign-in identity. `password_hash` holds a scrypt digest (never a password), `failed_logins` and `locked_until` implement lockout, `must_change_password` forces a reset after an administrator creates or resets the account. `org_id` is NULL only for platform administrators.
