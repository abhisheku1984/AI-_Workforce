# WorkforceIQ — UX Guide and User Journeys

**Version:** 1.0
**Last updated:** 2026-11-10

---

## 1. Design principles

The interface is built for a manager who has fifteen minutes between meetings and no patience for a dashboard that raises more questions than it answers.

| Principle | What it means in practice |
| --- | --- |
| **Every number is labelled** | A figure is never on screen without a name, a unit and a way to learn how it was calculated. Where a metric is ambiguous (allocation vs utilisation), the label says which it is. |
| **Plans, actuals and estimates are visually distinct** | Allocation (a plan), timesheets (actual work) and forecasts (estimates) never share a colour or a card without a qualifier. They are never added together. |
| **Blank is not zero** | When data is missing the interface shows "no data" with the reason, never `0%`. A zero that means "we don't know" is a lie a manager will act on. |
| **The interface never promises what the server won't do** | Buttons exist only where an endpoint exists and the caller has the permission. There are no placeholder buttons, no "coming soon" tiles, no menus that do nothing. |
| **Say what happened, in business language** | Errors read like "Weekly hours must be between 0 and 80", not "422 Unprocessable Entity". |
| **Explain, then offer the next step** | Every insight and assistant answer ends with a concrete next action, or with an explicit statement of what is missing. |

---

## 2. Screen inventory

Eighteen screens (seventeen plus the sign-in page), all reachable from the left navigation except sign-in and the two personal pages, which are reached from the account menu. The navigation itself is filtered by permission, so a viewer sees six items and an administrator sees thirteen.

| Screen | Route | Who sees it | Primary question it answers |
| --- | --- | --- | --- |
| Sign in | `/login` | Everyone | — |
| Dashboard | `/` | Utilisation or executive permission | How is the business doing this month, at a glance? |
| Workforce | `/workforce` | `workforce.view` | Who do we have, where are they, what do they cost? |
| Utilization | `/utilization` | `analytics.utilization` | Where is capacity going, and where is it idle? |
| Projects & Demand | `/projects` | `project.view` | What work is committed, and what staffing is still unfilled? |
| Allocation | `/allocation` | `allocation.view` | Who is planned onto what, and does the plan fit? |
| Finance | `/finance` | `finance.view` / `workforce.cost.view` | What are we spending, invoicing and keeping? |
| AI Insights | `/insights` | `ai.insights` | What should management look at, and why? |
| AI Assistant | `/assistant` | `ai.assistant` | Ask a question in plain English. |
| Forecast | `/forecast` | `forecast.view` | Where is this heading, and how reliable is that? |
| Reports | `/reports` | `report.view` | Produce the file someone asked for, with lineage. |
| Data | `/data` | `import.manage` | Get spreadsheet data in, correctly, once. |
| Automation | `/governance` | `automation.manage` / `approval.manage` | What runs automatically, and what is waiting for my decision? |
| Administration | `/admin` | `org.view` / `user.view` / `audit.view` | Users, roles, structure, audit. |
| Settings | `/settings` | Signed in | Targets, cost basis, AI permissions, retention. |
| My account | `/account` | Signed in | My password, my roles, my scope. |
| Notifications | `/notifications` | Signed in | What has happened that involves me? |
| Metric definitions | `/metrics` | Signed in | What exactly does each number mean? |

---

## 3. Journey 1 — First day: an administrator sets the organisation up

**Persona:** Priya, operations head at a 120-person services firm. She has bought a trial. She has an Excel file of employees and no time.

```
1. Receives a sign-in email with a temporary password
2. Signs in → forced to set a new password before anything else (no route around it)
3. Lands on an empty dashboard that says "No data yet" and explains the two-step next action
4. Administration → Structure: creates 2 business units, 6 departments, 3 locations
     · each location asks for hours per day and working days — the capacity engine needs this
5. Administration → Users: invites the COO (executive), the finance controller (finance),
   the resourcing lead (workforce_manager, scoped to one business unit)
6. Data → Upload Employees: downloads the template, fills it, uploads
     · the mapping screen pre-selects 18 of 19 columns; she confirms the mapping
     · validate shows 3 rows with a bad join date and 1 duplicate employee code
     · she downloads the error report, fixes the file, re-uploads, validates clean, commits
7. Uploads Projects, then Allocations, then Timesheets for the last 6 months
8. Opens the Dashboard: headcount, utilisation, bench and cost appear, with a freshness line
9. Generates insights and reads the first recommendation
```

**Design decisions that make this work:**

- The forced password change is a gate, not a reminder. A temporary credential cannot be used to browse data.
- The mapping screen shows which target fields are **unmatched** and which source columns were **ignored**, so nothing is silently dropped.
- Validation runs before any write. The commit button is disabled until validation passes, and the reason is stated on the button.
- The empty dashboard tells her what to do next rather than showing zeros.

**What she cannot do, and is told plainly:** connect her HRMS, enable email notifications, or turn on single sign-on. The Settings screen lists these as not available in this release.

---

## 4. Journey 2 — Monthly ritual: the COO looks at the month in ten minutes

**Persona:** Ravi, COO. First Tuesday of the month, coffee in hand.

```
1. Signs in → Dashboard, current month
2. Reads five headline tiles:
     Headcount 61 · Available 10,072 h · Utilisation 79.5% · Allocated (plan) 89.7% · Bench 2,478.8 h
3. Notices "23 people over-allocated (+1,438.8 h)" in danger colour next to "3 people with no allocation"
4. Clicks the over-allocation tile → Utilization screen, filtered to over-allocated people
5. Sees the department chart and the top-10 over-allocated list; opens one person's drawer
6. Constraint found: their 96% allocation is really three overlapping projects, one ending in 12 days
7. Returns to the Dashboard and reads the open recommendation:
     "23 people are over-allocated — evidence: 1,438.8 h above capacity across 4 departments…"
8. Acknowledges the insight with a note ("Review in Thursday's delivery call") — recorded with his name and time
9. Downloads the department utilisation report as Excel for the board pack — the file carries the
   organisation, generator, timestamp, period and the formulas used
```

**Why the two numbers sit side by side:** over-allocation and bench are different problems with different fixes. Showing only the net figure would hide both.

---

## 5. Journey 3 — "Why is my bench expensive?" — asking the assistant

**Persona:** Meera, finance controller. She wants a number, not a chart.

```
1. AI Assistant → types: "Where is our unallocated capacity concentrated and what is it costing us?"
2. The assistant answers in three sentences:
     · names the top department, its unallocated hours and its allocation %
     · gives the idle workforce cost with the currency
     · states the limitation: "Cost is available for 58 of 61 people; the remaining 3 have no cost data,
       so the figure is a floor, not a final number."
3. Below the answer, an Evidence panel lists each figure used with its basis
4. An "Assumptions" line and a "Limitations" line are always present, even when empty-adjacent
5. She clicks "Show the facts used" → sees exactly the aggregate fact pack the answer was built from
6. The footer reads: "Answered by the local grounded engine. No data left this server."
```

**Deliberate refusal behaviour she will also see:** asking "what will our utilisation be next quarter?" in the assistant returns an honest "that is a forecast; the Forecast screen produces it and will tell you whether there is enough history". Asking about a competitor returns a refusal.

---

## 6. Journey 4 — A resource manager places a person without over-committing them

**Persona:** Suresh, resourcing lead.

```
1. Allocation → filters to next month, sorts by unallocated hours
2. Opens "What if" scenario: project = Atlas Migration, 40 h/week, 4 weeks, skill = Java
3. Gets a ranked list of candidates with reasons ("82% allocated next month", "Java at level 4")
   and warnings ("already 20 h/week on another project in the same window")
4. Picks a name → the panel shows the capacity maths before saving:
     standard 40 h, existing 20 h, combined 60 h = 150% → blocked with an explanation
5. Reduces to 16 h/week → allowed, with a warning that the person is now at 90% and will show
   as over-allocated if the other project extends
6. Saves. The allocation is written, audited, and appears immediately in the utilisation report
7. Because the change moves the person above target, she uses "Request approval" on the allocation,
   which raises a request for the delivery head with the numbers attached; he decides it in
   Automation → Approvals (the platform does not decide placement on its own)
```

**Guardrails the user experiences as help, not obstruction:** the 150% ceiling, the overlap warning and the on-request approval all exist because committing a person beyond their capacity is the exact failure this product is meant to prevent. Placement itself is always a human decision — the scenario panel only suggests.

---

## 7. Journey 5 — Loading a messy spreadsheet

**Persona:** an analyst with an export from three different systems.

```
Upload → "18 of 19 fields matched" banner, one unmatched source column called "Grade Comment"
       → she maps "Grade Comment" to nothing (or creates the mapping) and sees it will be ignored
Validate → 214 rows: 198 valid, 12 warnings (missing location — defaults applied), 4 errors
         → error table is filterable by severity and by field
Download error report → CSV with row numbers and the original raw values
Fix in Excel → re-upload → the system recognises the identical rows but not the identical file
             (checksum differs) → validates clean → commit
Commit → "198 created, 0 updated, 16 skipped. Version history recorded."
       → 3 insights were regenerated as a result
```

If she re-uploads the **same** file twice by accident, the system refuses with a clear message and offers a deliberate override, because a silent double count is worse than an extra click.

---

## 8. Journey 6 — An approval that must involve a human

**Persona:** an administrator has configured a rule "Month-end utilisation report" with approval required.

```
Run → the system does NOT execute. It creates approval #31 and notifies admins and executives.
Automation → Approvals → the COO sees the request with the rule name, the action, the risk level
   and the exact parameters.
COO approves with a note → the action executes → the run is recorded with the approver, the
   timestamp, the result and a link to the generated report.
```

**What the product refuses:** the person who requested the approval cannot approve it (`SELF_APPROVAL`), the same rule for a data-deletion request requires a *second administrator*, and an approval for anything other than automation does not silently execute an action.

---

## 9. Journey 7 — When the data is not good enough

**Persona:** the founder opening a fresh trial with no timesheets.

```
Dashboard → utilisation tile reads "Not measurable" with the reason "no timesheet data for this period"
          → allocation tile still works, because allocations are a plan
Assistant → "How is utilisation trending?" → "There are no periods with timesheet data, so a trend
            cannot be calculated. Upload Timesheets from the Data page and ask again."
Forecast → refuses: "Only 0 months of complete utilisation history. At least 4 are required."
Insights → generates a DATA_QUALITY_INCOMPLETE recommendation naming the missing data sets
```

The product is designed to be honest at zero data rather than impressive and wrong.

---

## 10. Interaction and accessibility standards

| Standard | Implementation |
| --- | --- |
| Keyboard reachable | All controls are native buttons, links and inputs; a skip link jumps to main content. |
| Focus visible | Focus rings retained; drawers and menus close on route change and on Escape where applicable. |
| Labels | Every input has an associated label or accessible name; icon-only buttons carry `aria-label`. |
| Colour is never the only signal | Severity is shown as a word plus a colour (for example "Over-allocated" in a red badge). |
| Loading and error states | Every data region has a loading skeleton, an empty state and an error state with a retry action. |
| Numbers are formatted | Indian digit grouping for INR, one decimal for percentages, thousands separators for hours. |
| Responsive | Sidebar collapses below 1024 px; tables scroll horizontally; drawers become full width. |
| Language | Business English, second person, no jargon without a definition on the same screen. |

**Known accessibility gap:** no formal WCAG 2.2 AA audit has been performed. This is recorded in the risk register and is a blocker for public-sector procurement.

---

## 11. Empty, error and edge states (the part most products skip)

| Situation | What the user sees |
| --- | --- |
| No permission for a screen | A panel explaining that the role lacks the permission, naming the administrator as the route to access, and stating that the server enforces the same rule. |
| API returns 403 with `required` | The missing permission is named, not a generic "forbidden". |
| Session expired | Redirected to sign in with a return path; no data loss on forms where avoidable. |
| Network failure | An error state with a Retry action, plus the server's message when there is one. |
| Empty list | A short explanation of what would appear here and which action creates the first record. |
| Partial financial coverage | The figure plus "based on 58 of 61 people with cost data". |
| Very large file | Refused at upload with the 20,000-row limit and the reason (validation speed, manageable errors). |
| Duplicate upload | Refused with the original import's date and a deliberate override. |
| Forecast with thin history | Refused with the requirement, the months available, and the actuals it does have. |

---

## 12. Language and labelling rules

1. **Never say "AI-powered" where the answer is arithmetic.** The assistant says "calculated from your data".
2. **Always name the period.** "November 2026", never "this month" without the resolved label.
3. **Always name the currency** on a money figure.
4. **Distinguish plan from actual in the label itself**: "Allocated (plan)", "Utilised (timesheets)", "Forecast (estimate)".
5. **Do not call bench "savings".** It is capacity being paid for and not billed; calling it a saving is a claim the product cannot support.
6. **Demo data is labelled as demo in the organisation name** — every demonstration tenant is named "… (Demo)" and its records carry `is_demo`.

## Navigation rail

The sidebar occupies real layout width on desktop, so it competes with dense tables and charts.
It collapses to a 68-pixel icon rail, and the choice is remembered per browser. When collapsed,
each icon exposes its label as a tooltip and to an accessible name, so the rail is not a guessing
game for screen-reader or keyboard users. The collapse control is hidden below the `lg` breakpoint,
where the navigation is an overlay drawer instead and space is not the constraint.

Icon sizes are set as SVG attributes rather than utility classes. A utility class that does not
exist in the design system compiles to no CSS at all, and an `<svg>` with no width falls back to
its 300×150 default — which silently consumes the entire sidebar. Attributes cannot go missing
in the same way.

## Sidebar positioning

The navigation is a **sticky** column on desktop: pinned to the viewport for the whole scroll,
never scrolling away with the content. A `static` sidebar reflows with a long page, so the
navigation disappears the moment a user scrolls a 300-row table — which is exactly when they
want to switch sections. `sticky` + `top-0` + `self-start` (so the grid does not stretch it)
gives a full-height panel that stays put. Its own menu list scrolls internally
(`overflow-y-auto`) if the viewport is shorter than the item count, so collapsing is never the
only way to reach the last item.
