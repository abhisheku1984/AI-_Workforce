# WorkforceIQ — Change History

**Version:** 1.0
**Last updated:** 2026-11-10

This is the release record. It lists what was built in this release, and every defect found and fixed during verification, including the ones that were caught by tests before any customer could see them. It is written this way because "v1.0, initial release" tells a reader nothing about what is actually inside.

---

## Release 1.0 — 2026-11-10

### 1. Scope delivered

| Area | Delivered |
| --- | --- |
| Tenancy & access | Organisation provisioning, 24 permissions, 7 role templates, custom roles, department/business-unit scoping, server-side sessions, scrypt passwords, lockout, password policy |
| Structure | Business units, departments, locations with hours/day, working days and holidays |
| Workforce | Employee records, skills inventory, capacity inputs, permission-gated cost fields |
| Ingestion | 8 entity types, CSV/XLSX up to 20 MB and 20,000 rows, mapping suggestions, per-row validation, CSV error reports, duplicate-file blocking, single-transaction commit, version history |
| Analytics | Capacity engine with published formulas, utilisation and allocation reporting, department/BU/location roll-ups, trend, over-allocation and bench detection, demand coverage, overlap detection |
| Finance | Workforce cost, idle cost, invoiced revenue, expenses, billable value, gross margin with coverage disclosure |
| Dashboards | Single consistent dashboard payload with freshness indicators and metric definitions |
| AI | Grounded assistant with 11 intents and fact-preview, 7 insight types with review workflow, forecasts with refusal logic, AI audit stream, injection defences, optional verified external model |
| Reports | 8 report types, CSV and XLSX, lineage headers, permission-gated, download isolation |
| Automation | 5-action closed allow-list, approval workflow with no self-approval, run history, disabled-by-default rules |
| Governance | Append-only audit trail, AI audit, deletion with two-administrator approval, full tenant export, platform provisioning view |
| Interface | 18 screens, permission-filtered navigation, metric definitions page, empty/error/loading states throughout |

### 2. Verification

| Item | Result |
| --- | --- |
| Automated suites | 6 suites, 95 test cases, 96 recorded behaviours, **0 failures** |
| Production build | Succeeds (Vite build, main bundle ~647 kB, ~192 kB gzipped) |
| Served SPA | Root, hashed asset and a deep route all verified as served |
| API walk-through | Health, sign-in, principal, dashboard, assistant, forecast, insights, reports exercised against the seeded demonstration database |

Full detail with per-behaviour results: `docs/test-report.md`.

### 3. Defects found and fixed during the build

Each of these was found by running the product, not by reading it. They are listed because the pattern behind them is more useful than the fix.

| # | Defect | Effect | Fix | What it teaches |
| --- | --- | --- | --- | --- |
| 1 | Part-time capacity was halved twice | A 20-hour-per-week person showed 42 available hours in a 21-day month instead of 84, because explicit weekly hours were multiplied by FTE as well | Explicit `weekly_hours` is used as-is; FTE applies only when falling back to location-derived hours | Reduction factors must be applied exactly once, and a part-time fixture belongs in the test suite |
| 2 | JavaScript booleans bound to SQLite | Creating an automation rule returned 500 (`can only bind numbers, strings, bigints, buffers, null`) | Booleans coerced with `? 1 : 0` before binding | The database driver, not the application, defines what a boolean is |
| 3 | Transaction helper returned a result instead of a function | Staging an import threw `run is not a function`, and every import 500'd | `tx(fn)` now returns the transaction function; call sites invoke it | A helper whose return type is easy to misread deserves a name that says what it returns |
| 4 | Duplicate-file check too narrow | Re-uploading an identical uncommitted file returned 200 instead of 409, allowing a double import | Duplicate check now matches any import whose status is not `discarded` | A guard that only covers terminal states does not guard the dangerous window |
| 5 | Assistant read a field that does not exist | The assistant 500'd on `util.rows` | Corrected to `util.employees` | Renames must be searched, not assumed |
| 6 | AI audit rows had no organisation | The AI audit insert failed when the request had no tenant on the principal | `auditAi` falls back to the request's organisation | Audit code must never be the thing that fails |
| 7 | Forecast extrapolated without bounds | A three-month forecast returned 100% utilisation three times, a figure the data had never shown | Values clamped to the observed range | A model that can produce impossible values must be constrained, not trusted |
| 8 | Duplicate import blocked after staging | Uploading the same file twice was accepted in one code path | Checksum check moved to upload, before any staging | Validate as early as the information allows |
| 9 | Bill rate column not recognised | Files with a "Bill rate" header failed to map | Alias added to the `bill_rate_hour` field | Aliases are discovered by trying real files, not by imagining headers |
| 10 | Settings screen read a server-only value | The AI provider indicator read `process.env` in the browser, which does not exist there | Server exposes `ai_provider_configured`; the screen reads that | Browser code can only know what the API tells it |
| 11 | Date column ambiguous in SQL | An analytics query failed on an unqualified `start_date` | Table-qualified | Joins need qualification; there is no clever alternative |
| 12 | Assistant period resolution silently ignored | Passing an already-resolved period fell back to the current month, so an answer quoted the wrong month's figures | Fact pack accepts both a period spec and a resolved period | Silent fallbacks produce confidently wrong answers, which is worse than an error |
| 13 | Approval requests invisible in the main audit trail | An automation paused for approval, but an auditor scanning `audit_events` saw nothing | Every paused run now writes `approval.requested` as well as its run record | Governance records belong where the auditor looks, not only where the code finds them convenient |
| 14 | Assistant response omitted the "did data leave?" field | The documented `external_calls_made` flag was tested on the fact-preview endpoint but missing from the answer payload itself | Both the answer and the blocked-request response now report `external_calls_made` and `mode` | If a privacy claim is made in documentation, the field backing it must exist where users look |
| 15 | Import commit result lacked created-row detail | The commit response could not say which rows were created | `created_detail[]` added to the result | A result that only counts is hard to audit |
| 16 | **CSRF guard rejected legitimate sign-in behind a reverse proxy or preview tunnel** | The guard compared the request's `Origin` only against the `Host` header. When a proxy forwards `Host` as the upstream address while the browser sends the public host as `Origin`, every state-changing request — sign-in included — returned `403 CROSS_SITE_BLOCKED` before authentication ran. The user saw only "Cross-site requests are not permitted", and the audit trail recorded nothing because the request never reached the login handler. | The comparison now accepts a request when the browser states `Sec-Fetch-Site: same-origin`, or when `Origin` matches `Host`, `X-Forwarded-Host`, or a configured `PUBLIC_HOST` allow-list. A genuinely foreign `Origin` is still refused, and a request carrying neither signal is still refused. Two tests pin both halves. | A security control written without the deployment topology in view can lock out every legitimate user while looking perfectly strict. When a user says "I cannot log in", check what the audit trail does *not* say. |
| 17 | **Development server proxy broke its own host check** | `changeOrigin` was `false`, so the Vite dev server forwarded the browser's tunnel host to the API; Vite's host check then treated the hop as cross-origin and sign-in failed under `npm run dev` at any non-localhost host. | `changeOrigin: true` with `xfwd` and an explicit `X-Forwarded-Host`, which also feeds the API's proxy-aware CSRF check. | Reverse-proxy configuration is part of the product, not an environment detail. |

### 4. Corrections to test expectations (not product defects)

Recorded so the distinction between "the product was wrong" and "the test was wrong" is preserved:

| # | Expectation | Reality | Resolution |
| --- | --- | --- | --- |
| 1 | A scoped analyst's employee list excludes exited employees | Exited employees remain in the list for history; only capacity maths excludes them | Expectation corrected — showing a leaver is correct behaviour |
| 2 | Demand coverage should be 100% in the fixture | 84 of 336 required hours are covered = 25% | Expectation corrected; the fixture has one allocation against four demand records |
| 3 | A viewer could call the assistant and receive a refusal | Viewers lack `ai.assistant` entirely, so the endpoint returns 403 | Test restructured: the refusal case uses an analyst (assistant access, no finance permission), and a separate test asserts the 403 |
| 4 | The audit trail would contain `import.committed` at that point in the run | The audit assertion ran before the import suite had created that event | Expectation corrected to actions the governance suite itself causes (`auth.login`, `report.generated`, `approval.requested`, `approval.approved`) |

### 5. Configuration changes during the build

| Change | Reason |
| --- | --- |
| `better-sqlite3` pinned to ^13 | ^11 does not build on Node 22 |
| `multer` pinned to ^2 | 1.4.x is deprecated and has known issues |
| `server/index.js` exports `start()` and only auto-listens when run directly | So tests can import `{ app }` and listen on a random port without binding 4000 |
| `vite.config.js` host `0.0.0.0` with `allowedHosts: true` and an `/api` proxy | So the development server and the preview environment work from a remote browser |
| `package.json` seed scripts consolidated to `server/seed/run.js` | The previously referenced `server/seed/demo.js` did not exist |

### 6. Not included in this release

Stated as omissions, not as future promises:

- Multi-factor authentication, SSO, SCIM.
- Email delivery of any kind.
- Scheduled automation.
- Multi-currency.
- Native integrations with HRMS, project tools or finance systems.
- A formal accessibility audit, a penetration test, or load testing above demonstration scale.

These appear in `docs/13-roadmap.md` with the evidence that would justify each one.

### 7. How to verify this release yourself

```bash
npm ci                       # install
npm run build                # compile the interface
npm start                    # run the product (needs SESSION_SECRET in production mode)
npm test                     # six suites, 95 cases
npm run test:report          # regenerate docs/test-report.md from a real run
npm run seed                 # create the demonstration tenants (development only)
```

Demo sign-in (fictional data only): `admin@nexora-demo.example` / `DemoPass!2026`.
