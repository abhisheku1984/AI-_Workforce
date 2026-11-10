# WorkforceIQ — Risk Register

**Version:** 1.0
**Last updated:** 2026-11-10
**Owner:** Founder
**Review cycle:** monthly, and immediately after any incident

---

## 1. How risks are scored

| | **Impact: low** | **Impact: medium** | **Impact: high** |
| --- | --- | --- | --- |
| **Likelihood: high** | Medium | High | Critical |
| **Likelihood: medium** | Low | Medium | High |
| **Likelihood: low** | Low | Low | Medium |

Impact is judged on the business, not the code: a defect that loses a customer or breaches their data is high impact regardless of how small the fix.

Every risk has an owner (the founder, wearing a specific hat), a mitigation that exists **today**, and a response if it materialises. A risk whose mitigation is "we will do something later" is listed with that stated as the gap, not as a control.

---

## 2. Critical and high risks

### R-01 — No customer has validated the problem or the price

| | |
| --- | --- |
| **Category** | Commercial |
| **Score** | **Critical** — high likelihood, high impact |
| **Description** | The product exists; demand has not been demonstrated. All pricing is placeholder. If the problem is smaller than assumed or already solved by a spreadsheet plus a BI licence, there is no business. |
| **Why it is critical** | Every other risk is manageable if customers buy. None of them matter if none do. |
| **Current mitigation** | The assumption register makes each belief explicit and testable. The product can be demonstrated with realistic data in three segments. Nothing in any material claims outcomes or customers, so there is no credibility to lose. |
| **Contingency** | Narrow to one segment (most likely IT services), reprice to a single plan, and sell a focused pilot. |
| **Owner** | Founder (sales) |
| **Review** | Every customer conversation |

### R-02 — Sales cycle assumes IT and security approval that the product cannot yet pass

| | |
| --- | --- |
| **Category** | Commercial / technical |
| **Score** | **High** |
| **Description** | Enterprise and upper-mid-market buyers require SSO and MFA. Neither is built. A security review will surface this and stall the deal. |
| **Current mitigation** | The gaps are stated openly and early (`docs/06-security-design.md`, `docs/01-product-requirements.md` §7.3). Local authentication is solid (scrypt, lockout, revocation, audit), so the conversation is about missing features, not weak controls. |
| **Contingency** | Target buyers who will accept local auth for a pilot; implement TOTP first (smallest effort, largest coverage), then OIDC. |
| **Owner** | Founder (product) |
| **Review** | Before the first enterprise security questionnaire |

### R-03 — Customer data left accessible through a defect (cross-tenant or over-scope exposure)

| | |
| --- | --- |
| **Category** | Security / reputational |
| **Score** | **High** — low likelihood, high impact |
| **Description** | A future change adds a query without `org_id`, or a screen that filters in the browser instead of the server. One incident of this kind is existential for a workforce-data product. |
| **Current mitigation** | Three independent isolation layers (session-derived tenant, query-level `org_id`, schema shape). Twelve automated behaviours in `tests/02-tenancy.test.js` assert the boundary including 404-instead-of-403, org-context header rejection, scope-before-calculation and cost redaction. Cost fields are removed server-side. |
| **Contingency** | Incident runbook: identify the exposure window from the audit trail, notify the affected customers with facts, patch, add a regression test. |
| **Owner** | Founder (engineering) |
| **Review** | Every release — the tenancy suite must pass before deployment |

### R-04 — An AI answer states a figure that is wrong or invented

| | |
| --- | --- |
| **Category** | Product / trust |
| **Score** | **High** |
| **Description** | If a manager acts on a fabricated number, the product's core promise ("the AI never invents a figure") is broken, and that is the promise being sold. |
| **Current mitigation** | Answers are composed from a permission-filtered fact pack; the deterministic engine cannot produce a number outside it. If an external model is enabled, `verifyNumbers` re-checks every numeral and discards prose containing an untraceable one, logging the rejection. Evidence, assumptions and limitations are shown on every answer. Tests assert grounding, refusal on insufficient data, and rejection of invented figures. |
| **Contingency** | Disable the external provider by configuration; publish the audit record of the affected answers. |
| **Owner** | Founder (product) |
| **Review** | Every change to the AI layer against the governance checklist in `docs/07-ai-governance.md` §12 |

### R-05 — Forecast or insight misleads a customer into a wrong capacity decision

| | |
| --- | --- |
| **Category** | Product |
| **Score** | **High** — medium likelihood, high impact |
| **Description** | A straight-line forecast shown without context can be read as a commitment. A customer hires or cuts on the strength of it. |
| **Current mitigation** | Forecasts are refused below four months of history; method and R² are stated; limitations are mandatory; values are clamped to the observed range; the interface labels them as estimates. Insights require evidence, assumptions, limitations and risks, and are `NOT NULL` in the schema. Recommendations are reviewed by a human and the review is recorded. |
| **Contingency** | Add a confidence band and an explicit "do not use for headcount decisions" note if a customer is observed over-relying. |
| **Owner** | Founder (product) |
| **Review** | Each trial |

---

## 3. Medium risks

| ID | Risk | Category | Likelihood | Impact | Current mitigation | Contingency | Owner |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R-06 | **Onboarding stalls because the customer cannot produce the data files.** The product needs seven data sets; if employees can give only two, the first month shows nothing. | Product | Medium | High | Import templates, mapping suggestions, per-row error reports, and a data-quality insight that names what is missing. | Offer a guided first import as a paid service; consider a template-only "quick value" path using employees + allocations alone. | Founder (delivery) |
| R-07 | **Performance collapses at real customer scale.** Only 46–87 employee tenants have been exercised. A 1,000-employee tenant with dense timesheets is untested. | Technical | Medium | Medium | Indexed `org_id`-first queries; single dashboard payload instead of many calls; aggregation in SQLite rather than JavaScript. | Load-test harness; add caching of period aggregates; move report generation off the request path. | Founder (engineering) |
| R-08 | **Single-node failure takes the product down.** One process, one database file, one disk. | Operational | Medium | Medium | Systemd restart on failure; documented backup and restore; health endpoint for external monitoring. | Restore from backup (§8 of the deployment guide) and re-check dashboards against the last known values. | Founder (operations) |
| R-09 | **Accessibility shortfall blocks public-sector or large-enterprise procurement.** No WCAG 2.2 AA audit has been performed. | Compliance | Medium | Medium | Skip link, labelled controls, keyboard-reachable navigation, colour never the only signal, visible focus. | Commission an accessibility audit before bidding for regulated work; fix findings in priority order. | Founder (product) |
| R-10 | **Multi-currency customers cannot be served.** One currency per organisation. | Product | Medium | Medium | Stated as out of scope; the data model carries a currency column so a future change is contained. | Decline multi-currency deals until the feature exists; do not attempt manual workarounds with converted data, which would corrupt margin figures. | Founder (product) |
| R-11 | **The local AI engine proves too narrow and customers demand free-form answers.** | Product | Medium | Medium | Eleven intents cover the questions that matter; refusals are honest and name what can be asked; the external-provider path exists if a customer accepts the trade-offs. | Enable the external provider for that customer with signed data-handling consent; keep numeric verification mandatory. | Founder (product) |
| R-12 | **Audit trail is mutable by a host operator.** File-level database access defeats append-only semantics. | Security | Medium | Medium | Audit is written by the application for every state change; there is no delete endpoint; the trail is exportable for external retention. | Recommend shipping the `audit_trail` report to customer-controlled storage on a schedule. | Founder (engineering) |
| R-13 | **A customer's own export leaks sensitive cost data** because an administrator shared a full export. | Product / customer process | Medium | Medium | Cost fields require permission; full export requires `org.manage`; exports are audited. | Contractual guidance to customers on export handling; watermark report headers with the generator's identity (already present). | Founder (delivery) |
| R-14 | **Demonstration figures are mistaken for results.** Demo tenants are realistic enough to be quoted as outcomes. | Reputational | Medium | High | Every demo tenant is named "(Demo)"; `is_demo` is set on employee rows; the seeder prints a warning; no document presents them as results. | Correct any misuse immediately and publicly in the affected material. | Founder (sales) |

---

## 4. Low risks

| ID | Risk | Category | Mitigation |
| --- | --- | --- | --- |
| R-15 | Dependency vulnerability in an npm package | Technical | `npm audit` at deploy time; few runtime dependencies; no telemetry SDKs |
| R-16 | Report or upload directory fills the disk | Operational | Retention settings, `data-retention` screen, disk monitoring in the deployment guide |
| R-17 | Password reuse and no MFA allow account takeover | Security | Lockout, 12-hour sessions, revocation, audit; MFA on the roadmap as R-02's response |
| R-18 | Prompt-injection phrasing bypasses pattern detection | Security | Pattern detection is a speed bump; the structural control is that the fact pack is already permission-filtered |
| R-19 | A single developer is a bus factor of one | Operational | This documentation set, migrations under version control, a rebuild procedure, and a deployment guide that a competent engineer can follow |
| R-20 | Customers expect email notifications | Product | In-app only, clearly stated; email requires a paid provider and is not in budget |
| R-21 | Clock or timezone mismatch shifts "this month" | Technical | Period resolution is explicit and echoed in every response; timezone stored per organisation |
| R-22 | CSV formula injection via an uploaded value | Security | Leading `=`, `+`, `-`, `@` are escaped on export |
| R-23 | Retention settings are advisory, not enforced automatically | Compliance | Settings are visible and deletion is available with two-administrator approval; automated retention enforcement is not built and is stated as such |

---

## 5. Risks explicitly accepted, with the reason

| Accepted risk | Reason | What would change the decision |
| --- | --- | --- |
| No MFA in the first release | Scope and budget; the product is pre-revenue | Any enterprise security review |
| No SSO | Paid identity integration and per-provider testing | First upper-mid-market deal |
| No penetration test | Cost; internal review plus automated security suite performed instead | First enterprise contract, or any incident |
| Single-node deployment | Operational simplicity and cost at target size | Performance measured above the SQLite comfort zone |
| No external AI provider by default | Privacy, cost and accuracy | A customer with a signed data-handling agreement |
| Pricing is placeholder | No customer evidence yet | Three pricing conversations with real reactions |
| No load or penetration testing evidence | Not yet affordable | Before any claim of enterprise readiness is made |

---

## 6. Risks that must never be accepted

These are refusal points, not trade-offs. If any becomes necessary to win a deal, the deal is wrong.

1. Selling the product with a claim of achieved savings, ROI or results for a customer that does not exist.
2. Presenting the ₹5,00,000 monthly target as a forecast, in any document or pitch.
3. Sending a customer's employee or cost data to an external service without their explicit, recorded authorisation.
4. Removing tenant isolation, audit, or approval requirements to make a demo simpler.
5. Shipping a screen or button that does nothing.
6. Hardcoding a secret, or storing a password in a recoverable form.

---

## 7. Incident response (outline)

| Step | Action | Timeframe |
| --- | --- | --- |
| 1 | Contain: disable the affected route or configuration, or stop the service | Immediately |
| 2 | Preserve evidence: snapshot the database and logs before any repair | Within the hour |
| 3 | Assess scope from the audit trail (who accessed what, when) | Same day |
| 4 | Notify affected customers with facts: what happened, what data, what window, what has been done | Within 24 hours, or per contract |
| 5 | Fix, then add a regression test that would have caught it | Before restoring the feature |
| 6 | Write a short post-incident note: cause, effect, fix, and the test that now guards it | Within a week |

A full incident-response plan with named contacts is a contractual artefact and should be prepared with the first customer.
