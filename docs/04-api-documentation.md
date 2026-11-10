# WorkforceIQ — API Documentation

**Version:** 1.0
**Base URL (self-hosted default):** `http://<host>:4000/api`
**Last updated:** 2026-11-10

---

## 1. Conventions

### 1.1 Format

All requests and responses are JSON (`application/json`), except file uploads (`multipart/form-data`) and file downloads (`text/csv`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`).

### 1.2 Response envelopes

Success:

```json
{ "data": { … } }
{ "data": [ … ], "meta": { "total": 412, "limit": 50, "page": 1 } }
```

Failure — always with the same shape, always with a stable machine-readable code:

```json
{ "error": { "code": "VALIDATION_FAILED", "message": "Weekly hours must be between 0 and 80.", "details": { … } } }
```

`message` is written for a business user and is safe to display. `details` is optional structured context (for example which permission was required, or which capacity check failed).

### 1.3 Authentication

Session cookie `wiq_session` (HttpOnly, SameSite=Lax). Obtain it with `POST /auth/login`. All endpoints except `POST /auth/login` and `GET /health` require it. There is no API key or bearer token — the interface and any integration use the same session mechanism.

```bash
# sign in and keep the cookie
curl -c jar.txt -X POST http://localhost:4000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"admin@nexora-demo.example","password":"DemoPass!2026"}'

# then use it
curl -b jar.txt http://localhost:4000/api/analytics/dashboard
```

### 1.4 Pagination

List endpoints accept `?limit=` (default 50, max 500) and `?page=` (default 1) and return `meta.total`, `meta.limit`, `meta.page`.

### 1.5 Periods

Analytics endpoints accept one of:

| Parameter | Example | Meaning |
| --- | --- | --- |
| `month` | `2026-11` | Calendar month |
| `quarter`, `year` | `quarter=3&year=2026` | Calendar quarter |
| `from`, `to` | `from=2026-10-01&to=2026-10-31` | Explicit range |
| `days` | `days=30` | Trailing window ending today |

With no parameter, the current month is used. The resolved period (`start`, `end`, `label`, `working_days`) is always echoed in the response so a caller never has to infer it.

### 1.6 Filters

`business_unit_id`, `department_id`, `location_id` and `project_id` may be added to any analytics request. Filters narrow the data; they never widen a user's permissions.

### 1.7 Error codes

| Code | HTTP | Meaning |
| --- | --- | --- |
| `AUTH_REQUIRED` | 401 | No valid session |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password (deliberately ambiguous) |
| `ACCOUNT_LOCKED` | 423 | Too many failed attempts |
| `ACCOUNT_INACTIVE`, `ORG_INACTIVE` | 403 | Account or organisation disabled |
| `FORBIDDEN` | 403 | Missing permission; `details.required` names it |
| `MODULE_NOT_ENABLED` | 403 | Module not entitled for this organisation |
| `OUT_OF_SCOPE` | 403 | Record exists but is outside the user's data scope |
| `NO_TENANT` | 403 | Platform-only account on a tenant endpoint |
| `NOT_FOUND` | 404 | Missing, or belongs to another tenant (indistinguishable) |
| `VALIDATION_FAILED` | 400 | Input rejected; `details` explains |
| `DUPLICATE_FILE` | 409 | Identical file already uploaded |
| `CONFLICT` | 409 | State conflict (for example already committed) |
| `CAPACITY_EXCEEDED` | 400 | Allocation would exceed 150% of standard weekly hours |
| `SELF_APPROVAL` | 403 | A requester cannot approve their own request |
| `CROSS_SITE_BLOCKED` | 403 | `Origin` did not match `Host` on a state-changing request |
| `RATE_LIMITED` | 429 | Auth endpoint throttle (>30 attempts/minute/IP) |
| `INTERNAL_ERROR` | 500 | Server fault; no internal detail is returned |

### 1.8 Rate limiting and CSRF

- `/api/auth/*` allows 30 requests per minute per IP. Six bad passwords lock the account for 15 minutes.
- Any state-changing request that carries an `Origin` header must have an `Origin` host matching the `Host` header, otherwise it is refused with `CROSS_SITE_BLOCKED`.

---

## 2. Health

### `GET /api/health`

No authentication. Used by deployment health checks.

```json
{ "status": "ok", "environment": "production", "version": "1.0.0",
  "database": "connected", "ai_provider": "local", "time": "2026-11-10T12:00:00.000Z" }
```

Returns `503` with `"status": "degraded"` if the database cannot be read.

---

## 3. Authentication — `/api/auth`

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| POST | `/login` | — | Sign in, sets session cookie |
| POST | `/logout` | — | Revoke the current session |
| GET | `/me` | session | Current principal: user, org, roles, permissions, scopes, entitlements |
| POST | `/change-password` | session | Change own password; revokes other sessions |
| GET | `/permission-catalogue` | session | All 24 permissions and the seven role templates |
| POST | `/register-org` | platform admin | Provision a new customer organisation |

### `POST /auth/login`

```json
// request
{ "email": "admin@nexora-demo.example", "password": "DemoPass!2026" }
// 200
{ "data": { "expiresAt": "2026-11-10T23:00:00.000Z", "mustChangePassword": false } }
```

| Failure | Status/code |
| --- | --- |
| Missing field | 400 `VALIDATION_FAILED` |
| Unknown email or wrong password | 401 `INVALID_CREDENTIALS` (identical response for both) |
| 6 consecutive failures | 423 `ACCOUNT_LOCKED` for 15 minutes |
| Suspended user / suspended org | 403 `ACCOUNT_INACTIVE` / `ORG_INACTIVE` |

### `GET /auth/me`

```json
{ "data": {
    "user": { "id": 2, "email": "admin@…", "full_name": "…", "title": "…", "must_change_password": false },
    "organization": { "id": 1, "name": "Nexora IT Services (Demo)", "currency": "INR", "timezone": "Asia/Kolkata" },
    "roles": [{ "code": "org_admin", "name": "Organization Administrator", "scope": { "restricted": false } }],
    "permissions": ["org.view", "…"],
    "modules": ["org_admin", "…"],
    "is_platform_admin": false,
    "unread_notifications": 3
} }
```

### `POST /auth/change-password`

```json
{ "currentPassword": "OldPass!2026", "newPassword": "NewPass!2026" }
```

Policy: ≥10 characters, lower case, upper case, digit. All other sessions for the user are revoked on success.

### `POST /auth/register-org` (platform administrator only)

```json
{ "orgName": "Acme Delivery", "slug": "acme", "industry": "IT Services",
  "country": "IN", "currency": "INR", "adminEmail": "admin@acme.example",
  "adminName": "Acme Admin", "planCode": "professional",
  "modules": ["org_admin","data_ingestion","workforce","utilization"],
  "seats": 10, "tempPassword": "TempPass!2026" }
```

Returns `{ orgId, adminUserId, temporaryPassword, mustChangePassword: true }`. The temporary password is returned once and is never stored in plain form anywhere; the administrator must change it at first sign-in.

---

## 4. Administration — `/api/admin`

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/organization` | `org.view` | Organisation profile, settings, AI provider status |
| PATCH | `/organization` | `org.manage` | Update name, industry, country, currency, timezone |
| PUT | `/settings/:key` | `org.manage` | Replace one settings group (`utilization`, `cost`, `ai`, `data`, `notifications`, `branding`) |
| GET | `/structure` | `org.view` | Business units, departments, locations |
| POST | `/business-units` | `org.manage` | Create business unit |
| POST | `/departments` | `org.manage` | Create department |
| POST | `/locations` | `org.manage` | Create location (name, country, timezone, hours/day, working days, holidays) |
| PATCH | `/locations/:id` | `org.manage` | Update location |
| GET | `/users` | `user.view` | List users |
| POST | `/users` | `user.manage` | Create user with role and optional scope |
| PATCH | `/users/:id` | `user.manage` | Update user (name, title, status) |
| PUT | `/users/:id/roles` | `user.manage` | Replace role assignments |
| POST | `/users/:id/reset-password` | `user.manage` | Reset password, force change at next sign-in |
| GET | `/roles` | `user.view` | Roles with permissions and member counts |
| POST | `/roles` | `role.manage` | Create custom role |
| PUT | `/roles/:id` | `role.manage` | Replace a role's permissions (takes effect on the next request) |
| GET | `/audit` | `audit.view` | Audit trail, filterable by `action` and `actor` |
| GET | `/ai-audit` | `audit.view` | AI activity log (last 200 events) |
| GET | `/modules` | `org.view` | Module catalogue with this organisation's entitlements |
| GET | `/data-retention` | `org.manage` | Import inventory, retention settings, deletion requests |

### `POST /admin/users`

```json
{ "email": "wfm@acme.example", "full_name": "Resourcing Lead", "title": "Workforce Manager",
  "role_code": "workforce_manager", "business_unit_id": 2, "department_id": 7,
  "tempPassword": "TempPass!2026" }
```

`business_unit_id` / `department_id` make the assignment **scoped**: the user then sees only that slice, enforced in SQL. Returns the new user id and `mustChangePassword: true`.

### `GET /admin/audit`

Query: `limit` (default 100, max 500), `page`, `action` (substring), `actor` (substring).

```json
{ "data": [
  { "id": 981, "actor_email": "admin@nexora-demo.example", "actor_role": "org_admin",
    "action": "import.committed", "entity_type": "import", "entity_id": "12",
    "summary": "Import committed: 61 created, 0 updated, 0 skipped",
    "meta": "{\"created\":61,\"updated\":0,\"skipped\":0}", "ip": "10.0.0.4",
    "created_at": "2026-11-10T09:14:02.111Z" } ],
  "meta": { "total": 412, "limit": 100, "page": 1 } }
```

Audited action codes include `auth.login`, `auth.login.failed`, `auth.logout`, `auth.password_changed`, `user.created`, `user.updated`, `user.roles.updated`, `user.password_reset`, `role.created`, `role.updated`, `org.updated`, `org.settings.updated`, `business_unit.created`, `department.created`, `location.created`, `location.updated`, `employee.created`, `employee.updated`, `employee.skills.updated`, `project.created`, `project.updated`, `demand.created`, `demand.updated`, `allocation.created`, `allocation.updated`, `allocation.cancelled`, `approval.requested`, `approval.approved`, `approval.rejected`, `automation.rule.created`, `automation.rule.enabled`, `automation.rule.disabled`, `automation.rule.run`, `automation.executed_after_approval`, `import.uploaded`, `import.mapped`, `import.validated`, `import.committed`, `import.discarded`, `import.error_report.downloaded`, `report.generated`, `report.downloaded`, `insights.generated`, `insight.reviewed`, `forecast.generated`, `ai.conversation.deleted`, `deletion.requested`, `deletion.rejected`, `deletion.executed`, `data.exported`, `org.created`.

---

## 5. Workforce — `/api/workforce`

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/` | `workforce.view` | List employees, filterable and paginated |
| GET | `/:id` | `workforce.view` | One employee with skills and current allocations |
| POST | `/` | `workforce.manage` | Create employee |
| PATCH | `/:id` | `workforce.manage` | Update employee |
| GET | `/meta/skills` | `workforce.view` | Skill catalogue |
| PUT | `/:id/skills` | `workforce.manage` | Replace an employee's skill set |
| GET | `/export/csv` | `report.view` | CSV export honouring the caller's permissions |

### `GET /workforce`

Query: `q` (name/code/email search), `department_id`, `business_unit_id`, `location_id`, `status`, `limit`, `page`.

Cost fields (`annual_cost`, `cost_currency`, `bill_rate_hour`, `annual_bill_rate`) are present only when the caller holds `workforce.cost.view` or `finance.view`; otherwise the response carries `cost_redacted: true`. This is server-side redaction, not a UI hint.

```json
{ "data": [
  { "id": 14, "employee_code": "NX-1007", "full_name": "Asha Rao", "designation": "Senior Engineer",
    "department": "Application Development", "business_unit": "IT Services", "location": "Hyderabad (Madhapur)",
    "status": "active", "employment_type": "full_time", "fte": 1, "weekly_hours": 40,
    "annual_cost": 1820000, "cost_currency": "INR", "utilisation_pct": 82.4, "allocation_pct": 96.0 } ],
  "meta": { "total": 61, "limit": 50, "page": 1 } }
```

---

## 6. Projects and demand — `/api/projects`

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/` | `project.view` | List projects with headcount and weekly hours |
| GET | `/demand` | `project.view` | Demand records with coverage |
| GET | `/overlaps` | `allocation.view` | Allocations overlapping in time |
| GET | `/:id` | `project.view` | One project with team and demand |
| POST | `/` | `project.manage` | Create project |
| PATCH | `/:id` | `project.manage` | Update project |
| POST | `/:id/demand` | `project.manage` | Add a demand record |
| PATCH | `/demand/:demandId` | `project.manage` | Update a demand record |

---

## 7. Allocations — `/api/allocations`

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/` | `allocation.view` | Allocations, filterable by employee, project, month |
| POST | `/` | `allocation.manage` | Create allocation (capacity-guarded) |
| PATCH | `/:id` | `allocation.manage` | Update allocation (capacity-guarded) |
| DELETE | `/:id` | `allocation.manage` | Cancel an allocation (kept for history) |
| POST | `/scenario` | `allocation.view` | Read-only "what if" suggestions |
| POST | `/:id/request-approval` | `allocation.manage` | Route a change to a human approver |

### `POST /allocations`

```json
{ "employee_id": 14, "project_id": 3, "start_date": "2026-11-01", "end_date": "2026-11-30",
  "hours_per_week": 30, "billable": true, "note": "Phase 2 build" }
```

Guardrails: weekly hours must be 0–80; combining this allocation with existing overlapping ones must not exceed **150% of standard weekly hours**, otherwise `400 CAPACITY_EXCEEDED` with the capacity detail. Overlap with another allocation is allowed (people genuinely split time) but returned as `capacityWarning` so the interface can warn instead of silently accepting it.

```json
// 200
{ "data": { "id": 74, "capacityWarning": { "standard_weekly_hours": 40, "existing_weekly_hours": 20,
  "combined_weekly_hours": 50, "over_capacity": true, "overlapping_allocations": [ … ] } } }
```

### `POST /allocations/scenario`

Body: `{ "project_id": 3, "hours_per_week": 40, "start_date": "…", "end_date": "…", "skill": "Java" }`.

Returns ranked candidate employees with reasons and warnings. **Nothing is written**; the response includes `"applied": false`.

---

## 8. Imports — `/api/imports`

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/schemas` | `import.manage` | The eight importable entity types with fields, aliases and examples |
| GET | `/template/:entity` | `import.manage` | Downloadable CSV template with headers and one example row |
| POST | `/upload` | `import.manage` | Upload CSV/XLSX, returns suggested mapping |
| GET | `/` | `import.manage` | Import history with status and counts |
| GET | `/:id` | `import.manage` | One import with row detail |
| POST | `/:id/map` | `import.manage` | Save column mapping |
| POST | `/:id/validate` | `import.manage` | Validate rows |
| POST | `/:id/commit` | `import.manage` | Write to live tables (requires `validated`) |
| DELETE | `/:id` | `import.manage` | Discard a staged import (committed imports refuse) |
| GET | `/:id/error-report` | `import.manage` | CSV error report |
| GET | `/:id/file` | `import.manage` | Download the original uploaded file |

### `POST /imports/upload`

`multipart/form-data` with fields `file` (CSV/XLSX, ≤20 MB, ≤20,000 rows) and `entity_type` (one of `employees`, `skills`, `projects`, `demand`, `allocations`, `timesheets`, `invoices`, `expenses`). Optional `force=true` to bypass the duplicate check.

```json
{ "data": {
  "id": 12, "entity_type": "employees", "status": "staged", "rows_total": 61,
  "headers": ["Employee ID","Name","Department","…"],
  "mapping": { "employee_code": "Employee ID", "full_name": "Name", "department": "Department" },
  "unmapped_source_columns": ["Grade Comment"],
  "missing_required": [],
  "checksum": "a91f…" } }
```

| Failure | Status/code |
| --- | --- |
| Wrong extension or >20 MB | 400 `VALIDATION_FAILED` / `FILE_TOO_LARGE` |
| Header row but no data | 400 `NO_ROWS` |
| >20,000 rows | 400 `TOO_MANY_ROWS` |
| Identical file already uploaded | 409 `DUPLICATE_FILE` (use `force=true` deliberately) |

### `POST /imports/:id/validate`

```json
{ "data": { "rowsTotal": 61, "rowsValid": 58, "rowsInvalid": 2, "rowsDuplicate": 1,
  "issues": [ { "row_number": 14, "severity": "error", "code": "INVALID_DATE",
                "field": "join_date", "message": "Not a recognisable date", "raw_values": { "join_date": "31/02/2026" } } ] } }
```

### `POST /imports/:id/commit`

Refused with `409 CONFLICT` unless the import is `validated`. Executes in a single transaction.

```json
{ "data": { "created": 58, "updated": 0, "skipped": 3, "committed": true,
  "details": [ { "row": 14, "status": "invalid" } ],
  "created_detail": [ { "row": 2, "employee_code": "NX-1001" } ],
  "insights": { "generated": 2 } } }
```

### `GET /imports/:id/error-report`

CSV, fixed header: `row_number,severity,code,field,message,raw_values`. The import must belong to the caller's organisation.

---

## 9. Analytics — `/api/analytics`

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/dashboard` | `analytics.utilization` or `analytics.executive` | One consistent dashboard payload |
| GET | `/utilization` | `analytics.utilization` | Full utilisation report with per-person rows |
| GET | `/utilization/trend` | `analytics.utilization` | Monthly trend (`months` or `count` + `end`) |
| GET | `/financial` | `finance.view` or `workforce.cost.view` | Cost, revenue, margin |
| GET | `/demand` | `project.view` | Demand coverage analysis |
| GET | `/overlaps` | `allocation.view` | Overlapping allocations |
| GET | `/definitions` | session | Metric definitions and calculation settings |

### `GET /analytics/dashboard?month=2026-11`

```json
{ "data": {
  "period": { "start": "2026-11-01", "end": "2026-11-30", "label": "November 2026", "working_days": 21 },
  "utilization": {
    "total": { "headcount": 61, "available_hours": 10072, "allocated_hours": 9032,
               "utilized_hours": 8003.5, "unallocated_hours": 2478.8,
               "over_allocated_hours": 1438.8, "allocation_pct": 89.7, "utilization_pct": 79.5,
               "billable_pct": 74.2, "employees_over_allocated": 23, "bench_count": 3 },
    "byDepartment": [ … ], "byBusinessUnit": [ … ], "byLocation": [ … ],
    "overAllocated": [ … 10 ], "idle": [ … 10 ],
    "definitions": { … } },
  "trend": [ { "month": "2026-06", "utilization_pct": 77.1, "allocation_pct": 88.0 }, … ],
  "demand": { "gaps": [ … ], "total_gaps": 4 },
  "finance": { "availability": { "visible": true, "reason": null }, "totals": {
      "workforce_cost": 6568166.7, "idle_workforce_cost": 1616641.1,
      "invoiced_revenue": 8485000, "paid_revenue": 0, "expenses": 803200,
      "billable_value": 12181900, "gross_margin": 1113633.3, "gross_margin_pct": 13.1 } },
  "dataFreshness": { "last_timesheet_date": "2026-11-30", "last_import_at": null,
                     "last_insight_at": "2026-11-10T12:11:50.224Z", "generated_at": "…" },
  "openInsights": 5,
  "settings": { "basis": "available_hours", "target_utilization_pct": 75, … }
} }
```

> The figures above are from the fictional Nexora demonstration tenant for November 2026. They illustrate the shape of the response, not any customer's results.

`finance` is `null` when the caller lacks both finance and cost permissions — the block is absent, not zeroed.

### `GET /analytics/utilization?month=2026-08`

Returns period, `employees[]` (per-person available/allocated/used hours, percentages, flags, `utilization_confidence`), `byDepartment`, `byBusinessUnit`, `byLocation`, `total`, `overAllocated`, `idle`, and the definitions used.

Utilisation is `null` — never `0` — for a person with no timesheet rows. `utilization_confidence` is `none`, `partial` or `full` based on timesheet coverage.

### `GET /analytics/definitions`

Returns every metric with `key`, `name`, `formula`, `notes`, plus the organisation's calculation settings and a note about actuals vs plans vs estimates. This is the same content the "Metric definitions" screen renders.

---

## 10. AI — `/api/ai`

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| POST | `/assistant/ask` | `ai.assistant` | Ask a business question |
| GET | `/assistant/suggestions` | `ai.assistant` | Suggested questions starter set |
| GET | `/assistant/conversations` | `ai.assistant` | Own conversations |
| GET | `/assistant/conversations/:id` | `ai.assistant` | One conversation with messages |
| GET | `/assistant/fact-preview` | `ai.assistant` | The exact facts that would be used (transparency) |
| DELETE | `/assistant/conversations/:id` | `ai.assistant` | Delete own conversation |
| GET | `/insights` | `ai.insights` | Insights, filterable by status/severity |
| POST | `/insights/generate` | `ai.insights` | Generate insights for a period |
| POST | `/insights/:id/review` | `ai.insights` | Record a review decision |
| GET | `/insights/:id/reviews` | `ai.insights` | Review history |
| POST | `/forecast` | `forecast.view` | Generate a forecast |
| GET | `/forecast/history` | `forecast.view` | Previous forecasts and refusals |
| GET | `/governance` | `ai.assistant` | AI configuration and usage summary |

### `POST /ai/assistant/ask`

```json
{ "question": "Where are we over-allocated and who is affected?", "period": { "month": "2026-11" } }
```

```json
{ "data": {
  "intent": "over_allocation",
  "answer": "In November 2026, 23 of 61 people are over-allocated by a combined 1,438.8 hours …",
  "period": { "start": "2026-11-01", "end": "2026-11-30", "label": "November 2026" },
  "filters": {},
  "evidence": [ { "label": "Employees over-allocated", "value": 23, "unit": "people" },
                { "label": "Hours above capacity", "value": 1438.8, "unit": "hours" } ],
  "assumptions": [ … ], "limitations": [ … ],
  "confidence": "high",
  "provider": "local-deterministic", "external_calls_made": false, "mode": "grounded_local",
  "insufficient": false } }
```

Behaviour that is guaranteed and tested:

| Situation | Response |
| --- | --- |
| Question matches no supported intent | Refusal that lists what the assistant can answer (`insufficient: true`) |
| Required data absent (for example no timesheets) | Answer states exactly what is missing; no number is guessed |
| Question asks for finance data without permission | 403, and the fact pack never contained the figures |
| Text attempting to change instructions | Not answered: the response returns `blocked: true`, an explanation, `intent: "blocked"` and `confidence: "insufficient_data"`, and the attempt is recorded in `ai_audit_events` as `prompt_injection.blocked` |
| No external model configured | `provider: "local-deterministic"`, `external_calls_made: false` |

### `POST /ai/insights/generate`

```json
{ "period": { "month": "2026-11" } }
→ { "data": { "generated": 5, "codes": ["EMPLOYEES_OVER_ALLOCATED", "…"], "period": { … } } }
```

Insight codes: `UNALLOCATED_CAPACITY_CONCENTRATION`, `EMPLOYEES_OVER_ALLOCATED`, `OVERLAPPING_ALLOCATIONS`, `DEMAND_COVERAGE_GAP`, `UTILIZATION_TREND_SHIFT`, `IDLE_WORKFORCE_COST`, `DATA_QUALITY_INCOMPLETE`.

### `POST /ai/insights/:id/review`

```json
{ "decision": "acknowledged", "note": "Reviewed with the delivery head on 10 Nov." }
```

Decision is one of `acknowledged`, `actioned`, `dismissed`. The reviewer, note and timestamp are stored and audited.

### `POST /ai/forecast`

```json
{ "kind": "utilization", "horizonMonths": 3, "filters": {} }
```

`kind` is one of `utilization`, `demand`, `capacity`, `cost` (`cost` additionally requires cost permission).

```json
// refusal — the honest outcome when history is thin
{ "data": { "refused": true, "kind": "utilization",
  "reason": "Only 2 month(s) of complete utilization history are available. At least 4 are required before a forecast is meaningful.",
  "missing": { "required": "4 months of utilization history", "have": "2 months" },
  "actuals": [ { "month": "2026-10", "value": 78.9 } ], "series": [], "limitations": [ … ] } }
```

```json
// success
{ "data": { "id": 4, "kind": "utilization", "method": "ordinary_least_squares_trend",
  "horizon_months": 3, "series": [ { "month": "2026-12", "value": 80.1 } ],
  "quality": { "r2": 0.87, "method_note": "Linear trend on monthly utilization; no seasonality modelling." },
  "limitations": [ "Straight-line trend with no seasonality.", "Assumes current headcount." ] } }
```

Predictions are clamped to the observed range, so a forecast can never claim a utilisation figure the data has never supported.

---

## 11. Reports — `/api/reports`

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/` | `report.view` | Report catalogue with availability for this user |
| POST | `/generate` | `report.view` | Generate a report file |
| GET | `/download/:filename` | `report.view` | Download a generated file |
| GET | `/history` | `report.view` | Previously generated files |

Report codes and their separate permission gates:

| Code | Requires | Content |
| --- | --- | --- |
| `utilization_summary` | `report.view` | Headline metrics with definitions |
| `department_utilization` | `report.view` | Utilisation by department |
| `employee_capacity` | `report.view` | Per-person capacity (cost columns only with cost permission) |
| `project_demand` | `report.view` | Required vs filled hours |
| `allocation_register` | `allocation.view` | All allocations in the period |
| `workforce_cost` | `finance.view` | Cost by department and project |
| `data_quality` | `report.view` | Record counts, cost coverage, timesheet coverage |
| `audit_trail` | `audit.view` | Who did what and when |

```json
// POST /reports/generate
{ "code": "department_utilization", "format": "xlsx", "period": { "month": "2026-11" } }
→ { "data": { "report_code": "department_utilization", "filename": "department_utilization_2026-11_…xlsx",
              "format": "xlsx", "row_count": 9, "download": "/api/reports/download/…" } }
```

Every file carries a lineage header: organisation, generator, generation timestamp, period, and the metric definitions used. The download endpoint refuses path traversal and refuses files belonging to another organisation (404, not 403).

---

## 12. Governance — `/api/governance`

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| GET | `/automation/rules` | `automation.manage` | Rules, action and trigger catalogue |
| POST | `/automation/rules` | `automation.manage` | Create rule (created disabled) |
| POST | `/automation/rules/:id/enable` | `automation.manage` | Enable or disable |
| POST | `/automation/rules/:id/run` | `automation.manage` | Run now (may create an approval instead) |
| GET | `/approvals` | `approval.manage` | Approval inbox (`?status=pending`) |
| POST | `/approvals/:id/decide` | `approval.manage` | Approve or reject |
| GET | `/notifications` | session | Own notifications |
| POST | `/notifications/:id/read` | session | Mark read |
| GET | `/subscription` | `org.view` | Plan, seats, entitlement usage |
| GET | `/data/deletion-requests` | `org.manage` | Deletion requests |
| POST | `/data/deletion-requests` | `org.manage` | Request deletion |
| POST | `/data/deletion-requests/:id/decide` | `org.manage` | Approve or reject (not the requester) |
| GET | `/data/export` | `org.manage` | Full JSON export of this tenant's data |
| GET | `/platform/organizations` | platform admin | Aggregate tenant counts only |

### `POST /automation/rules`

```json
{ "code": "month_end_utilization_report", "name": "Month-end utilisation report",
  "description": "Produces the department report at month end.",
  "trigger_type": "manual", "action_type": "generate_report",
  "action_config": { "report_code": "department_utilization" },
  "requires_approval": true }
```

`action_type` must be one of `generate_report`, `notify`, `refresh_data`, `create_approval`, `flag_insight` — anything else is `400 VALIDATION_FAILED`. The rule is created **disabled** and must be enabled deliberately.

### `POST /automation/rules/:id/run`

```json
// sensitive rule → no execution yet
{ "data": { "status": "awaiting_approval", "approvalId": 31 } }
// non-sensitive rule
{ "data": { "status": "executed", "detail": "Generated report department_utilization (9 rows).", "runId": 88 } }
```

A disabled rule returns `409 CONFLICT`.

### `POST /approvals/:id/decide`

```json
{ "decision": "approve", "note": "Checked against the November close." }
```

Self-approval returns `403 SELF_APPROVAL`. Only `automation`-type approvals execute an action on approval; other types record the decision.

---

## 13. Tenant isolation guarantees at the API level

These are properties of every endpoint, verified by tests:

1. No endpoint accepts an organisation id from the request body or query string for data access.
2. A record from another tenant returns `404 NOT_FOUND`, never `403`, so identifiers cannot be probed.
3. `X-Org-Context` is honoured only for platform administrators and only for reading; it is rejected for everyone else.
4. Report file downloads are constrained to the caller's own organisation's files.
5. Cost and finance fields are removed server-side, not hidden client-side.
6. A scoped user's request is filtered in SQL, so aggregate figures never include out-of-scope people.

---

## 14. Versioning and change policy

The API is versioned implicitly by release (`/api/health` reports `version`). Additive changes are non-breaking; changing a response field's meaning, or removing one, requires a documented change in `docs/14-change-history.md` and a matching test update. Error codes are treated as public API and are not renamed without the same process.
