# WorkforceIQ — Test Plan and Test Report

**Report generated:** 2026-11-10 14:48:04 UTC

> This report is produced by `npm run test:report`, which executes the real test suites
> against a real (temporary) database and a real HTTP server. Every number below comes
> from that run. If a suite fails, the report records the failure.

## 1. What is under test

| Item | Detail |
| --- | --- |
| Application | WorkforceIQ — AI Workforce & Business Operations Intelligence Platform |
| Node.js | v22.22.3 |
| Platform | linux x64 |
| Database | SQLite via better-sqlite3, one throwaway file per run |
| AI provider | `local` (deterministic, no network calls) |
| Test style | Black-box HTTP tests through the public REST API, plus targeted unit checks of pure functions |
| Fixtures | Two fictional tenants (`Test Alpha Ltd`, `Test Beta Ltd`) with employees, allocations, timesheets, invoices, expenses and demand |

## 2. Summary of results

| Metric | Result |
| --- | --- |
| Test suites executed | 9 |
| Node test cases passed | 178 |
| Node test cases failed | 0 |
| Recorded assertion groups | 127 |
| Assertion groups failed | 0 |
| Overall verdict | **Pass** |

What "assertion group" means: each `await t.test(...)` block in a suite is one behaviour
that is being checked, and it may contain several individual assertions. The group is
recorded only when all of its assertions inside it pass.

## 3. Results per suite

| Suite | Node cases passed | Node cases failed | Duration (ms) | Verdict |
| --- | --- | --- | --- | --- |
| `tests/01-auth.test.js` | 10 | 0 | 1489 | Pass |
| `tests/02-tenancy.test.js` | 12 | 0 | 1175 | Pass |
| `tests/03-analytics.test.js` | 14 | 0 | 789 | Pass |
| `tests/04-ingestion.test.js` | 17 | 0 | 888 | Pass |
| `tests/05-ai.test.js` | 17 | 0 | 1010 | Pass |
| `tests/06-governance.test.js` | 39 | 0 | 2422 | Pass |
| `tests/07-voice.test.js` | 28 | 0 | 100 | Pass |
| `tests/08-assistant-actions.test.js` | 16 | 0 | 839 | Pass |
| `tests/09-crm.test.js` | 25 | 0 | 836 | Pass |

## 4. What each suite proves

### 01-auth.test.js

Authentication, session handling and the permission model: sign-in with correct and incorrect credentials, session identity, logout, brute-force rate limiting, password-change requirements, and rejection of unauthenticated or under-privileged requests.

| Behaviour verified | Result |
| --- | --- |
| Valid sign-in creates session and returns principal | Pass |
| Wrong password rejected | Pass |
| Unknown email returns identical error (no enumeration) | Pass |
| Unauthenticated API access refused on all protected routes | Pass |
| Session cookie is HttpOnly and SameSite=Lax | Pass |
| Logout revokes the session server-side (cookie reuse fails) | Pass |
| Account locked after 6 failed attempts | Pass |
| Weak new password rejected by policy | Pass |
| Password change revokes other sessions | Pass |

### 02-tenancy.test.js

Tenant isolation: data from one organisation is never visible to another, identifiers from another tenant cannot be used to read or change records, and platform-level administration cannot read customer operational data.

| Behaviour verified | Result |
| --- | --- |
| Cross-tenant employee read returns 404 (existence not disclosed) | Pass |
| Employee lists are strictly per-org | Pass |
| Foreign department id rejected when creating an employee | Pass |
| Org-context header ignored for non-platform users | Pass |
| Department-scoped user only sees their department | Pass |
| Scoped analytics exclude out-of-scope employees before calculation | Pass |
| Cost fields removed server-side for viewer role | Pass |
| Viewer role blocked from all writes (403 on each) | Pass |
| Financial analytics denied to viewer | Pass |
| Self role escalation blocked | Pass |
| User cannot approve their own request | Pass |

### 03-analytics.test.js

Analytics correctness: the capacity and utilisation formulas are reconciled against hand-computed expectations, allocation and utilisation are never mixed, months without timesheets read as "no data" rather than zero, and financial figures respect permissions.

| Behaviour verified | Result |
| --- | --- |
| Available hours = weekly hours ÷ 5 × working days (FTE applied once) | Pass |
| Employee who exited before the period is excluded | Pass |
| Allocated hours aggregate overlapping allocations | Pass |
| Utilization is null rather than 0 when no timesheet data exists | Pass |
| Unallocated and over-allocated hours reconcile per person | Pass |
| Totals reconcile with the sum of employee rows | Pass |
| Department filter restricts the dataset | Pass |
| A period with no timesheets reports zero recorded hours and null utilization | Pass |
| Utilization trend returns one point per month with months missing data flagged | Pass |
| Demand coverage compares required hours with allocated hours | Pass |
| Overlapping allocations above capacity detected | Pass |
| Financial totals computed from documented inputs | Pass |
| Margin only reported when invoice, cost and expense inputs all exist | Pass |
| Margin is null with explanatory notes when inputs are missing | Pass |
| Metric definitions endpoint exposes formulas | Pass |

### 04-ingestion.test.js

Data ingestion: file upload validation, column mapping suggestions, row-level validation and error reporting, duplicate protection, the validate-then-commit sequence, and rollback safety.

| Behaviour verified | Result |
| --- | --- |
| Header aliases map to the correct target fields | Pass |
| Numbers, dates and months normalise safely; impossible dates rejected | Pass |
| Required fields and formatting are validated with fixes recorded | Pass |
| Valid CSV upload → map → validate → commit creates records | Pass |
| Formatting issues fixed automatically and recorded | Pass |
| Invalid rows are reported and skipped; no values invented | Pass |
| Duplicate rows within a file detected and skipped | Pass |
| Re-upload updates the existing record instead of duplicating it | Pass |
| Record version history written on update | Pass |
| Unsupported file type rejected before parsing | Pass |
| File content signature validated, not just the extension | Pass |
| Empty upload rejected with an understandable error | Pass |
| Mapping without required fields is refused with the field name | Pass |
| Commit refused before validation | Pass |
| Rejected import does not change existing data | Pass |
| Identical file re-upload detected by checksum | Pass |
| CSV formula injection neutralised in exported files | Pass |
| Import history and downloadable error report available | Pass |

### 05-ai.test.js

AI safety and grounding: answers are computed from the requesting user's own permitted data, every stated figure is traceable, insufficient data produces an honest refusal, prompt injection is blocked and logged, and no external model is contacted in the default configuration.

| Behaviour verified | Result |
| --- | --- |
| Answer returned with evidence, period and confidence | Pass |
| Assistant figures reconcile with the analytics API | Pass |
| Unsupported question returns an explicit refusal | Pass |
| Prompt injection in a question is blocked, returned no data and was logged | Pass |
| Injection patterns detected in arbitrary text without false positive on a normal question | Pass |
| Assistant endpoint requires the ai.assistant permission | Pass |
| Assistant refuses cost/revenue questions without permission | Pass |
| Fact pack excludes financial data for unauthorised users | Pass |
| Fact pack is limited to the requesting tenant | Pass |
| Default deployment makes no outbound AI calls | Pass |
| Employee names can be redacted from the payload sent to a model | Pass |
| Numbers not present in the authorised facts are detected | Pass |
| Insights carry finding, evidence, assumptions, limitations, risks and next step | Pass |
| Insight review recorded with reviewer and audit event | Pass |
| Forecast refused when history is insufficient, with the reason stated | Pass |
| Forecast produced with method, R², ranges and limitations | Pass |
| Forecast points are labelled separately from actuals | Pass |

### 06-governance.test.js

Governance and operations: sensitive automations stop for human approval, approvals cannot be self-granted, reports carry lineage, tenants cannot download each other's files, deletions require a second administrator, and security headers, error handling and audit trails behave correctly.

| Behaviour verified | Result |
| --- | --- |
| Action requiring approval does not execute; approval request created | Pass |
| Approved automation executes and the result is recorded | Pass |
| Every run records initiator, approval, result and timestamp | Pass |
| Disabled automation cannot be triggered | Pass |
| Closed allow-list rejects unsupported action types | Pass |
| CSV report includes period, generator and lineage header | Pass |
| Excel export produces a valid xlsx (zip signature) | Pass |
| Cost report blocked for roles without finance permission | Pass |
| Another tenant's report file cannot be downloaded | Pass |
| Path traversal attempt on report download rejected | Pass |
| Audit trail captures authentication, approvals, automation and report generation | Pass |
| Audit trail restricted to authorised roles | Pass |
| Tenant export excludes other tenants and password hashes | Pass |
| Data portability export available to administrators | Pass |
| Deletion cannot be self-approved | Pass |
| Health endpoint reports database connectivity | Pass |
| Unknown API route returns structured error | Pass |
| Error responses contain no stack traces or internal paths | Pass |
| Helmet security headers applied; framework banner hidden | Pass |
| Cross-origin state-changing request rejected | Pass |
| Foreign origin still rejected after proxy-safe comparison | Pass |
| Sign-in works behind a reverse proxy or preview tunnel | Pass |
| Frame embedding follows configuration, not a fixed header | Pass |
| Missing or unrecognised session is explained to the user | Pass |
| Session cookie flags match the transport in use | Pass |
| Session works without cookies via a bearer token | Pass |
| Sign-out revokes the token as well as the cookie | Pass |
| Entry document is served no-store with a build stamp | Pass |
| No hardcoded credentials or API keys in server source | Pass |
| Dashboard returns KPI totals, trend, definitions and freshness | Pass |
| Structure endpoints validate input ranges | Pass |
| Removing a permission from a role is enforced on the next request | Pass |
| A direct run announces a listening URL on any platform | Pass |
| Importing the app module does not start a listener | Pass |
| A prebuilt interface can be installed when the bundler is blocked | Pass |
| The committed interface snapshot is not excluded by .gitignore | Pass |
| Local build output and secrets remain ignored | Pass |
| Without dist/, the landing page explains the fix and the API stays healthy | Pass |

### 07-voice.test.js



| Behaviour verified | Result |
| --- | --- |
| (See raw output below) | Pass |

### 08-assistant-actions.test.js



| Behaviour verified | Result |
| --- | --- |
| The action catalogue is available to permitted users | Pass |
| Staging an action performs no write | Pass |
| A confirmed action creates the record with no cost fields | Pass |
| A replayed confirmation is refused, not duplicated | Pass |
| Voice actions obey the same permission checks as the API | Pass |
| An action cannot be applied without its confirmed payload | Pass |
| Cost and pay fields are excluded from assistant edits | Pass |
| An unmatched name is refused rather than resolved to a random record | Pass |
| Removing an allocation cancels it and keeps the row | Pass |
| Applied actions are audited with the voice/text channel | Pass |

### 09-crm.test.js



| Behaviour verified | Result |
| --- | --- |
| Dictation fills a draft one field at a time | Pass |
| A submitted draft waits in the queue without touching the dataset | Pass |
| Approval appends the record to the dataset | Pass |
| An approved draft cannot be replayed into a duplicate | Pass |
| A rejected draft never enters the dataset | Pass |
| CRM drafting and approval are permissioned, not just hidden in the UI | Pass |
| A question about the world is refused and redirected, not fobbed off | Pass |
| CRM questions are answered from the CRM tables | Pass |
| Financial answers respect permissions, not just the menu | Pass |

## 5. Requirement coverage

The acceptance criteria in the build brief map onto the suites as follows. Only rows
whose evidence is a passing test in this run are marked "Covered by test".

| Acceptance criterion | Evidence |
| --- | --- |
| Authentication and authorisation enforced server-side | `01-auth`, `06-governance` (role permission changes take effect immediately) |
| Tenant isolation in backend and database queries | `02-tenancy` |
| Utilisation formula reconciliation | `03-analytics` |
| Import validation and error reporting | `04-ingestion` |
| AI grounding, permission-awareness and prompt-injection resistance | `05-ai` |
| Automation approval trails | `06-governance` |
| Operational safety (headers, errors, secrets, backups documented) | `06-governance` plus `docs/deployment-guide.md` (process, not testable here) |

## 6. Known limitations of this test run

- **No browser automation.** The sandbox has no Chromium/Playwright, so the React UI is
  verified by a production build and by exercising the same APIs the screens call, not by
  scripted clicks. UI defects that only appear in a browser would not be caught here.
- **SQLite only.** Postgres-specific behaviour is untested because the deployment target
  documented in `docs/deployment-guide.md` is single-node SQLite.
- **No external AI provider is exercised.** Only the deterministic local provider runs, and
  that is deliberate: no customer data leaves the machine.
- **Not a performance or load test.** These suites prove correctness, not throughput.

## 7. Raw output

Full per-suite output from `node --test`, retained for auditability.

### 01-auth.test.js

```
TAP version 13
# [db] applied migration 001_init.sql
# [db] applied migration 002_crm.sql
# Subtest: Authentication
    # Subtest: valid credentials create a session and return the principal
    ok 1 - valid credentials create a session and return the principal
      ---
      duration_ms: 89.171615
      type: 'test'
      ...
    # Subtest: wrong password is rejected with a generic message
    ok 2 - wrong password is rejected with a generic message
      ---
      duration_ms: 43.151945
      type: 'test'
      ...
    # Subtest: unknown email returns the same error (no account enumeration)
    ok 3 - unknown email returns the same error (no account enumeration)
      ---
      duration_ms: 44.287193
      type: 'test'
      ...
    # Subtest: unauthenticated API access is refused
    ok 4 - unauthenticated API access is refused
      ---
      duration_ms: 8.10998
      type: 'test'
      ...
    # Subtest: session cookie is HttpOnly and SameSite
    ok 5 - session cookie is HttpOnly and SameSite
      ---
      duration_ms: 43.510787
      type: 'test'
      ...
    # Subtest: logout revokes the session server-side
    ok 6 - logout revokes the session server-side
      ---
      duration_ms: 53.013869
      type: 'test'
      ...
    # Subtest: account is temporarily locked after repeated failures
    ok 7 - account is temporarily locked after repeated failures
      ---
      duration_ms: 278.220096
      type: 'test'
      ...
    # Subtest: weak password change is rejected
    ok 8 - weak password change is rejected
      ---
      duration_ms: 70.413309
      type: 'test'
      ...
    # Subtest: password change revokes other sessions
    ok 9 - password change revokes other sessions
      ---
      duration_ms: 261.254417
      type: 'test'
      ...
    1..9
ok 1 - Authentication
  ---
  duration_ms: 894.076436
  type: 'test'
  ...
1..1
# tests 10
# suites 0
# pass 10
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1455.865187
```

### 02-tenancy.test.js

```
TAP version 13
# [db] applied migration 001_init.sql
# [db] applied migration 002_crm.sql
# Subtest: Tenant isolation and data scope
    # Subtest: a tenant cannot read another tenant's employees
    ok 1 - a tenant cannot read another tenant's employees
      ---
      duration_ms: 85.030126
      type: 'test'
      ...
    # Subtest: workforce lists never include another tenant's records
    ok 2 - workforce lists never include another tenant's records
      ---
      duration_ms: 91.710937
      type: 'test'
      ...
    # Subtest: creating a record cannot reference another tenant structure
    ok 3 - creating a record cannot reference another tenant structure
      ---
      duration_ms: 43.187423
      type: 'test'
      ...
    # Subtest: organization header cannot be spoofed by a normal user
    ok 4 - organization header cannot be spoofed by a normal user
      ---
      duration_ms: 49.616149
      type: 'test'
      ...
    # Subtest: department-scoped user sees only their department
    ok 5 - department-scoped user sees only their department
      ---
      duration_ms: 47.613367
      type: 'test'
      ...
    # Subtest: scoped totals exclude out-of-scope capacity
    ok 6 - scoped totals exclude out-of-scope capacity
      ---
      duration_ms: 43.96626
      type: 'test'
      ...
    # Subtest: cost fields are stripped for roles without cost permission
    ok 7 - cost fields are stripped for roles without cost permission
      ---
      duration_ms: 44.571997
      type: 'test'
      ...
    # Subtest: viewer cannot write, cannot regenerate insights, cannot import
    ok 8 - viewer cannot write, cannot regenerate insights, cannot import
      ---
      duration_ms: 45.482955
      type: 'test'
      ...
    # Subtest: viewer cannot see financial analytics
    ok 9 - viewer cannot see financial analytics
      ---
      duration_ms: 39.184297
      type: 'test'
      ...
    # Subtest: user cannot escalate their own role
    ok 10 - user cannot escalate their own role
      ---
      duration_ms: 41.89497
      type: 'test'
      ...
    # Subtest: self-approval of a request is blocked
    ok 11 - self-approval of a request is blocked
      ---
      duration_ms: 48.931452
      type: 'test'
      ...
    1..11
ok 1 - Tenant isolation and data scope
  ---
  duration_ms: 583.9177
  type: 'test'
  ...
1..1
# tests 12
# suites 0
# pass 12
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 1145.415822
```

### 03-analytics.test.js

```
TAP version 13
# [db] applied migration 001_init.sql
# [db] applied migration 002_crm.sql
# Subtest: Utilization and capacity calculations
    # Subtest: available hours match the documented formula
    ok 1 - available hours match the documented formula
      ---
      duration_ms: 12.43097
      type: 'test'
      ...
    # Subtest: exited employee is excluded from the period
    ok 2 - exited employee is excluded from the period
      ---
      duration_ms: 8.52006
      type: 'test'
      ...
    # Subtest: allocated hours sum overlapping allocations
    ok 3 - allocated hours sum overlapping allocations
      ---
      duration_ms: 6.258701
      type: 'test'
      ...
    # Subtest: utilization comes from timesheets and is null (not zero) without data
    ok 4 - utilization comes from timesheets and is null (not zero) without data
      ---
      duration_ms: 5.490259
      type: 'test'
      ...
    # Subtest: unallocated and over-allocated hours reconcile
    ok 5 - unallocated and over-allocated hours reconcile
      ---
      duration_ms: 4.972907
      type: 'test'
      ...
    # Subtest: filters change results consistently
    ok 6 - filters change results consistently
      ---
      duration_ms: 5.173821
      type: 'test'
      ...
    # Subtest: period boundaries are respected
    ok 7 - period boundaries are respected
      ---
      duration_ms: 3.776818
      type: 'test'
      ...
    # Subtest: trend returns one point per month
    ok 8 - trend returns one point per month
      ---
      duration_ms: 6.213042
      type: 'test'
      ...
    # Subtest: demand coverage identifies the uncovered requirement
    ok 9 - demand coverage identifies the uncovered requirement
      ---
      duration_ms: 4.236985
      type: 'test'
      ...
    # Subtest: overlapping allocations are detected
    ok 10 - overlapping allocations are detected
      ---
      duration_ms: 3.657439
      type: 'test'
      ...
    # Subtest: financial analysis states availability and computes margin only with full inputs
    ok 11 - financial analysis states availability and computes margin only with full inputs
      ---
      duration_ms: 5.974591
      type: 'test'
      ...
    # Subtest: insufficient cost data is disclosed rather than estimated
    ok 12 - insufficient cost data is disclosed rather than estimated
      ---
      duration_ms: 52.511531
      type: 'test'
      ...
    # Subtest: metric definitions are exposed for audit
    ok 13 - metric definitions are exposed for audit
      ---
      duration_ms: 6.112477
      type: 'test'
      ...
    1..13
ok 1 - Utilization and capacity calculations
  ---
  duration_ms: 206.031803
  type: 'test'
  ...
1..1
# tests 14
# suites 0
# pass 14
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 756.445491
```

### 04-ingestion.test.js

```
TAP version 13
# [db] applied migration 001_init.sql
# [db] applied migration 002_crm.sql
# Subtest: Data ingestion pipeline
    # Subtest: column mapping suggestion matches known header aliases
    ok 1 - column mapping suggestion matches known header aliases
      ---
      duration_ms: 1.238377
      type: 'test'
      ...
    # Subtest: format parsing handles common spreadsheet variations
    ok 2 - format parsing handles common spreadsheet variations
      ---
      duration_ms: 0.843776
      type: 'test'
      ...
    # Subtest: row validation flags errors and records safe fixes
    ok 3 - row validation flags errors and records safe fixes
      ---
      duration_ms: 0.961825
      type: 'test'
      ...
    # Subtest: valid CSV uploads, maps, validates and commits
    ok 4 - valid CSV uploads, maps, validates and commits
      ---
      duration_ms: 62.914156
      type: 'test'
      ...
    # Subtest: invalid rows are reported and never invented
    ok 5 - invalid rows are reported and never invented
      ---
      duration_ms: 33.2792
      type: 'test'
      ...
    # Subtest: duplicate rows inside a file are detected and skipped
    ok 6 - duplicate rows inside a file are detected and skipped
      ---
      duration_ms: 22.229112
      type: 'test'
      ...
    # Subtest: re-uploading existing records updates rather than duplicates
    ok 7 - re-uploading existing records updates rather than duplicates
      ---
      duration_ms: 20.257999
      type: 'test'
      ...
    # Subtest: unsupported file types are rejected
    ok 8 - unsupported file types are rejected
      ---
      duration_ms: 10.287425
      type: 'test'
      ...
    # Subtest: a file with a .xlsx extension but non-xlsx content is rejected
    ok 9 - a file with a .xlsx extension but non-xlsx content is rejected
      ---
      duration_ms: 5.942303
      type: 'test'
      ...
    # Subtest: empty file is rejected with a clear message
    ok 10 - empty file is rejected with a clear message
      ---
      duration_ms: 4.524688
      type: 'test'
      ...
    # Subtest: missing required mapping is refused
    ok 11 - missing required mapping is refused
      ---
      duration_ms: 8.806626
      type: 'test'
      ...
    # Subtest: committing an unvalidated import is refused
    ok 12 - committing an unvalidated import is refused
      ---
      duration_ms: 7.762447
      type: 'test'
      ...
    # Subtest: a failed import leaves existing data intact (transactional)
    ok 13 - a failed import leaves existing data intact (transactional)
      ---
      duration_ms: 23.113233
      type: 'test'
      ...
    # Subtest: duplicate file checksum is detected
    ok 14 - duplicate file checksum is detected
      ---
      duration_ms: 9.47514
      type: 'test'
      ...
    # Subtest: CSV injection payloads are neutralised on export
    ok 15 - CSV injection payloads are neutralised on export
      ---
      duration_ms: 0.847989
      type: 'test'
      ...
    # Subtest: import history and error report are available
    ok 16 - import history and error report are available
      ---
      duration_ms: 9.008889
      type: 'test'
      ...
    1..16
ok 1 - Data ingestion pipeline
  ---
  duration_ms: 303.232208
  type: 'test'
  ...
1..1
# tests 17
# suites 0
# pass 17
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 856.934926
```

### 05-ai.test.js

```
TAP version 13
# [db] applied migration 001_init.sql
# [db] applied migration 002_crm.sql
# Subtest: AI assistant grounding and safety
    # Subtest: answers are grounded in the requesting user's own data
    ok 1 - answers are grounded in the requesting user's own data
      ---
      duration_ms: 35.622809
      type: 'test'
      ...
    # Subtest: reported figures match the analytics service exactly
    ok 2 - reported figures match the analytics service exactly
      ---
      duration_ms: 23.137576
      type: 'test'
      ...
    # Subtest: a question that cannot be answered returns insufficient data, not a guess
    ok 3 - a question that cannot be answered returns insufficient data, not a guess
      ---
      duration_ms: 11.428411
      type: 'test'
      ...
    # Subtest: prompt injection in the question is blocked and logged
    ok 4 - prompt injection in the question is blocked and logged
      ---
      duration_ms: 4.488952
      type: 'test'
      ...
    # Subtest: injection patterns are recognised in uploaded/external text
    ok 5 - injection patterns are recognised in uploaded/external text
      ---
      duration_ms: 0.441096
      type: 'test'
      ...
    # Subtest: assistant is unavailable to roles without the assistant permission
    ok 6 - assistant is unavailable to roles without the assistant permission
      ---
      duration_ms: 43.778113
      type: 'test'
      ...
    # Subtest: assistant refuses financial questions without finance permission
    ok 7 - assistant refuses financial questions without finance permission
      ---
      duration_ms: 53.556802
      type: 'test'
      ...
    # Subtest: cost data is absent from the fact pack for users without cost permission
    ok 8 - cost data is absent from the fact pack for users without cost permission
      ---
      duration_ms: 47.60152
      type: 'test'
      ...
    # Subtest: fact pack never contains another tenant's organisation name
    ok 9 - fact pack never contains another tenant's organisation name
      ---
      duration_ms: 8.526011
      type: 'test'
      ...
    # Subtest: no external model is called in the default configuration
    ok 10 - no external model is called in the default configuration
      ---
      duration_ms: 6.691686
      type: 'test'
      ...
    # Subtest: employee names can be withheld before any model call
    ok 11 - employee names can be withheld before any model call
      ---
      duration_ms: 6.977729
      type: 'test'
      ...
    # Subtest: model output with invented figures is rejected
    ok 12 - model output with invented figures is rejected
      ---
      duration_ms: 0.597545
      type: 'test'
      ...
    # Subtest: insight generation produces evidence-backed records with stated limits
    ok 13 - insight generation produces evidence-backed records with stated limits
      ---
      duration_ms: 12.101011
      type: 'test'
      ...
    # Subtest: an insight can be reviewed and the decision is audited
    ok 14 - an insight can be reviewed and the decision is audited
      ---
      duration_ms: 8.007299
      type: 'test'
      ...
    # Subtest: forecast is refused without enough history
    ok 15 - forecast is refused without enough history
      ---
      duration_ms: 61.542112
      type: 'test'
      ...
    # Subtest: forecast is produced with adequate history and labelled as an estimate
    ok 16 - forecast is produced with adequate history and labelled as an estimate
      ---
      duration_ms: 11.822528
      type: 'test'
      ...
    1..16
ok 1 - AI assistant grounding and safety
  ---
  duration_ms: 414.07509
  type: 'test'
  ...
1..1
# tests 17
# suites 0
# pass 17
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 973.763198
```

### 06-governance.test.js

```
TAP version 13
# [db] applied migration 001_init.sql
# [db] applied migration 002_crm.sql
# Subtest: Automation, approvals, reports and operations
    # Subtest: sensitive automation creates an approval request instead of executing
    ok 1 - sensitive automation creates an approval request instead of executing
      ---
      duration_ms: 22.125814
      type: 'test'
      ...
    # Subtest: a second approver can approve and the action then executes
    ok 2 - a second approver can approve and the action then executes
      ---
      duration_ms: 121.63679
      type: 'test'
      ...
    # Subtest: disabled rules cannot be run
    ok 3 - disabled rules cannot be run
      ---
      duration_ms: 7.694297
      type: 'test'
      ...
    # Subtest: automation cannot be created with an unsupported action
    ok 4 - automation cannot be created with an unsupported action
      ---
      duration_ms: 3.411473
      type: 'test'
      ...
    # Subtest: report generation writes a file with lineage metadata
    ok 5 - report generation writes a file with lineage metadata
      ---
      duration_ms: 10.859641
      type: 'test'
      ...
    # Subtest: Excel report is a valid xlsx file
    ok 6 - Excel report is a valid xlsx file
      ---
      duration_ms: 14.425889
      type: 'test'
      ...
    # Subtest: cost report is refused without finance permission
    ok 7 - cost report is refused without finance permission
      ---
      duration_ms: 45.114037
      type: 'test'
      ...
    # Subtest: report files cannot be downloaded by another tenant
    ok 8 - report files cannot be downloaded by another tenant
      ---
      duration_ms: 50.213516
      type: 'test'
      ...
    # Subtest: path traversal on report download is rejected
    ok 9 - path traversal on report download is rejected
      ---
      duration_ms: 4.045453
      type: 'test'
      ...
    # Subtest: audit trail records authentication, approvals, automation and report generation
    ok 10 - audit trail records authentication, approvals, automation and report generation
      ---
      duration_ms: 5.371405
      type: 'test'
      ...
    # Subtest: audit trail is not visible to roles without audit permission
    ok 11 - audit trail is not visible to roles without audit permission
      ---
      duration_ms: 47.055283
      type: 'test'
      ...
    # Subtest: full tenant data export contains only that tenant
    ok 12 - full tenant data export contains only that tenant
      ---
      duration_ms: 8.622196
      type: 'test'
      ...
    # Subtest: deletion requires a second administrator
    ok 13 - deletion requires a second administrator
      ---
      duration_ms: 6.768454
      type: 'test'
      ...
    # Subtest: health endpoint reports database status
    ok 14 - health endpoint reports database status
      ---
      duration_ms: 2.746876
      type: 'test'
      ...
    # Subtest: unknown API routes return a structured 404
    ok 15 - unknown API routes return a structured 404
      ---
      duration_ms: 2.705531
      type: 'test'
      ...
    # Subtest: internal errors do not leak stack traces
    ok 16 - internal errors do not leak stack traces
      ---
      duration_ms: 38.801082
      type: 'test'
      ...
    # Subtest: security headers are present
    ok 17 - security headers are present
      ---
      duration_ms: 2.185285
      type: 'test'
      ...
    # Subtest: cross-site state-changing request is blocked when Origin differs
    ok 18 - cross-site state-changing request is blocked when Origin differs
      ---
      duration_ms: 2.684175
      type: 'test'
      ...
    # Subtest: cross-site protection still blocks a genuinely foreign origin
    ok 19 - cross-site protection still blocks a genuinely foreign origin
      ---
      duration_ms: 5.100417
      type: 'test'
      ...
    # Subtest: a request behind a reverse proxy is not mistaken for a cross-site request
    ok 20 - a request behind a reverse proxy is not mistaken for a cross-site request
      ---
      duration_ms: 81.45047
      type: 'test'
      ...
    # Subtest: the app can be embedded in a frame where configured, blocked where not
    ok 21 - the app can be embedded in a frame where configured, blocked where not
      ---
      duration_ms: 4.20688
      type: 'test'
      ...
    # Subtest: a session cookie that does not resolve is reported, not silently ignored
    ok 22 - a session cookie that does not resolve is reported, not silently ignored
      ---
      duration_ms: 4.027246
      type: 'test'
      ...
    # Subtest: session cookie attributes follow the transport and the configured policy
    ok 23 - session cookie attributes follow the transport and the configured policy
      ---
      duration_ms: 67.927561
      type: 'test'
      ...
    # Subtest: a bearer session token works where cookies are blocked
    ok 24 - a bearer session token works where cookies are blocked
      ---
      duration_ms: 49.54783
      type: 'test'
      ...
    # Subtest: signing out revokes a bearer token
    ok 25 - signing out revokes a bearer token
      ---
      duration_ms: 45.062956
      type: 'test'
      ...
    # Subtest: the entry document is never cached, so a deploy cannot leave a stale client
    ok 26 - the entry document is never cached, so a deploy cannot leave a stale client
      ---
      duration_ms: 3.414723
      type: 'test'
      ...
    # Subtest: no secrets are committed to the repository
    ok 27 - no secrets are committed to the repository
      ---
      duration_ms: 0.72763
      type: 'test'
      ...
    # Subtest: dashboard payload is complete and internally consistent
    ok 28 - dashboard payload is complete and internally consistent
      ---
      duration_ms: 8.541376
      type: 'test'
      ...
    # Subtest: structure creation validates input
    ok 29 - structure creation validates input
      ---
      duration_ms: 4.162101
      type: 'test'
      ...
    # Subtest: role permission changes take effect immediately
    ok 30 - role permission changes take effect immediately
      ---
      duration_ms: 42.755012
      type: 'test'
      ...
    1..30
ok 1 - Automation, approvals, reports and operations
  ---
  duration_ms: 806.453504
  type: 'test'
  ...
# Subtest: startup: a direct run serves traffic, an import opens no port
    # Subtest: running server/index.js directly opens a port and reports the URL
    ok 1 - running server/index.js directly opens a port and reports the URL
      ---
      duration_ms: 311.520111
      type: 'test'
      ...
    # Subtest: importing the module does not open a port
    ok 2 - importing the module does not open a port
      ---
      duration_ms: 367.419928
      type: 'test'
      ...
    # Subtest: the prebuilt interface installs without any native tooling
    ok 3 - the prebuilt interface installs without any native tooling
      ---
      duration_ms: 31.179623
      type: 'test'
      ...
    1..3
ok 2 - startup: a direct run serves traffic, an import opens no port
  ---
  duration_ms: 711.016312
  type: 'test'
  ...
# Subtest: packaging: the prebuilt interface is not excluded by .gitignore
    # Subtest: git does not ignore prebuilt/dist
    ok 1 - git does not ignore prebuilt/dist
      ---
      duration_ms: 4.943579
      type: 'test'
      ...
    # Subtest: .gitignore still ignores a local build and local data
    ok 2 - .gitignore still ignores a local build and local data
      ---
      duration_ms: 16.224518
      type: 'test'
      ...
    # Subtest: an unbuilt checkout explains itself instead of 404ing
    ok 3 - an unbuilt checkout explains itself instead of 404ing
      ---
      duration_ms: 308.926717
      type: 'test'
      ...
    1..3
ok 3 - packaging: the prebuilt interface is not excluded by .gitignore
  ---
  duration_ms: 330.939991
  type: 'test'
  ...
1..3
# tests 39
# suites 0
# pass 39
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 2390.378176
```

### 07-voice.test.js

```
TAP version 13
# Subtest: Voice: text prepared for speech keeps the words and loses the typography
    # Subtest: markdown emphasis and headings are stripped
    ok 1 - markdown emphasis and headings are stripped
      ---
      duration_ms: 0.978165
      type: 'test'
      ...
    # Subtest: bullets and arrows become spoken pauses, not symbols
    ok 2 - bullets and arrows become spoken pauses, not symbols
      ---
      duration_ms: 1.045409
      type: 'test'
      ...
    # Subtest: table pipes are not read aloud as "pipe"
    ok 3 - table pipes are not read aloud as "pipe"
      ---
      duration_ms: 0.213293
      type: 'test'
      ...
    # Subtest: code fences keep their contents
    ok 4 - code fences keep their contents
      ---
      duration_ms: 0.207341
      type: 'test'
      ...
    # Subtest: whitespace is collapsed but paragraphs survive
    ok 5 - whitespace is collapsed but paragraphs survive
      ---
      duration_ms: 0.176358
      type: 'test'
      ...
    # Subtest: null and undefined are empty, not "null"
    ok 6 - null and undefined are empty, not "null"
      ---
      duration_ms: 0.12139
      type: 'test'
      ...
    1..6
ok 1 - Voice: text prepared for speech keeps the words and loses the typography
  ---
  duration_ms: 3.820788
  type: 'test'
  ...
# Subtest: Voice: spoken summary is shorter than the displayed answer
    # Subtest: the answer is spoken, the evidence block is not
    ok 1 - the answer is spoken, the evidence block is not
      ---
      duration_ms: 0.282562
      type: 'test'
      ...
    # Subtest: exactly one limitation is spoken, as a caveat
    ok 2 - exactly one limitation is spoken, as a caveat
      ---
      duration_ms: 0.248931
      type: 'test'
      ...
    # Subtest: insufficient data is stated out loud, not left to the screen
    ok 3 - insufficient data is stated out loud, not left to the screen
      ---
      duration_ms: 0.216711
      type: 'test'
      ...
    # Subtest: low confidence is announced; high confidence is not
    ok 4 - low confidence is announced; high confidence is not
      ---
      duration_ms: 0.140666
      type: 'test'
      ...
    # Subtest: a blocked request is spoken verbatim and adds nothing
    ok 5 - a blocked request is spoken verbatim and adds nothing
      ---
      duration_ms: 0.078674
      type: 'test'
      ...
    # Subtest: an empty answer produces no speech rather than "undefined"
    ok 6 - an empty answer produces no speech rather than "undefined"
      ---
      duration_ms: 0.119126
      type: 'test'
      ...
    1..6
ok 2 - Voice: spoken summary is shorter than the displayed answer
  ---
  duration_ms: 1.654303
  type: 'test'
  ...
# Subtest: Voice: spoken phrases map onto the suggested questions
    # Subtest: a recognised phrase resolves to the closest suggestion
    ok 1 - a recognised phrase resolves to the closest suggestion
      ---
      duration_ms: 0.243218
      type: 'test'
      ...
    # Subtest: an unrelated phrase resolves to nothing instead of a wrong guess
    ok 2 - an unrelated phrase resolves to nothing instead of a wrong guess
      ---
      duration_ms: 0.121112
      type: 'test'
      ...
    # Subtest: empty input resolves to nothing
    ok 3 - empty input resolves to nothing
      ---
      duration_ms: 0.057083
      type: 'test'
      ...
    1..3
ok 3 - Voice: spoken phrases map onto the suggested questions
  ---
  duration_ms: 0.610765
  type: 'test'
  ...
# Subtest: Voice: locale tags are valid
    # Subtest: a normal tag is preserved
    ok 1 - a normal tag is preserved
      ---
      duration_ms: 1.317679
      type: 'test'
      ...
    # Subtest: a malformed tag falls back rather than throwing in the synthesiser
    ok 2 - a malformed tag falls back rather than throwing in the synthesiser
      ---
      duration_ms: 0.119395
      type: 'test'
      ...
    1..2
ok 4 - Voice: locale tags are valid
  ---
  duration_ms: 1.633948
  type: 'test'
  ...
# Subtest: Interface: icon sizing does not depend on a Tailwind class that does not exist
    # Subtest: the icon component sets width and height as attributes
    ok 1 - the icon component sets width and height as attributes
      ---
      duration_ms: 0.295668
      type: 'test'
      ...
    # Subtest: the sidebar can be collapsed and the choice is remembered
    ok 2 - the sidebar can be collapsed and the choice is remembered
      ---
      duration_ms: 0.15776
      type: 'test'
      ...
    1..2
ok 5 - Interface: icon sizing does not depend on a Tailwind class that does not exist
  ---
  duration_ms: 1.360715
  type: 'test'
  ...
# Subtest: Interface: the navigation is pinned to the viewport, not the document
    # Subtest: the sidebar uses sticky positioning on desktop
    ok 1 - the sidebar uses sticky positioning on desktop
      ---
      duration_ms: 0.173066
      type: 'test'
      ...
    # Subtest: the sidebar still behaves as an overlay drawer on small screens
    ok 2 - the sidebar still behaves as an overlay drawer on small screens
      ---
      duration_ms: 0.107926
      type: 'test'
      ...
    # Subtest: the built stylesheet actually contains the sticky rule
    ok 3 - the built stylesheet actually contains the sticky rule
      ---
      duration_ms: 0.344624
      type: 'test'
      ...
    1..3
ok 6 - Interface: the navigation is pinned to the viewport, not the document
  ---
  duration_ms: 1.011347
  type: 'test'
  ...
1..6
# tests 28
# suites 0
# pass 28
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 71.994064
```

### 08-assistant-actions.test.js

```
TAP version 13
# [db] applied migration 001_init.sql
# [db] applied migration 002_crm.sql
# Subtest: Assistant actions: parsing and lookup
    # Subtest: dates are accepted in the forms people actually say
    ok 1 - dates are accepted in the forms people actually say
      ---
      duration_ms: 0.966732
      type: 'test'
      ...
    # Subtest: numbers accept digits and simple words
    ok 2 - numbers accept digits and simple words
      ---
      duration_ms: 0.320885
      type: 'test'
      ...
    # Subtest: employee lookup refuses to guess between identical names
    ok 3 - employee lookup refuses to guess between identical names
      ---
      duration_ms: 0.177086
      type: 'test'
      ...
    1..3
ok 1 - Assistant actions: parsing and lookup
  ---
  duration_ms: 2.505196
  type: 'test'
  ...
# Subtest: Assistant actions: staging never writes, and permissions are enforced
    # Subtest: the catalogue lists only permissioned actions
    ok 1 - the catalogue lists only permissioned actions
      ---
      duration_ms: 9.680216
      type: 'test'
      ...
    # Subtest: staging a change writes nothing to the database
    ok 2 - staging a change writes nothing to the database
      ---
      duration_ms: 7.161989
      type: 'test'
      ...
    # Subtest: applying the staged payload performs exactly one write
    ok 3 - applying the staged payload performs exactly one write
      ---
      duration_ms: 8.76879
      type: 'test'
      ...
    # Subtest: the same payload cannot create a duplicate
    ok 4 - the same payload cannot create a duplicate
      ---
      duration_ms: 8.042729
      type: 'test'
      ...
    # Subtest: a user without ai.assistant is refused
    ok 5 - a user without ai.assistant is refused
      ---
      duration_ms: 45.5904
      type: 'test'
      ...
    # Subtest: applying without a staged payload is refused
    ok 6 - applying without a staged payload is refused
      ---
      duration_ms: 4.623412
      type: 'test'
      ...
    # Subtest: pay and cost fields are refused with a clear reason
    ok 7 - pay and cost fields are refused with a clear reason
      ---
      duration_ms: 4.462509
      type: 'test'
      ...
    # Subtest: an unknown name is reported, not guessed at
    ok 8 - an unknown name is reported, not guessed at
      ---
      duration_ms: 3.673402
      type: 'test'
      ...
    1..8
ok 2 - Assistant actions: staging never writes, and permissions are enforced
  ---
  duration_ms: 178.547828
  type: 'test'
  ...
# Subtest: Assistant actions: destructive actions are reversible in effect
    # Subtest: an allocation is cancelled, never deleted
    ok 1 - an allocation is cancelled, never deleted
      ---
      duration_ms: 24.675933
      type: 'test'
      ...
    # Subtest: every applied action is recorded with its actor and channel
    ok 2 - every applied action is recorded with its actor and channel
      ---
      duration_ms: 0.53703
      type: 'test'
      ...
    1..2
ok 3 - Assistant actions: destructive actions are reversible in effect
  ---
  duration_ms: 66.060459
  type: 'test'
  ...
1..3
# tests 16
# suites 0
# pass 16
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 805.602507
```

### 09-crm.test.js

```
TAP version 13
# [db] applied migration 001_init.sql
# [db] applied migration 002_crm.sql
# Subtest: CRM: dictation is parsed the way people actually speak
    # Subtest: a plain sentence fills the first empty required field
    ok 1 - a plain sentence fills the first empty required field
      ---
      duration_ms: 1.992788
      type: 'test'
      ...
    # Subtest: continuations beginning with "and" parse identically
    ok 2 - continuations beginning with "and" parse identically
      ---
      duration_ms: 2.328734
      type: 'test'
      ...
    # Subtest: several fields in one sentence are all captured
    ok 3 - several fields in one sentence are all captured
      ---
      duration_ms: 1.610647
      type: 'test'
      ...
    # Subtest: "next step" is a field, not a connective to be stripped
    ok 4 - "next step" is a field, not a connective to be stripped
      ---
      duration_ms: 0.265388
      type: 'test'
      ...
    # Subtest: "next step date" is not captured as "next step"
    ok 5 - "next step date" is not captured as "next step"
      ---
      duration_ms: 0.211212
      type: 'test'
      ...
    # Subtest: a spoken email address is reassembled
    ok 6 - a spoken email address is reassembled
      ---
      duration_ms: 0.589825
      type: 'test'
      ...
    # Subtest: Indian number words become numbers
    ok 7 - Indian number words become numbers
      ---
      duration_ms: 0.463947
      type: 'test'
      ...
    # Subtest: an invalid value is reported, not silently stored
    ok 8 - an invalid value is reported, not silently stored
      ---
      duration_ms: 0.441378
      type: 'test'
      ...
    # Subtest: missing required fields are named
    ok 9 - missing required fields are named
      ---
      duration_ms: 0.28264
      type: 'test'
      ...
    1..9
ok 1 - CRM: dictation is parsed the way people actually speak
  ---
  duration_ms: 10.179753
  type: 'test'
  ...
# Subtest: CRM: a draft cannot reach the dataset without approval
    # Subtest: capture is incremental and the field list is tracked
    ok 1 - capture is incremental and the field list is tracked
      ---
      duration_ms: 23.432189
      type: 'test'
      ...
    # Subtest: nothing is written to the dataset while drafting
    ok 2 - nothing is written to the dataset while drafting
      ---
      duration_ms: 0.277644
      type: 'test'
      ...
    # Subtest: submitting moves it to the approval queue only
    ok 3 - submitting moves it to the approval queue only
      ---
      duration_ms: 14.605764
      type: 'test'
      ...
    # Subtest: approval is what appends it to the dataset
    ok 4 - approval is what appends it to the dataset
      ---
      duration_ms: 9.409847
      type: 'test'
      ...
    # Subtest: a draft cannot be approved twice
    ok 5 - a draft cannot be approved twice
      ---
      duration_ms: 3.988371
      type: 'test'
      ...
    # Subtest: rejection keeps the draft out of the dataset permanently
    ok 6 - rejection keeps the draft out of the dataset permanently
      ---
      duration_ms: 20.660233
      type: 'test'
      ...
    # Subtest: a viewer cannot draft or approve
    ok 7 - a viewer cannot draft or approve
      ---
      duration_ms: 45.212111
      type: 'test'
      ...
    1..7
ok 2 - CRM: a draft cannot reach the dataset without approval
  ---
  duration_ms: 207.13832
  type: 'test'
  ...
# Subtest: AI author: answers from any table, and says so when it cannot
    # Subtest: the subject of a question is detected, with inflections
    ok 1 - the subject of a question is detected, with inflections
      ---
      duration_ms: 10.542845
      type: 'test'
      ...
    # Subtest: out-of-scope subjects are recognised explicitly
    ok 2 - out-of-scope subjects are recognised explicitly
      ---
      duration_ms: 0.179305
      type: 'test'
      ...
    # Subtest: a question outside the business data is refused, with alternatives
    ok 3 - a question outside the business data is refused, with alternatives
      ---
      duration_ms: 0.588502
      type: 'test'
      ...
    # Subtest: a CRM question is answered from the CRM tables
    ok 4 - a CRM question is answered from the CRM tables
      ---
      duration_ms: 1.439378
      type: 'test'
      ...
    # Subtest: finance questions are refused without the permission
    ok 5 - finance questions are refused without the permission
      ---
      duration_ms: 0.835492
      type: 'test'
      ...
    # Subtest: an answer never invents a number for an empty table
    ok 6 - an answer never invents a number for an empty table
      ---
      duration_ms: 0.604184
      type: 'test'
      ...
    1..6
ok 3 - AI author: answers from any table, and says so when it cannot
  ---
  duration_ms: 14.905269
  type: 'test'
  ...
1..3
# tests 25
# suites 0
# pass 25
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 798.930789
```

