# WorkforceIQ — Assumptions Register

**Version:** 1.0
**Last updated:** 2026-11-10

---

## 1. Why this register exists

Every product rests on beliefs that have not yet been proven. Written down, they can be tested, priced and retired. Left implicit, they become the reason a launch fails quietly.

Each assumption below has: an identifier, the assumption stated plainly, how confident we are, how it could be proven or disproven, what happens if it is wrong, and the current status. **Nothing here has been validated with a paying customer, because there is no paying customer yet.** No assumption in this register should be read as a validated fact.

Confidence scale: **Low** (a guess), **Medium** (reasonable but untested), **High** (strong structural reason to believe it, still untested with customers).

---

## 2. Market assumptions

| ID | Assumption | Confidence | How to test | If wrong | Status |
| --- | --- | --- | --- | --- | --- |
| M-01 | Mid-sized services firms (50–2,000 people) cannot answer "where is our bench and what is it costing" from their existing tools without manual spreadsheet work. | High | Five discovery interviews; ask to see how the last month's view was produced | The product solves a solved problem and has no wedge | Untested |
| M-02 | The pain is concentrated in the monthly reporting ritual, not in daily execution. | Medium | Interview operations heads about when the argument happens | The buyer will be an operations tool, not an intelligence tool, and the design must change | Untested |
| M-03 | Definition disputes (allocation vs utilisation, which working days, whose FTE) are a genuine recurring cost and not a procurement excuse. | Medium | Ask three finance leads to define utilisation independently; compare | A key differentiator is worth less than assumed | Untested |
| M-04 | The willingness to pay sits with the COO or delivery head, not with IT. | Medium | Track who replies to outreach and who asks for the price | Sales motion changes entirely | Untested |
| M-05 | IT services, BPO and GCC buyers have materially different needs. | High | Compare discovery notes across the three segments | One product with three emphases is over-built; narrow to one segment | Untested |

## 3. Product assumptions

| ID | Assumption | Confidence | How to test | If wrong | Status |
| --- | --- | --- | --- | --- | --- |
| P-01 | Customers can supply, from existing systems, the seven data sets the product needs (employees, skills, projects, demand, allocations, timesheets, invoices/expenses). | Medium | Ask for the files during a trial, not after | The product's first-run experience is the blocker, and an integration becomes mandatory before value is delivered | Untested |
| P-02 | Customers will accept file upload rather than a live integration for the first six months. | Medium | Offer both in conversation; see which is demanded | Sales cycle lengthens and integrations become release-blocking | Untested |
| P-03 | Six months of historical timesheets is enough to make the first report meaningful. | Medium | Ask a trial customer to upload and report whether the output is credible | The first impression is thin data, and a "cold start" mode is needed | Untested |
| P-04 | A manager will read a dashboard for ten minutes a month rather than wanting a scheduled email digest. | Low | Observe an actual month-end session | Email delivery becomes the highest-value feature, and it is currently not built | Untested |
| P-05 | Publishing fixed metric formulas is a selling point rather than a blocker. | High | Offer the argument in sales conversations; watch for "can we change the formula" objections | Configurable formulas must be considered, with the drift risk managed differently | Untested |
| P-06 | Over-allocation and bench shown side by side is understood without explanation. | Medium | Watch a first-time user read the dashboard without help | The interface needs more guided interpretation | Untested |
| P-07 | The eight reports cover most asks from finance and delivery. | Low | Log actual report requests in a trial | A custom report builder becomes necessary | Untested |
| P-08 | Demand records will be maintained by project managers. | Low | Check whether demand data is refreshed in a trial | Coverage analysis becomes stale and is ignored | Untested |

## 4. Technical assumptions

| ID | Assumption | Confidence | How to test | If wrong | Status |
| --- | --- | --- | --- | --- | --- |
| T-01 | A single SQLite-backed node handles the target customer size (up to ~2,000 employees) with acceptable response times. | High | Load test at 1,000 and 2,000 employees with realistic timesheet volumes | Move to Postgres earlier than planned; the data layer is isolated for this reason | **Untested at scale** — measured only at demo size (46–87 employees) |
| T-02 | Customers will accept a self-hosted or single-VM deployment rather than requiring a multi-tenant cloud service. | Medium | Ask during procurement; check whether IT will host it | A hosted multi-tenant build with per-tenant isolation, billing and uptime obligations becomes necessary | Untested |
| T-03 | The deterministic local AI engine is good enough that customers do not immediately demand a hosted LLM. | Medium | Show both; measure whether the structured answer satisfies | The external-provider path becomes the default, and cost/privacy trade-offs must be re-priced | Untested |
| T-04 | Excel and CSV are the real-world interchange formats for this data. | High | Inspect real exports during discovery | An API integration layer is required | Untested with customer files |
| T-05 | Column-mapping suggestions from a declared alias list will cover most real files without manual mapping. | Medium | Test against ten real customer exports | Mapping becomes a friction point and a "save this mapping" feature is needed | Untested with customer files |
| T-06 | The audit trail volume is manageable (roughly one row per user action). | High | Project: 50 users × 40 actions/month ≈ 2,000 rows/month | Archiving or partitioning becomes necessary | Estimated, not measured |
| T-07 | 12-hour sessions and no MFA are acceptable for the first customers. | Low | Ask directly in a security review | MFA and SSO become release-blocking, which they currently are not built | Untested |
| T-08 | The backup procedure (daily file-level backup) satisfies customer recovery expectations. | Low | Ask for a stated RPO during procurement | Continuous archiving or a managed database becomes necessary | Untested |
| T-09 | Reports up to a few thousand rows can be generated in-process without blocking. | Medium | Measure report generation at 2,000 employees | Report generation must move to a worker | Unmeasured |
| T-10 | Formula-injection protection on CSV export is sufficient (prefixing dangerous leading characters). | High | Adversarial test with a spreadsheet | Additional sanitisation is required | Implemented; adversarially tested only by inspection |

## 5. Commercial assumptions

| ID | Assumption | Confidence | How to test | If wrong | Status |
| --- | --- | --- | --- | --- | --- |
| C-01 | A monthly subscription in the range currently encoded in the product's plan tiers — ₹25,000 (Starter), ₹45,000 (Professional), ₹90,000 (Enterprise) per month, with optional setup fees of ₹0 / ₹25,000 / ₹60,000 — is in the buyer's budget for this problem. These are configurable placeholders, not validated prices. | **Low** | Present pricing in three conversations and observe the reaction | The model must change (per-employee, per-module, or services-led), and the plan tiers are placeholders precisely because of this | Untested |
| C-02 | The ₹5,00,000 monthly revenue target is reachable through a small number of mid-sized accounts rather than many small ones. | **Low** | Model both motions against real pipeline | The go-to-market must be rebuilt around a different segment | Untested |
| C-03 | **The ₹5,00,000 monthly revenue figure is an aspiration, not a forecast.** It has no supporting pipeline, no signed contracts and no customer evidence. | n/a | It can only become a forecast once there is a pipeline with named opportunities and a conversion rate | Presenting it as a forecast would be a fabricated claim | Standing statement |
| C-04 | A free trial with the customer's own data converts better than a demo dataset. | Medium | Run both; compare | Demo-led selling becomes the primary motion | Untested |
| C-05 | Customers will pay for the AI modules separately from the core analytics. | Low | Test module-level pricing against a bundled price | Bundling is simpler and module pricing should be dropped | Untested |
| C-06 | No paid third-party service is needed to deliver the first ten customers. | High | Track every infrastructure and API cost as it appears | Hosting or email costs reduce margin and must be priced in | Holding so far: the product requires no paid service to run |

## 6. Operational and delivery assumptions

| ID | Assumption | Confidence | How to test | If wrong | Status |
| --- | --- | --- | --- | --- | --- |
| O-01 | Onboarding a new customer takes hours, not weeks, because the import pipeline does the work. | Medium | Time the first real onboarding end to end | A services-led onboarding becomes necessary, changing the cost model | Untested |
| O-02 | Customers will nominate an administrator who can define structure, roles and data ownership. | High | Ask during contracting | Implementation support becomes mandatory per customer | Untested |
| O-03 | The 15-document pack is enough for procurement without a bespoke security questionnaire response each time. | Low | Send the pack in a real procurement and record the gaps | A structured questionnaire response library is needed | The pack is complete but has not been through procurement |
| O-04 | One support person can handle ten mid-sized accounts with this feature set. | Low | Measure actual ticket volume in a trial | Support cost changes the pricing floor | Untested |

## 7. Assumptions that are *not* being made

Stated explicitly, because each is a common shortcut this product declines to take:

| Not assumed | Why it matters |
| --- | --- |
| That demonstration figures are evidence of customer outcomes | The demo tenants are fictional. Any pitch using their numbers as results would be a fabricated claim. |
| That a perfect product sells itself | Nothing in this build implies demand. Demand must be discovered. |
| That "AI" in the name increases willingness to pay | The AI is deliberately narrow; it is a quality feature, not a pricing lever until proven. |
| That customers will tolerate the missing MFA and SSO indefinitely | These are pre-requisites for enterprise deals, not nice-to-haves. |
| That the founder's time is free | Support and onboarding effort must be counted against margin from the first customer. |
| That the ₹5,00,000 monthly target reflects any market research | It is the founder's planning anchor. |

## 8. Review cycle

This register is reviewed:

- whenever a customer conversation materially confirms or contradicts an assumption (record which one, and the date);
- at the end of each trial (update confidence and status);
- before any pricing change;
- before any claim is made in sales material about results, savings or outcomes.

A confirmed assumption moves out of "untested" and is recorded with its evidence. An assumption that is disproven is not deleted — it stays, marked disproven, because the reason a belief failed is more useful than the belief.
