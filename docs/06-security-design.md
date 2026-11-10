# WorkforceIQ — Security Design

**Version:** 1.0
**Last updated:** 2026-11-10
**Classification:** Internal — approved for customer security review

---

## 1. What is being protected, and from whom

This product holds two categories of data that are unusually sensitive for a business tool:

1. **Personnel data** — names, employee codes, departments, grades, skills, employment status, join and exit dates.
2. **Compensation and commercial data** — annual cost per person, bill rates, invoices, expenses, margin.

For a mid-sized services firm, the second is arguably the most confidential dataset it owns: individual salary and rate information is commercially explosive both internally and with clients.

The threats that matter, in order of realistic likelihood:

| Threat | Realistic scenario | Primary control |
| --- | --- | --- |
| **Insider over-read** | A department manager opens a screen and sees salaries or another department's people | Server-side permission and scope filtering, applied before calculation |
| **Cross-tenant leak** | A customer sees another customer's data through a mis-scoped query | Tenant id derived only from the session; `org_id` in every query; 404 instead of 403 |
| **Credential compromise** | A reused password appears in a breach dump | scrypt hashing, lockout, 12-hour sessions, immediate server-side revocation |
| **Data exfiltration via export** | Someone downloads the full employee list with costs | Cost fields removed server-side; exports honour permissions; downloads constrained to the tenant |
| **Injection through uploads** | A malicious CSV attempts to reach the AI layer or the database | Parameterised SQL everywhere, injection scanning on AI input, uploads treated as data |
| **Prompt injection / AI misuse** | A user tries to make the assistant reveal other data or ignore rules | Permission-filtered fact pack, injection scan, no external calls by default |
| **Unapproved high-impact action** | An automation changes something nobody signed off | Closed action list, approval for sensitive actions, no self-approval |
| **Silent tampering** | Someone edits an allocation and denies it | Append-only audit trail plus per-record version history |

---

## 2. Authentication

### 2.1 Password storage

```
scrypt$N$r$p$salt_b64$hash_b64        N=16384, r=8, p=1, keylen=64, salt=16 random bytes
```

- Hashing uses `crypto.scrypt` with `maxmem` raised to 64 MB to allow the cost parameters.
- Verification uses `crypto.timingSafeEqual` to avoid a timing side channel.
- A sign-in attempt for an unknown email still performs a dummy scrypt verification so response time does not disclose whether the account exists.
- Parameters are stored with each hash, so cost can be raised later without invalidating existing accounts (a rehash-on-next-login path is a future change, documented in the roadmap).

### 2.2 Password policy

| Rule | Value | Enforced where |
| --- | --- | --- |
| Minimum length | 10 characters | Server, on create / reset / change |
| Character classes | at least one lower case, one upper case, one digit | Server |
| Reuse | Not prevented in this release (no history table) | — documented gap |
| Expiry | None | Deliberate: forced rotation degrades password quality |
| Temporary passwords | Must be changed at first sign-in (`must_change_password = 1`) | Server flag, enforced before any other action |

### 2.3 Brute-force resistance

- Six consecutive failures set `locked_until` to 15 minutes ahead; the counter resets on success.
- `/api/auth/*` is additionally rate limited to 30 requests per minute per IP in memory.
- Failed attempts are logged (`auth.login.failed`) with the actor and IP, forming a detection trail.

### 2.4 Sessions

| Property | Value |
| --- | --- |
| Token | 32 random bytes, base64url |
| Storage | SHA-256 hash only (`auth_sessions.token_hash`) |
| Cookie | `wiq_session`, `HttpOnly`, `Path=/`, `SameSite=Lax` by default (`SameSite=None; Secure` only when `COOKIE_SAMESITE=none` and the request is HTTPS, for cross-site embedding), `Secure` in production. A cross-site embedding weakens CSRF protection, which is why it is opt-in per deployment and the origin check remains in force. |
| Lifetime | 12 hours (configurable via `SESSION_TTL_HOURS`) |
| Revocation | `revoked_at` on sign-out, and on password change for all other sessions |
| Validation per request | `revoked_at IS NULL AND expires_at > now` |

Because sessions are server-side, a revoked session fails on the very next request. There is no window in which a stolen cookie survives a logout.

### 2.5 Not implemented in this release

| Control | Status | Consequence |
| --- | --- | --- |
| Multi-factor authentication | **Not implemented** | A stolen password plus a non-locked account is sufficient to sign in. Mitigated by lockout, 12-hour sessions, and the fact that no bulk export is available without a second permission. |
| SSO / SAML / OIDC | **Not implemented** | Enterprise buyers will usually require it. Documented as a pre-requisite for enterprise sales. |
| SCIM provisioning | **Not implemented** | Users are created manually or via the provisioning API. |
| Passwordless / WebAuthn | **Not implemented** | — |

These are stated openly rather than described as "on the roadmap", because a security reviewer needs to know what is in the box today.

---

## 3. Authorisation

### 3.1 Model

Role-based access control with 24 permissions and optional data scoping.

```
user ──< user_roles >── role ── permissions[]
                │
                └── business_unit_id / department_id   (optional scope)
```

Seven templates ship; organisations may create custom roles from any subset of permissions.

### 3.2 Enforcement mechanics

| Layer | Mechanism | Notes |
| --- | --- | --- |
| Route gate | `requirePermission('x')`, `requireAnyPermission('x','y')` | Returns 403 with `details.required` naming the permission |
| Column redaction | Service-level check before serialising | Cost and finance fields are removed server-side |
| Row restriction | `employeeScopeSql()` injects `IN (...)` into SQL | Applied before aggregation, so figures cannot include out-of-scope rows |
| Module gate | `requireModule(code)` | Module entitlement per organisation |
| Tenant gate | `tenantContext` middleware | `req.orgId` from the session only |

### 3.3 The rule the codebase follows

> **The interface never makes a security decision.** Hiding a navigation item is a convenience; the endpoint enforces the permission independently.

This is verified by tests that call the API directly with under-privileged identities (`tests/02-tenancy.test.js`, `tests/06-governance.test.js`), including one that removes a permission from a role and confirms the very next request is refused.

### 3.4 Privilege escalation defences

| Attempt | Result |
| --- | --- |
| A user edits their own roles | Not possible: role assignment requires `user.manage`; the endpoint re-reads the authenticated principal |
| A user creates a role with permissions they lack | Requires `role.manage`, which only administrators hold by default; custom role creation is audited |
| A platform admin reads tenant records | Refused: platform accounts get `NO_TENANT` on tenant endpoints; only aggregate counts via `/platform/organizations` |
| A scoped user requests an unscoped filter | Scope is applied in SQL from the principal, not from query parameters |
| A user passes another tenant's id in a body | Record lookup is `WHERE id = ? AND org_id = ?`, returning 404 |

---

## 4. Tenant isolation

Three independent layers (§6 of the architecture document): session-derived tenant, query-level `org_id`, and schema shape. The tests exercise the boundaries rather than the happy path:

1. Cross-tenant employee read → 404.
2. Employee lists are strictly per-organisation.
3. A foreign department id is rejected when creating an employee.
4. An org-context header is ignored for non-platform users.
5. Scoped analytics exclude out-of-scope employees **before** calculation.
6. Report files cannot be downloaded by another tenant.
7. A full data export contains only that organisation's rows.
8. The AI fact pack never contains another organisation's name.

---

## 5. Transport, headers and browser protections

| Control | Implementation |
| --- | --- |
| Security headers | `helmet` defaults: `X-Content-Type-Options`, `X-Frame-Options`/frame-ancestors, `Referrer-Policy`, `Cross-Origin-Resource-Policy: same-site`, HSTS when behind TLS |
| CSP | Not set by the API (which returns JSON only). If the interface is served by this same process, a CSP should be added at the reverse proxy — see the deployment guide, which includes a recommended policy. This is an open item, not a claim. |
| CORS | Not enabled. The interface is same-origin, so no cross-origin allowance is needed. |
| CSRF | `SameSite=Lax` cookie plus a server-side check. A state-changing request is accepted when the browser sends `Sec-Fetch-Site: same-origin`, or when its `Origin` host matches `Host`, `X-Forwarded-Host`, or the configured `PUBLIC_HOST` allow-list; anything else returns `403 CROSS_SITE_BLOCKED`. Proxy-aware matching exists because comparing `Origin` to `Host` alone rejected legitimate sign-ins behind a reverse proxy (change-history defect 16); the protection against a genuinely foreign origin is unchanged. |
| Clickjacking | `X-Frame-Options: SAMEORIGIN` via helmet in production. Embedding is a deployment decision: `ALLOW_FRAME_EMBEDDING=true` disables the frame guard for portals and previews, and that is a deliberate, documented trade — an embedded app must be trusted by the embedding page. |
| Compression | gzip; no side-channel-sensitive responses are shared across users |
| Error leakage | Central handler returns a generic message for 5xx; stack traces go to the server log only |
| `x-powered-by` | Disabled |
| Body size | JSON 1 MB; uploads 20 MB (validated extension and size before parsing) |

---

## 6. Input handling

| Input | Handling |
| --- | --- |
| SQL | Parameterised statements only; no string concatenation of user values anywhere. Dynamic `IN (...)` lists are built from an array with generated placeholders. |
| JSON bodies | Shape and type validated; `zod` used for structured schemas; numbers coerced with explicit finite/range checks (for example weekly hours 0–80). |
| File uploads | Extension allow-list (`.csv`, `.xlsx`, `.xls`), 20 MB cap, 20,000-row cap, stored under a generated name with the original name recorded, SHA-256 checksum calculated, parsed with a bounded reader. |
| File downloads | Path resolved and compared against the exports directory, and the file's report run must belong to the caller's organisation. Traversal attempts are rejected. |
| CSV output | Escaped per RFC 4180; a value beginning with `=`, `+`, `-` or `@` is neutralised to prevent spreadsheet formula injection. |
| Rich content | The interface renders text content only; no HTML from user data is injected. |
| AI input | Control characters stripped, length capped at 1,200 characters, scanned for injection patterns before any data is retrieved. |

---

## 7. Audit and non-repudiation

Two append-only streams:

| Table | Holds | Retention |
| --- | --- | --- |
| `audit_events` | Every state-changing action and every sensitive read, with actor, role, action code, entity, summary, JSON metadata, IP and user agent | Per the organisation's `data.retention_days` setting (default 1,095 days) |
| `ai_audit_events` | Every AI query, intent, provider, result status, and every blocked injection attempt or rejected model output | Same |

Plus per-record history in `record_versions` (snapshot before each import-driven update), and `automation_runs` (initiator, approval, result, timestamps).

Rules the design follows:

1. **Audit rows have no foreign keys.** They survive deletion of the record they describe.
2. **Nothing in the application deletes audit rows.** There is no delete endpoint for either stream.
3. **Audit is readable only with `audit.view`**, which is not granted to the viewer, analyst or finance templates by default.
4. **Sensitive reads are audited too** — report generation and full data export are events, not silent operations.

A gap to state honestly: because the database is a local file, an operator with file-system access could modify audit rows directly. Protecting against that requires remote append-only storage or signed log chaining, neither of which is in this release. It is recorded in the risk register.

---

## 8. AI-specific security

The AI layer is the newest attack surface in any business product, so it is treated as hostile-input territory.

| Risk | Control |
| --- | --- |
| Data sent to an external model without consent | External provider is off by default; enabling it is an explicit configuration change; the Settings screen shows the current state; the AI governance screen reports whether an external provider is configured. |
| Personal data in prompts | Employee names are replaced with "Employee (name withheld)" unless the customer opts in via `AI_ALLOW_EMPLOYEE_NAMES`; only aggregates are sent. |
| Hallucinated numbers | Deterministic answers are composed from the fact pack. If an external model is enabled, every numeral in its output is checked against the facts (`verifyNumbers`); on mismatch the verified answer is used and the event is logged. |
| Prompt injection via question | Pattern scan blocks the request before data retrieval and logs `prompt_injection.blocked`. |
| Prompt injection via uploaded data | Uploaded content is parsed into typed fields, never concatenated into instructions; any text passed to a model is wrapped as FACTS and the system prompt states it is data only. |
| Cross-tenant leakage in facts | The fact pack is built with the requesting principal's organisation and data scope. |
| Permission escalation through the assistant | Facts are filtered by the caller's permissions; a question about cost data without cost permission returns an insufficiency, and the figures were never in the pack. |
| Runaway cost | No external calls by default; a 20-second timeout and a 12,000-character fact cap if enabled. |

---

## 9. Secrets and configuration

| Item | Handling |
| --- | --- |
| Session secret | Environment variable, minimum 32 characters. In production the process **refuses to start** without it. In development a random secret is written to `data/.dev-session-secret` with mode `0600`. |
| AI API key | Environment variable only; never returned by any endpoint. The API reports only whether an external provider is *configured*. |
| Database | File on disk, no password. Protection is file-system permissions plus host access control. |
| Repository hygiene | `.env`, `.env.local`, `*.log`, database files, uploads and exports are git-ignored. A test scans tracked source files for secret-shaped strings and for the demo password appearing in non-seed code. |
| Logs | Application logs contain request path and error message; no request bodies, no passwords, no cost figures. |

---

## 10. Data lifecycle

| Stage | Behaviour |
| --- | --- |
| Ingestion | Original file stored unmodified; checksum recorded; raw rows retained for re-inspection |
| Use | All analytics read from normalised tables; cost fields filtered by permission |
| Retention | Configurable (`data.retention_days` default 1,095; `raw_retention_days` default 365); the Data & retention screen exposes current settings and import inventory |
| Deletion | Requested by one administrator, approved by a different one, executed in a transaction, recorded in `deletion_requests` and the audit trail |
| Export | Full tenant export available to the organisation's own administrator |
| Backup | Documented in the deployment guide: stop the process (or use SQLite's online backup), copy the database and uploads, verify by restoring into a scratch directory |

---

## 11. Residual risks accepted for this release

Stated plainly so a reviewer can weigh them:

| Risk | Why accepted now | Mitigation in place | Closing action |
| --- | --- | --- | --- |
| No MFA | Budget and scope; the product is pre-revenue | Lockout, short sessions, revocation, audit | Implement TOTP |
| No SSO | Same | Strong local auth; per-tenant isolation | Implement OIDC/SAML |
| Local database file can be modified by the host operator | Single-node design | File permissions; audit trail shows application-level actions | Move to a managed database with restricted credentials |
| No CSP header when the SPA is served by this process | Needs a policy tuned to the built bundle | Helmet headers; no inline script in the build | Add CSP at the reverse proxy and in `helmet` |
| No penetration test | Cost | Internal review plus an automated security suite | Commission a third-party test before the first enterprise contract |
| No rate limit beyond auth endpoints | Traffic is low and authenticated | Session auth required for everything else | Add a global limiter at the proxy |
| No password history / reuse prevention | Minor | Lockout and audit | Add a password history table |

---

## 12. Security verification performed

Everything below is a real test result, not an assertion of intent. The suite is `tests/06-governance.test.js` and the full report is `docs/test-report.md`.

| Check | Result |
| --- | --- |
| Security headers present on API responses | Pass |
| Unknown route returns a structured 404 (no HTML error page, no stack) | Pass |
| Internal error does not leak a stack trace | Pass |
| Cross-site state-changing request blocked when `Origin` differs | Pass |
| No secrets committed to the repository | Pass |
| Report file not downloadable by another tenant | Pass |
| Path traversal on report download rejected | Pass |
| Audit trail not visible without `audit.view` | Pass |
| Full tenant export contains only that tenant's data | Pass |
| Deletion requires a second administrator | Pass |
| Self-approval refused | Pass |
| Role permission change takes effect on the next request | Pass |
| Injection attempts blocked and logged | Pass |
| No external model call in the default configuration | Pass |
| Cost fields absent from the fact pack without cost permission | Pass |

A third-party penetration test has **not** been performed, and no claim of one should be made in any sales material.
