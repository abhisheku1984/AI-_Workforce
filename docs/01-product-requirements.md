# WorkforceIQ — Product Requirements Document (PRD)

**Version:** 1.0
**Status:** Built; awaiting market validation
**Owner:** Founder / Product lead
**Last updated:** 2026-11-10

---

## 1. In plain business language: what this is

WorkforceIQ is software that answers one question a services business asks every month:

> *"Are the people we pay for actually working on things that make us money — and if not, where exactly is the gap, and what should we do about it?"*

Today most firms answer that with a spreadsheet stitched together by an operations analyst. The spreadsheet breaks when people leave, when definitions drift, and when two departments disagree about what "utilisation" means. WorkforceIQ replaces that spreadsheet with a system where:

- every number has one fixed definition that is visible in the product;
- every number is traceable back to the file it came from;
- different roles see different slices, enforced by the server, not by hiding buttons;
- the AI assistant is only allowed to repeat numbers the system already calculated, and says so when it cannot answer.

It is a **multi-tenant SaaS product**: many customer organisations share one installation, and the architecture guarantees that one organisation's data cannot be seen by another.

---

## 2. The business problem

### 2.1 Who has the problem

| Segment | Typical size | Why it hurts |
| --- | --- | --- |
| IT services / software services firms | 50–5,000 employees | Bench cost is the single largest controllable expense; utilisation drives margin; reporting is manual and late. |
| BPO / contact centres | 100–10,000 agents | Shrinkage, ramp-up and attrition make capacity planning weekly, not monthly. |
| Global capability centres (GCCs) | 200–3,000 employees | Shared-service capacity is charged back to business units; nobody trusts the chargeback because the allocation logic is a black box. |

### 2.2 What goes wrong without a system

1. **Definition drift.** Finance computes utilisation on 8-hour days; delivery computes it on 8.5. The two numbers differ by 6% and the argument consumes a month.
2. **Allocation mistaken for work.** A consultant "allocated 100%" may bill 60%. Plans and actuals get added together and the result is fiction.
3. **Bench is invisible until it is expensive.** Unassigned people are noticed in the quarterly review, four weeks after the money was spent.
4. **Data entry is unvalidated.** A timesheet import with a bad date silently drops rows; the month looks better than it was.
5. **Access is uncontrolled.** Everyone downloads the full cost-per-person spreadsheet because there is no other way to run a report.
6. **AI tools hallucinate.** A general chatbot asked "how is my bench?" invents a plausible-sounding percentage, and someone acts on it.

### 2.3 What "solved" looks like

A general manager opens one screen on the 3rd of the month, sees utilisation, bench and margin with a delta against last month, clicks twice to see which departments and which people drive the gap, and reads a recommendation that cites the exact figures it used. No spreadsheet, no chasing, no argument about definitions.

---

## 3. Scope

### 3.1 Modules in this release

Twelve modules, all functional in this release unless marked otherwise.

| # | Module | Status | What it does |
| --- | --- | --- | --- |
| 1 | Organization & Administration | Functional | Structure (business units, departments, locations), users, custom roles, org settings, audit log, module entitlements. |
| 2 | Data Ingestion | Functional | CSV/XLSX upload of eight entity types, automatic column-mapping suggestions, row-level validation, error report download, commit with full lineage. |
| 3 | Workforce Intelligence | Functional | Employee records, skills, capacity inputs, cost fields (permission-gated). |
| 4 | Utilization Analytics | Functional | Available vs allocated vs utilised hours, allocation %, utilisation %, bench, over-allocation, confidence flags, trend. |
| 5 | Resource Allocation & Demand | Functional | Allocations with capacity guardrails, project demand records, demand coverage and gap analysis, "what if" scenario suggestions (suggestions only — nothing is written). |
| 6 | Financial Intelligence | Functional | Workforce cost, idle cost, invoiced revenue, expenses, billable value, gross margin — all permission-gated. |
| 7 | Executive Dashboards | Functional | One consistent dashboard payload per period, with metric definitions and data-freshness indicators. |
| 8 | AI Business Assistant | Functional (local provider) | Natural-language questions answered from the user's own permitted aggregate data, with evidence, assumptions and limitations. |
| 9 | AI Recommendations | Functional | Generated insights with evidence, impact, limitations and risks; review workflow (acknowledge / act / dismiss) that is audited. |
| 10 | Forecasting & Predictive Intelligence | Functional (restricted) | Linear-trend forecasts with R², explicit minimum history requirement, and refusal when history is insufficient. |
| 11 | Workflow Automation | Functional (narrow by design) | Rules with a closed list of safe actions, human approval for sensitive ones, and a full run trail. |
| 12 | Notifications & Approvals | Functional (in-app only) | In-app notifications and an approval inbox. Email is deliberately not wired (see §7.3). |

### 3.2 Explicit scope boundaries for this release

These are decisions, not omissions:

| Boundary | Reason |
| --- | --- |
| **No external AI service by default.** The assistant uses a deterministic local engine. An external model can be enabled by configuration only, and the customer's data is not sent unless an administrator switches it on. | Customer data protection, cost control, and the requirement that AI never invents a figure. |
| **No email sending.** Notifications are in-app. | Email requires a paid provider and a deliverability/consent process; neither is in budget yet. |
| **No SSO / SAML / SCIM / MFA.** Local passwords with scrypt hashing, lockout and session revocation instead. | Enterprise identity providers are a paid and contractual commitment. Documented as a gap for enterprise deals. |
| **No payroll processing, no employment decisions.** The platform reports and recommends; humans decide. | Regulatory exposure and the founder's governance rule that high-impact employment actions need human judgement. |
| **No outbound integrations** (Jira, Workday, SAP, HRMS). | Every integration is a separate commercial and technical commitment. Data arrives by file today; the import layer is the integration path. |
| **Single-node deployment.** SQLite with WAL, one application process. | Budget-constrained; SQLite handles this workload comfortably at the target customer size. Migration path documented. |
| **No mobile-native app.** Responsive web only. | Focus. |

---

## 4. Users and jobs to be done

| Role (system template) | Real-world person | Job to be done |
| --- | --- | --- |
| Organization Administrator (`org_admin`) | Ops head, IT admin, founding team | Set up the company, invite users, define who can see cost data, keep the audit trail clean. |
| Executive Leadership (`executive`) | CEO, COO, delivery head | See the whole business in one screen without asking anyone for a file. |
| Finance User (`finance`) | Finance controller, FP&A | Reconcile workforce cost to invoices and understand margin by department and project. |
| Workforce / Resource Manager (`workforce_manager`) | Resourcing lead, bench manager | Know who is free, who is overloaded, and place people without over-committing them. |
| Project Manager (`project_manager`) | Delivery manager | See own projects, own demand, own allocations. |
| Analyst (`analyst`) | Ops analyst, PMO | Slice the data, build the analysis, download the report. |
| Read-only User (`viewer`) | Department head, external stakeholder | Look at dashboards, change nothing, never see salary. |

Custom roles can be created with any subset of the 24 permissions.

---

## 5. Functional requirements

Requirements are numbered so tests, docs and change history can reference them. "MUST" is a release-blocking requirement; "SHOULD" is expected; "MAY" is optional.

### 5.1 Authentication and access

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| AUTH-1 | A user MUST sign in with email + password; passwords MUST be hashed with a per-user random salt (scrypt). | MUST | Done |
| AUTH-2 | Six consecutive failed attempts MUST lock the account for 15 minutes. | MUST | Done |
| AUTH-3 | A failed sign-in MUST NOT reveal whether the email exists. | MUST | Done |
| AUTH-4 | Sessions MUST be server-side revocable; sign-out MUST invalidate the session immediately (not just clear the cookie). | MUST | Done |
| AUTH-5 | Changing a password MUST revoke all other sessions for that user. | MUST | Done |
| AUTH-6 | A user created by an administrator MUST be forced to change the temporary password at first sign-in. | MUST | Done |
| AUTH-7 | Permissions MUST be enforced on the server for every endpoint, independently of what the interface shows. | MUST | Done |
| AUTH-8 | Multi-factor authentication SHOULD be available. | SHOULD | **Not built** — see §7.3 |

### 5.2 Tenant isolation

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| TEN-1 | Every database read and write MUST be constrained by the organisation id taken from the authenticated session, never from the request body or query string. | MUST | Done |
| TEN-2 | A record belonging to another organisation MUST be indistinguishable from a record that does not exist. | MUST | Done |
| TEN-3 | Users with department or business-unit scoped roles MUST only see data inside that scope, and scope MUST be applied before any calculation. | MUST | Done |
| TEN-4 | Platform administration MUST be limited to provisioning and aggregate counts; it MUST NOT expose customer operational records. | MUST | Done |
| TEN-5 | Cost and compensation fields MUST be removed on the server for users without the cost permission. | MUST | Done |

### 5.3 Data ingestion

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| ING-1 | The system MUST accept CSV and XLSX up to 20 MB and 20,000 rows per file. | MUST | Done |
| ING-2 | Column mapping MUST be suggested automatically from a declared alias list and MUST be editable and auditable. | MUST | Done |
| ING-3 | Validation MUST report per-row, per-field errors with the original values, downloadable as a CSV error report. | MUST | Done |
| ING-4 | Data MUST NOT be written to the live tables until the file has been validated, and commit MUST be refused before validation. | MUST | Done |
| ING-5 | An identical file (same checksum) MUST be blocked as a duplicate at any stage except a discarded one, unless explicitly forced. | MUST | Done |
| ING-6 | Every commit MUST be a single database transaction; a failure MUST leave no partial data. | MUST | Done |
| ING-7 | Every changed record MUST keep a prior-version snapshot. | MUST | Done |
| ING-8 | Committed imports MUST NOT be deletable; removal MUST require a second administrator's approval. | MUST | Done |

### 5.4 Analytics

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| ANA-1 | Allocation (a plan) and utilisation (actual work) MUST be calculated separately and never summed or substituted. | MUST | Done |
| ANA-2 | Utilisation MUST be blank/null when no timesheet data exists, never zero. | MUST | Done |
| ANA-3 | Available hours MUST exclude weekends by default, exclude location holidays, and exclude time outside a person's join/exit window. | MUST | Done |
| ANA-4 | An explicit contracted weekly-hours figure MUST be used as-is and MUST NOT be multiplied by FTE again. | MUST | Done |
| ANA-5 | Over-allocation and unallocated capacity MUST be floored at zero per person, so one person's over-allocation cannot hide another's bench. | MUST | Done |
| ANA-6 | Every metric MUST have a definition retrievable from the product and shown next to the number. | MUST | Done |
| ANA-7 | Totals MUST state data coverage (for example, how many people have cost data) instead of silently averaging. | MUST | Done |

### 5.5 AI assistant and recommendations

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| AI-1 | The assistant MUST answer only from a fact pack built with the requesting user's permissions. | MUST | Done |
| AI-2 | The assistant MUST NOT invent a figure; every number in an answer MUST be traceable to the fact pack. | MUST | Done |
| AI-3 | When the facts do not support an answer, the assistant MUST say what is missing rather than guess. | MUST | Done |
| AI-4 | Text that attempts to change the assistant's instructions MUST be detected, refused and logged. | MUST | Done |
| AI-5 | No external model MUST be contacted unless the customer explicitly configures one; the answer MUST state when no external call was made. | MUST | Done |
| AI-6 | Employee names MUST be withheld from any external model unless the customer opts in. | MUST | Done |
| AI-7 | Every insight MUST carry evidence, assumptions, limitations and a risk note; insights MUST be reviewable and the review MUST be audited. | MUST | Done |
| AI-8 | The assistant MUST refuse questions outside its domain (for example general knowledge or advice) rather than improvising. | MUST | Done |

### 5.6 Forecasting

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| FOR-1 | A forecast MUST be refused with an explicit reason when fewer than four complete months of history exist. | MUST | Done |
| FOR-2 | A forecast MUST state its method, R² and limitations, and MUST be labelled an estimate. | MUST | Done |
| FOR-3 | A forecast MUST NOT extrapolate beyond the observed range without clamping. | MUST | Done |
| FOR-4 | Cost forecasts MUST require the cost permission. | MUST | Done |

### 5.7 Automation, approvals and governance

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| GOV-1 | Automation actions MUST come from a closed allow-list with no shell, no external call and no employment or financial decision. | MUST | Done |
| GOV-2 | A rule marked sensitive MUST create an approval request and MUST NOT execute until a human who is not the requester approves. | MUST | Done |
| GOV-3 | Self-approval MUST be refused in every approval flow. | MUST | Done |
| GOV-4 | Every automated run MUST record initiator, approval, result and timestamp. | MUST | Done |
| GOV-5 | Every state-changing action and every sensitive read MUST be written to an append-only audit trail. | MUST | Done |
| GOV-6 | Data deletion MUST require a second administrator and MUST be recorded. | MUST | Done |
| GOV-7 | A full export of a tenant's own data MUST be available to its administrator. | MUST | Done |
| GOV-8 | A newly created rule MUST be disabled by default. | MUST | Done |

### 5.8 Reporting

| ID | Requirement | Priority | Status |
| --- | --- | --- | --- |
| REP-1 | Reports MUST be downloadable as CSV and XLSX. | MUST | Done |
| REP-2 | Every generated file MUST carry lineage: organisation, generator, timestamp, period, metric definitions. | MUST | Done |
| REP-3 | A report file MUST only be downloadable by a user of the organisation that generated it. | MUST | Done |
| REP-4 | Report generation MUST be permission-checked per report (cost and audit reports are separately gated). | MUST | Done |

---

## 6. Non-functional requirements

| Area | Requirement | Status |
| --- | --- | --- |
| Performance | Dashboard payload under 1 second for 1,000 employees on a single node. | Met at demo scale (61–87 employees); 1,000-employee load not yet measured — see risk R-07. |
| Availability | Single node with restart; recovery from backup documented. | Process-level restart; no HA. |
| Security | Parameterised SQL everywhere, no secrets in code, HttpOnly SameSite cookies, security headers, no stack traces to clients. | Met; verified by tests. |
| Privacy | Personnel and cost data stay inside the customer's own deployment by default. | Met. |
| Auditability | Who did what, to which record, when, and from which address. | Met. |
| Explainability | Every screen explains its numbers; every AI answer cites evidence. | Met. |
| Accessibility | Keyboard-navigable, skip link, labelled form controls, sufficient contrast. | Partially met — no formal WCAG audit (risk R-09). |
| Localisation | Single currency per organisation, INR default, date/month formats fixed. | Met for single-currency; multi-currency is out of scope (risk R-10). |

---

## 7. What is deliberately NOT functional, and what it would take

This section exists because a product that hides its gaps is a product you cannot buy safely.

### 7.1 The ₹5 lakh per month revenue target

The founder's target of ₹5,00,000 monthly recurring revenue is an **aspiration and planning anchor, not a forecast**. Nothing in this document or the product should be read as a projection that it will be reached. Pricing fields in the product are configurable placeholders that have not been validated with a single paying customer.

### 7.2 The demo data

Three demonstration organisations ship with the product:

| Demo organisation | Segment it illustrates | Records |
| --- | --- | --- |
| Nexora IT Services (Demo) | IT services | 61 employees, 6 projects, 73 allocations, 14,858 timesheet rows |
| ContactBridge BPO (Demo) | Contact centre / BPO | 87 employees, 4 projects, 81 allocations, 20,233 timesheet rows |
| Helios Financial GCC (Demo) | Global capability centre | 46 employees, 4 projects, 48 allocations, 10,513 timesheet rows |

**This data is fictional, generated for demonstration, and marked as such in the database (`is_demo = 1`).** It is not customer data, not benchmark data, and must never be presented as evidence of results achieved at any real company.

### 7.3 Gaps a buyer must know about before signing

| Gap | Impact today | What closing it requires |
| --- | --- | --- |
| No SSO / SAML / OIDC | Enterprise IT will usually refuse; passwords are the only option. | Identity-provider integration effort plus per-provider testing. |
| No email delivery | Password resets and approvals are in-app only; an approver must be looking. | A transactional email provider (paid) plus consent and deliverability work. |
| No MFA | A stolen password is enough to sign in (mitigated by lockout and 12-hour sessions). | TOTP or WebAuthn implementation. |
| No scheduled automation | Rules run when a user clicks Run or after an import; there is no background scheduler. | A job runner (cron or in-process scheduler) plus timezone handling. |
| No data warehouse / BI connector | Export only. | Connector work per target. |
| Multi-currency not supported | One currency per organisation. | Currency model, FX source (paid), restatement rules. |
| No formal accessibility audit | Risk of failing a public-sector procurement. | Third-party WCAG 2.2 AA audit. |
| Load untested beyond demo size | Performance above ~2,000 employees is unknown. | A load-test harness and a performance budget per endpoint. |

---

## 8. Success measures

Deliberately measurable with what the product instruments, and stated as measures rather than promises:

| Measure | How it would be observed | Current state |
| --- | --- | --- |
| Time to first insight after upload | Timestamp of import commit vs. first insight generated, from the audit trail. | Path exists and is logged; no cohort data yet. |
| Percentage of months where cost data coverage is complete | `data_quality` report check "cost coverage". | Measured per tenant; no cross-tenant statistics exist. |
| Reduction in ad-hoc reporting requests | Not instrumented. Would need a support-request count. | Not measured. |
| Definition disputes | Anecdotal; the product eliminates them structurally by publishing formulas. | Not measured. |
| Trial-to-paid conversion | Not instrumented. | No customers yet. |

No claim in this document should be read as an achieved outcome. There are no customers, and therefore no customer results.

---

## 9. Release criteria

The release is considered shippable when:

1. All MUST requirements above are implemented. ✅ (7 SHOULD/MUST gaps listed in §7.3 are excluded from this release; AUTH-8 is SHOULD.)
2. The automated suite passes with zero failures. ✅ 93 test cases, 94 recorded behaviours, 0 failures — see `docs/test-report.md`.
3. The production build succeeds. ✅
4. Deployment, backup and restore are documented and have been executed at least once. ✅ documented; restore tested per `docs/09-deployment-and-backup.md`.
5. The 15 project documents are current. ✅
6. Every screen's numbers are explained in the product. ✅ Metric definitions page + per-figure help.

---

## 10. Decisions log (product-level)

| Decision | Alternative considered | Why this way |
| --- | --- | --- |
| Publish fixed metric formulas instead of letting customers redefine them | Fully configurable metric builder | Redefinable metrics recreate the definition-drift problem the product exists to solve. Targets and inclusion rules are configurable; formulas are not. |
| Blank utilisation instead of zero when no timesheets | Show 0% | 0% is a false statement about a person. Blank plus a stated confidence flag is honest. |
| Deterministic AI engine as the default | Ship with a hosted LLM | A hosted LLM costs money, ships personal data off-site by default, and can invent numbers. |
| Closed action list for automation | Generic "run script" action | A generic action is an arbitrary-code-execution feature with an audit problem. |
| Single-node SQLite | Postgres cluster | Cost and operational simplicity at the target size; the data access layer is isolated in one module so a move to Postgres is a contained change. |
