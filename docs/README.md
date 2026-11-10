# WorkforceIQ — Documentation Index

All fifteen project documents plus the deployment guide, in the order a reader should approach them.

| # | Document | What it answers |
| --- | --- | --- |
| 1 | [`01-product-requirements.md`](01-product-requirements.md) | What the product is, who it is for, every requirement with its status, and what is deliberately not built |
| 2 | [`02-architecture.md`](02-architecture.md) | How the system is shaped, the request lifecycle, the AI design, the scaling path and eight recorded architecture decisions |
| 3 | [`03-data-dictionary.md`](03-data-dictionary.md) | Every table and column, generated from the live schema, with plain-English purpose and the status vocabularies |
| 4 | [`04-api-documentation.md`](04-api-documentation.md) | Every endpoint, request shape, response envelope, error code and the tenant-isolation guarantees at the API level |
| 5 | [`05-ux-and-journeys.md`](05-ux-and-journeys.md) | Screen inventory, seven end-to-end user journeys, empty/error states, accessibility standards and language rules |
| 6 | [`06-security-design.md`](06-security-design.md) | Threat model, authentication, authorisation, tenant isolation, input handling, audit, AI security, and the residual risks stated plainly |
| 7 | [`07-ai-governance.md`](07-ai-governance.md) | What the AI may and may not do, how "no invented numbers" is enforced, and the checklist every future AI change must pass |
| 8 | [`08-test-plan.md`](08-test-plan.md) | The testing method, fixtures with hand-computed expectations, requirement traceability, defect severity, entry and exit criteria |
| 9 | [`09-deployment-and-backup.md`](09-deployment-and-backup.md) | Install, run as a service, TLS, provision a tenant, back up, restore, upgrade, roll back, troubleshoot |
| 10 | [`10-user-and-admin-guide.md`](10-user-and-admin-guide.md) | How to use every screen, plus the administrator's setup order, monthly rhythm, audit routine and housekeeping |
| 11 | [`11-assumptions-register.md`](11-assumptions-register.md) | Every belief the product rests on, with confidence, how to test it, and what breaks if it is wrong |
| 12 | [`12-risk-register.md`](12-risk-register.md) | Scored risks, current mitigations, contingencies, accepted risks, refusal points and an incident-response outline |
| 13 | [`13-roadmap.md`](13-roadmap.md) | What is next and why, what needs customer evidence first, what is in discovery, and what is deliberately not planned |
| 14 | [`14-change-history.md`](14-change-history.md) | What shipped, every defect found and fixed during the build, and the corrections made to test expectations |
| 15 | [`15-onboarding-guide.md`](15-onboarding-guide.md) | How a new engineer gets the product running, navigates the codebase, adds a feature and passes the definition of done |
| — | [`test-report.md`](test-report.md) | **Generated from a real run** of the test suites — the current, authoritative results |

---

## The three documents a buyer should read first

1. **Product requirements** — what the product does and, in §7.3, what it does not do.
2. **Security design** — the controls, and §11's honest list of residual risks.
3. **Test report** — proof that the assertions in the first two documents are tested, with the limitations of that testing stated in §6.

## The two documents that keep everyone honest

- **Assumptions register** — the beliefs nobody has proved yet.
- **Risk register** — the things that could end the business, with the mitigation that actually exists today rather than the one intended.

## A note on what these documents do not claim

- No customer results, savings, ROI or testimonials exist, because there are no customers.
- The demonstration tenants are fictional and are labelled as such in the product and in these documents.
- The ₹5,00,000 monthly revenue figure is the founder's planning anchor and is not a forecast.
- No penetration test, load test or accessibility certification has been performed; where those would ordinarily be cited, the gap is named instead.
