# WorkforceIQ — User and Administrator Guide

**Version:** 1.0
**Last updated:** 2026-11-10
**Who this is for:** the people who use the product every day, and the person who sets it up and keeps it tidy

---

## Part 1 — Getting started (everyone)

### 1.1 Signing in

Open the address your administrator gave you. Enter your email and password.

- Your first password will be temporary. The product will not let you do anything until you choose your own, which is deliberate.
- Passwords need at least 10 characters, with a capital letter, a lowercase letter and a number.
- Six wrong attempts in a row lock the account for 15 minutes. If that happens, wait, or ask your administrator to reset it.
- Sessions last 12 hours. Signing out ends the session on the server immediately — a copied browser cookie stops working.

### 1.2 What you can see depends on your role

| If you are… | You can | You cannot |
| --- | --- | --- |
| Read-only user | See dashboards, workforce lists, projects, reports | Change anything; see salaries |
| Analyst | Everything a viewer can, plus utilisation detail and AI insights | See cost or finance; change records |
| Finance | Cost, revenue, margin, cost reports | Change workforce records |
| Workforce manager | Manage employees, skills and allocations within your area | See cost; see finance |
| Project manager | Manage your projects and demand | Change other departments |
| Executive | Whole business, including finance | Administer users |
| Administrator | Everything in your organisation, including users, roles, settings and audit | Access platform-level settings or other organisations |

If a screen you expect is missing from the menu, your role does not include it. Ask your administrator. The server enforces the same rule as the menu, so typing the address directly will not get you in.

### 1.3 The "how is this calculated?" habit

Every figure can be explained from inside the product:

- Hover or tap the small information marker next to a number for a one-line definition.
- **Metric definitions** in the account menu lists every measure, its formula and its notes.
- Reports include the definitions in the file header, so a number pasted into a board pack still carries its meaning.

---

## Part 2 — Using each screen

### 2.1 Dashboard

Five headline numbers for the selected period: headcount, available hours, utilisation %, allocated (plan) %, and bench. Below them: trend, department breakdown, over-allocated people, idle capacity, demand gaps and any open recommendations.

Read the two capacity numbers together. **Allocation** is what managers planned. **Utilisation** is what people recorded. A team can be 100% allocated and 70% utilised — that gap is the interesting part. The dashboard never adds them together.

The "as of" line at the bottom shows the last timesheet date, last import and when the numbers were generated. If those look stale, the data needs refreshing before you make a decision.

### 2.2 Workforce

A searchable list of people with department, location, status, capacity and, if you have the permission, cost.

- Click a person for their full record: capacity inputs, skills, current allocations and utilisation.
- Filters: search by name or code, department, business unit, location, status.
- Cost columns simply are not present for roles without the cost permission — they are removed by the server, not hidden on screen.
- Export to CSV honours your permissions too.

### 2.3 Utilization

The detailed capacity view. For each person: available hours, allocated hours, utilised hours, allocation %, utilisation % and a confidence flag.

- **Blank utilisation means no timesheet data**, not zero. If a person shows no utilisation, chase the timesheet before drawing a conclusion.
- **Confidence**: `full` (timesheet coverage is complete for the period), `partial`, or `none`.
- Over-allocated and idle lists are separate, because being over-committed and being idle are different problems with different fixes.
- The definitions panel under the figures is the same content as the Metric definitions page.

### 2.4 Projects & Demand

Every project with status, health, manager and how many people are attached. **Demand** records are the unfilled staffing needs: role, skill, headcount, hours per week and window. Coverage tells you how much of that need is met by current allocations.

A demand record is a statement of need, not a reservation. Creating one does not allocate anybody.

### 2.5 Allocation

Who is planned onto what, when, and for how many hours. Three things to know:

1. **Allocation is a plan.** It is not a record of work done.
2. **The product will stop you going past 150%** of a person's standard weekly hours. That ceiling exists because a person at 200% is a delivery failure waiting to happen.
3. **Overlaps are allowed and warned about.** People genuinely split time across projects; the warning is information, not an error.

**What-if scenarios** suggest candidates for a demand record with reasons and warnings. Nothing is saved by a scenario — you must create the allocation deliberately.

If a change needs sign-off in your organisation, use **Request approval** on the allocation so a named decision is recorded.

### 2.6 Finance

Workforce cost, the cost of unallocated time, invoiced revenue, operating expenses and gross margin, at total and department level.

Two cautions the screen states and you should respect:

- **Cost of unallocated time is not a saving.** It is what you are already paying for capacity you are not billing.
- **Coverage matters.** If only 58 of 61 people have cost data, the total is a floor, not a final figure. The screen says so.

Margin is shown only when revenue, cost and expenses all exist for the period.

### 2.7 AI Insights

Recommendations generated from your data. Each one has a finding, an explanation in plain English, the evidence behind it, its assumptions, its limitations and its risks. You can acknowledge it, mark it actioned, or dismiss it — and your name, note and time are recorded.

Read the limitations line before acting. It tells you what the recommendation does not know.

### 2.8 AI Assistant

Ask a business question in ordinary language. Good questions: "Where is our unallocated capacity concentrated?", "Who is over-allocated this month?", "What is our invoiced revenue and margin?", "Which demands are under-covered?", "How is utilisation trending?"

- The answer comes with an **Evidence** list showing every figure used.
- **Assumptions** and **Limitations** are always shown.
- **Show the facts used** reveals the exact data behind the answer — verify it yourself.
- The footer tells you whether any data left the server. By default it did not.
- The assistant will refuse questions outside your data: general knowledge, competitor information, or advice about an individual's performance. That refusal is a feature, not a failure.
- If it says data is insufficient, the honest next step is usually on the **Data** screen: upload the missing file.

### 2.9 Forecast

Three-month projections of utilisation, demand, capacity or cost.

- It needs at least four complete months of history, and it will refuse — with the reason and the actuals it does have — if you do not have them.
- Every forecast states its method, its R² and its limitations, and is labelled an estimate. Treat it as a direction of travel, not a commitment.
- Values are limited to the range your data has actually shown, so a forecast will not claim a number you have never achieved.

### 2.10 Reports

Eight reports, downloadable as CSV or Excel. Each file carries a header with the organisation, who generated it, when, for which period, and the metric definitions used. If a number is questioned in a meeting, the file proves its own provenance.

Cost and audit reports require the corresponding permission. If a report shows as unavailable in the list, your role lacks that permission — the reason is shown on the row.

### 2.11 Data

Where spreadsheets get in.

```
Choose data type → upload → confirm column mapping → validate → fix errors → commit
```

1. **Download the template** the first time; it has the exact headers the product expects.
2. **Upload** a CSV or Excel file (up to 20 MB and 20,000 rows).
3. **Confirm the mapping.** The product suggests a mapping from the column names it recognises and shows which source columns it would ignore. Check this every time — a mis-mapped salary column is a real risk.
4. **Validate.** You get per-row, per-column errors. Download the error report as a CSV with row numbers and the original values, fix the file, and re-upload.
5. **Commit.** Nothing is written until you commit, and a commit either fully succeeds or fully fails. If it fails, nothing was half-written.

Two safety behaviours worth knowing: re-uploading an identical file is refused (so a double count cannot happen by accident), and committed imports cannot be deleted — removal needs a second administrator's approval.

The eight data types: Employees, Skills, Projects, Demand, Allocations, Timesheets, Invoices, Expenses.

### 2.12 Automation

Rules that do routine work, plus the approval inbox.

- A new rule starts **disabled**. You turn it on when you are ready.
- Available actions are deliberately limited: generate a report, send an in-app notification, refresh insights, raise an approval request, flag an insight for review. There is no action that changes pay, employment status, or sends data outside the product.
- If a rule is marked as requiring approval, clicking **Run** does not execute it — it creates an approval request. The approver must be someone other than the person who ran it.
- Every run is recorded with who initiated it, who approved it, what happened and when.

### 2.13 Administration

| Section | What you do there |
| --- | --- |
| Organization | Name, industry, country, currency, timezone |
| Structure | Business units, departments, locations. Locations carry hours per day and working days — the capacity engine needs these |
| Users | Create users, assign roles, optionally scope them to a business unit or department, reset passwords |
| Roles | The seven templates, plus any custom roles. A change here takes effect on the user's next request |
| Audit | Who did what, when, from which address. Filter by action or person |
| Modules | What your organisation is entitled to |
| Retention | Import inventory, retention settings, deletion requests |

### 2.14 Settings

Utilisation targets, cost basis, AI permissions, retention and notification preferences.

**Formulas are not configurable.** Targets and inclusion rules are. That is deliberate: if two departments could define utilisation differently, the product would recreate the argument it exists to end. The Settings screen says this in plain words.

### 2.15 My account, Notifications, Metric definitions

- **My account**: change your password, see your roles and your data scope.
- **Notifications**: in-app messages about approvals, imports and insights. No email is sent in this release.
- **Metric definitions**: the complete list of measures, formulas and notes.

---

## Part 3 — Administrator playbook

### 3.1 First-day setup, in order

```
1. Structure first
     business units → departments → locations
     Locations matter most: hours per day and working days drive every capacity figure.
2. Then people
     invite the COO, finance lead, resourcing lead and analysts.
     Scope the resourcing lead to their business unit if they should not see the whole company.
3. Then targets
     Settings → Utilisation target (for example 75%) and the small-firm threshold if relevant.
4. Then data
     Data → Employees → Projects → Allocations → Timesheets (six months) → Invoices → Expenses
     Import timesheets before you trust any utilisation figure.
5. Then insights
     AI Insights → Generate. Read the limitations on the first few; they tell you what is still missing.
```

### 3.2 Choosing roles and scopes

| Person | Role | Scope |
| --- | --- | --- |
| Owner / COO | Executive | Whole organisation |
| Finance controller | Finance | Whole organisation |
| Resourcing lead | Workforce manager | Optionally one business unit |
| Delivery managers | Project manager | Whole organisation, or a department |
| PMO analyst | Analyst | Whole organisation |
| Department heads | Read-only user | Their department |

Create a **custom role** only when a template genuinely does not fit. Fewer roles means fewer surprises during an audit.

Scoping is enforced in the database query, not the interface. A department-scoped user's dashboards, lists, reports and AI answers are all restricted, and out-of-scope people never influence the numbers they see.

### 3.3 Monthly operating rhythm

| When | What | Who |
| --- | --- | --- |
| 1st working day | Import the previous month's timesheets and any new invoices and expenses | Analyst or administrator |
| 1st–2nd | Read the data quality insight; fix whatever it flags | Analyst |
| 2nd | Generate insights for the month | Executive or analyst |
| 3rd | Review over-allocation and bench; act on placements | Resourcing lead |
| 3rd | Review margin by department; check cost coverage | Finance |
| Weekly | Check the approval inbox; nothing sensitive should sit undecided | Administrator |

### 3.4 Handling a data problem

| Symptom | Usual cause | Fix |
| --- | --- | --- |
| Utilisation shows blank for a period | No timesheet rows for that period | Import timesheets |
| Utilisation looks low across a department | Timesheets imported but mapping dropped a column, or the file covered fewer weeks | Check the import's row count and validate result |
| Cost total looks low | Not everybody has cost data | Look at the coverage note; complete the employee import |
| Demand coverage reads low | Demand is stated in hours per week and allocations are in hours per week; a mismatch in windows understates coverage | Check the demand window against allocation dates |
| A person shows as over-allocated | Their allocations exceed their contracted weekly hours in overlapping windows | Adjust hours or end date, or confirm the person is genuinely at more than full capacity |
| Margin is missing | One of revenue, cost or expenses is absent for the period | Import the missing data set |

### 3.5 Approvals and sensitive actions

- Approve automation requests in **Automation → Approvals**. Read the parameters before approving; the request states exactly what will run.
- You cannot approve your own request. Neither can anyone else — that is enforced, not a guideline.
- Data deletion needs two administrators. Take a backup first, always.
- Every approval is in the audit trail with your name and the time.

### 3.6 Audit reviews

A monthly ten-minute review:

1. Administration → Audit. Filter `auth.login.failed` — a spike is worth investigating.
2. Filter `user.roles.updated` and `role.updated` — permission changes should match a request you remember.
3. Filter `data.exported` — full exports should be rare and expected.
4. Filter `deletion.executed` — confirm each had a reason and a second approver.
5. AI audit: check `prompt_injection.blocked` and `assistant.model_output.rejected` for unusual activity.

### 3.7 Housekeeping

| Task | Frequency | How |
| --- | --- | --- |
| Verify backups | Weekly | Check the backup log; once a quarter, restore into a scratch folder |
| Review dormant users | Quarterly | Administration → Users; suspend leavers the same day they leave |
| Review roles | Quarterly | Remove permissions nobody uses; check custom roles still match reality |
| Clear staged imports | Monthly | Data → discard abandoned uploads |
| Review retention settings | Annually | Settings → Data |

---

## Part 4 — Things the product will not do

So you are not surprised in front of a customer:

| Not available | Workaround |
| --- | --- |
| Email notifications, including password reset emails | Notifications are in-app; administrators reset passwords directly |
| Single sign-on, multi-factor authentication | Local passwords with lockout |
| Scheduled automation (rules run on demand or after an import) | Run the rule manually at month end |
| Direct integration with HRMS, Jira, SAP or payroll | Export from those systems and import the file |
| Multi-currency within one organisation | One currency per organisation |
| Mobile app | The web interface is responsive and works in a phone browser |
| Editing the metric formulas | Targets and inclusion rules are configurable; formulas are fixed by design |
| A native Excel add-in | Download CSV or Excel reports |

---

## Part 5 — Getting help

| Question | Where to look first |
| --- | --- |
| What does this number mean? | Information marker on the figure, then Metric definitions |
| How do I do this? | This guide, then the screen's own description line |
| Something is not working | Note the exact message; it is written to be understood. Then check the troubleshooting table in the deployment guide |
| A figure disagrees with my spreadsheet | Download the report and compare the definitions; if the definition matches and the data differs, the import is usually the cause |
| I need a permission I do not have | Ask your organisation administrator — permissions are per-organisation and cannot be self-granted |
| Sign-in is refused with "Cross-site requests are not permitted" | This is a deployment configuration issue, not your password. Whoever runs the installation needs to set `PUBLIC_HOST` or forward `X-Forwarded-Host` — see the deployment guide |
| I think I found a security problem | Report it to the person who runs your installation immediately, and stop using the affected feature |
