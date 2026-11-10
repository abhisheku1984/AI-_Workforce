# WorkforceIQ — Test Plan and Test Report

**Report generated:** 2026-11-10 18:09:26 UTC

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
| Test suites executed | 10 |
| Node test cases passed | 210 |
| Node test cases failed | 0 |
| Recorded assertion groups | 129 |
| Assertion groups failed | 0 |
| Overall verdict | **Pass** |

What "assertion group" means: each `await t.test(...)` block in a suite is one behaviour
that is being checked, and it may contain several individual assertions. The group is
recorded only when all of its assertions inside it pass.

## 3. Results per suite

| Suite | Node cases passed | Node cases failed | Duration (ms) | Verdict |
| --- | --- | --- | --- | --- |
| `tests/01-auth.test.js` | 10 | 0 | 1545 | Pass |
| `tests/02-tenancy.test.js` | 12 | 0 | 1233 | Pass |
| `tests/03-analytics.test.js` | 14 | 0 | 803 | Pass |
| `tests/04-ingestion.test.js` | 17 | 0 | 875 | Pass |
| `tests/05-ai.test.js` | 17 | 0 | 1014 | Pass |
| `tests/06-governance.test.js` | 41 | 0 | 2518 | Pass |
| `tests/07-voice.test.js` | 28 | 0 | 105 | Pass |
| `tests/08-assistant-actions.test.js` | 16 | 0 | 856 | Pass |
| `tests/09-crm.test.js` | 25 | 0 | 861 | Pass |
| `tests/10-ui-smoke.test.js` | 30 | 0 | 37229 | Pass |

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
| A missing asset returns 404 with recovery instructions | Pass |
| dist/ never falls behind the committed prebuilt snapshot | Pass |
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

### 10-ui-smoke.test.js



| Behaviour verified | Result |
| --- | --- |
| (See raw output below) | Pass |

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
      duration_ms: 88.910626
      type: 'test'
      ...
    # Subtest: wrong password is rejected with a generic message
    ok 2 - wrong password is rejected with a generic message
      ---
      duration_ms: 40.935203
      type: 'test'
      ...
    # Subtest: unknown email returns the same error (no account enumeration)
    ok 3 - unknown email returns the same error (no account enumeration)
      ---
      duration_ms: 43.428995
      type: 'test'
      ...
    # Subtest: unauthenticated API access is refused
    ok 4 - unauthenticated API access is refused
      ---
      duration_ms: 7.781378
      type: 'test'
      ...
    # Subtest: session cookie is HttpOnly and SameSite
    ok 5 - session cookie is HttpOnly and SameSite
      ---
      duration_ms: 43.646697
      type: 'test'
      ...
    # Subtest: logout revokes the session server-side
    ok 6 - logout revokes the session server-side
      ---
      duration_ms: 52.979562
      type: 'test'
      ...
    # Subtest: account is temporarily locked after repeated failures
    ok 7 - account is temporarily locked after repeated failures
      ---
      duration_ms: 285.169302
      type: 'test'
      ...
    # Subtest: weak password change is rejected
    ok 8 - weak password change is rejected
      ---
      duration_ms: 83.866985
      type: 'test'
      ...
    # Subtest: password change revokes other sessions
    ok 9 - password change revokes other sessions
      ---
      duration_ms: 273.600008
      type: 'test'
      ...
    1..9
ok 1 - Authentication
  ---
  duration_ms: 923.058012
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
# duration_ms 1511.766893
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
      duration_ms: 101.672851
      type: 'test'
      ...
    # Subtest: workforce lists never include another tenant's records
    ok 2 - workforce lists never include another tenant's records
      ---
      duration_ms: 82.033944
      type: 'test'
      ...
    # Subtest: creating a record cannot reference another tenant structure
    ok 3 - creating a record cannot reference another tenant structure
      ---
      duration_ms: 39.54635
      type: 'test'
      ...
    # Subtest: organization header cannot be spoofed by a normal user
    ok 4 - organization header cannot be spoofed by a normal user
      ---
      duration_ms: 43.722878
      type: 'test'
      ...
    # Subtest: department-scoped user sees only their department
    ok 5 - department-scoped user sees only their department
      ---
      duration_ms: 47.162442
      type: 'test'
      ...
    # Subtest: scoped totals exclude out-of-scope capacity
    ok 6 - scoped totals exclude out-of-scope capacity
      ---
      duration_ms: 46.872242
      type: 'test'
      ...
    # Subtest: cost fields are stripped for roles without cost permission
    ok 7 - cost fields are stripped for roles without cost permission
      ---
      duration_ms: 46.90321
      type: 'test'
      ...
    # Subtest: viewer cannot write, cannot regenerate insights, cannot import
    ok 8 - viewer cannot write, cannot regenerate insights, cannot import
      ---
      duration_ms: 49.991611
      type: 'test'
      ...
    # Subtest: viewer cannot see financial analytics
    ok 9 - viewer cannot see financial analytics
      ---
      duration_ms: 42.03301
      type: 'test'
      ...
    # Subtest: user cannot escalate their own role
    ok 10 - user cannot escalate their own role
      ---
      duration_ms: 42.838353
      type: 'test'
      ...
    # Subtest: self-approval of a request is blocked
    ok 11 - self-approval of a request is blocked
      ---
      duration_ms: 54.599964
      type: 'test'
      ...
    1..11
ok 1 - Tenant isolation and data scope
  ---
  duration_ms: 600.056852
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
# duration_ms 1193.859297
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
      duration_ms: 13.620286
      type: 'test'
      ...
    # Subtest: exited employee is excluded from the period
    ok 2 - exited employee is excluded from the period
      ---
      duration_ms: 6.487235
      type: 'test'
      ...
    # Subtest: allocated hours sum overlapping allocations
    ok 3 - allocated hours sum overlapping allocations
      ---
      duration_ms: 8.246669
      type: 'test'
      ...
    # Subtest: utilization comes from timesheets and is null (not zero) without data
    ok 4 - utilization comes from timesheets and is null (not zero) without data
      ---
      duration_ms: 6.683282
      type: 'test'
      ...
    # Subtest: unallocated and over-allocated hours reconcile
    ok 5 - unallocated and over-allocated hours reconcile
      ---
      duration_ms: 9.974209
      type: 'test'
      ...
    # Subtest: filters change results consistently
    ok 6 - filters change results consistently
      ---
      duration_ms: 4.856856
      type: 'test'
      ...
    # Subtest: period boundaries are respected
    ok 7 - period boundaries are respected
      ---
      duration_ms: 4.91641
      type: 'test'
      ...
    # Subtest: trend returns one point per month
    ok 8 - trend returns one point per month
      ---
      duration_ms: 7.76432
      type: 'test'
      ...
    # Subtest: demand coverage identifies the uncovered requirement
    ok 9 - demand coverage identifies the uncovered requirement
      ---
      duration_ms: 5.795997
      type: 'test'
      ...
    # Subtest: overlapping allocations are detected
    ok 10 - overlapping allocations are detected
      ---
      duration_ms: 4.875017
      type: 'test'
      ...
    # Subtest: financial analysis states availability and computes margin only with full inputs
    ok 11 - financial analysis states availability and computes margin only with full inputs
      ---
      duration_ms: 6.428
      type: 'test'
      ...
    # Subtest: insufficient cost data is disclosed rather than estimated
    ok 12 - insufficient cost data is disclosed rather than estimated
      ---
      duration_ms: 38.987496
      type: 'test'
      ...
    # Subtest: metric definitions are exposed for audit
    ok 13 - metric definitions are exposed for audit
      ---
      duration_ms: 4.232938
      type: 'test'
      ...
    1..13
ok 1 - Utilization and capacity calculations
  ---
  duration_ms: 201.026645
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
# duration_ms 767.802012
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
      duration_ms: 1.836127
      type: 'test'
      ...
    # Subtest: format parsing handles common spreadsheet variations
    ok 2 - format parsing handles common spreadsheet variations
      ---
      duration_ms: 1.035357
      type: 'test'
      ...
    # Subtest: row validation flags errors and records safe fixes
    ok 3 - row validation flags errors and records safe fixes
      ---
      duration_ms: 1.385274
      type: 'test'
      ...
    # Subtest: valid CSV uploads, maps, validates and commits
    ok 4 - valid CSV uploads, maps, validates and commits
      ---
      duration_ms: 68.168411
      type: 'test'
      ...
    # Subtest: invalid rows are reported and never invented
    ok 5 - invalid rows are reported and never invented
      ---
      duration_ms: 30.428628
      type: 'test'
      ...
    # Subtest: duplicate rows inside a file are detected and skipped
    ok 6 - duplicate rows inside a file are detected and skipped
      ---
      duration_ms: 43.149244
      type: 'test'
      ...
    # Subtest: re-uploading existing records updates rather than duplicates
    ok 7 - re-uploading existing records updates rather than duplicates
      ---
      duration_ms: 18.640089
      type: 'test'
      ...
    # Subtest: unsupported file types are rejected
    ok 8 - unsupported file types are rejected
      ---
      duration_ms: 4.993488
      type: 'test'
      ...
    # Subtest: a file with a .xlsx extension but non-xlsx content is rejected
    ok 9 - a file with a .xlsx extension but non-xlsx content is rejected
      ---
      duration_ms: 5.189941
      type: 'test'
      ...
    # Subtest: empty file is rejected with a clear message
    ok 10 - empty file is rejected with a clear message
      ---
      duration_ms: 4.647582
      type: 'test'
      ...
    # Subtest: missing required mapping is refused
    ok 11 - missing required mapping is refused
      ---
      duration_ms: 8.142052
      type: 'test'
      ...
    # Subtest: committing an unvalidated import is refused
    ok 12 - committing an unvalidated import is refused
      ---
      duration_ms: 7.322472
      type: 'test'
      ...
    # Subtest: a failed import leaves existing data intact (transactional)
    ok 13 - a failed import leaves existing data intact (transactional)
      ---
      duration_ms: 15.2044
      type: 'test'
      ...
    # Subtest: duplicate file checksum is detected
    ok 14 - duplicate file checksum is detected
      ---
      duration_ms: 9.383821
      type: 'test'
      ...
    # Subtest: CSV injection payloads are neutralised on export
    ok 15 - CSV injection payloads are neutralised on export
      ---
      duration_ms: 1.059888
      type: 'test'
      ...
    # Subtest: import history and error report are available
    ok 16 - import history and error report are available
      ---
      duration_ms: 6.038419
      type: 'test'
      ...
    1..16
ok 1 - Data ingestion pipeline
  ---
  duration_ms: 316.090285
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
# duration_ms 838.209621
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
      duration_ms: 33.388892
      type: 'test'
      ...
    # Subtest: reported figures match the analytics service exactly
    ok 2 - reported figures match the analytics service exactly
      ---
      duration_ms: 22.487332
      type: 'test'
      ...
    # Subtest: a question that cannot be answered returns insufficient data, not a guess
    ok 3 - a question that cannot be answered returns insufficient data, not a guess
      ---
      duration_ms: 13.276298
      type: 'test'
      ...
    # Subtest: prompt injection in the question is blocked and logged
    ok 4 - prompt injection in the question is blocked and logged
      ---
      duration_ms: 4.312747
      type: 'test'
      ...
    # Subtest: injection patterns are recognised in uploaded/external text
    ok 5 - injection patterns are recognised in uploaded/external text
      ---
      duration_ms: 0.504633
      type: 'test'
      ...
    # Subtest: assistant is unavailable to roles without the assistant permission
    ok 6 - assistant is unavailable to roles without the assistant permission
      ---
      duration_ms: 44.979043
      type: 'test'
      ...
    # Subtest: assistant refuses financial questions without finance permission
    ok 7 - assistant refuses financial questions without finance permission
      ---
      duration_ms: 53.212993
      type: 'test'
      ...
    # Subtest: cost data is absent from the fact pack for users without cost permission
    ok 8 - cost data is absent from the fact pack for users without cost permission
      ---
      duration_ms: 52.826585
      type: 'test'
      ...
    # Subtest: fact pack never contains another tenant's organisation name
    ok 9 - fact pack never contains another tenant's organisation name
      ---
      duration_ms: 8.533041
      type: 'test'
      ...
    # Subtest: no external model is called in the default configuration
    ok 10 - no external model is called in the default configuration
      ---
      duration_ms: 7.733209
      type: 'test'
      ...
    # Subtest: employee names can be withheld before any model call
    ok 11 - employee names can be withheld before any model call
      ---
      duration_ms: 7.957414
      type: 'test'
      ...
    # Subtest: model output with invented figures is rejected
    ok 12 - model output with invented figures is rejected
      ---
      duration_ms: 0.675747
      type: 'test'
      ...
    # Subtest: insight generation produces evidence-backed records with stated limits
    ok 13 - insight generation produces evidence-backed records with stated limits
      ---
      duration_ms: 13.960607
      type: 'test'
      ...
    # Subtest: an insight can be reviewed and the decision is audited
    ok 14 - an insight can be reviewed and the decision is audited
      ---
      duration_ms: 9.41018
      type: 'test'
      ...
    # Subtest: forecast is refused without enough history
    ok 15 - forecast is refused without enough history
      ---
      duration_ms: 56.471279
      type: 'test'
      ...
    # Subtest: forecast is produced with adequate history and labelled as an estimate
    ok 16 - forecast is produced with adequate history and labelled as an estimate
      ---
      duration_ms: 26.69011
      type: 'test'
      ...
    1..16
ok 1 - AI assistant grounding and safety
  ---
  duration_ms: 445.287795
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
# duration_ms 980.714135
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
      duration_ms: 23.653572
      type: 'test'
      ...
    # Subtest: a second approver can approve and the action then executes
    ok 2 - a second approver can approve and the action then executes
      ---
      duration_ms: 121.961893
      type: 'test'
      ...
    # Subtest: disabled rules cannot be run
    ok 3 - disabled rules cannot be run
      ---
      duration_ms: 9.886993
      type: 'test'
      ...
    # Subtest: automation cannot be created with an unsupported action
    ok 4 - automation cannot be created with an unsupported action
      ---
      duration_ms: 4.587408
      type: 'test'
      ...
    # Subtest: report generation writes a file with lineage metadata
    ok 5 - report generation writes a file with lineage metadata
      ---
      duration_ms: 14.192314
      type: 'test'
      ...
    # Subtest: Excel report is a valid xlsx file
    ok 6 - Excel report is a valid xlsx file
      ---
      duration_ms: 34.11872
      type: 'test'
      ...
    # Subtest: cost report is refused without finance permission
    ok 7 - cost report is refused without finance permission
      ---
      duration_ms: 47.447483
      type: 'test'
      ...
    # Subtest: report files cannot be downloaded by another tenant
    ok 8 - report files cannot be downloaded by another tenant
      ---
      duration_ms: 56.399416
      type: 'test'
      ...
    # Subtest: path traversal on report download is rejected
    ok 9 - path traversal on report download is rejected
      ---
      duration_ms: 3.400568
      type: 'test'
      ...
    # Subtest: audit trail records authentication, approvals, automation and report generation
    ok 10 - audit trail records authentication, approvals, automation and report generation
      ---
      duration_ms: 4.674046
      type: 'test'
      ...
    # Subtest: audit trail is not visible to roles without audit permission
    ok 11 - audit trail is not visible to roles without audit permission
      ---
      duration_ms: 43.791679
      type: 'test'
      ...
    # Subtest: full tenant data export contains only that tenant
    ok 12 - full tenant data export contains only that tenant
      ---
      duration_ms: 5.831868
      type: 'test'
      ...
    # Subtest: deletion requires a second administrator
    ok 13 - deletion requires a second administrator
      ---
      duration_ms: 5.761083
      type: 'test'
      ...
    # Subtest: health endpoint reports database status
    ok 14 - health endpoint reports database status
      ---
      duration_ms: 2.267587
      type: 'test'
      ...
    # Subtest: unknown API routes return a structured 404
    ok 15 - unknown API routes return a structured 404
      ---
      duration_ms: 2.546844
      type: 'test'
      ...
    # Subtest: internal errors do not leak stack traces
    ok 16 - internal errors do not leak stack traces
      ---
      duration_ms: 47.76151
      type: 'test'
      ...
    # Subtest: security headers are present
    ok 17 - security headers are present
      ---
      duration_ms: 2.238992
      type: 'test'
      ...
    # Subtest: cross-site state-changing request is blocked when Origin differs
    ok 18 - cross-site state-changing request is blocked when Origin differs
      ---
      duration_ms: 2.795453
      type: 'test'
      ...
    # Subtest: cross-site protection still blocks a genuinely foreign origin
    ok 19 - cross-site protection still blocks a genuinely foreign origin
      ---
      duration_ms: 4.75857
      type: 'test'
      ...
    # Subtest: a request behind a reverse proxy is not mistaken for a cross-site request
    ok 20 - a request behind a reverse proxy is not mistaken for a cross-site request
      ---
      duration_ms: 83.350459
      type: 'test'
      ...
    # Subtest: the app can be embedded in a frame where configured, blocked where not
    ok 21 - the app can be embedded in a frame where configured, blocked where not
      ---
      duration_ms: 3.220507
      type: 'test'
      ...
    # Subtest: a session cookie that does not resolve is reported, not silently ignored
    ok 22 - a session cookie that does not resolve is reported, not silently ignored
      ---
      duration_ms: 3.767205
      type: 'test'
      ...
    # Subtest: session cookie attributes follow the transport and the configured policy
    ok 23 - session cookie attributes follow the transport and the configured policy
      ---
      duration_ms: 81.975519
      type: 'test'
      ...
    # Subtest: a bearer session token works where cookies are blocked
    ok 24 - a bearer session token works where cookies are blocked
      ---
      duration_ms: 53.556347
      type: 'test'
      ...
    # Subtest: signing out revokes a bearer token
    ok 25 - signing out revokes a bearer token
      ---
      duration_ms: 47.751745
      type: 'test'
      ...
    # Subtest: the entry document is never cached, so a deploy cannot leave a stale client
    ok 26 - the entry document is never cached, so a deploy cannot leave a stale client
      ---
      duration_ms: 2.980961
      type: 'test'
      ...
# [api] Missing asset requested: /assets/index-DOES-NOT-EXIST.js — the client is running a stale build. Serving 404 so the failure is visible.
    # Subtest: a missing interface asset is a 404, not a page that silently blanks
    ok 27 - a missing interface asset is a 404, not a page that silently blanks
      ---
      duration_ms: 2.814357
      type: 'test'
      ...
    # Subtest: the interface in dist/ is kept in step with the prebuilt snapshot
    ok 28 - the interface in dist/ is kept in step with the prebuilt snapshot
      ---
      duration_ms: 0.678291
      type: 'test'
      ...
    # Subtest: no secrets are committed to the repository
    ok 29 - no secrets are committed to the repository
      ---
      duration_ms: 0.579753
      type: 'test'
      ...
    # Subtest: dashboard payload is complete and internally consistent
    ok 30 - dashboard payload is complete and internally consistent
      ---
      duration_ms: 9.130015
      type: 'test'
      ...
    # Subtest: structure creation validates input
    ok 31 - structure creation validates input
      ---
      duration_ms: 6.160183
      type: 'test'
      ...
    # Subtest: role permission changes take effect immediately
    ok 32 - role permission changes take effect immediately
      ---
      duration_ms: 68.307111
      type: 'test'
      ...
    1..32
ok 1 - Automation, approvals, reports and operations
  ---
  duration_ms: 892.64834
  type: 'test'
  ...
# Subtest: startup: a direct run serves traffic, an import opens no port
    # Subtest: running server/index.js directly opens a port and reports the URL
    ok 1 - running server/index.js directly opens a port and reports the URL
      ---
      duration_ms: 358.737785
      type: 'test'
      ...
    # Subtest: importing the module does not open a port
    ok 2 - importing the module does not open a port
      ---
      duration_ms: 313.516123
      type: 'test'
      ...
    # Subtest: the prebuilt interface installs without any native tooling
    ok 3 - the prebuilt interface installs without any native tooling
      ---
      duration_ms: 35.391674
      type: 'test'
      ...
    1..3
ok 2 - startup: a direct run serves traffic, an import opens no port
  ---
  duration_ms: 708.955262
  type: 'test'
  ...
# Subtest: packaging: the prebuilt interface is not excluded by .gitignore
    # Subtest: git does not ignore prebuilt/dist
    ok 1 - git does not ignore prebuilt/dist
      ---
      duration_ms: 5.732232
      type: 'test'
      ...
    # Subtest: .gitignore still ignores a local build and local data
    ok 2 - .gitignore still ignores a local build and local data
      ---
      duration_ms: 16.172875
      type: 'test'
      ...
    # Subtest: an unbuilt checkout explains itself instead of 404ing
    ok 3 - an unbuilt checkout explains itself instead of 404ing
      ---
      duration_ms: 305.433393
      type: 'test'
      ...
    1..3
ok 3 - packaging: the prebuilt interface is not excluded by .gitignore
  ---
  duration_ms: 328.27143
  type: 'test'
  ...
1..3
# tests 41
# suites 0
# pass 41
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 2486.468091
```

### 07-voice.test.js

```
TAP version 13
# Subtest: Voice: text prepared for speech keeps the words and loses the typography
    # Subtest: markdown emphasis and headings are stripped
    ok 1 - markdown emphasis and headings are stripped
      ---
      duration_ms: 1.028495
      type: 'test'
      ...
    # Subtest: bullets and arrows become spoken pauses, not symbols
    ok 2 - bullets and arrows become spoken pauses, not symbols
      ---
      duration_ms: 1.134465
      type: 'test'
      ...
    # Subtest: table pipes are not read aloud as "pipe"
    ok 3 - table pipes are not read aloud as "pipe"
      ---
      duration_ms: 0.239586
      type: 'test'
      ...
    # Subtest: code fences keep their contents
    ok 4 - code fences keep their contents
      ---
      duration_ms: 0.196508
      type: 'test'
      ...
    # Subtest: whitespace is collapsed but paragraphs survive
    ok 5 - whitespace is collapsed but paragraphs survive
      ---
      duration_ms: 0.110102
      type: 'test'
      ...
    # Subtest: null and undefined are empty, not "null"
    ok 6 - null and undefined are empty, not "null"
      ---
      duration_ms: 0.152309
      type: 'test'
      ...
    1..6
ok 1 - Voice: text prepared for speech keeps the words and loses the typography
  ---
  duration_ms: 3.882416
  type: 'test'
  ...
# Subtest: Voice: spoken summary is shorter than the displayed answer
    # Subtest: the answer is spoken, the evidence block is not
    ok 1 - the answer is spoken, the evidence block is not
      ---
      duration_ms: 0.284148
      type: 'test'
      ...
    # Subtest: exactly one limitation is spoken, as a caveat
    ok 2 - exactly one limitation is spoken, as a caveat
      ---
      duration_ms: 0.207532
      type: 'test'
      ...
    # Subtest: insufficient data is stated out loud, not left to the screen
    ok 3 - insufficient data is stated out loud, not left to the screen
      ---
      duration_ms: 0.245451
      type: 'test'
      ...
    # Subtest: low confidence is announced; high confidence is not
    ok 4 - low confidence is announced; high confidence is not
      ---
      duration_ms: 0.151818
      type: 'test'
      ...
    # Subtest: a blocked request is spoken verbatim and adds nothing
    ok 5 - a blocked request is spoken verbatim and adds nothing
      ---
      duration_ms: 0.079373
      type: 'test'
      ...
    # Subtest: an empty answer produces no speech rather than "undefined"
    ok 6 - an empty answer produces no speech rather than "undefined"
      ---
      duration_ms: 0.081821
      type: 'test'
      ...
    1..6
ok 2 - Voice: spoken summary is shorter than the displayed answer
  ---
  duration_ms: 1.678612
  type: 'test'
  ...
# Subtest: Voice: spoken phrases map onto the suggested questions
    # Subtest: a recognised phrase resolves to the closest suggestion
    ok 1 - a recognised phrase resolves to the closest suggestion
      ---
      duration_ms: 0.314414
      type: 'test'
      ...
    # Subtest: an unrelated phrase resolves to nothing instead of a wrong guess
    ok 2 - an unrelated phrase resolves to nothing instead of a wrong guess
      ---
      duration_ms: 0.131135
      type: 'test'
      ...
    # Subtest: empty input resolves to nothing
    ok 3 - empty input resolves to nothing
      ---
      duration_ms: 0.058532
      type: 'test'
      ...
    1..3
ok 3 - Voice: spoken phrases map onto the suggested questions
  ---
  duration_ms: 0.69461
  type: 'test'
  ...
# Subtest: Voice: locale tags are valid
    # Subtest: a normal tag is preserved
    ok 1 - a normal tag is preserved
      ---
      duration_ms: 1.120514
      type: 'test'
      ...
    # Subtest: a malformed tag falls back rather than throwing in the synthesiser
    ok 2 - a malformed tag falls back rather than throwing in the synthesiser
      ---
      duration_ms: 0.089814
      type: 'test'
      ...
    1..2
ok 4 - Voice: locale tags are valid
  ---
  duration_ms: 1.368065
  type: 'test'
  ...
# Subtest: Interface: icon sizing does not depend on a Tailwind class that does not exist
    # Subtest: the icon component sets width and height as attributes
    ok 1 - the icon component sets width and height as attributes
      ---
      duration_ms: 0.275181
      type: 'test'
      ...
    # Subtest: the sidebar can be collapsed and the choice is remembered
    ok 2 - the sidebar can be collapsed and the choice is remembered
      ---
      duration_ms: 0.142146
      type: 'test'
      ...
    1..2
ok 5 - Interface: icon sizing does not depend on a Tailwind class that does not exist
  ---
  duration_ms: 1.207784
  type: 'test'
  ...
# Subtest: Interface: the navigation is pinned to the viewport, not the document
    # Subtest: the sidebar uses sticky positioning on desktop
    ok 1 - the sidebar uses sticky positioning on desktop
      ---
      duration_ms: 0.127972
      type: 'test'
      ...
    # Subtest: the sidebar still behaves as an overlay drawer on small screens
    ok 2 - the sidebar still behaves as an overlay drawer on small screens
      ---
      duration_ms: 0.087718
      type: 'test'
      ...
    # Subtest: the built stylesheet actually contains the sticky rule
    ok 3 - the built stylesheet actually contains the sticky rule
      ---
      duration_ms: 0.366418
      type: 'test'
      ...
    1..3
ok 6 - Interface: the navigation is pinned to the viewport, not the document
  ---
  duration_ms: 0.877696
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
# duration_ms 76.376944
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
      duration_ms: 0.942336
      type: 'test'
      ...
    # Subtest: numbers accept digits and simple words
    ok 2 - numbers accept digits and simple words
      ---
      duration_ms: 0.320879
      type: 'test'
      ...
    # Subtest: employee lookup refuses to guess between identical names
    ok 3 - employee lookup refuses to guess between identical names
      ---
      duration_ms: 0.201245
      type: 'test'
      ...
    1..3
ok 1 - Assistant actions: parsing and lookup
  ---
  duration_ms: 2.646543
  type: 'test'
  ...
# Subtest: Assistant actions: staging never writes, and permissions are enforced
    # Subtest: the catalogue lists only permissioned actions
    ok 1 - the catalogue lists only permissioned actions
      ---
      duration_ms: 11.768052
      type: 'test'
      ...
    # Subtest: staging a change writes nothing to the database
    ok 2 - staging a change writes nothing to the database
      ---
      duration_ms: 10.362688
      type: 'test'
      ...
    # Subtest: applying the staged payload performs exactly one write
    ok 3 - applying the staged payload performs exactly one write
      ---
      duration_ms: 9.088118
      type: 'test'
      ...
    # Subtest: the same payload cannot create a duplicate
    ok 4 - the same payload cannot create a duplicate
      ---
      duration_ms: 8.867399
      type: 'test'
      ...
    # Subtest: a user without ai.assistant is refused
    ok 5 - a user without ai.assistant is refused
      ---
      duration_ms: 47.673322
      type: 'test'
      ...
    # Subtest: applying without a staged payload is refused
    ok 6 - applying without a staged payload is refused
      ---
      duration_ms: 5.131399
      type: 'test'
      ...
    # Subtest: pay and cost fields are refused with a clear reason
    ok 7 - pay and cost fields are refused with a clear reason
      ---
      duration_ms: 5.137421
      type: 'test'
      ...
    # Subtest: an unknown name is reported, not guessed at
    ok 8 - an unknown name is reported, not guessed at
      ---
      duration_ms: 3.562752
      type: 'test'
      ...
    1..8
ok 2 - Assistant actions: staging never writes, and permissions are enforced
  ---
  duration_ms: 197.735282
  type: 'test'
  ...
# Subtest: Assistant actions: destructive actions are reversible in effect
    # Subtest: an allocation is cancelled, never deleted
    ok 1 - an allocation is cancelled, never deleted
      ---
      duration_ms: 11.487197
      type: 'test'
      ...
    # Subtest: every applied action is recorded with its actor and channel
    ok 2 - every applied action is recorded with its actor and channel
      ---
      duration_ms: 0.406086
      type: 'test'
      ...
    1..2
ok 3 - Assistant actions: destructive actions are reversible in effect
  ---
  duration_ms: 55.304452
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
# duration_ms 824.769878
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
      duration_ms: 2.157931
      type: 'test'
      ...
    # Subtest: continuations beginning with "and" parse identically
    ok 2 - continuations beginning with "and" parse identically
      ---
      duration_ms: 2.457617
      type: 'test'
      ...
    # Subtest: several fields in one sentence are all captured
    ok 3 - several fields in one sentence are all captured
      ---
      duration_ms: 1.781119
      type: 'test'
      ...
    # Subtest: "next step" is a field, not a connective to be stripped
    ok 4 - "next step" is a field, not a connective to be stripped
      ---
      duration_ms: 0.275993
      type: 'test'
      ...
    # Subtest: "next step date" is not captured as "next step"
    ok 5 - "next step date" is not captured as "next step"
      ---
      duration_ms: 0.263543
      type: 'test'
      ...
    # Subtest: a spoken email address is reassembled
    ok 6 - a spoken email address is reassembled
      ---
      duration_ms: 0.497613
      type: 'test'
      ...
    # Subtest: Indian number words become numbers
    ok 7 - Indian number words become numbers
      ---
      duration_ms: 0.559749
      type: 'test'
      ...
    # Subtest: an invalid value is reported, not silently stored
    ok 8 - an invalid value is reported, not silently stored
      ---
      duration_ms: 0.412577
      type: 'test'
      ...
    # Subtest: missing required fields are named
    ok 9 - missing required fields are named
      ---
      duration_ms: 0.386045
      type: 'test'
      ...
    1..9
ok 1 - CRM: dictation is parsed the way people actually speak
  ---
  duration_ms: 10.848324
  type: 'test'
  ...
# Subtest: CRM: a draft cannot reach the dataset without approval
    # Subtest: capture is incremental and the field list is tracked
    ok 1 - capture is incremental and the field list is tracked
      ---
      duration_ms: 9.7015
      type: 'test'
      ...
    # Subtest: nothing is written to the dataset while drafting
    ok 2 - nothing is written to the dataset while drafting
      ---
      duration_ms: 0.288179
      type: 'test'
      ...
    # Subtest: submitting moves it to the approval queue only
    ok 3 - submitting moves it to the approval queue only
      ---
      duration_ms: 17.589618
      type: 'test'
      ...
    # Subtest: approval is what appends it to the dataset
    ok 4 - approval is what appends it to the dataset
      ---
      duration_ms: 10.131198
      type: 'test'
      ...
    # Subtest: a draft cannot be approved twice
    ok 5 - a draft cannot be approved twice
      ---
      duration_ms: 5.196027
      type: 'test'
      ...
    # Subtest: rejection keeps the draft out of the dataset permanently
    ok 6 - rejection keeps the draft out of the dataset permanently
      ---
      duration_ms: 20.041893
      type: 'test'
      ...
    # Subtest: a viewer cannot draft or approve
    ok 7 - a viewer cannot draft or approve
      ---
      duration_ms: 45.532262
      type: 'test'
      ...
    1..7
ok 2 - CRM: a draft cannot reach the dataset without approval
  ---
  duration_ms: 194.787542
  type: 'test'
  ...
# Subtest: AI author: answers from any table, and says so when it cannot
    # Subtest: the subject of a question is detected, with inflections
    ok 1 - the subject of a question is detected, with inflections
      ---
      duration_ms: 12.161803
      type: 'test'
      ...
    # Subtest: out-of-scope subjects are recognised explicitly
    ok 2 - out-of-scope subjects are recognised explicitly
      ---
      duration_ms: 0.293143
      type: 'test'
      ...
    # Subtest: a question outside the business data is refused, with alternatives
    ok 3 - a question outside the business data is refused, with alternatives
      ---
      duration_ms: 0.541638
      type: 'test'
      ...
    # Subtest: a CRM question is answered from the CRM tables
    ok 4 - a CRM question is answered from the CRM tables
      ---
      duration_ms: 1.345475
      type: 'test'
      ...
    # Subtest: finance questions are refused without the permission
    ok 5 - finance questions are refused without the permission
      ---
      duration_ms: 1.066845
      type: 'test'
      ...
    # Subtest: an answer never invents a number for an empty table
    ok 6 - an answer never invents a number for an empty table
      ---
      duration_ms: 0.504458
      type: 'test'
      ...
    1..6
ok 3 - AI author: answers from any table, and says so when it cannot
  ---
  duration_ms: 16.633859
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
# duration_ms 816.919809
```

### 10-ui-smoke.test.js

```
TAP version 13
# ⚠️ React Router Future Flag Warning: React Router will begin wrapping state updates in `React.startTransition` in v7. You can use the `v7_startTransition` future flag to opt-in early. For more information, see https://reactrouter.com/v6/upgrading/future\#v7_starttransition.
# ⚠️ React Router Future Flag Warning: Relative route resolution within Splat routes is changing in v7. You can use the `v7_relativeSplatPath` future flag to opt-in early. For more information, see https://reactrouter.com/v6/upgrading/future\#v7_relativesplatpath.
# Subtest: Interface: every route renders something
    # Subtest: / renders without throwing
    ok 1 - / renders without throwing
      ---
      duration_ms: 1879.246952
      type: 'test'
      ...
    # Subtest: /workforce renders without throwing
    ok 2 - /workforce renders without throwing
      ---
      duration_ms: 1216.713369
      type: 'test'
      ...
    # Subtest: /utilization renders without throwing
    ok 3 - /utilization renders without throwing
      ---
      duration_ms: 1209.114934
      type: 'test'
      ...
    # Subtest: /projects renders without throwing
    ok 4 - /projects renders without throwing
      ---
      duration_ms: 1217.216088
      type: 'test'
      ...
    # Subtest: /crm renders without throwing
    ok 5 - /crm renders without throwing
      ---
      duration_ms: 1212.288621
      type: 'test'
      ...
    # Subtest: /allocation renders without throwing
    ok 6 - /allocation renders without throwing
      ---
      duration_ms: 1214.746417
      type: 'test'
      ...
    # Subtest: /finance renders without throwing
    ok 7 - /finance renders without throwing
      ---
      duration_ms: 1212.099521
      type: 'test'
      ...
    # Subtest: /insights renders without throwing
    ok 8 - /insights renders without throwing
      ---
      duration_ms: 1210.826476
      type: 'test'
      ...
    # Subtest: /assistant renders without throwing
    ok 9 - /assistant renders without throwing
      ---
      duration_ms: 1211.440618
      type: 'test'
      ...
    # Subtest: /forecast renders without throwing
    ok 10 - /forecast renders without throwing
      ---
      duration_ms: 1214.684874
      type: 'test'
      ...
    # Subtest: /reports renders without throwing
    ok 11 - /reports renders without throwing
      ---
      duration_ms: 1209.263417
      type: 'test'
      ...
    # Subtest: /data renders without throwing
    ok 12 - /data renders without throwing
      ---
      duration_ms: 1212.279037
      type: 'test'
      ...
    # Subtest: /governance renders without throwing
    ok 13 - /governance renders without throwing
      ---
      duration_ms: 1210.44681
      type: 'test'
      ...
    # Subtest: /admin renders without throwing
    ok 14 - /admin renders without throwing
      ---
      duration_ms: 1212.047659
      type: 'test'
      ...
    # Subtest: /settings renders without throwing
    ok 15 - /settings renders without throwing
      ---
      duration_ms: 1220.611689
      type: 'test'
      ...
    # Subtest: /account renders without throwing
    ok 16 - /account renders without throwing
      ---
      duration_ms: 1210.332753
      type: 'test'
      ...
    # Subtest: /notifications renders without throwing
    ok 17 - /notifications renders without throwing
      ---
      duration_ms: 1208.947962
      type: 'test'
      ...
    # Subtest: /metrics renders without throwing
    ok 18 - /metrics renders without throwing
      ---
      duration_ms: 1209.198702
      type: 'test'
      ...
    1..18
ok 1 - Interface: every route renders something
  ---
  duration_ms: 22497.780019
  type: 'test'
  ...
# Subtest: Interface: renders with no API data at all
    # Subtest: /crm survives an empty response
    ok 1 - /crm survives an empty response
      ---
      duration_ms: 1210.613752
      type: 'test'
      ...
    # Subtest: /reports survives an empty response
    ok 2 - /reports survives an empty response
      ---
      duration_ms: 1211.410797
      type: 'test'
      ...
    # Subtest: /governance survives an empty response
    ok 3 - /governance survives an empty response
      ---
      duration_ms: 1209.498652
      type: 'test'
      ...
    # Subtest: /admin survives an empty response
    ok 4 - /admin survives an empty response
      ---
      duration_ms: 1210.614471
      type: 'test'
      ...
    # Subtest: /settings survives an empty response
    ok 5 - /settings survives an empty response
      ---
      duration_ms: 1215.581365
      type: 'test'
      ...
    # Subtest: /metrics survives an empty response
    ok 6 - /metrics survives an empty response
      ---
      duration_ms: 1209.579266
      type: 'test'
      ...
    1..6
ok 2 - Interface: renders with no API data at all
  ---
  duration_ms: 7269.243473
  type: 'test'
  ...
# Subtest: Interface: the shell contains the navigation and the AI author
    # Subtest: the signed-in shell renders its navigation
    ok 1 - the signed-in shell renders its navigation
      ---
      duration_ms: 1209.440301
      type: 'test'
      ...
    # Subtest: the AI author button is present on every page
    ok 2 - the AI author button is present on every page
      ---
      duration_ms: 4840.600862
      type: 'test'
      ...
    # Subtest: the CRM page shows its approval queue
    ok 3 - the CRM page shows its approval queue
      ---
      duration_ms: 1221.876747
      type: 'test'
      ...
    1..3
ok 3 - Interface: the shell contains the navigation and the AI author
  ---
  duration_ms: 7273.003158
  type: 'test'
  ...
1..3
# tests 30
# suites 0
# pass 30
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 37200.227955
```

