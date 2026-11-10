# WorkforceIQ — Test Plan

**Version:** 1.0
**Last updated:** 2026-11-10
**Companion document:** `docs/test-report.md` — the current, generated results (`npm run test:report`)

---

## 1. Purpose

This plan describes how the product is verified, what that verification can and cannot prove, and how a defect is classified. The report is generated from a real run so the two documents cannot drift apart: the report is evidence, this plan is the method.

---

## 2. Testing philosophy

Three principles drive the approach:

1. **Test behaviour through the real product, not through mocks.** Every suite boots the actual Express app against a real SQLite database in a temporary directory, listens on a real port, and makes real HTTP requests with a real session cookie. Nothing in the request path is stubbed, so a passing test means the same code a browser would hit works.
2. **Test the boundary, not the happy path.** The dangerous failures in a multi-tenant workforce product are not "the dashboard is wrong"; they are "another tenant's employee was readable" and "a viewer could see cost". The suites spend most of their assertions on refusals.
3. **Never adjust the product to satisfy a mistaken test, and never adjust a test to hide a defect.** When the two disagree, the disagreement is resolved by deciding which is right, and the decision is recorded in `docs/14-change-history.md` — with product defects (§3) separated from corrected expectations (§4).

---

## 3. Test levels

| Level | What it covers | Where |
| --- | --- | --- |
| **Unit** | Pure functions where an error is subtle and math-heavy: number verification of model output, fact-pack redaction, injection pattern detection, CSV formula escaping | Inside the suites, imported directly |
| **Integration (API)** | Every route, permission gate, validation rule, error shape and audit write, exercised over HTTP with an authenticated cookie jar | `tests/01`–`tests/06` |
| **Cross-cutting security** | Tenant isolation, scope enforcement, privilege escalation, CSRF, headers, error leakage, secret scanning | `tests/02`, `tests/06` |
| **Build** | The production bundle compiles and the compiled SPA is served with deep-route fallback | `npm run build` plus manual HTTP verification |
| **Documentation consistency** | Metric definitions in the API match the formulas in the code, and the report is regenerated from a real run | `npm run test:report` |

### 3.1 What is not covered, and why

| Not covered | Reason | Consequence to accept |
| --- | --- | --- |
| Browser automation (clicks, rendering) | No Chromium/Playwright available in the build environment | A UI defect that only appears in a browser would not be caught. Mitigated by building the bundle and exercising the same endpoints the screens call. |
| Load and performance | No production-scale dataset | Throughput above demonstration size is unknown; recorded as risk R-07 |
| Postgres | The supported topology is single-node SQLite | A future migration would need its own test pass |
| External AI provider | Deliberate: no customer data leaves the host in tests | The `verifyNumbers` guard is unit-tested; a live provider has never been called |
| Email delivery | Not built | — |
| Accessibility conformance | No audit tooling in the environment | Risk R-09 |

**No claim of penetration testing, load testing or accessibility certification is made anywhere in the project documentation**, because none has been performed.

---

## 4. Test data

Fixtures are defined in `tests/seed-test-data.js` and are deliberately small enough that every expected value can be computed by hand.

| Fixture element | Value | Why |
| --- | --- | --- |
| Tenant A | `Test Alpha Ltd`, `admin@alpha.test` | Primary tenant |
| Tenant B | `Test Beta Ltd`, `admin@beta.test` | Exists only to attempt cross-tenant access |
| Period | `2026-08` (21 weekdays) | Fixed, so working-day maths is stable |
| Employee T-001 | 40 h/week, 20 h billable + 24 h internal allocation | Exercises allocation vs billable vs capacity with a deliberate overlap |
| Employee T-002 | 20 h/week part-time | Guards the double-FTE reduction defect |
| Employee T-003 | Bench (no allocation, no timesheet) | Guards utilisation = `null`, not `0` |
| Employee T-004 | Exited 2026-06-30 | Guards exclusion from capacity maths while remaining in lists |
| Timesheets | 80 h, 20 h, none | Full, partial and absent coverage |
| Demand | 2 records × 40 h/week | Guards the coverage formula |
| Invoice / expense | ₹10,00,000 / ₹1,00,000 | Guards margin computation |
| Extra users | `scoped@`, `viewer@`, `finance@` | Guard the scope, permission and cost-redaction boundaries |

Hand-computed expectations are asserted directly: **168 h** available for 40 h/week over 21 days, **84 h** for 20 h/week (not 42 — the doubled-FTE defect), **184.8 h** for 44 h/week, **420 h** total available, **184.8 h** allocated, **16.8 h** over-allocated, **252 h** unallocated.

Every fixture is fictional. No customer data exists anywhere in this repository.

---

## 5. Suites

| Suite | Focus | Recorded behaviours |
| --- | --- | --- |
| `01-auth.test.js` | Sign-in, session identity, cookie flags, logout revocation, lockout, password policy, session revocation on change, unauthenticated refusal | 9 |
| `02-tenancy.test.js` | Cross-tenant reads, per-org lists, foreign ids, org-context header, department scope, scope-before-calculation, cost redaction, viewer write refusal, financial denial, self-escalation | 11 |
| `03-analytics.test.js` | Capacity formulas, allocation vs utilisation separation, null-on-no-data, department and BU roll-ups, trend, demand coverage, overlap detection, cost and margin, permission-gated finance | 15 |
| `04-ingestion.test.js` | Upload validation, mapping suggestions, row validation and error report, duplicate blocking, validate-before-commit, single-transaction commit, undeletable committed imports, template download | 18 |
| `05-ai.test.js` | Grounding, exact figure match with the analytics service, insufficiency, injection blocking and logging, permission-aware refusal, fact-pack redaction, cross-tenant absence, no external calls, name withholding, invented-number rejection, insight generation and review, forecast refusal and success | 17 |
| `06-governance.test.js` | Approval-gated automation, second-approver execution, disabled rules, action allow-list, report lineage, XLSX validity, permission-gated cost report, cross-tenant download, path traversal, audit trail, tenant export, two-administrator deletion, health, 404 shape, no stack leakage, headers, CSRF, secret scan, dashboard consistency, input validation, live permission changes | 24 |

Counts shown are what the current run recorded; `docs/test-report.md` is the authoritative, generated list.

---

## 6. Requirement traceability

| Requirement area (see `docs/01-product-requirements.md`) | Verified by |
| --- | --- |
| AUTH-1 … AUTH-7 | `01-auth`, `06-governance` (live permission change) |
| AUTH-8 (MFA) | **Not built — no test, by design** |
| TEN-1 … TEN-5 | `02-tenancy` |
| ING-1 … ING-8 | `04-ingestion`, `06-governance` (deletion requires a second admin) |
| ANA-1 … ANA-7 | `03-analytics` |
| AI-1 … AI-8 | `05-ai` |
| FOR-1 … FOR-4 | `05-ai` |
| GOV-1 … GOV-8 | `06-governance` |
| REP-1 … REP-4 | `06-governance` |
| Security headers, CSRF, error leakage, secrets | `06-governance` |
| Backup and restore | **Process, not code — verified by executing the procedure in `docs/09-deployment-and-backup.md` §8** |
| Accessibility | **Not verified — risk R-09** |

Any requirement marked "not built" or "not verified" is stated that way rather than quietly omitted, because a traceability matrix that hides gaps is worse than none.

---

## 7. Defect classification

| Severity | Definition | Response |
| --- | --- | --- |
| **S1 — Critical** | Tenant data exposed, authentication bypass, cost data visible without permission, or an AI answer containing an invented figure | Block the release; fix, add a regression test, record in the change history |
| **S2 — Major** | Wrong figure where the correct one was available, an approval that can be bypassed, an import that half-commits, a missing audit event | Block the release |
| **S3 — Moderate** | Wrong error code, missing validation on a non-destructive field, misleading label, broken empty state | Fix before release where practical |
| **S4 — Minor** | Copy, spacing, ordering | Fix in the next cycle |

Every defect found during this build was S2 or S3. Two of them (the doubled part-time capacity and the transaction helper) would have produced visibly wrong numbers or a completely broken import path in a demo — which is precisely why they were found by running the product rather than reading it.

---

## 8. Test procedure

### 8.1 On every change

```bash
node --test --test-concurrency=1 tests/<relevant>.test.js
```

### 8.2 Before any release

```bash
npm ci
npm run build
npm test                      # all suites
npm run test:report           # regenerates docs/test-report.md and data/test-results.json
npm run migrate               # confirms migrations apply cleanly to a fresh database
```

The report runner executes each suite itself and fails the process if any suite fails, so a green report cannot be produced from a red build.

### 8.3 Manual checks that automation cannot cover

| Check | Method |
| --- | --- |
| The compiled interface is actually served | Start the process, fetch `/`, the hashed asset and a deep route such as `/utilization`; expect 200 for each |
| A signed-out browser cannot reach a screen | Open a private window, request a protected route, confirm redirect to sign-in |
| A screen's numbers match the API | Call the endpoint the screen uses and compare with the rendered value |
| Backup and restore | Run the procedure in the deployment guide into a scratch directory and confirm `PRAGMA integrity_check` returns `ok` |
| Fresh-install path | `npm run migrate && npm run seed` on an empty data directory, then sign in as each demo role |

---

## 9. Test environment recorded with each run

The report captures the runtime it ran on (Node version, platform, AI provider, database) because a result is only meaningful alongside its environment. The current run is Node 22.22.3 on linux x64 with the deterministic local AI provider and a throwaway SQLite file.

---

## 10. Entry and exit criteria

**Entry (before a release is verified):**
- All planned suites exist and run.
- The build compiles.
- Migrations apply to a fresh database.

**Exit (a release is shippable when):**
- Zero failures across all suites.
- No open S1 or S2 defects.
- Every "not built" item is documented in the PRD, the roadmap and this plan.
- `docs/test-report.md` is regenerated from the final run.
- Manual checks in §8.3 are complete, including a rehearsed restore.

**Current state:** all exit criteria met except load testing, accessibility and penetration testing, all three of which are documented as known gaps rather than claimed as complete.
