/**
 * Rebuild the interface and refresh the committed snapshot in prebuilt/dist.
 *
 * Run this after changing anything under src/, on a machine where the bundler works:
 *
 *     npm run refresh-prebuilt
 *
 * Then commit the result. Without this step, people running on machines where the native
 * bundler binary is blocked keep seeing the previous interface — which is how a fixed bug
 * appears to still be broken.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const run = (args) => execFileSync('npm', args, { cwd: root, stdio: 'inherit' });

console.log('[refresh-prebuilt] building the interface…');
run(['run', 'build']);

const dist = path.join(root, 'dist');
const target = path.join(root, 'prebuilt', 'dist');
if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('[refresh-prebuilt] build produced no dist/index.html — nothing to copy.');
  process.exit(1);
}

fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(dist, target, { recursive: true });

const entry = fs.readdirSync(path.join(target, 'assets')).find((f) => /^index-.*\.js$/.test(f));
const commit = (() => {
  try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); }
  catch { return null; }
})();

fs.writeFileSync(path.join(target, 'BUILD-STAMP.json'), JSON.stringify({
  note: 'Snapshot of the built interface, committed so the app can run on machines where the native bundler binary is blocked by policy. Refresh with npm run refresh-prebuilt after changing src/.',
  entry,
  builtAt: new Date().toISOString(),
  rebuiltFromCommit: commit,
  appVersion: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
}, null, 2) + '\n');

console.log(`[refresh-prebuilt] prebuilt/dist refreshed (entry ${entry}).`);
console.log('[refresh-prebuilt] Commit prebuilt/dist so other machines receive this interface.');
