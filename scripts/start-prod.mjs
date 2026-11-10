/**
 * Cross-platform production start.
 *
 * `NODE_ENV=production node server/index.js` is Unix-only syntax and fails in Windows
 * PowerShell / cmd. This sets the environment variable in JavaScript instead, so the
 * same command works on Windows, macOS and Linux.
 *
 * In production a real SESSION_SECRET is required (minimum 32 characters). It is read
 * from the environment or from a `.env` file in the project root — never hardcoded.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const isWindows = process.platform === 'win32';

process.env.NODE_ENV = 'production';

// Load .env if present (server/config.js also does this, but we need the secret first).
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  const generated = crypto.randomBytes(32).toString('hex');
  const target = path.join(root, '.env');
  const line = `SESSION_SECRET=${generated}`;
  try {
    if (fs.existsSync(target)) fs.appendFileSync(target, `\n${line}\n`);
    else fs.writeFileSync(target, `${line}\n`, { mode: 0o600 });
    console.log(`[start] No SESSION_SECRET found — generated one and saved it to ${target}`);
    console.log('[start] Keep that file private. It is already excluded by .gitignore.');
    process.env.SESSION_SECRET = generated;
  } catch (err) {
    console.error('[start] Production needs a SESSION_SECRET of at least 32 characters.');
    console.error('        Windows PowerShell:  $env:SESSION_SECRET = -join ((1..64) | % { "{0:x}" -f (Get-Random -Max 16) })');
    console.error('        macOS / Linux:       export SESSION_SECRET=$(openssl rand -hex 32)');
    console.error(`        (could not write .env: ${err.message})`);
    process.exit(1);
  }
}

if (!process.env.TRUST_PROXY) process.env.TRUST_PROXY = 'false';

if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) {
  console.error('[start] No built interface found. Run `npm run build` first.');
  process.exit(1);
}

const { start } = await import('../server/index.js');
start(Number(process.env.PORT || 4000));

if (isWindows) {
  console.log('[start] Open http://localhost:4000 in your browser.');
}
