# WorkforceIQ — Roadmap

**Version:** 1.0
**Last updated:** 2026-11-10

---

## 1. How this roadmap is built

The roadmap is ordered by **what unblocks a paying customer**, not by what is technically interesting. Every item states the evidence that would justify building it. Items without evidence stay in "Discovery".

The ₹5,00,000 monthly revenue figure is a planning anchor, not a forecast, and nothing below claims it will be reached.

Status legend: **Shipped** (in this release) · **Next** (justified by known blockers) · **Later** (needs customer evidence) · **Discovery** (needs research before it becomes a commitment) · **Not planned** (deliberately excluded).

---

## 2. Where the product is today

All twelve modules exist and work. The verification run is 93 test cases across six suites with zero failures (`docs/test-report.md`). The honest characterisation is:

> A capable, self-contained analytics and governance product that a small services firm can install and run today, missing the enterprise identity and delivery features most mid-market buyers will ask for in a security review.

---

## 3. Next — unblocks a real deal

### N-1 — Multi-factor authentication (TOTP)

| | |
| --- | --- |
| **Why now** | It is the single most-requested control in any workforce-data security review, and it is the cheapest of the identity gaps to close. |
| **Scope** | Time-based one-time passcodes: enrolment with QR/secret, recovery codes, enforcement per organisation or per role, a reset path for administrators, and audit events for enrolment, use and reset. |
| **Definition of done** | A user without a second factor cannot sign in when their organisation requires it. Recovery codes work once each. Lost-device recovery requires an administrator and is audited. Tests cover enrolment, successful and failed verification, and reset. |
| **Effort** | Small (days, not weeks) — no new service dependency. |
| **Risk if skipped** | Deals stall at security review (R-02). |

### N-2 — Single sign-on (OIDC first, SAML second)

| | |
| --- | --- |
| **Why now** | Enterprise IT will not run a separate password store for a workforce tool. OIDC covers the common case (Entra ID, Google Workspace, Okta) with far less work than SAML. |
| **Scope** | OIDC authorisation-code flow with PKCE, per-organisation configuration, just-in-time user creation mapped to a default role, domain verification to prevent tenant hijacking, and a break-glass local administrator. |
| **Definition of done** | An organisation can require SSO; users are provisioned on first sign-in with the correct role; the local password path is disabled for that organisation except for one nominated break-glass account; every sign-in is audited. |
| **Effort** | Medium. |
| **Evidence needed** | One named prospect whose IT team states SSO is a condition of purchase. |

### N-3 — Email delivery for password resets and approvals

| | |
| --- | --- |
| **Why now** | Today an approver must be looking at the product. A pending approval nobody sees is a governance failure that the product itself creates. |
| **Scope** | A pluggable transactional mail transport (SMTP is free if the customer provides a relay; a hosted provider is a paid dependency and requires approval before use), templates for reset, invitation, approval pending and approval decided, per-organisation enablement, and a "no email in this environment" mode that stays the default. |
| **Definition of done** | A password reset can be completed without an administrator; approvals notify the right people; every send is logged; the product still works with email switched off. |
| **Effort** | Small-to-medium. |
| **Cost note** | **A hosted email provider is a paid third-party service and requires the founder's explicit approval before it is wired in.** SMTP through a relay the customer already owns avoids the cost entirely and is the preferred first path. |

### N-4 — Scheduled automation

| | |
| --- | --- |
| **Why now** | "Month-end report" is a calendar event. A rule that must be clicked is a reminder, not automation, and customers will notice. |
| **Scope** | An in-process scheduler with a durable lock so a rule fires once, timezone-aware monthly/weekly schedules, catch-up behaviour after downtime, and a visible next-run time. |
| **Definition of done** | A monthly rule fires unattended, records its run, respects the approval requirement, and does not double-fire after a restart. |
| **Effort** | Medium. |

---

## 4. Later — needs customer evidence first

| ID | Item | What evidence would justify it | Why it is not next |
| --- | --- | --- | --- |
| L-1 | **Postgres support and horizontal scaling** | A measured performance problem, or a customer above ~2,000 employees | Adds operational cost and complexity with no current user |
| L-2 | **Load and performance test harness published as a number** | A procurement asking for measured throughput | Needs a realistic dataset generator first; claiming performance without measuring it would violate the no-fabrication rule |
| L-3 | **Saved column mappings per file source** | A customer onboarding three or more recurring files | Mapping is already suggested; the friction is unproven |
| L-4 | **Custom report builder** | Two customers asking for a report not in the catalogue | Eight reports cover the known asks; a builder is a large surface |
| L-5 | **Demand-driven skill gap analysis** | Demand data actually being maintained in a trial (assumption P-08 is low-confidence) | The input is unreliable today |
| L-6 | **Scenario comparison ("save two plans, compare")** | Resourcing leads asking to compare options rather than see one suggestion | Current scenarios are suggestions only and are read-only by design |
| L-7 | **API keys for read-only integrations** | A customer wanting to pull figures into their own BI tool | Session-cookie-only auth is simpler and safer until there is a real integration requirement |
| L-8 | **Multi-currency** | A customer with a genuine two-currency payroll | Requires FX sourcing (paid) and restatement rules; data model already has a currency column |
| L-9 | **WCAG 2.2 AA audit and remediation** | A public-sector or regulated procurement | Needs an external audit budget |
| L-10 | **Third-party penetration test** | Before the first enterprise contract | Cost; internal suite exists but is not a substitute |
| L-11 | **Chargeback / showback reporting for GCCs** | A GCC customer asking to bill internal business units | Needs a cost-allocation model agreed with the customer's finance team |
| L-12 | **Automated retention enforcement** | Retention emerging in a compliance review | Settings are advisory today and stated as such |

---

## 5. Discovery — research before promising anything

| ID | Question | How to answer it | What it would change |
| --- | --- | --- | --- |
| D-1 | Which of the three segments (IT services, BPO, GCC) has the sharpest, most fundable pain? | Ten discovery conversations, five per segment; ask for the artefact they use today | Which one or two segments the product is aimed at, and which screens matter most |
| D-2 | Who signs, and what budget line does this come from? | Ask directly in every conversation | The pricing model and the sales motion |
| D-3 | Would a customer accept file upload indefinitely, or is integration a condition? | Ask what happens when the export format changes | Whether an integration layer is a later item or a prerequisite |
| D-4 | Does the deterministic AI engine satisfy, or is a hosted model demanded? | Show both, ask which they would trust | Whether to invest in model quality or in breadth |
| D-5 | What is the real first-month experience for a customer with two weeks of data? | Run a guided pilot and observe | Whether a "cold start" mode is needed before any selling |
| D-6 | Is the 15-document pack enough for procurement? | Send it through one real procurement | What documentation to add |

---

## 6. Not planned

Stated so nobody promises them by accident:

| Excluded | Reason |
| --- | --- |
| Payroll processing | Regulatory exposure, and it is not the problem being solved |
| Performance ratings, talent review or succession scoring | The product deliberately makes no judgements about individuals |
| Recruitment / applicant tracking | Different buyer, different data regime |
| Native mobile apps | A responsive web interface covers the need |
| A public marketplace of templates and connectors | Premature; nothing to trade yet |
| Any feature that ranks, scores or predicts an individual's performance, potential or attrition risk | Standing governance rule (`docs/07-ai-governance.md` §9) |

---

## 7. Sequencing logic, in one paragraph

Multi-factor authentication comes first because it is cheap and it unblocks security reviews. Single sign-on follows because enterprise IT insists on it. Email comes third because a governance product that quietly holds an approval nobody sees is failing at its own job. Scheduling comes fourth so that "automation" means automation. Everything else waits for evidence, because building features before customers is how a product becomes impressive and unsellable.

---

## 8. What would make this roadmap wrong

This roadmap assumes the product's shape is roughly right and the gaps are at the edges. It would be wrong if:

- discovery shows the data cannot be obtained (then the roadmap is about integrations, not features);
- discovery shows the buyer is a managed-service provider who wants to resell it (then the roadmap is about multi-tenancy controls and white-labelling);
- discovery shows customers only want a monthly PDF (then most of the product is unnecessary and a thin reporting service is the real product).

Each of these would invalidate the sequencing above, and the assumptions register is where that would be recorded first.
