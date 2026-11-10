# Running WorkforceIQ on your own machine (Windows + PyCharm)

This is the fastest path to a working local copy. Total time on a clean machine: 5–10 minutes.
All commands below are for **Windows PowerShell**, which is what PyCharm's terminal uses by default.

---

## 0. What you need first

| Requirement | Check | If missing |
| --- | --- | --- |
| Node.js **22, 24 or 25** | `node -v` | Download the **LTS** installer from nodejs.org. **Avoid Node 26+/very new releases** until the database module publishes binaries for them. |
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

### You must be inside the project folder

Every `npm` and `git` command must run **inside** the folder that contains `package.json`.
If your prompt shows the parent directory, they all fail with `ENOENT ... open 'package.json'`
or `fatal: not a git repository`:

```text
PS E:\PythonProject1>              <-- wrong: the repository is one level down
PS E:\PythonProject1\AI-_Workforce>  <-- right
```

Fix: `cd AI-_Workforce`

If you are ever unsure where you are or what state the checkout is in, run:

```powershell
npm run status
```

It prints the folder, branch, commit, and whether dependencies, the interface, the database and
`.env` are present, then tells you the one next step. It changes nothing.

## 2. Check the machine first (10 seconds)

```powershell
node scripts/preflight.mjs
```

This reports the Node version, whether the prebuilt database binary matches it, and whether
dependencies, the interface and the database are present. It prints one short verdict instead of
a screenful of compiler output. If it says something is wrong, fix that before continuing.

If you would rather stay inside Python/PyCharm, the same check is available as a Python wrapper:

```powershell
python tools\python\setup_workforceiq.py check
```

## 3. Install the dependencies

```powershell
npm install
```

This takes 1–3 minutes. It downloads a **prebuilt** database binary for your Node version —
no C++ compiler is needed on Node 22, 24 or 25.

> **If you are on Node 24 and `npm install` fails with `gyp ERR! find VS ... Could not find any
> Visual Studio installation`,** that was a real defect in this project: it pinned
> `better-sqlite3` 13.x, and 13.x publishes **no** prebuilt binaries at all, so every Windows
> machine had to compile it. The dependency is now pinned to **12.11.1**, which ships prebuilt
> binaries for Node 22, 24 and 25 on Windows x64.
>
> Fix, from the project folder:
>
> ```powershell
> git pull
> Remove-Item -Recurse -Force node_modules      # clear the half-installed tree
> npm install
> ```
>
> If you cannot pull, the one-line workaround is `npm install better-sqlite3@12.11.1` after
> installing the rest, or installing Node 22 LTS and re-running `npm install`.
>
> Only if none of that works do you need the C++ toolchain: the "Desktop development with C++"
> workload from Visual Studio Build Tools, which is a large download.

---

## 4. Create the database and the demonstration data

```powershell
npm run migrate
npm run seed
```

`npm run seed` prints the demo sign-in details at the end. It creates three **fictional**
demonstration organisations — every name ends in "(Demo)" and every row is flagged as demo data.

---

## 5. Start it

> **If `npm start` prints nothing at all and returns to the prompt**, you are on a build older than
> the fix for this: the server decided whether it was being run directly by string-matching
> `server/index.js` against `process.argv[1]`, which is an absolute path with **backslashes** on
> Windows, so the match failed and the server never started. Pull the latest code
> (`git pull`) — the check now compares resolved paths, and a failed port bind reports itself
> instead of exiting quietly.

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

## 6. Using PyCharm

You do not need a Python interpreter for this project. Recommended setup:

1. **Open the project:** `File → Open` → select the `AI-_Workforce` folder.
2. **Use the built-in terminal:** `View → Tool Windows → Terminal` (or `Alt+F12`). It opens in the
   project folder, so the commands in §3–§5 work directly.
3. **Run it with one click** (PyCharm Professional only):
   `Run → Edit Configurations → + → npm` → set *package.json* to the project's `package.json`,
   *Command* = `run`, *Scripts* = `start` → OK → press the green Run arrow.
   On PyCharm Community, create a **Shell Script** configuration pointing at a `.ps1` file that
   contains `npm start`, or just keep using the terminal.
4. **Mark folders:** right-click `docs` → `Mark Directory as → Not Excluded` if PyCharm greys it out.
5. **Exclude `node_modules`** from indexing to keep the IDE fast:
   right-click `node_modules` → `Mark Directory as → Excluded`.

**Prefer Python?** There is a small wrapper that drives Node for you, so you can run everything
from a PyCharm Python run configuration (`Run → Edit Configurations → + → Python`):

| Command | Does |
| --- | --- |
| `python tools\python\setup_workforceiq.py check` | Reports whether the machine can run it |
| `python tools\python\setup_workforceiq.py install` | `npm install`, build, migrate, seed |
| `python tools\python\setup_workforceiq.py run` | Builds if needed, then starts the server |
| `python tools\python\setup_workforceiq.py test` | Runs the test suites |
| `python tools\python\setup_workforceiq.py reset` | Deletes local data and reseeds |

It still requires Node on PATH — it is a convenience wrapper, not a Python implementation.

**Check the working directory** of any PyCharm run configuration you create: it must be the
project root (`E:\PythonProject1\AI-_Workforce`), not the parent folder, or the wrapper will
not find `package.json`. PyCharm defaults it to whatever folder you had open, so set it
explicitly in the configuration's *Working directory* field.

A one-line launcher, if you want to double-click something: create `run.ps1` in the project root:

```powershell
Set-Location $PSScriptRoot
npm run build
npm start
```

Then in PyCharm: `Run → Edit Configurations → + → Shell Script → Script path: run.ps1`.

---

## 7. Common Windows problems

| Symptom | Cause | Fix |
| --- | --- | --- |
| `'NODE_ENV' is not recognized as an internal or external command` | The old start script used Unix syntax | Already fixed in this branch: use `npm start` (it sets production mode in JavaScript) |
| `gyp ERR! find VS ... Could not find any Visual Studio installation` | You are on a `better-sqlite3` version with no prebuilt binary for your Node (this project previously pinned 13.x, which has none) | `git pull` (now pinned to 12.11.1, which has Windows prebuilts for Node 22/24/25), then `Remove-Item -Recurse -Force node_modules; npm install`. Still failing: install Node 22 LTS, or the VS C++ build tools. |
| `'vite' is not recognized` | `npm install` failed earlier, so dev dependencies were never installed | Fix the install error first; `npm run build` needs `vite` |
| `An Application Control policy has blocked this file` (rollup `.node`) | A Windows security policy blocks the bundler's native binary — not an app defect | `npm run use-prebuilt` then `npm start`; or `npm run dev`; see §7b |
| `npm error enoent ... open 'package.json'` or `fatal: not a git repository` | You are running the command one folder above the repository | `cd AI-_Workforce`, then `npm run status` — see the box at the top of §1 |
| `npm start` prints nothing, returns to the prompt | Server's direct-invocation check failed on Windows path separators (fixed) | `git pull`, then `npm start` |
| `npm start` exits with "Port 4000 is already in use" | Another copy is still running | `Get-NetTCPConnection -LocalPort 4000 -State Listen \| Select-Object OwningProcess`, then `Stop-Process -Id <pid>`; or `$env:PORT=4001; npm start` |
| `EADDRINUSE :::4000` | Port 4000 already used | `$env:PORT=4100; npm start` then open http://localhost:4100 |
| `SESSION_SECRET ... required in production` | `npm run start:prod` without a secret | The script now generates one into `.env` automatically |
| Blank page after `npm start` | No build yet | Run `npm run build` first; the server serves `dist/` |
| Browser shows old behaviour after an update | Cached page | `Ctrl+Shift+R`. The entry page is now served `no-store`, so this should not recur |
| `npm` blocked by execution policy in PowerShell | Windows policy | Run once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |

Check the build the server is actually serving: open **http://localhost:4000/api/health** — the
`build` field names the exact bundle in use.

---

## 7b. If the build is blocked by a security policy

`npm run build` runs Vite → Rollup → a compiled native module
(`rollup.win32-x64-msvc.node`). On managed Windows machines, Application Control or Smart App
Control can block that file:

```
Error: An Application Control policy has blocked this file.
  ...\node_modules\@rollup\rollup-win32-x64-msvc\rollup.win32-x64-msvc.node
    code: 'ERR_DLOPEN_FAILED'
```

This is your machine's policy, not a defect in the app — and note that the **database** module
loaded fine, so only that one binary is affected. You have three options, best first:

**1. Use the prebuilt interface (no native code, works everywhere)**

A snapshot of the built interface ships with the repository in `prebuilt/dist/`. The server only
needs `dist/` to exist; it does not care how it got there.

```powershell
npm run use-prebuilt
npm start
```

Trade-off, stated plainly: it is a **snapshot of the source as committed**, not a fresh build. If
you edit anything under `src/`, the change will not appear until you rebuild on a machine where
the bundler is permitted.

**2. Use the dev server** — `npm run dev` uses esbuild for the interface and does **not** load
the Rollup binary. Open http://localhost:5173. Hot reload works, so this is the better choice if
you intend to change the front end. (If esbuild is blocked too, fall back to option 1.)

**3. Ask IT to allow the file** — allow
`node_modules\@rollup\rollup-win32-x64-msvc\rollup.win32-x64-msvc.node`, or the project folder,
then `npm run build`.

To check which of these applies before you start, run `node scripts/preflight.mjs`: it loads the
bundler deliberately and tells you if it is blocked.

## 8. Prove it works

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

## 9. Where everything lives

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

## 10. Resetting to a clean state

```powershell
Remove-Item -Recurse -Force data
npm run migrate
npm run seed
```

This deletes all local data (including anything you imported) and rebuilds the demonstration set.
