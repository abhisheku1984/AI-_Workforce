/**
 * Install the prebuilt interface bundle into dist/.
 *
 * Why this exists: building the interface runs Vite, which runs Rollup, which loads a
 * compiled native module (rollup.win32-x64-msvc.node on Windows). On machines managed by
 * an Application Control / Smart App Control policy that binary can be blocked, and the
 * build fails with "An Application Control policy has blocked this file" even though the
 * rest of the project installs and runs perfectly.
 *
 * The API server only needs dist/ to exist — it does not care how it got there. This
 * script copies a snapshot of the built interface that ships with the repository.
 *
 *     npm run use-prebuilt
 *     node scripts/use-prebuilt.mjs --to <directory>   # install elsewhere
 *
 * The snapshot corresponds to the source at the time it was committed. Rebuild with
 * `npm run build` whenever you change anything under src/, on a machine where the
 * bundler is permitted.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'prebuilt', 'dist');

// --to <dir> installs somewhere else (used by the tests so a real build is never overwritten).
const toIndex = process.argv.indexOf('--to');
const target = toIndex !== -1 && process.argv[toIndex + 1]
  ? path.resolve(process.argv[toIndex + 1])
  : path.join(root, 'dist');
const stampFile = path.join(source, 'BUILD-STAMP.json');

if (!fs.existsSync(path.join(source, 'index.html'))) {
  console.error('[prebuilt] No prebuilt bundle found in prebuilt/dist.');
  console.error('[prebuilt] Build one with: npm run build');
  process.exit(1);
}

fs.rmSync(target, { recursive: true, force: true });
fs.cpSync(source, target, { recursive: true });

let stamp = {};
try { stamp = JSON.parse(fs.readFileSync(stampFile, 'utf8')); } catch { /* optional */ }

const entry = fs.readdirSync(path.join(target, 'assets')).find((f) => /^index-.*\.js$/.test(f));
console.log(`[prebuilt] Interface installed into dist/ (entry: ${entry || 'unknown'})`);
if (stamp.commit) console.log(`[prebuilt] Snapshot of commit ${stamp.commit}${stamp.builtAt ? `, built ${stamp.builtAt}` : ''}`);
console.log('[prebuilt] Note: this is a snapshot, not a fresh build. Run `npm run build` after');
console.log('[prebuilt] changing anything in src/ on a machine where the bundler is allowed.');
console.log('[prebuilt] Start the app with: npm start');
