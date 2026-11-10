#!/usr/bin/env python3
"""
Set up and run WorkforceIQ from Python — for people working in PyCharm.

WorkforceIQ is a Node.js application, so Python does not run it. This script drives Node
for you: it checks the toolchain, installs dependencies, creates the database, seeds the
demonstration data, builds the interface and starts the server. It is a convenience
wrapper over exactly the commands in LOCAL-SETUP.md, nothing more.

Usage (from the project root, in PyCharm's terminal):
    python tools/python/setup_workforceiq.py check     # can this machine run it?
    python tools/python/setup_workforceiq.py install   # npm install + build + migrate + seed
    python tools/python/setup_workforceiq.py run       # build if needed, then start the server
    python tools/python/setup_workforceiq.py test      # run the test suites
    python tools/python/setup_workforceiq.py reset     # delete local data and reseed

Windows note: npm and node are .cmd shims, so they must be run through the shell; this
script handles that.
"""
from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
IS_WINDOWS = platform.system() == "Windows"
# A Node version with prebuilt better-sqlite3 binaries: 22, 24 or 25.
PREBUILT_MAJORS = {22, 24, 25}


def say(mark: str, text: str) -> None:
    print(f"{mark} {text}")


def run(args: list[str], *, check: bool = True) -> int:
    """Run a command in the project root, shell-aware for Windows .cmd shims."""
    printable = " ".join(args)
    print(f"\n$ {printable}\n")
    result = subprocess.run(printable, cwd=ROOT, shell=True)
    if check and result.returncode != 0:
        print(f"\nCommand failed with exit code {result.returncode}: {printable}")
        sys.exit(result.returncode)
    return result.returncode


def node_version() -> tuple[int, int, int] | None:
    try:
        out = subprocess.run(
            "node -v", cwd=ROOT, shell=True, capture_output=True, text=True, timeout=30
        ).stdout.strip()
    except Exception:
        return None
    if not out.startswith("v"):
        return None
    parts = out[1:].split(".")
    try:
        return int(parts[0]), int(parts[1]), int(parts[2])
    except (ValueError, IndexError):
        return None


def npm_available() -> bool:
    return shutil.which("npm") is not None or shutil.which("npm.cmd") is not None


def cmd_check() -> int:
    print("\nWorkforceIQ preflight (Python wrapper)\n" + "=" * 44)
    blocking = False
    warn = False

    if not npm_available():
        say("X", "npm was not found on PATH. Install Node.js 22 or 24 LTS from nodejs.org.")
        return 1

    version = node_version()
    if not version:
        say("X", "node was not found on PATH. Install Node.js 22 or 24 LTS from nodejs.org.")
        return 1

    major = version[0]
    say("i", f"Node {major}.{version[1]}.{version[2]} on {platform.system()} ({platform.machine()})")
    if major in PREBUILT_MAJORS:
        say("v", f"Node {major} has prebuilt database binaries — no C++ compiler needed.")
    elif major > max(PREBUILT_MAJORS):
        say("!", f"Node {major} is newer than the prebuilt binaries cover; the database module will compile from source.")
        say(" ", "If the install fails, install Node 24 LTS and re-run.")
        warn = True
    else:
        say("X", f"Node {major} is too old. Install Node 22 or 24 LTS.")
        blocking = True

    if (ROOT / "node_modules" / "express").exists():
        say("v", "Dependencies are installed.")
    else:
        say("!", "Dependencies are not installed yet — run: python tools/python/setup_workforceiq.py install")
        warn = True

    if (ROOT / "dist" / "index.html").exists():
        say("v", "Interface is built.")
    elif (ROOT / "prebuilt" / "dist" / "index.html").exists():
        say("!", "Interface not built yet; a prebuilt snapshot is available — run: npm run use-prebuilt")
        warn = True
    else:
        say("!", "Interface is not built yet — the install step does this.")
        warn = True

    if (ROOT / "data" / "workforceiq.db").exists():
        say("v", "Database exists.")
    else:
        say("!", "No database yet — the install step creates and seeds it.")
        warn = True

    if blocking:
        print("\nX Fix the blocking problem above, then run this again.\n")
        return 1
    print(("\n! Ready, with the notes above.\n" if warn else "\nv Everything checks out.\n"))
    return 0


def build_interface() -> bool:
    """Build the interface, falling back to the committed snapshot if policy blocks it."""
    if run(["npm", "run", "build"], check=False) == 0:
        return True
    say("!", "The build failed. On Windows this is usually an Application Control policy")
    say(" ", "blocking the bundler's native binary, not a problem with the app.")
    if (ROOT / "prebuilt" / "dist" / "index.html").exists():
        say("i", "Installing the prebuilt interface snapshot instead.")
        return run(["npm", "run", "use-prebuilt"], check=False) == 0
    return False


def cmd_install() -> int:
    if node_version() is None or not npm_available():
        say("X", "Node.js/npm not found. Install Node 24 LTS first: https://nodejs.org")
        return 1
    run(["npm", "install"])
    build_interface()
    run(["npm", "run", "migrate"])
    run(["npm", "run", "seed"])
    print("\nSetup complete. Start the app with:\n    python tools/python/setup_workforceiq.py run\n")
    return 0


def cmd_run() -> int:
    if not (ROOT / "dist" / "index.html").exists():
        say("i", "No built interface found — building first.")
        build_interface()
    if not (ROOT / "data" / "workforceiq.db").exists():
        say("i", "No database found — creating and seeding it.")
        run(["npm", "run", "migrate"])
        run(["npm", "run", "seed"])
    print("\nStarting WorkforceIQ on http://localhost:4000  (Ctrl+C to stop)\n")
    return run(["npm", "run", "start"], check=False)


def cmd_test() -> int:
    return run(["npm", "test"], check=False)


def cmd_reset() -> int:
    data = ROOT / "data"
    if data.exists():
        shutil.rmtree(data)
        say("v", "Deleted local data directory.")
    run(["npm", "run", "migrate"])
    run(["npm", "run", "seed"])
    print("\nReset complete. Start the app with: python tools/python/setup_workforceiq.py run\n")
    return 0


COMMANDS = {
    "check": cmd_check,
    "install": cmd_install,
    "run": cmd_run,
    "test": cmd_test,
    "reset": cmd_reset,
}


def main() -> int:
    os.chdir(ROOT)
    command = sys.argv[1] if len(sys.argv) > 1 else "check"
    if command not in COMMANDS:
        print(__doc__)
        print("Commands: " + ", ".join(COMMANDS))
        return 2
    return COMMANDS[command]()


if __name__ == "__main__":
    sys.exit(main())
