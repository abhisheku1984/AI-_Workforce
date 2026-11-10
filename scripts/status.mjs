/**
 * One-glance state of this checkout, so a support round trip does not have to ask.
 *
 *     npm run status
 *
 * Prints where you are, which commit you are on, and whether the pieces needed to run
 * the app are in place. It never changes anything.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const cwd = process.cwd();
const OK = '\u2714';
const WARN = '!';
const BAD = '\u2718';

const git = (args) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};

console.log('\nWorkforceIQ status\n' + '='.repeat(44));
console.log(`Folder    ${cwd}`);
console.log(`Project   ${root}`);

/* ---------------------------------------------------------------- wrong directory check */

// The single most common mistake: running npm/git from the parent of the project folder.
if (path.resolve(cwd) !== path.resolve(root)) {
  console.log('');
  console.log(`${BAD} You are not in the project folder. npm used ${path.join(cwd, 'package.json')}, which does not exist.`);
  console.log(`   cd "${root}"`);
  if (process.argv.includes('--strict')) process.exit(1);
}

/* ---------------------------------------------------------------- git state */

const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
const commit = git(['rev-parse', '--short', 'HEAD']);
const subject = git(['log', '-1', '--pretty=%s']);
const dirty = git(['status', '--porcelain']);

if (branch) {
  console.log(`Branch    ${branch}`);
  console.log(`Commit    ${commit}  ${subject || ''}`);
  if (dirty) console.log(`${WARN} Uncommitted changes: ${dirty.split('\n').length} file(s)`);
} else {
  console.log(`${BAD} Not a git repository — this folder was copied, not cloned.`);
}

/* ---------------------------------------------------------------- files */

console.log('');
const check = [
  ['node_modules/express', 'Dependencies installed'],
  ['dist/index.html', 'Interface built (dist/)'],
  ['prebuilt/dist/index.html', 'Prebuilt interface snapshot available'],
  ['data/workforceiq.db', 'Database created'],
  ['.env', 'Local .env present'],
];
for (const [rel, label] of check) {
  const full = path.join(root, rel);
  console.log(`${fs.existsSync(full) ? OK : WARN} ${label}${fs.existsSync(full) ? '' : ' — missing'}`);
}
console.log(`${OK} Node ${process.versions.node} (${process.platform} ${process.arch})`);

/* ---------------------------------------------------------------- verdict */

console.log('');
const hasDeps = fs.existsSync(path.join(root, 'node_modules', 'express'));
const hasDist = fs.existsSync(path.join(root, 'dist', 'index.html'));
const hasDb = fs.existsSync(path.join(root, 'data', 'workforceiq.db'));

if (!hasDeps) {
  console.log(`${BAD} Run: npm install`);
} else if (!hasDist) {
  console.log(`${BAD} No interface in dist/. Run: npm run use-prebuilt   (or npm run build)`);
} else if (!hasDb) {
  console.log(`${BAD} No database. Run: npm run migrate   then   npm run seed`);
} else {
  console.log(`${OK} Ready. Start it with: npm start   (http://localhost:4000)`);
}
console.log('');
