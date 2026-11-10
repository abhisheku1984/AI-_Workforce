# WorkforceIQ — System Architecture

**Version:** 1.0
**Last updated:** 2026-11-10
**Audience:** technical evaluator, future engineer, and any customer doing technical due diligence

---

## 1. One-paragraph summary

WorkforceIQ is a single Node.js process that serves both a REST JSON API and the compiled React single-page interface from the same origin. Data lives in a local SQLite database accessed through a thin data-access layer. There is no cloud service, no message broker, no external AI call, and no third-party dependency at runtime other than the npm packages listed in §11. Everything a customer's data touches is inside their own machine.

That shape is a deliberate budget and privacy decision: it removes per-seat hosting cost, removes the "is my salary data leaving the building?" question, and makes a single-command install possible. The trade-off is that scaling beyond one node requires the database swap described in §9.

---

## 2. Deployment shape

```
        ┌─────────────────────────────────────────────────────────┐
        │  One host (VM / laptop / on-prem appliance)             │
        │                                                         │
  User  │   ┌───────────────────────────────────────────────┐     │
 browser├───┼──▶│  Node process (port 4000, 0.0.0.0)            │     │
        │   │                                               │     │
        │   │  /api/*  → Express routers → services → SQLite │     │
        │   │  /*      → dist/ (compiled React SPA)         │     │
        │   └───────────────────────────────────────────────┘     │
        │              │                    │                     │
        │        data/workforceiq.db   data/uploads/ exports/     │
        └─────────────────────────────────────────────────────────┘
```

- **Development:** Vite dev server (`:5173`) proxies `/api` to the API on `:4000`.
- **Production:** `npm run build` produces `dist/`; the same Node process serves it with an SPA fallback so deep links such as `/utilization` resolve to `index.html`.

There is exactly one origin in production. That means no CORS configuration to get wrong, and the session cookie can be `SameSite=Lax; HttpOnly` without a cross-origin exception.

---

## 3. Layer map

| Layer | Location | Responsibility | Must never |
| --- | --- | --- | --- |
| Presentation | `src/pages/*`, `src/components/*` | Render, navigate, collect input, show errors | Make a security decision |
| API surface | `server/routes/*.js` | Validate input shape, call one service, shape the response, write the audit event | Contain business maths |
| Domain services | `server/services/*.js`, `server/ai/*.js`, `server/ingestion/*.js` | All calculations, all permission-sensitive filtering | Trust caller-supplied organisation ids |
| Cross-cutting | `server/auth/*`, `server/lib/*` | Session, permissions, scope SQL, audit, capacity maths, HTTP helpers | Hold per-request state |
| Data access | `server/db/*` | Connection, migrations, transaction helper | Contain business rules |

The important structural rule: **the route layer decides *whether* someone may act; the service layer decides *what the numbers are*.** Authentication and tenant resolution happen once, as middleware, before any route body runs.

---

## 4. Request lifecycle

Every `/api` request follows the same path.

```
1. helmet                      security headers (CSP disabled — API returns JSON only)
2. compression                 gzip
3. express.json / urlencoded   body parsing, 1 MB cap
4. authenticate                read session cookie → hash → look up session row →
                               load user, org, roles, permissions, scopes, entitlements
5. CSRF guard (state-changing) if an Origin header is present it must match Host
6. router mount                /api/auth, /api/admin, /api/workforce, …
7. router.use(requireAuth, tenantContext, requireOrg)
                               tenant id is taken from the session; only a platform
                               admin may *read* under another tenant via X-Org-Context
8. requirePermission('x.y')    permission check, 403 with the required permission named
9. handler                     validate → service call → ok(res, data) | throw ApiError
10. central error handler      ApiError → its status/code; anything else → 500 with a
                               generic message and a server-side log; never a stack trace
```

Every response body is one of two shapes:

```json
{ "data": … }                  or   { "data": …, "meta": { "total": 42, "limit": 50, "page": 1 } }
{ "error": { "code": "FORBIDDEN", "message": "…", "details": { … } } }
```

Error codes are stable strings (`FORBIDDEN`, `VALIDATION_FAILED`, `DUPLICATE_FILE`, `CAPACITY_EXCEEDED`, `SELF_APPROVAL`, …) so the interface can react to the code and show the message, and so tests can assert on behaviour rather than prose.

---

## 5. Authentication and authorisation design

### 5.1 Credentials

- Hash: scrypt, N=16384, r=8, p=1, 64-byte key, 16-byte random salt per user, stored as `scrypt$N$r$p$salt$hash`.
- Verification uses `crypto.timingSafeEqual`.
- Unknown email still runs a scrypt verification against a dummy hash, so response time does not reveal account existence.
- Policy: minimum 10 characters with lower, upper and a digit. Enforced on creation, reset and change.
- Lockout: 6 consecutive failures → 15-minute lock (`users.locked_until`), reset on success.

### 5.2 Sessions

- A 32-byte random token is issued; only its SHA-256 hash is stored (`auth_sessions.token_hash`). A database leak does not yield usable sessions.
- Cookie `wiq_session`: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production, expiry = 12 hours (`SESSION_TTL_HOURS`).
- Sign-out sets `revoked_at`; a replayed cookie fails on the next request because `loadPrincipal` filters on `revoked_at IS NULL AND expires_at > now`.
- Password change revokes every other session for that user.

### 5.3 Permissions

24 permissions in `server/auth/permissions.js`, grouped for the interface. Seven templates ship: `org_admin`, `executive`, `finance`, `workforce_manager`, `project_manager`, `analyst`, `viewer`. An organisation may create custom roles from any subset.

Enforcement points, all server-side:

| Mechanism | Used for |
| --- | --- |
| `requirePermission(p)` | Single permission gate |
| `requireAnyPermission(p…)` | Dashboard, finance, governance screens with a choice of permissions |
| `principal.permissions.has(p)` inside a service | Column-level redaction (cost fields) and per-report gating |
| `requireOrg` | Refuses platform-only accounts on tenant endpoints |
| `requireModule(code)` | Module entitlement gate (available; used where a module can be sold separately) |

The interface also hides navigation it cannot use, and `Guard` blocks direct URL entry. **That is a convenience, not a control.** Every endpoint enforces its own permission, which the tests verify by calling the API directly as an under-privileged user.

### 5.4 Data scope inside a tenant

A role assignment may carry a `business_unit_id` and/or `department_id` (`user_roles`). If a user has any scoped assignment and no unscoped one, `principal.scope.restricted` is true, and `employeeScopeSql()` appends an `IN (…)` filter **into the SQL** — before any aggregation. A restricted user with no grants gets `1 = 0`, not "everything".

This ordering matters: filtering after aggregation would let an out-of-scope employee change a percentage that someone else sees.

---

## 6. Tenant isolation

Isolation is structural, in three independent places. Any one of them failing still leaves isolation intact.

1. **Session-derived tenant.** `req.orgId` comes from `loadPrincipal`, which reads the session row. No endpoint accepts an organisation id from the body or query string for data access. The only exception is a platform administrator *reading* under an explicit `X-Org-Context` header, which is a separate privilege and is audited.
2. **Query-level constraint.** Every service takes `orgId` from the principal and puts it in the `WHERE` clause. Lookup-by-id queries are `WHERE id = ? AND org_id = ?`, so a foreign id returns "not found" rather than "forbidden" — existence is not disclosed.
3. **Schema shape.** Every operational table carries `org_id NOT NULL` with an index. There is no cross-tenant join anywhere in the codebase; the only global tables are the module catalogue and `schema_migrations`.

Verified by `tests/02-tenancy.test.js` (12 behaviours), including: foreign employee id returns 404; lists are strictly per-org; a foreign department id is rejected when creating an employee; a scoped user sees only their department; scoped analytics exclude out-of-scope people before calculation; the `X-Org-Context` header is ignored for non-platform users.

---

## 7. Data ingestion pipeline

```
upload ──▶ validate file ──▶ parse (CSV or XLSX, first sheet) ──▶ row cap 20,000
   │                                                                    │
   │                                                          SHA-256 checksum
   │                                                                    │
   │                                                     duplicate? → 409 (unless force)
   ▼
imports row (status = staged) + import_rows (raw JSON per row)
   │
   ├─▶ POST /:id/map       column mapping saved (status = mapped)
   ├─▶ POST /:id/validate  per-row, per-field validation → status = validated
   │                        rows_valid / rows_invalid / duplicate_rows counted
   └─▶ POST /:id/commit    REFUSED unless status = validated
                            single transaction:
                              upsert by natural key
                              record_versions snapshot before each update
                              timesheets get import_id lineage
                            result: created / updated / skipped / details / insights
```

Design decisions worth stating:

- **Nothing writes until validated.** The live tables are not a staging area, so a bad file cannot half-land.
- **A commit is one transaction.** Any error rolls the whole file back; there is no partial month.
- **Checksums are checked at upload, not only at commit**, so re-uploading the same file after fixing a mapping is blocked (409) unless the user explicitly forces it. This is the difference between a re-import and a silent double-count.
- **Error report** is a CSV with a fixed header (`row_number,severity,code,field,message,raw_values`) so it can be opened in Excel or processed by a script.
- **Uploaded files are stored unmodified** under `data/uploads/` and referenced from `imports.stored_path`, which is what makes "where did this number come from?" answerable months later.

---

## 8. Analytics engine

`server/lib/capacity.js` (period maths, working days, holidays) and `server/services/analytics.js` (aggregation) hold every formula. Definitions are exposed at `GET /api/analytics/definitions` and rendered on the "Metric definitions" screen, so the interface and the documentation cannot drift apart.

```
employees (status active, within join/exit window)
   │  weekly hours = explicit weekly_hours, else hours_per_day × working days × fte
   ▼
available hours = weekly hours / 5 × working days in period (holidays excluded)
allocated hours = Σ allocations overlapping period, hours_per_week / 5 × overlap days
utilised hours  = Σ timesheets in period
   ▼
allocation %    = allocated / available        (> 100% = over-allocated)
utilisation %   = utilised  / available        (null when no timesheets)
unallocated h   = max(available − allocated, 0)   summed per person
over-allocated h= max(allocated − available, 0)   summed per person
```

Two subtleties that are easy to get wrong and are covered by tests:

- **Per-person flooring.** Over-allocation for one person never offsets bench for another, because both are floored at zero individually before summing.
- **No double-reduction for part-time.** If the customer supplies contracted weekly hours (20 for a 0.5 FTE person), that number is used directly. Multiplying by FTE as well would halve their capacity twice. A test asserts 84 available hours in a 21-working-day month for a 20-hour-per-week person.

Cost and margin are calculated only for people with cost data, and the response states coverage so a partial dataset cannot masquerade as a complete one. `gross_margin` requires revenue, cost and expenses to all exist.

---

## 9. AI design (the part that matters commercially)

The product's AI claim is narrow and defensible: **the AI composes sentences from numbers the system already calculated. It does not calculate.**

```
question
   │
   ├─ sanitise (strip control characters, cap 1,200 chars)
   ├─ prompt-injection scan ──── flagged → refuse, log ai_audit_event
   ├─ intent detection (11 intents: unallocated capacity, over-allocation,
   │   staffing gaps, utilisation trend, cost trend, operational risks,
   │   data quality, finance summary, headcount, definition help, capability)
   ▼
buildFactPack(principal, period, filters, question)
   │   permissions applied HERE: no cost facts without cost permission,
   │   no finance facts without finance permission, scope applied in SQL
   ▼
composeAnswer(intent, facts)  ← deterministic
   │   every sentence references a fact; missing facts → explicit insufficiency
   ├─ optional: external model enabled by customer config
   │     · system prompt forbids new numbers
   │     · employee names replaced unless the customer opted in
   │     · fact pack truncated to 12,000 chars
   │     · verifyNumbers() re-checks every numeral in the prose against the facts;
   │       any invented number → discard the prose, keep the deterministic answer, log it
   ▼
response { answer, evidence[], assumptions[], limitations[], confidence, provider,
           external_calls_made, mode }
```

Default configuration: `AI_PROVIDER=local`, so `provider` is `local-deterministic` and `external_calls_made` is `false`. A customer turning on an external model is an explicit, auditable configuration change, and the Settings screen says so.

Insight generation (`server/ai/insights.js`) produces eight evidence-backed insight types (unallocated capacity concentration, employees over-allocated, overlapping allocations, demand coverage gap, utilisation trend shift, idle workforce cost, data quality). Each record stores evidence, assumptions, limitations, risks, whether it requires approval, and a review workflow (`insight_reviews`) that is audited.

---

## 10. Automation and approvals

```
rule (org-scoped, created disabled, action from a closed list of 5)
   │
   ├─ requires_approval = 0 → run now, write automation_runs
   └─ requires_approval = 1 → create approval_request, automation_runs = awaiting_approval,
                              notify admins/executives, execute ONLY after approval
                                 by a different user
```

The five actions: `generate_report`, `notify` (in-app only), `refresh_data`, `create_approval`, `flag_insight`. There is no action that sends data outside, changes an employee's status, changes pay, or executes code. Unknown action types are rejected with 400 rather than accepted and ignored.

Approval decisions refuse self-approval (`SELF_APPROVAL`, 403) across automation, allocation-change approvals and data-deletion requests. Deletion additionally requires a second administrator and executes in a transaction with a recorded detail string.

---

## 11. Database

SQLite via `better-sqlite3` in WAL mode, foreign keys on, busy timeout set. 38 tables in `server/db/migrations/001_init.sql`, applied by a small version-tracking migrator (`schema_migrations`). See `docs/03-data-dictionary.md` for every table and column.

Groups of tables:

| Group | Tables |
| --- | --- |
| Tenancy & access | `organizations`, `users`, `roles`, `user_roles`, `auth_sessions`, `org_entitlements`, `subscriptions`, `modules` |
| Structure | `business_units`, `departments`, `locations` |
| Workforce | `employees`, `skills`, `employee_skills` |
| Delivery | `projects`, `project_demand`, `allocations`, `timesheets` |
| Money | `invoices`, `expenses` |
| Ingestion | `imports`, `import_rows`, `record_versions` |
| Intelligence | `ai_conversations`, `ai_messages`, `ai_insights`, `insight_reviews`, `forecasts` |
| Governance | `automation_rules`, `automation_runs`, `approval_requests`, `notifications`, `deletion_requests`, `audit_events`, `ai_audit_events` |
| Reporting & config | `report_definitions`, `report_runs`, `org_settings` |

`tx(fn)` wraps a function in `BEGIN`/`COMMIT`/`ROLLBACK` and **returns a function**; callers invoke it (`tx(() => …)()`). That detail caused a real bug during development and is worth stating so it is not reintroduced.

---

## 12. Dependency inventory

Runtime dependencies, all free and open source, no paid service:

| Package | Why |
| --- | --- |
| `express` 4 | HTTP routing |
| `helmet` | Security headers |
| `compression` | gzip |
| `cookie` | Cookie parsing/serialisation |
| `better-sqlite3` 13 | Embedded database (synchronous, fast, no server) |
| `multer` 2 | Multipart upload handling |
| `xlsx` | Reading XLSX uploads and writing XLSX reports |
| `zod` | Input schema validation |

Front end: `react` 18, `react-router-dom` 6, `recharts` (charts), `tailwindcss` (styling), built by `vite` 5.

Notably absent, and why: no ORM (the SQL is explicit and reviewable), no Redis (no cross-process state needed), no job queue (no scheduler yet), no analytics/telemetry SDK (no data leaves the host), no AI SDK (a direct `fetch` to a configurable endpoint if ever enabled).

`npm audit` should be run at deploy time; a sandbox without registry access cannot perform it here, so it is listed as a deployment step rather than claimed as clean.

---

## 13. Scaling path (when it is needed, not before)

| Trigger | Change | Effort |
| --- | --- | --- |
| > ~2,000 employees or multi-process need | Move to Postgres. Every query is behind `server/db/index.js` and parameterised; the schema needs `AUTOINCREMENT` → `SERIAL`, JSON columns → `jsonb`, and `better-sqlite3` calls → `pg` pool. | Contained, but not trivial: a week of work plus a data migration. |
| Report generation competing with requests | Move report generation to a worker process reading the same database. | Moderate. |
| Multiple app instances | Session state is already in the database, so instances can share it. Requires the Postgres move first. | Follows the first row. |
| Scheduled automation | Add a job runner with a lock so only one instance fires a rule. | Small, once the scheduler exists. |

---

## 14. Architecture decision record

| # | Decision | Alternatives | Rationale | Consequence |
| --- | --- | --- | --- | --- |
| 1 | Single process serving API + SPA | Separate API and web hosts | One origin removes CORS and cookie complexity; one deploy target suits small customers and a self-hosted story. | Static assets compete with API for one process's CPU. |
| 2 | SQLite | Postgres, MySQL | Zero operational cost, no separate server, transactional, backup is a file copy. | Single-writer; horizontal scaling requires a database swap. |
| 3 | Deterministic local AI as default | Hosted LLM by default | No per-query cost, no personal data leaving the host, no invented numbers. | Answers are structured analysis, not free-form conversation. |
| 4 | Fixed metric formulas, configurable targets | Customer-defined formulas | The product exists to end definition disputes. | Some customers will want a formula the product does not have; the answer is a product change, not a setting. |
| 5 | Session cookie + server-side sessions | JWT | Immediate revocation on logout and password change is a hard requirement for HR data. | A database read per request (cheap on SQLite). |
| 6 | Closed automation action list | Generic webhook/script runner | An arbitrary action is an RCE feature and an audit hole. | Fewer automation possibilities; expansion is a deliberate, reviewed product decision. |
| 7 | Audit writes in the route layer | Trigger-based audit | The route knows the intent and the human-readable summary. | A service called outside a route would not be audited; services are only called from routes. |
| 8 | Manual column mapping with suggestions | Fully automatic mapping | A silently mis-mapped salary column is a data breach. | Slightly more setup per new file format. |
