# WorkforceIQ — Onboarding Guide

**Version:** 1.0
**Last updated:** 2026-11-10
**Audience:** whoever is installing WorkforceIQ for the first time — a developer joining the project, or the person running a customer's deployment

---

## 1. What you are picking up

WorkforceIQ is a multi-tenant workforce and operations analytics product: a Node.js/Express API, a SQLite database, and a React single-page interface, delivered as one process.

Read these three sentences before touching anything:

1. **Every number a user sees is calculated on the server, from the user's permitted data, by a documented formula.** The interface only displays.
2. **The AI does not calculate.** It phrases results that the analytics layer already computed, and it refuses when the underlying data is missing.
3. **Tenant isolation is structural.** The organisation id comes from the session, and it is in the `WHERE` clause of every query. Nothing in this codebase should ever take an organisation id from a request body.

If you understand those three, the rest of the codebase will read quickly.

---

## 2. Environment

| Requirement | Version | Note |
| --- | --- | --- |
| Node.js | 20 LTS or newer (22 used in development) | Tested on Node 22.22.3 |
| npm | 10+ | |
| Build tools | `build-essential`, `python3` on Linux | `better-sqlite3` is a native module |
| Database | None to install | SQLite is embedded |
| External services | None | No cloud, no AI key, no email provider required |

```bash
git clone <repository> && cd AI-_Workforce
npm ci
npm run migrate          # creates data/workforceiq.db with 38 tables
npm run seed             # creates 3 fictional demo tenants + platform admin
npm run dev              # API on :4000, Vite on :5173
```

Open `http://localhost:5173` and sign in as `admin@nexora-demo.example` / `DemoPass!2026`.

For a single-process production-like run:

```bash
npm run build            # produces dist/
npm start                # serves API and interface from :4000
```

**The demo tenants are fictional.** Every employee row carries `is_demo = 1` and every organisation name ends in "(Demo)". Never quote their numbers as customer results.

---

## 3. Repository map

```
server/
  index.js            app assembly, middleware order, static serving, error handler
  config.js           environment + secret handling (secrets from env only)
  db/
    index.js          connection, WAL, migrate(), tx(fn)  ← read this first
    migrations/       numbered SQL migrations (001_init.sql: 38 tables)
  auth/               permissions catalogue, scrypt passwords, sessions, middleware
  lib/                http helpers, audit writer, capacity maths, guards
  services/           scope, analytics, orgStructure, onboarding, forecasting,
                      automation, reports, grounding, billing
  ai/                 provider (external model + numeric verification), assistant, insights
  ingestion/          schemas (field aliases), parse, validate, pipeline
  routes/             10 routers: auth, admin, workforce, projects, allocations,
                      imports, analytics, ai, reports, governance
  seed/               scenarios.js (data generators), run.js (entry)
src/
  lib/                api client, formatting, auth context
  components/         ui primitives, charts, tables, filters, layout
  pages/              18 screens
tests/
  helpers.js          boots the real app on a random port against a temp database
  seed-test-data.js   two fictional tenants with hand-computed expectations
  01..06*.test.js     auth, tenancy, analytics, ingestion, AI, governance
  run-report.js       regenerates docs/test-report.md from a real run
docs/                 15 project documents + this guide
```

### The three files to read in order

1. `server/db/index.js` — how data is reached, and the `tx(fn)` contract.
2. `server/auth/middleware.js` — how identity, permissions, tenant and scope are established.
3. `server/services/analytics.js` — where every business number comes from.

---

## 4. The request path, end to end

```
browser → helmet → compression → body parse → authenticate (session cookie)
        → CSRF origin check → router → requireAuth → tenantContext → requireOrg
        → requirePermission('x.y') → handler
             ├─ validate input (throw ApiError on bad input)
             ├─ call exactly one service with req.user (the principal)
             ├─ write the audit event
             └─ ok(res, data)
        → central error handler (ApiError → its status; anything else → 500, logged, no stack)
```

Three rules that follow from this shape:

- **A route validates and audits; a service calculates.** If you find business maths in a route, it is in the wrong place.
- **A service never reads a request object.** It takes a *principal* and explicit parameters, which is what makes the test suite possible.
- **`ok(res, data)` and throwing `ApiError`** are the only two ways to respond. Do not write `res.json` in a handler.

---

## 5. Adding a feature: a worked example

Say you want to add "add an employee note".

**1. Schema.** Add a migration `server/db/migrations/002_employee_notes.sql` with a new table carrying `org_id NOT NULL`. Never edit `001_init.sql` after it has run anywhere.

**2. Service.** Create or extend a service in `server/services/`. It takes `(principal, args)`, checks permission-sensitive fields, and puts `org_id` in every query:

```js
export function addNote(principal, { employeeId, note }) {
  const employee = getDb().prepare('SELECT * FROM employees WHERE id = ? AND org_id = ?')
    .get(employeeId, principal.orgId);
  if (!employee) throw notFound('Employee');          // 404, never 403 — no existence disclosure
  ...insert with principal.orgId...
}
```

**3. Route.** Validate the body, call the service once, audit, respond:

```js
router.post('/:id/notes', requirePermission('workforce.manage'), ah(async (req, res) => {
  const note = String(req.body?.note || '').trim();
  if (note.length < 3) throw badRequest('A note needs at least 3 characters.');
  const created = addNote(req.user, { employeeId: Number(req.params.id), note });
  audit(req, { action: 'employee.note.added', entityType: 'employee', entityId: req.params.id,
               summary: 'Note added', meta: { note_id: created.id } });
  return ok(res, created);
}));
```

**4. Interface.** Add the control on the screen, guarded by `can('workforce.manage')`. The guard is cosmetic; the server already enforces it.

**5. Test.** Add a case to the relevant suite in `tests/`, including a cross-tenant attempt (another organisation's employee id must return 404) and a permission attempt (a viewer must get 403).

**6. Documentation.** Update the API doc, the data dictionary, the PRD status column and the change history. This is not optional: the documentation is part of the product.

---

## 6. Conventions that are enforced by history, not preference

| Convention | Why it exists |
| --- | --- |
| Never bind a JavaScript boolean to SQLite | It throws. Coerce with `? 1 : 0`. |
| `tx(fn)` returns a **function** — call it | `tx(() => { … })()` is correct; `const r = tx(() => …)` gives you a function, not a result. |
| Tenant id comes from the principal, never from input | This is the product's core security property. |
| Lookup-by-id is always `WHERE id = ? AND org_id = ?` | Returns 404 instead of 403, so ids cannot be probed. |
| Cost fields are removed in the service, not the UI | A hidden field is still transmitted. |
| `resource.sql` parameters, never string concatenation | No exceptions, including `IN` lists (build placeholders from the array). |
| Audit every state change in the route | The route knows the human-readable summary. |
| Never `pkill -f "node server/index.js"` while it is your own parent shell | It kills the session. Use the process manager or `systemctl`. |
| Tests run with `--test-concurrency=1` | The suites share a database file pattern and port allocation strategy. |
| Never call `tx` inside an open transaction | better-sqlite3 throws on nested transactions; use the returned function once. |

---

## 7. Where the numbers come from

If you change anything in `server/lib/capacity.js` or `server/services/analytics.js`, the following must still hold, and the tests assert most of them:

| Property | Fixture expectation |
| --- | --- |
| Available hours for a 40 h/week full-time person, 21 weekdays | 168 h |
| Available hours for a 20 h/week part-time person, 21 weekdays | 84 h (weekly hours used as-is, never multiplied by FTE again) |
| Allocated hours for 20 h/week over 21 weekdays | 84 h |
| Available hours for 44 h/week | 184.8 h |
| Unallocated and over-allocated hours | Floored at zero **per person** before summing |
| Utilisation with no timesheet rows | `null`, never `0` |
| Allocation and utilisation | Never summed, never substituted for each other |
| Gross margin | Only when revenue, workforce cost and expenses all exist |

The canonical descriptions live in `GET /api/analytics/definitions` and on the Metric definitions screen. **If you change a formula, change the definition text in the same commit** — otherwise the interface starts lying about the product.

---

## 8. Working with the AI layer

`server/services/grounding.js` builds the fact pack (permission-filtered). `server/ai/assistant.js` composes answers deterministically. `server/ai/provider.js` is the optional external model with numeric verification.

Rules:

1. The composer may only interpolate values that exist in the fact pack.
2. If a fact is missing, return `insufficient(...)` with a reason — never a zero or a guess.
3. Any new intent needs a test that proves it refuses when its data is absent.
4. Never pass raw rows to a model. Aggregates only.
5. Never add an AI capability without walking the checklist in `docs/07-ai-governance.md` §12.

---

## 9. Testing

```bash
npm test                          # all six suites, concurrency 1
node --test --test-concurrency=1 tests/03-analytics.test.js   # one suite
npm run test:report               # full run + regenerate docs/test-report.md
```

`tests/helpers.js` boots the real Express app against a temporary database in a fresh temp directory, seeds fixtures, listens on a random port, and gives you a cookie-jar client. Nothing is mocked — the tests exercise the same code path a browser uses.

When a test fails, decide honestly which is wrong:

- If the **product** is wrong, fix the product and add a regression test.
- If the **expectation** is wrong, fix the expectation and say so in the change history. Do not adjust the product to satisfy a mistaken test.

Both kinds of correction are recorded separately in `docs/14-change-history.md` §3 and §4, and that distinction is worth preserving.

---

## 10. Common first-week mistakes

| Mistake | Symptom | Fix |
| --- | --- | --- |
| Forgetting to invoke the transaction function | `run is not a function` | `tx(fn)()` |
| Binding a boolean | `SQLITE_RANGE` / bind error | `value ? 1 : 0` |
| Taking `org_id` from `req.body` | Cross-tenant leak (a failing tenancy test) | Use `req.orgId` |
| Returning 403 for a foreign record | Ids can be probed | Return 404 |
| Reading `process.env` in a React page | Value is `undefined` in the browser | Expose it from the API |
| Forgetting `--test-concurrency=1` | Intermittent port or file conflicts | Pass the flag |
| Editing an applied migration | Existing databases diverge | Add a new migration |
| Changing a formula without changing its definition text | The product misdescribes itself | Update both, plus the test |

---

## 11. Reading list, in the order it is useful

| Order | Document | Why |
| --- | --- | --- |
| 1 | `docs/01-product-requirements.md` | What it is meant to do, and what it deliberately does not do |
| 2 | `docs/02-architecture.md` | How the pieces fit, and the eight architectural decisions |
| 3 | `docs/03-data-dictionary.md` | Every table and column, with plain-English purpose |
| 4 | `docs/04-api-documentation.md` | Every endpoint, envelope and error code |
| 5 | `docs/06-security-design.md` | The controls, and the gaps stated openly |
| 6 | `docs/07-ai-governance.md` | What the AI may and may not do |
| 7 | `docs/09-deployment-and-backup.md` | Install, back up, restore, upgrade |
| 8 | `docs/10-user-and-admin-guide.md` | How the product is actually used |
| 9 | `docs/12-risk-register.md` | What can go wrong and what is already done about it |
| 10 | `docs/test-report.md` | The real, current test results |

---

## 12. Definition of done for any change

- [ ] The behaviour works through the API, not only in the interface.
- [ ] The permission is enforced on the server, and a test proves an under-privileged call is refused.
- [ ] A cross-tenant call is refused (404) where the change touches identifiable records.
- [ ] State changes are audited.
- [ ] Numbers are traceable to a documented formula, and the definition text matches.
- [ ] Missing data produces an honest response, not a zero.
- [ ] The relevant document is updated (API, data dictionary, PRD status, change history).
- [ ] `npm test` passes with zero failures, and `npm run test:report` is regenerated if results changed.
- [ ] No secret, credential or customer data is in the diff.
