# WorkforceIQ

**AI Workforce & Business Operations Intelligence Platform** — a multi-tenant SaaS product for IT services firms, BPO/contact centres and global capability centres.

WorkforceIQ answers the question a services business asks every month: *are the people we pay for working on things that make us money, and if not, where is the gap and what should we do about it?*

It replaces the monthly spreadsheet ritual with a system where every number has one published definition, every number is traceable to the file it came from, different roles see different slices enforced by the server, and the AI assistant is only allowed to repeat figures the platform has already calculated.

---

## Quick start

**On Windows, or running it on your own machine for the first time?** Follow
[`LOCAL-SETUP.md`](LOCAL-SETUP.md) — it has PowerShell commands, PyCharm setup and the
Windows-specific fixes. The short version:

```powershell
git clone -b arena/441f1caa-ai-workforce https://github.com/abhisheku1984/AI-_Workforce.git
cd AI-_Workforce
npm install
npm run migrate
npm run seed
npm run build
npm start            # http://localhost:4000
```

The same thing on macOS / Linux:

```bash
npm ci                       # install dependencies
npm run migrate              # create the database (38 tables)
npm run seed                 # create three fictional demonstration tenants
npm run dev                  # API on :4000, interface on :5173
```

If `npm run build` is blocked by a Windows security policy (Application Control can reject
Rollup's native binary), install the interface snapshot that ships with the repository instead:
`npm run use-prebuilt && npm start`. See [`LOCAL-SETUP.md`](LOCAL-SETUP.md) §7b.

`npm start` runs the built app on a single port (4000) and works on Windows, macOS and Linux:
the production start script sets `NODE_ENV` in JavaScript rather than using Unix-only
`VAR=value command` syntax, and generates a `SESSION_SECRET` into `.env` on first run if none
is set.

Open `http://localhost:5173` and sign in:

| Segment | Email | Password |
| --- | --- | --- |
| IT services | `admin@nexora-demo.example` | `DemoPass!2026` |
| BPO / contact centre | `admin@contactbridge-demo.example` | `DemoPass!2026` |
| Global capability centre | `admin@heliosgcc-demo.example` | `DemoPass!2026` |

Other roles per tenant: `coo@`, `finance@`, `wfm@`, `pm@`, `analyst@`, `viewer@`, `dept.manager@` the same domains.

> **All demonstration data is fictional.** Every demo tenant is named "(Demo)"; every demo employee row carries `is_demo = 1`. It is not customer data and must never be presented as evidence of results achieved anywhere.

### Production-like single-process run

```bash
npm run build                # compile the interface into dist/
SESSION_SECRET=$(openssl rand -hex 32) NODE_ENV=production npm start
```

The same process serves the API and the compiled interface from one origin on `:4000`.

---

## What is in the product

Twelve modules, all functional:

| Module | What it does |
| --- | --- |
| Organization & Administration | Structure, users, custom roles, settings, audit, entitlements |
| Data Ingestion | CSV/XLSX upload of eight entity types with mapping suggestions, row validation, error reports and lineage |
| Workforce Intelligence | People, skills, capacity inputs, permission-gated cost |
| Utilization Analytics | Available vs allocated vs utilised hours, bench, over-allocation, confidence flags, trend |
| Resource Allocation & Demand | Capacity-guarded allocations, demand records, coverage gaps, read-only scenarios |
| Financial Intelligence | Workforce cost, idle cost, revenue, expenses, gross margin with coverage disclosure |
| Executive Dashboards | One consistent payload per period with freshness indicators and definitions |
| AI Business Assistant | Grounded answers from the user's own permitted data, with evidence and limitations |
| AI Recommendations | Evidence-backed insights with a human review workflow |
| Forecasting | Trend forecasts with a minimum-history refusal and R² disclosure |
| Workflow Automation | Five safe actions, approval-gated, fully logged |
| Reporting | Eight reports, CSV and XLSX, with lineage headers and per-report permissions |

Eighteen screens, permission-filtered navigation, and no placeholder buttons.

---

## What makes it defensible

- **Tenant isolation in three layers** — the tenant id comes from the session, is in the `WHERE` clause of every query, and a foreign record returns 404 rather than 403. Twelve automated checks assert the boundary.
- **Fixed, published formulas** — exposed at `GET /api/analytics/definitions` and on the Metric definitions screen, so two reports can never disagree about what utilisation means.
- **Plans, actuals and estimates are never mixed** — allocation is a plan, timesheets are actuals, forecasts are estimates. Utilisation is blank, not zero, when no timesheets exist.
- **The AI cannot invent a figure** — answers are composed from a permission-filtered fact pack; if an external model is ever enabled, every numeral in its output is verified against the facts or the prose is discarded.
- **Human approval for sensitive actions** — no self-approval anywhere; deletion needs two administrators; automation actions come from a closed list with no shell, no external call and no employment decision.
- **Everything is audited** — state changes, approvals, report generation, exports, AI queries and blocked injection attempts.

---

## Verification

```bash
npm test                     # six suites
npm run test:report          # rerun everything and regenerate docs/test-report.md
```

Current state: **6 suites, 101 test cases, 102 recorded behaviours, 0 failures**, against a real Express app and a real database. Details, including what the tests do not cover, are in [`docs/test-report.md`](docs/test-report.md).

---

## Documentation

Fifteen project documents plus a deployment guide, indexed in [`docs/README.md`](docs/README.md). Start with:

- [`docs/01-product-requirements.md`](docs/01-product-requirements.md) — including §7.3, the gaps a buyer must know before signing
- [`docs/02-architecture.md`](docs/02-architecture.md)
- [`docs/06-security-design.md`](docs/06-security-design.md)
- [`docs/15-onboarding-guide.md`](docs/15-onboarding-guide.md) — for engineers
- [`docs/09-deployment-and-backup.md`](docs/09-deployment-and-backup.md) — install, back up, restore

---

## Known limitations, stated plainly

| Not available | Impact |
| --- | --- |
| Multi-factor authentication | A stolen password is enough to sign in (mitigated by lockout, 12-hour sessions, revocation) |
| Single sign-on (SAML/OIDC) | Enterprise IT will usually require it |
| Email delivery | Notifications and password resets are in-app or administrator-driven |
| Scheduled automation | Rules run on demand or after an import |
| Live integrations (HRMS, Jira, SAP) | Data arrives by file; the import pipeline is the integration path |
| Multi-currency | One currency per organisation |
| Load, penetration and accessibility testing | No measured performance above demo scale; no third-party security or WCAG audit |

These are decisions and open gaps, not hidden defects. Each appears in the product documentation with the evidence that would justify closing it.

## Constraints this build respects

- No paid third-party service, cloud dependency or API is required to run the product.
- No secrets in the repository; configuration comes from environment variables only.
- No fabricated metrics, customers, testimonials, savings or test results anywhere.
- The ₹5,00,000 monthly revenue figure is an aspiration and a planning anchor — **not a forecast**.

## Stack

Node.js 20+ · Express 4 · SQLite (better-sqlite3, WAL) · React 18 · Vite 5 · Tailwind CSS 3 · Recharts. No ORM, no queue, no telemetry SDK, no external AI call by default.
