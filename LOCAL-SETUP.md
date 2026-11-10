# Running WorkforceIQ on your own machine (Windows + PyCharm)

This is the fastest path to a working local copy. Total time on a clean machine: 5–10 minutes.
All commands below are for **Windows PowerShell**, which is what PyCharm's terminal uses by default.

---

## 0. What you need first

| Requirement | Check | If missing |
| --- | --- | --- |
| Node.js 20 or newer | `node -v` | Download the **LTS** installer from nodejs.org. Use Node 22 or 24. |
| npm | `npm -v` | Comes with Node. |
| Git | `git --version` | Download Git for Windows. |
| Python (for PyCharm) | — | Not required to run the app. Only PyCharm itself needs it. |

> **Important:** WorkforceIQ is a **Node.js** application. PyCharm can host it, but you will run
> it with `npm` in PyCharm's terminal, not with Python. PyCharm Professional also has Node.js
> run configurations (see §5). PyCharm Community will not offer that, so use the terminal — it
> works identically.

---

## 1. Get the code

```powershell
cd C:\Users\<you>\Projects
git clone -b arena/441f1caa-ai-workforce https://github.com/abhisheku1984/AI-_Workforce.git
cd AI-_Workforce
```

The branch is `arena/441f1caa-ai-workforce`. If you clone without `-b`, run
`git checkout arena/441f1caa-ai-workforce` afterwards.

No Git? Download the ZIP from the same branch on GitHub, extract it, and `cd` into the folder.
(The `.git` folder is absent in that case; nothing else changes.)

---

## 2. Install the dependencies

```powershell
npm install
```

This takes 1–3 minutes. `better-sqlite3` is a compiled module: on Windows it downloads a
prebuilt binary for your Node version. **If it tries to compile from source**, install the
Visual Studio C++ build tools, or simply make sure you are on Node 22 LTS (prebuilt binaries
exist for it).

If you see `gyp ERR!` or `MSBuild` errors, that is the missing C++ toolchain, not the app.

---

## 3. Create the database and the demonstration data

```powershell
npm run migrate
npm run seed
```

`npm run seed` prints the demo sign-in details at the end. It creates three **fictional**
demonstration organisations — every name ends in "(Demo)" and every row is flagged as demo data.

---

## 4. Start it

**Easiest, one process, one port:**

```powershell
npm run build
npm start
```

Open **http://localhost:4000** in your browser.

Sign in with:

| Segment | Email | Password |
| --- | --- | --- |
| IT services | `admin@nexora-demo.example` | `DemoPass!2026` |
| BPO | `admin@contactbridge-demo.example` | `DemoPass!2026` |
| GCC | `admin@heliosgcc-demo.example` | `DemoPass!2026` |

Other roles in each tenant: `coo@`, `finance@`, `wfm@`, `pm@`, `analyst@`, `viewer@`,
`dept.manager@` — same domain, same password.

**Alternative, development mode with hot reload (two servers, two ports):**

```powershell
npm run dev
```

Then open **http://localhost:5173** (the API runs on 4000 and the web server proxies to it).

To stop a server, press `Ctrl+C` in that terminal.

---

## 5. Using PyCharm

You do not need a Python interpreter for this project. Recommended setup:

1. **Open the project:** `File → Open` → select the `AI-_Workforce` folder.
2. **Use the built-in terminal:** `View → Tool Windows → Terminal` (or `Alt+F12`). It opens in the
   project folder, so the commands in §2–§4 work directly.
3. **Run it with one click** (PyCharm Professional only):
   `Run → Edit Configurations → + → npm` → set *package.json* to the project's `package.json`,
   *Command* = `run`, *Scripts* = `start` → OK → press the green Run arrow.
   On PyCharm Community, create a **Shell Script** configuration pointing at a `.ps1` file that
   contains `npm start`, or just keep using the terminal.
4. **Mark folders:** right-click `docs` → `Mark Directory as → Not Excluded` if PyCharm greys it out.
5. **Exclude `node_modules`** from indexing to keep the IDE fast:
   right-click `node_modules` → `Mark Directory as → Excluded`.

A one-line launcher, if you want to double-click something: create `run.ps1` in the project root:

```powershell
Set-Location $PSScriptRoot
npm run build
npm start
```

Then in PyCharm: `Run → Edit Configurations → + → Shell Script → Script path: run.ps1`.

---

## 6. Common Windows problems

| Symptom | Cause | Fix |
| --- | --- | --- |
| `'NODE_ENV' is not recognized as an internal or external command` | The old start script used Unix syntax | Already fixed in this branch: use `npm start` (it sets production mode in JavaScript) |
| `gyp ERR! find Python` / `MSBuild` | No C++ build tools for `better-sqlite3` | Use Node 22 LTS, then `npm rebuild better-sqlite3` |
| `EADDRINUSE :::4000` | Port 4000 already used | `$env:PORT=4100; npm start` then open http://localhost:4100 |
| `SESSION_SECRET ... required in production` | `npm run start:prod` without a secret | The script now generates one into `.env` automatically |
| Blank page after `npm start` | No build yet | Run `npm run build` first; the server serves `dist/` |
| Browser shows old behaviour after an update | Cached page | `Ctrl+Shift+R`. The entry page is now served `no-store`, so this should not recur |
| `npm` blocked by execution policy in PowerShell | Windows policy | Run once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |

Check the build the server is actually serving: open **http://localhost:4000/api/health** — the
`build` field names the exact bundle in use.

---

## 7. Prove it works

```powershell
npm test
```

You should see **101 passing, 0 failing**. The suites boot the real server against a temporary
database and exercise authentication, tenancy, analytics, imports, AI grounding and governance.

Regenerate the test report (writes `docs/test-report.md`):

```powershell
npm run test:report
```

---

## 8. Where everything lives

```
AI-_Workforce\
  server\       API, database, migrations, services, AI
  src\          React interface (18 screens)
  tests\        six test suites
  docs\         16 project documents — start with docs\README.md
  data\         created on first run: workforceiq.db, uploads\, exports\
```

`data\` is the only thing you need to back up. `.env` (created on first production start) holds
the session secret — keep it private; it is already excluded from Git.

---

## 9. Resetting to a clean state

```powershell
Remove-Item -Recurse -Force data
npm run migrate
npm run seed
```

This deletes all local data (including anything you imported) and rebuilds the demonstration set.
