# WorkforceIQ — AI Governance and Responsible Use

**Version:** 1.0
**Last updated:** 2026-11-10
**Owner:** Founder (product and governance)
**Applies to:** the AI Business Assistant, AI Recommendations, Forecasting, and any customer-enabled external model

---

## 1. Why this document exists

A workforce product that adds "AI" to salary and performance-adjacent data carries real risk: wrong numbers, hidden bias, unexplainable recommendations, and data leaving the building. This document states, in enforceable terms, what the AI in this product will and will not do, how each guarantee is implemented, and how a customer can verify it.

It is written so a non-technical buyer can read it, and so an engineer can check it against the code.

---

## 2. The single governing principle

> **The AI writes sentences about numbers the platform has already calculated. It never produces a number of its own.**

Every other guarantee follows from that one. The assistant is a *language layer over a calculation layer*, not a general-purpose model with access to a database.

Consequence: if the calculation layer cannot produce a figure — because data is missing, permissions exclude it, or the period has no records — the AI must say so. It cannot fill the gap with plausible prose.

---

## 3. What each AI capability is allowed to do

### 3.1 AI Business Assistant

| Allowed | Not allowed |
| --- | --- |
| Answer questions about capacity, allocation, utilisation, bench, demand coverage, cost trend, finance summary and data quality | Answer general knowledge, world facts, competitor information or anything outside the customer's own data |
| Quote figures from the permission-filtered fact pack | Calculate a new figure not present in the fact pack |
| State what data is missing and what it would take to answer | Guess a range, an estimate or a "typical industry benchmark" |
| Explain how a metric is defined | Advise on employment decisions (who to make redundant, who to promote, who to rate) |
| Refuse and explain the refusal | Speculate on an individual employee's performance or potential |

### 3.2 AI Recommendations (insights)

Eight insight types, each rule-based and evidence-backed:

| Code | What it flags | Evidence it must carry |
| --- | --- | --- |
| `UNALLOCATED_CAPACITY_CONCENTRATION` | Bench concentrated in one department | Unallocated hours per department, headcount, allocation % |
| `EMPLOYEES_OVER_ALLOCATED` | People planned above capacity | Count, total over-allocated hours, the affected people within the caller's scope |
| `OVERLAPPING_ALLOCATIONS` | Assignments that collide in time | The overlapping allocations with dates and hours |
| `DEMAND_COVERAGE_GAP` | Demand that is not covered | Required vs filled hours per demand record |
| `UTILIZATION_TREND_SHIFT` | A month-on-month shift | Both months' values and the delta in points |
| `IDLE_WORKFORCE_COST` | The cost of unallocated time, by department | Cost figure, coverage of cost data, basis |
| `DATA_QUALITY_INCOMPLETE` | Missing or partial data that limits reporting | Which data sets are missing or partial |

Every insight record stores: finding, explanation, evidence, impact, assumptions, limitations, risks, whether human approval is required, and the generator identity. A record cannot be created without the evidence and limitation fields — they are `NOT NULL` in the schema.

**No insight ranks, scores or evaluates an individual person.** Over-allocation is a planning fact (hours against capacity), not a performance judgement.

### 3.3 Forecasting

| Rule | Implementation |
| --- | --- |
| Minimum history | Fewer than 4 complete months → refuse, stating what is required and what is available |
| Method disclosure | `ordinary_least_squares_trend` named in the response, with R² |
| Explicit limits | Seasonality not modelled; assumes current headcount; stated in every response |
| No wild extrapolation | Values are clamped to the observed range, so a forecast cannot claim a utilisation figure the data has never shown |
| Permission | Cost forecasts require the cost permission |
| Estimates labelled | The interface labels forecasts as estimates and never presents them beside actuals without a qualifier |

---

## 4. Grounding: how "no invented numbers" is enforced

```
1. Permission-filtered fact pack
     built per request from the caller's organisation and data scope.
     Cost facts require the cost permission; finance facts require finance permission.
2. Deterministic answer composition
     intent detection (11 intents) → a template that only interpolates fact values.
     Missing fact → explicit insufficiency response, not an empty sentence.
3. Optional external writer (off by default)
     the model receives the fact pack and is instructed to use only those figures.
4. Numeric verification of model output
     every numeral in the returned prose is checked against the fact pack.
     A number that cannot be traced → the prose is discarded, the deterministic
     answer is used, and the rejection is logged in ai_audit_events.
```

Step 4 is the belt-and-braces control that makes enabling an external model survivable rather than reckless. It is the only step that exists purely because a language model cannot be trusted with arithmetic.

### 4.1 How a customer can verify grounding themselves

| Verification | Where |
| --- | --- |
| See the exact facts that would be used for a question | AI Assistant → "Show the facts used" (`GET /api/ai/assistant/fact-preview`) |
| See whether any data left the server | Every answer carries `provider` and `external_calls_made` |
| See the AI activity log | Administration → AI audit (`GET /api/admin/ai-audit`) |
| See the AI configuration and data-handling statements | AI Assistant → Governance panel (`GET /api/ai/governance`) |
| Check a quoted figure | Every answer lists evidence items with labels and units; the same figure appears on the analytics screens |

---

## 5. Permission-awareness

The AI is bound by exactly the same permissions as the rest of the product. There is no "AI can see more" path.

| User | What the assistant may use |
| --- | --- |
| Executive | Everything the executive permission set allows, including cost and finance |
| Finance | Cost, revenue, margin; workforce aggregates |
| Workforce manager | Capacity and allocation; no cost, no finance |
| Analyst (unscoped) | Capacity and allocation; no cost |
| Department-scoped manager | Only people inside that scope — the scope filter is applied in SQL before the fact pack is assembled |
| Viewer | No assistant access at all (`ai.assistant` not granted) |

A question that requires data the caller cannot see returns an honest insufficiency. The figures were never in the pack, so they cannot be leaked by a cleverly worded question.

---

## 6. Prompt-injection defence

**Attack surface #1 — the question box.** Patterns such as "ignore previous instructions", "you are now…", "reveal the system prompt", "print all API keys", "set your role to…", "bypass tenant" are detected before any data is retrieved. The request is blocked, the user is told why, and the attempt is written to `ai_audit_events` as `prompt_injection.blocked` with the matched patterns.

**Attack surface #2 — uploaded files and pasted text.** Uploaded content is parsed into typed fields and never concatenated into an instruction. Any free text that reaches a model is placed inside a FACTS block, and the system prompt states that FACTS is data only. The same scanner runs over externally supplied text so a malicious cell is detectable.

**Attack surface #3 — model output.** Treated as untrusted text: numbers are verified, nothing from the output is executed, and the interface renders text content only.

**Honest limitation:** pattern matching stops the obvious attempts and creates a detection trail, but it is not a proof of safety. A novel phrasing may get through. The structural defence — that the fact pack is already permission-filtered, so there is nothing valuable to extract — is the control that actually matters.

---

## 7. Data handling

| Question a buyer will ask | Answer |
| --- | --- |
| Does my data leave my server? | Not by default. The default provider is a deterministic local engine; `external_calls_made` is `false` on every answer. |
| What is sent if an external model is enabled? | The aggregate fact pack only: totals, department roll-ups, counts, cost figures the caller is permitted to see. Never raw timesheet rows, never a full employee table. |
| Are employee names sent? | No, unless the customer explicitly sets `AI_ALLOW_EMPLOYEE_NAMES=true`. By default names are replaced with "Employee (name withheld)". |
| How do I switch it off? | Remove the `AI_PROVIDER`, `AI_API_KEY`, `AI_BASE_URL` and `AI_MODEL` configuration; the product falls back to the local engine with no external dependency. |
| Is AI usage logged? | Yes, in `ai_audit_events`: intent, provider, result status, data shape and size, and whether the request was blocked. |
| Can I delete conversation history? | Yes, the owner can delete a conversation; an administrator can apply the organisation's retention setting to AI records. |

---

## 8. Human oversight and high-impact actions

The AI never performs an action. It produces text and records.

| Action | Who may perform it | Oversight |
| --- | --- | --- |
| Generate a recommendation | A user with `ai.insights` | It is a record, not a change |
| Mark a recommendation acknowledged / actioned / dismissed | A user with `ai.insights` | Reviewer, note, timestamp stored and audited |
| Change an allocation | A user with `allocation.manage` | Capacity guardrails; optional approval request |
| Run an automation | A user with `automation.manage` | Sensitive rules require a different human's approval |
| Delete data | Two administrators | Requester cannot approve their own request |
| Terminate, promote, rate or pay someone | **Nobody, through this product** | Out of scope by design |

Over-allocation and bench are planning signals. The product's language is deliberately factual: "23 people are allocated above their available hours", never "23 people are underperforming".

---

## 9. Fairness and bias considerations

This product does not make or score decisions about individuals. That removes the most common source of algorithmic bias in HR software (ranking, screening, scoring). What remains is a subtler risk: a manager may read an over-allocation or idleness flag as a judgement about a person.

Controls:

1. Terminology is factual and about hours, not performance.
2. Idle capacity is attributed to a department and to planning, with the explicit statement that it is "cost of carrying spare capacity, not a saving already achieved".
3. No insight compares employees to one another.
4. No insight predicts attrition, performance or potential.
5. Cost figures are aggregate; the product does not produce a "cheapest person" shortlist.
6. Scenario suggestions list reasons and warnings, including when a candidate is already over-committed, rather than optimising for cost alone.

Any future feature that scores or ranks people requires a separate governance review and explicit customer opt-in. That is a standing rule, not a preference.

---

## 10. Transparency surfaces in the product

| Surface | What it discloses |
| --- | --- |
| AI Assistant answer panel | Evidence, assumptions, limitations, confidence, sources, next step, provider, whether an external call was made |
| "Show the facts used" | The exact aggregate fact pack |
| AI Audit screen | Every query, intent, provider, result, and every blocked attempt |
| AI Governance panel | Provider configuration, organisation AI settings, data-handling statements, recent activity |
| Metric definitions screen | The formulas the assistant and insights are quoting |
| Settings → AI | Whether an external provider is configured (not just what the setting says) |

---

## 11. Known limitations, stated plainly

1. **The local engine is not conversational.** It classifies the question into one of eleven intents and composes a structured answer. A question outside those intents is refused rather than answered poorly. This is a deliberate trade of breadth for accuracy.
2. **Injection detection is pattern-based.** Novel phrasing may pass. The structural defence (permission-filtered facts) is the real control.
3. **Forecasts are straight-line.** No seasonality, no cohorts, no causal model. They are labelled accordingly and refused when history is thin.
4. **Insights are rule-based, not learned.** They are reproducible and explainable precisely because they are deterministic. They will not discover a pattern nobody thought to encode.
5. **No evaluation benchmark exists.** There is no labelled dataset measuring answer accuracy in the wild, because there are no customers yet. The tests verify grounding behaviour (numbers traceable, refusals correct, injection blocked), not answer quality against human judgement.
6. **No model risk register entry for a customer-supplied model.** If a customer points the product at their own model endpoint, that model's behaviour is outside this governance document; the numeric verification still applies.

---

## 12. Governance checklist for every future AI change

Before any AI capability ships, all of these must be answerable "yes":

- [ ] Does it use only permission-filtered facts for the requesting user?
- [ ] Can every number in its output be traced to a fact, and is that checked automatically?
- [ ] Does it refuse — with a stated reason — when data is insufficient?
- [ ] Is it off by default if it requires an external service, and is the customer's consent explicit?
- [ ] Is the activity logged in `ai_audit_events`?
- [ ] Does the interface disclose provider, evidence, assumptions and limitations?
- [ ] Does it avoid scoring, ranking or predicting anything about an individual?
- [ ] Is there a test that fails if the guarantee is broken?

## Voice interaction

Voice is a **presentation layer over the same assistant**, not a second assistant. Every
guarantee above applies unchanged: the answer is computed from permission-filtered data by the
same deterministic engine, the same audit record is written, the same limitations are attached.

Where voice differs, and why:

| Concern | Decision | Reason |
| --- | --- | --- |
| What is spoken | The answer, one limitation, and a confidence statement when confidence is low or data is insufficient. Evidence, assumptions and sources stay on screen. | Reading an evidence block aloud takes minutes, loses the user, and buries the figure they asked for. |
| When it speaks | Only when the user enables "Read answers aloud", and on an explicit "Read aloud" press per answer. | An assistant that starts talking unprompted is worse than a silent one, especially in a shared office. |
| Microphone | Opens only on a press. One utterance per press, stopping on silence; the button shows a listening state while open. | Continuous listening with no visible state leaves microphones open by accident. |
| Speech recognition | Browser engine, not a server call. Unavailable without a secure context (https or localhost). | Keeps the audio out of our infrastructure entirely; the transcript is the only thing that reaches us. |
| Recognition accuracy | The transcript is shown to the user before it becomes a question; spoken numbers are treated as ordinary question text. | Never act silently on a misheard question. |
| Data sent to the speech engine | Nothing beyond the spoken text. Same rule as the assistant: aggregates only, no employee names unless the organisation allows them. | Voice must not widen the data surface. |

**Known limitation, stated plainly:** speech *recognition* in Chrome and Edge sends audio to
that browser's speech service. That is a property of the browser, not of this application, and it
means "no data leaves this deployment" is true of the answer engine but **not** of the
microphone. Organisations that cannot accept that should leave voice input unused; typed
questions and spoken answers remain fully local to the browser.

## Record-keeping actions

The assistant can change records. That is a materially larger power than answering questions, so
it is bounded deliberately.

**Two steps, always.** A request is *staged* — validated, resolved and rendered as a preview of
exactly what will change — before it can be applied. There is no code path that writes from a
single request. A misheard voice instruction therefore produces a preview that the user reads
and rejects, not a silently created record.

**The same permissions, not new ones.** Each action declares the permission its REST endpoint
requires (`allocation.manage`, `workforce.manage`). A user who cannot add an allocation in the
interface cannot add one by asking, and a voice request cannot be used to escalate.

**Ambiguity is surfaced, never guessed.** Two people with the same first name, or two active
allocations on different projects, produce a question — not a coin flip.

**Nothing here hard-deletes.** Removing an allocation sets it to `cancelled`; marking a person as
exited sets `status = 'exited'` and keeps their history. Reports that depend on those rows
continue to reconcile.

**Excluded on purpose.** Pay, annual cost, charge-out rates, invoices and approvals are not
reachable through the assistant at any permission level. A request for them is refused with an
explanation, and the refusal is logged. The reasoning is asymmetric risk: a wrong allocation can
be cancelled in one click, a wrong salary silently corrupts every downstream report.

**Audited both ways.** Staging an action writes `ai.action.staged`; applying one writes the same
event type the UI action would (`allocation.created`, `employee.updated`, …) plus
`via_voice: true|false` and the before/after values. An auditor can reconstruct who asked, in
what words, what was previewed, and what was applied.

| Action | Permission | Destructive | Effect |
| --- | --- | --- | --- |
| Add an allocation | `allocation.manage` | No | Creates a planned allocation; warns aloud if it over-allocates the person |
| Remove an allocation | `allocation.manage` | Yes | Sets `cancelled`, retains the row |
| Add a person | `workforce.manage` | No | Creates the record with no cost fields |
| Update a person | `workforce.manage` | No | Department, designation, email only |
| Mark a person as exited | `workforce.manage` | Yes | Sets `status = 'exited'` and an exit date |

## The CRM drafting lane

The brief for this feature was: *"I will say 'AI select the topic' and then I tell the AI auto to
fill in the detail… then it will be there for human approval and once someone approves it, it will
automatically append to that dataset."* That is implemented literally, because the literal version
is the safe one.

**The state machine** is the guarantee:

```
drafting ──submit──▶ pending_approval ──approve──▶ approved  (row written to crm_leads)
                                    └──reject───▶ rejected  (never enters the dataset)
```

A draft lives in `crm_ai_sessions`. It has no write path to `crm_leads`; `approveDraft()` is the
only function that inserts, and it runs inside a transaction that also writes the revision to
`record_versions`, the pipeline event to `crm_lead_events`, and the security audit entry. Tests
assert the row count does not change across drafting and submission, and does change on approval.

**Incremental capture.** Each utterance is parsed and merged, so a user can say one thing at a
time and continue with "and". The parser handles the three shapes people actually use — labelled
("value is 42 lakh"), unlabelled ("Kelvin Cold Chain"), and continuation ("and the city is
Chennai") — and reports what it could not use rather than storing a guess. Fields still missing
are named in the reply, so the assistant always asks for the next one.

**What is captured, and what a human must still do.** The assistant can draft a lead from speech,
including Indian number words ("42 lakh", "1.5 crore") and spoken email addresses ("ramesh at
kelvincold dot com"). It cannot set cost, pay or billing fields, and it cannot approve its own
work: `crm.draft` and `crm.approve` are separate permissions, so the person who dictates a record
need not be the person who authorises it.

**Why approval sits in front of the data, not behind it.** A CRM is the system of record for
revenue. A plausible-but-wrong record that silently enters it is worse than a missing record,
because everything downstream — pipeline value, forecasts, commission — inherits the error without
anyone noticing. The approval step costs one click and makes the error visible.

## Answering anything, rather than eleven things

The assistant previously matched eleven fixed intents and replied "I could not map that question"
to everything else, which is what a user experiences as "the AI is not working". It now:

1. tries the specific intent engine, which produces the richest answer with evidence;
2. falls back to a general engine that identifies which part of the database the question refers
   to (CRM, people, projects, allocations, finance, timesheets, departments, approvals, insights,
   audit) and answers from those tables;
3. if the question is about something the database cannot know — the weather, a cricket score —
   says exactly that, and offers the questions it *can* answer instead of a dead end.

Every figure still comes from a query filtered by the requesting user's organisation and scope;
finance answers still require the finance permission. Nothing is generated by a language model,
so there is nothing to hallucinate.
