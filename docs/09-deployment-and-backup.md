# WorkforceIQ — Deployment, Operations, Backup and Restore

**Version:** 1.0
**Last updated:** 2026-11-10
**Applies to:** single-node installation (the supported topology for this release)

---

## 1. What you are deploying

One Node.js process that serves both the API and the compiled web interface, backed by one SQLite file and two directories.

```
/opt/workforceiq/
  ├── server/            application code
  ├── dist/              compiled web interface (built once, then static)
  ├── package.json
  └── data/
        ├── workforceiq.db       the database (plus .db-wal and .db-shm while running)
        ├── uploads/             original uploaded files, unmodified
        └── exports/             generated report files
```

**Everything that matters is inside `data/`.** If you back that directory up, you can rebuild the product anywhere.

---

## 2. Requirements

| Item | Minimum | Notes |
| --- | --- | --- |
| Node.js | 20 LTS (22 recommended) | `node --version` |
| RAM | 1 GB | 2 GB comfortable for 1,000+ employees |
| Disk | 5 GB | Database grows ~50–100 MB per 1,000 employees per year of timesheets; uploads and exports add more |
| OS | Linux (x64/arm64), macOS, Windows | Debian/Ubuntu LTS assumed below |
| Network | Outbound not required | The product needs no internet access at runtime |
| Reverse proxy | nginx or Caddy | Strongly recommended for TLS |

`better-sqlite3` is a native module. On a fresh machine, installing dependencies may need build tools: `sudo apt-get install -y build-essential python3`.

---

## 3. First installation

```bash
# 1. create a service user and directory
sudo useradd --system --create-home --shell /usr/sbin/nologin workforceiq
sudo mkdir -p /opt/workforceiq && sudo chown workforceiq:workforceiq /opt/workforceiq

# 2. copy the application there (git clone, scp or tarball)
sudo -u workforceiq git clone <repository> /opt/workforceiq   # or rsync the working tree
cd /opt/workforceiq

# 3. install dependencies and build the interface
sudo -u workforceiq npm ci --omit=dev    # production dependencies only
sudo -u workforceiq npm install --no-save vite @vitejs/plugin-react tailwindcss postcss autoprefixer typescript
sudo -u workforceiq npm run build        # produces dist/

# 4. generate a session secret and write the environment file
sudo -u workforceiq bash -c 'umask 077; cat > /opt/workforceiq/.env <<EOF
NODE_ENV=production
PORT=4000
SESSION_SECRET=$(openssl rand -hex 32)
SESSION_TTL_HOURS=12
MAX_UPLOAD_MB=20
AI_PROVIDER=local
DEMO_MODE=false
TRUST_PROXY=true
EOF'

# 5. create the schema
sudo -u workforceiq npm run migrate

# 6. start it once in the foreground to confirm it works
#    (npm start serves the built app; npm run start:prod adds production mode and
#     generates a session secret into .env on first run — cross-platform)
sudo -u workforceiq npm run start:prod
#   → "[api] WorkforceIQ listening on 0.0.0.0:4000 (production)"
#   → "[api] AI provider: local (deterministic, grounded)"
#   Ctrl-C to stop
```

### 3.1 Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `NODE_ENV` | development | `production` enforces a real session secret and `Secure` cookies |
| `PORT` | 4000 | HTTP port |
| `DATA_DIR` | `<app>/data` | Where the database, uploads and exports live |
| `DB_FILE` | `<DATA_DIR>/workforceiq.db` | Database path override |
| `SESSION_SECRET` | generated in development only | **Required in production**, minimum 32 characters |
| `SESSION_TTL_HOURS` | 12 | Session length |
| `MAX_UPLOAD_MB` | 20 | Upload size cap |
| `TRUST_PROXY` | false | Set `true` behind a reverse proxy so client IPs are recorded correctly |
| `PUBLIC_HOST` | empty | Comma-separated public hostnames (for example `workforce.example.com`). The cross-site request check accepts an `Origin` matching one of these. Required whenever a proxy forwards neither `X-Forwarded-Host` nor the browser's `Sec-Fetch-Site` header (some tunnels and older proxies do not). Set it to the exact host users type into the address bar. |
| `ALLOW_FRAME_EMBEDDING` | `true` outside production, `false` in production | Whether the app may be rendered inside an iframe. Production defaults to blocked (clickjacking protection). Set `true` for deployments that are embedded in a portal or preview frame — with framing blocked, sign-in succeeds server-side but the framed page cannot keep the session, which looks like "I cannot log in". |
| `INSECURE_COOKIES` | empty | Set `true` only for a deliberate plain-HTTP deployment. By default the session cookie is marked `Secure` in production, and a browser silently drops a `Secure` cookie on plain HTTP. |
| `COOKIE_SAMESITE` | `lax` | `lax` is correct for a normal same-origin deployment and gives real CSRF protection. Set `none` when the app runs inside a cross-site frame (preview tunnels, customer portals, embedded dashboards): a `Lax` cookie is **not sent** on a cross-site subresource request, so sign-in appears to succeed and the next request arrives unauthenticated. `none` is only applied over HTTPS (browsers reject `SameSite=None` without `Secure`); over plain HTTP the cookie falls back to `Lax`. |
| `DEBUG_AUTH_HEADERS` | false | Logs host, origin, `X-Forwarded-*`, `Sec-Fetch-*` and whether a session cookie was present for `/api/auth/*`. Header values only — never cookie values or passwords. Use it to diagnose "sign-in succeeded but the session did not stick", then turn it off. |
| `AI_PROVIDER` | `local` | `local` (default) or an OpenAI-compatible provider name |
| `AI_MODEL`, `AI_BASE_URL`, `AI_API_KEY` | empty | Only needed if you deliberately enable an external model |
| `AI_ALLOW_EMPLOYEE_NAMES` | false | Sends names to an external model — off unless a customer explicitly accepts it |
| `AI_TIMEOUT_MS` | 20000 | External model timeout |
| `DEMO_MODE` | true | Hides demo-only affordances when `false` |
| `PLATFORM_ADMIN_EMAIL` | `platform@workforceiq.example` | Platform administrator account created by the seeder |

**Never put a secret in `package.json`, the source tree, or a shell history file.** The `.env` file is git-ignored and should be mode `0600`.

---

## 4. Running as a service

`/etc/systemd/system/workforceiq.service`:

```ini
[Unit]
Description=WorkforceIQ
After=network.target

[Service]
Type=simple
User=workforceiq
WorkingDirectory=/opt/workforceiq
EnvironmentFile=/opt/workforceiq/.env
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=5
# hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/workforceiq/data
LimitNOFILE=4096

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now workforceiq
sudo systemctl status workforceiq
journalctl -u workforceiq -f
```

The process handles `SIGTERM` and `SIGINT` by closing the HTTP server, so restarts and deploys are clean. It exits after 5 seconds even if connections linger.

---

## 5. Reverse proxy and TLS

The application speaks plain HTTP on `4000`. Terminate TLS at nginx.

`/etc/nginx/sites-available/workforceiq`:

```nginx
server {
    listen 80;
    server_name workforce.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name workforce.example.com;

    ssl_certificate     /etc/letsencrypt/live/workforce.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/workforce.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;

    client_max_body_size 22m;   # slightly above the 20 MB upload cap

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/workforceiq /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
# then set TRUST_PROXY=true in .env and restart the service
```

The CSP above is the recommended policy for the built bundle; verify it after any front-end change (browser console, no CSP violations) because a policy that silently breaks the interface is worse than none.

---

## 6. Creating the first customer organisation

The seeder (`npm run seed`) creates a platform administrator **and** three fictional demonstration tenants. For a clean production install, provision only the platform administrator:

```bash
node -e "import('./server/seed/scenarios.js').then(async (m) => {
  const { migrate, closeDb } = await import('./server/db/index.js');
  migrate();
  const p = await m.seedPlatformAdmin();
  console.log('platform admin created:', p.email);
  closeDb();
})"
```

Then create the customer tenant:

```bash
# sign in as the platform administrator
curl -c jar.txt -X POST https://workforce.example.com/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"platform@workforceiq.example","password":"<the password the seeder printed>"}'
# the platform account is flagged to change its password at first sign-in

# provision the tenant
curl -b jar.txt -X POST https://workforce.example.com/api/auth/register-org \
  -H 'content-type: application/json' \
  -d '{"orgName":"Acme Delivery","slug":"acme","industry":"IT Services","country":"IN",
       "currency":"INR","adminEmail":"admin@acme.example","adminName":"Acme Admin",
       "planCode":"professional","modules":["org_admin","data_ingestion","workforce",
       "utilization","allocation","finance","dashboards","reports","ai_assistant","ai_insights"],
       "seats":10,"tempPassword":"<a strong temporary password>"}'
```

The response contains the organisation id and the temporary password (only if you supplied one; otherwise it is generated and returned once). **Deliver it out of band, and the administrator must change it at first sign-in.**

Do not run `npm run seed` on a production install unless you want the demonstration tenants. They are clearly labelled "(Demo)", every employee row carries `is_demo = 1`, and they are useful for training — but a customer should decide deliberately. To remove them later, take a backup first, then delete in a controlled SQL session inside a transaction, since deleting an organisation cascades to its users, employees, allocations and timesheets.

---

## 7. Backup

### 7.1 What to back up

| Item | Why | Recreatable? |
| --- | --- | --- |
| `data/workforceiq.db` (with WAL) | All tenant data, audit trail, sessions | **No** |
| `data/uploads/` | Original uploaded files for lineage | No (source files may exist elsewhere) |
| `data/exports/` | Generated report files referenced in report history | Yes, by regenerating |
| `/opt/workforceiq/.env` | Session secret and configuration | Only by regenerating the secret (invalidates all sessions) |

Losing the `.env` secret does not lose data, but everyone is signed out and any external-model configuration must be re-entered. Store it in your password manager, separately from the backups.

### 7.2 Consistent backup while running

SQLite in WAL mode should be copied with its own backup mechanism, not `cp` alone.

```bash
#!/usr/bin/env bash
# /usr/local/bin/workforceiq-backup.sh
set -euo pipefail
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DEST="/var/backups/workforceiq/$STAMP"
mkdir -p "$DEST"

# 1. online, consistent database backup (safe while the service runs)
sqlite3 /opt/workforceiq/data/workforceiq.db ".backup '$DEST/workforceiq.db'"

# 2. files
tar -czf "$DEST/uploads.tar.gz" -C /opt/workforceiq/data uploads
tar -czf "$DEST/exports.tar.gz" -C /opt/workforceiq/data exports

# 3. verification: the backup must open and contain the expected tables
TABLES=$(sqlite3 "$DEST/workforceiq.db" "SELECT COUNT(*) FROM sqlite_master WHERE type='table';")
if [ "$TABLES" -lt 30 ]; then echo "BACKUP VERIFICATION FAILED ($TABLES tables)" >&2; exit 1; fi
sqlite3 "$DEST/workforceiq.db" "PRAGMA integrity_check;" | grep -qx ok || { echo "INTEGRITY CHECK FAILED" >&2; exit 1; }

# 4. checksum manifest, then expire anything older than 35 days
( cd "$DEST" && sha256sum * > SHA256SUMS )
find /var/backups/workforceiq -maxdepth 1 -type d -mtime +35 -exec rm -rf {} +
echo "backup ok: $DEST"
```

If `sqlite3` is not installed, use the application's own path instead — stop the service and copy `workforceiq.db`, `-wal` and `-shm` together:

```bash
sudo systemctl stop workforceiq
cp -a /opt/workforceiq/data/workforceiq.db* /var/backups/workforceiq/manual-$(date +%F)/
sudo systemctl start workforceiq
```

Never copy only `workforceiq.db` while the service is running and the WAL contains unmerged pages — that produces a backup that is missing the most recent work.

### 7.3 Schedule

```cron
# daily at 01:15 UTC, log the outcome
15 1 * * * root /usr/local/bin/workforceiq-backup.sh >> /var/log/workforceiq-backup.log 2>&1
```

| Data | Frequency | Retention | Off-host copy |
| --- | --- | --- | --- |
| Database + uploads | Daily | 35 days local | Weekly to separate storage |
| `.env` | On change | Permanent | Password manager |
| Full restore test | Quarterly | — | — |

### 7.4 Off-host copy

A backup on the same disk does not survive a disk failure. Copy the daily archive to storage the customer controls (an object store, a NAS, or an encrypted external drive). The product itself makes no network calls, so this is the only outbound operation and it is a deliberate operator choice.

---

## 8. Restore

Practise this before you need it. A restore that has never been rehearsed is a plan, not a capability.

```bash
# 1. stop the service
sudo systemctl stop workforceiq

# 2. preserve the current state (do not delete it — you may need it)
sudo mv /opt/workforceiq/data /opt/workforceiq/data.broken.$(date +%s)

# 3. restore
sudo mkdir -p /opt/workforceiq/data
sudo cp /var/backups/workforceiq/<STAMP>/workforceiq.db /opt/workforceiq/data/
sudo tar -xzf /var/backups/workforceiq/<STAMP>/uploads.tar.gz -C /opt/workforceiq/data
sudo tar -xzf /var/backups/workforceiq/<STAMP>/exports.tar.gz -C /opt/workforceiq/data
sudo chown -R workforceiq:workforceiq /opt/workforceiq/data

# 4. verify before starting
sqlite3 /opt/workforceiq/data/workforceiq.db "PRAGMA integrity_check;"
sqlite3 /opt/workforceiq/data/workforceiq.db "SELECT COUNT(*) FROM employees;"

# 5. start and check
sudo systemctl start workforceiq
curl -fsS http://127.0.0.1:4000/api/health
#   → {"status":"ok", ... "database":"connected" ...}

# 6. sign in as an administrator and confirm a dashboard figure matches the last known value
```

**Point-in-time limitation:** this release has no continuous archiving, so a restore returns to the last backup. The gap between the backup and a failure is lost. If a customer needs a low recovery-point objective, the backup frequency must increase, or the deployment must move to a database with log shipping.

| Objective | This release |
| --- | --- |
| Recovery point objective (RPO) | Up to 24 hours with daily backups |
| Recovery time objective (RTO) | ~15 minutes for a single node (restore the files, restart the service) |
| Restore test evidence | Procedure above executed during development; a customer should re-run it on their own host |

---

## 9. Upgrading

```bash
cd /opt/workforceiq
sudo -u workforceiq git fetch && sudo -u workforceiq git checkout <tag>
sudo -u workforceiq npm ci --omit=dev
sudo -u workforceiq npm install --no-save vite @vitejs/plugin-react tailwindcss postcss autoprefixer typescript
sudo -u workforceiq npm run build
/usr/local/bin/workforceiq-backup.sh          # take a backup BEFORE migrating
sudo systemctl restart workforceiq
sudo -u workforceiq npm run migrate           # idempotent; applies any new migration
```

Order matters: back up before migrating, and restart after the build so the process serves the new assets. Migrations are version-tracked in `schema_migrations` and only apply once.

### 9.1 Rollback

```bash
sudo systemctl stop workforceiq
sudo mv /opt/workforceiq/data /opt/workforceiq/data.failed
sudo cp -a /var/backups/workforceiq/<pre-upgrade>/... /opt/workforceiq/data   # as in §8
cd /opt/workforceiq && sudo -u workforceiq git checkout <previous-tag>
sudo -u workforceiq npm ci --omit=dev && sudo -u workforceiq npm run build
sudo systemctl start workforceiq
```

A migration that added a column is not reversed by the old code; that is why the database is restored from the pre-upgrade backup rather than rolled back in place.

---

## 10. Monitoring and health

| Check | Method | Expected |
| --- | --- | --- |
| Process alive | `systemctl status workforceiq` | `active (running)` |
| Application health | `GET /api/health` | `200` with `"database":"connected"` |
| Disk space | `df -h /opt/workforceiq` | Headroom for growth |
| Backup success | `/var/log/workforceiq-backup.log` | `backup ok:` line each day |
| Error rate | `journalctl -u workforceiq \| grep "unhandled error"` | Should be empty |
| Audit activity | Administration → Audit in the product | Recent sign-ins and imports visible |

Suggested external uptime check: HTTP GET `/api/health`, expecting 200, every 5 minutes. It requires no authentication and touches the database, so it is a genuine liveness check.

---

## 11. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `SESSION_SECRET (min 32 chars) is required in production` | `.env` missing or `NODE_ENV=production` without a secret | Add a 32+ character secret with `openssl rand -hex 32` |
| `SQLITE_CANTOPEN` at start | `data/` not writable by the service user | `chown -R workforceiq:workforceiq /opt/workforceiq/data` |
| `SQLITE_BUSY` under load | Long write transaction or a second process on the same file | Confirm only one service instance; WAL and busy timeout are already configured |
| Interface loads but every API call fails | Reverse proxy not forwarding cookies, or `TRUST_PROXY` misconfigured | Check `proxy_set_header Host` and the `X-Forwarded-*` headers |
| Cookies do not persist behind HTTPS | `Secure` cookie and the browser is on HTTP, or TLS terminates without the proxy passing `X-Forwarded-Proto` | Serve only HTTPS; set `TRUST_PROXY=true` |
| Upload rejected | Over 20 MB or over 20,000 rows | Split the file; both limits are configurable but deliberate |
| Forecast refused | Fewer than 4 months of complete history | Expected behaviour — see the AI governance document |
| `better-sqlite3` fails to install | No prebuilt binary for this Node version, or no compiler | Node 22/24/25 have prebuilt binaries (the module is pinned to 12.11.1 for exactly this reason). On any other Node version, install build tools (`apt-get install -y build-essential python3`) and run `npm rebuild better-sqlite3`. Run `npm run preflight` for a one-line verdict. |
| Sign-in works but the screen is blank | `dist/` not built or stale | `npm run build` and restart |
| You fixed a bug but the user still sees the old behaviour | The browser is running a stale cached bundle | The entry document is now served `no-store`; confirm the bundle with `GET /api/health` → `build`, and compare with `X-App-Build` on the page response. A hard reload (Ctrl+Shift+R) forces it. |
| **Sign-in returns `403 CROSS_SITE_BLOCKED`** | The public host the browser used is not visible to the API: an unset `PUBLIC_HOST`, a proxy that strips `X-Forwarded-Host`, or a client that sends neither `Sec-Fetch-Site` nor a matching `Origin` | Set `PUBLIC_HOST=<the exact public hostname>` in `.env` and restart. Verify with `curl -H "Origin: https://<host>" -X POST .../api/auth/login`. This is a configuration error, not a credential problem — the audit trail will show no login attempt at all. |
| **Sign-in appears to work but returns to the sign-in page** | The session cookie was accepted by the server but not sent back by the browser — usually a framing restriction, a `Secure` cookie on plain HTTP, or the app and API on different addresses | Check `GET /api/auth/me`: it returns `reason: NO_SESSION_COOKIE` or `SESSION_NOT_RECOGNISED` with diagnostics. Set `ALLOW_FRAME_EMBEDDING=true` if the app is framed; set `INSECURE_COOKIES=true` only if you genuinely serve plain HTTP; otherwise serve over TLS. |
| **Sign-in succeeds but the next request is unauthenticated, and the browser shows no cookie** | The environment blocks or partitions cookies (embedded preview frame, third-party cookies disabled, portal stripping `Set-Cookie`) | The web client also stores the session token and sends it as a bearer token, so this now recovers automatically. Confirm with `DEBUG_AUTH_HEADERS`: `token_transport: "bearer"` means the fallback is in use. Cookies remain the primary path for normal deployments. |

---

## 12. Regulatory and contractual notes

- **Data location.** Everything stays on the host the customer controls. No analytics, telemetry, crash reporting or model calls leave the machine in the default configuration.
- **Personnel data.** The product stores employee identifiers, department, grade, skills, dates and cost. It does **not** store bank details, national identifiers, health data or performance ratings.
- **Retention and deletion.** Configurable per organisation; deletion requires two administrators and is audited.
- **Data processing agreement.** A DPA is a legal document and must be prepared with the customer; the architecture supports it by keeping processing inside the customer's environment.
- **Audit for regulators.** The audit trail is exportable (`audit_trail` report, requires `audit.view`) and covers authentication, authorisation-sensitive actions, data changes, approvals and AI activity.

---

## 13. Deployment checklist

Before handing a deployment to a customer:

- [ ] `NODE_ENV=production` and a real `SESSION_SECRET` (32+ characters)
- [ ] `TRUST_PROXY=true` behind TLS, `false` when exposed directly
- [ ] `dist/` built from the tagged source
- [ ] `.env` mode `0600`, owned by the service user, and stored in the password manager
- [ ] `npm run migrate` executed
- [ ] Demonstration tenants removed, or clearly labelled and accepted by the customer
- [ ] Platform administrator password changed from the seeded value
- [ ] First customer tenant provisioned, administrator's temporary password delivered out of band
- [ ] Backup script installed, run once manually, and the log line confirmed
- [ ] Restore rehearsed into a scratch directory
- [ ] Health endpoint monitored externally
- [ ] TLS certificate renewal automated (`certbot renew --dry-run`)
- [ ] Customer told, in writing, what is not in the box: no SSO, no MFA, no email delivery, no scheduled automation
