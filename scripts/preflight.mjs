/**
 * Preflight: check the machine can run this project, before npm tries to compile anything.
 *
 * Run this FIRST on a new machine (especially Windows):
 *     node scripts/preflight.mjs
 *
 * It answers the only two questions that actually block an install:
 *   1. Is Node a version that has prebuilt database binaries?
 *   2. Do the dependencies actually load?
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const OK = '\u2714';
const WARN = '!';
const BAD = '\u2718';

const lines = [];
const say = (mark, text) => { lines.push(`${mark} ${text}`); };

const major = Number(process.versions.node.split('.')[0]);
const arch = process.arch;
const platform = process.platform;

console.log(`\nWorkforceIQ preflight\n${'='.repeat(44)}`);
console.log(`Node      ${process.versions.node}`);
console.log(`Platform  ${platform} ${arch}`);
console.log('');

let blocking = false;
let nodeWarning = false;

/* ---------------------------------------------------------------- Node version */

// better-sqlite3 12.11.1 ships prebuilt binaries for the Node ABI versions listed in its
// GitHub release: Node 22 (ABI 127), 24 (ABI 137) and 25 (ABI 141).
const PREBUILT_MAJORS = [22, 24, 25];
if (PREBUILT_MAJORS.includes(major)) {
  say(OK, `Node ${major} has a prebuilt database binary — no C++ compiler needed.`);
} else if (major >= 20 && major < 22) {
  say(WARN, `Node ${major} is supported but may compile the database module from source.`);
  nodeWarning = true;
} else if (major > 25) {
  say(WARN, `Node ${major} is newer than the prebuilt binaries cover; the database module will compile from source.`);
  say(WARN, 'If that fails, install Node 24 LTS (nvm-windows or the official installer) and re-run.');
  nodeWarning = true;
} else {
  say(BAD, `Node ${major} is too old. Install Node 22 or 24 LTS from nodejs.org.`);
  blocking = true;
}

/* ---------------------------------------------------------------- dependencies */

const required = ['express', 'helmet', 'compression', 'cookie', 'multer', 'xlsx', 'zod', 'better-sqlite3'];
const missing = required.filter((m) => !fs.existsSync(path.join(root, 'node_modules', m)));
if (missing.length) {
  say(BAD, `Not installed yet: ${missing.join(', ')}`);
  say(' ', 'Run: npm install');
  blocking = true;
} else {
  say(OK, 'Runtime dependencies are installed.');
}

// The one that actually breaks on Windows.
try {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const Database = require('better-sqlite3');
  const pkg = require('better-sqlite3/package.json');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE t (a INTEGER)');
  db.prepare('INSERT INTO t VALUES (?)').run(1);
  const row = db.prepare('SELECT COUNT(*) AS c FROM t').get();
  db.close();
  say(OK, `Database module loads (better-sqlite3 ${pkg.version}, query returned ${row.c}).`);
} catch (err) {
  const msg = String(err.message || err);
  say(BAD, 'The database module does not load.');
  if (/NODE_MODULE_VERSION|was compiled against a different Node\.js/.test(msg)) {
    say(' ', 'It was built for a different Node version. Run: npm rebuild better-sqlite3');
    say(' ', 'Or reinstall: Remove-Item -Recurse -Force node_modules; npm install');
  } else if (/Could not locate the bindings file|bindings/.test(msg)) {
    say(' ', 'The native binary is missing. Run: npm rebuild better-sqlite3');
  } else {
    say(' ', msg.split('\n')[0]);
  }
  blocking = true;
}

/* ---------------------------------------------------------------- front-end toolchain */

if (!fs.existsSync(path.join(root, 'node_modules', 'vite'))) {
  say(WARN, 'The web build tool (vite) is not installed — `npm run build` will say "vite is not recognized".');
  say(' ', 'Run: npm install  (it is a dev dependency and must be installed too)');
  nodeWarning = true;
} else {
  say(OK, 'Web build tool present.');
}

/* ---------------------------------------------------------------- build + database */

if (fs.existsSync(path.join(root, 'dist', 'index.html'))) {
  say(OK, 'Interface is built (dist/ exists).');
} else if (fs.existsSync(path.join(root, 'prebuilt', 'dist', 'index.html'))) {
  say(WARN, 'Interface not built, but a prebuilt snapshot ships with the repository.');
  say(' ', 'Install it with: npm run use-prebuilt    (needs no native code)');
  say(' ', 'Or build from source with: npm run build');
  nodeWarning = true;
} else {
  say(WARN, 'Interface not built yet — run: npm run build');
  nodeWarning = true;
}

// Vite builds with Rollup, which loads a compiled native module. Some Windows policies
// block it outright; detect that and point at the prebuilt path instead of failing later.
try {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  require('rollup');
  say(OK, 'Bundler loads — npm run build will work.');
} catch (err) {
  const msg = String(err.message || err);
  if (/Application Control policy|blocked this file|ERR_DLOPEN_FAILED/i.test(msg)) {
    say(WARN, 'A Windows Application Control policy blocks the bundler (rollup native module).');
    say(' ', 'You cannot run npm run build on this machine. Use the prebuilt interface instead:');
    say(' ', '    npm run use-prebuilt    then    npm start');
    say(' ', 'Or use the dev server, which does not load that binary: npm run dev');
  } else {
    say(WARN, 'Bundler did not load: ' + msg.split('\n')[0]);
    say(' ', 'Run npm install, or use npm run use-prebuilt if only the build fails.');
  }
  nodeWarning = true;
}

const dbFile = path.join(process.env.DATA_DIR || path.join(root, 'data'), 'workforceiq.db');
if (fs.existsSync(dbFile)) {
  say(OK, `Database exists (${dbFile}).`);
} else {
  say(WARN, 'No database yet — run: npm run migrate  then  npm run seed');
  nodeWarning = true;
}

/* ---------------------------------------------------------------- report */

console.log(lines.join('\n'));
console.log('');

if (blocking) {
  console.log(`${BAD} There is a blocking problem above. Fix it and run this again.`);
  console.log('   Full instructions: LOCAL-SETUP.md\n');
  process.exit(1);
}
if (nodeWarning) {
  console.log(`${WARN} Ready, with the notes above.`);
} else {
  console.log(`${OK} Everything checks out. Start the app with: npm start`);
}
console.log('');
