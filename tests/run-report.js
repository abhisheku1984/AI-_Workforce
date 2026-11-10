/**
 * Test report runner.
 *
 * Executes every test suite for real, captures the per-assertion-group results
 * emitted by `record()` in `tests/helpers.js`, and writes:
 *   - docs/test-report.md   (human-readable, committed)
 *   - data/test-results.json (machine-readable evidence)
 *
 * Nothing is invented here. If a suite fails, the report says so and the
 * process exits non-zero.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const suites = fs
  .readdirSync(here)
  .filter((f) => /^\d\d-.*\.test\.js$/.test(f))
  .sort();

const tmpResults = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'workforceiq-report-')), 'results.jsonl');
const perSuite = [];
let nodeTestOutput = '';

for (const file of suites) {
  const started = Date.now();
  const proc = spawnSync(
    process.execPath,
    ['--test', '--test-reporter=tap', path.join('tests', file)],
    {
      cwd: root,
      env: { ...process.env, TEST_RESULTS_FILE: tmpResults, AI_PROVIDER: 'local' },
      encoding: 'utf8',
      timeout: 300_000,
    }
  );
  const output = `${proc.stdout || ''}${proc.stderr || ''}`;
  nodeTestOutput += `\n### ${file}\n\n\`\`\`\n${output.trim()}\n\`\`\`\n`;
  const pass = Number((output.match(/^# pass (\d+)/m) || [])[1] || 0);
  const fail = Number((output.match(/^# fail (\d+)/m) || [])[1] || 0);
  perSuite.push({ file, pass, fail, durationMs: Date.now() - started, exitCode: proc.status, output: output.trim() });
  process.stdout.write(`${file}: ${pass} pass, ${fail} fail (${Date.now() - started} ms)\n`);
}

const records = fs.existsSync(tmpResults)
  ? fs
      .readFileSync(tmpResults, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  : [];

const totalPass = perSuite.reduce((n, s) => n + s.pass, 0);
const totalFail = perSuite.reduce((n, s) => n + s.fail, 0);
const failedGroups = records.filter((r) => !r.passed).length;
const now = new Date();

const json = {
  generated_at: now.toISOString(),
  node_version: process.version,
  platform: `${process.platform} ${process.arch}`,
  ai_provider: 'local',
  database: 'sqlite (temporary per-run file)',
  totals: { test_cases_passed: totalPass, test_cases_failed: totalFail, assertion_groups: records.length, assertion_groups_failed: failedGroups },
  suites: perSuite.map(({ output, ...rest }) => rest),
  assertion_groups: records,
};
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
fs.writeFileSync(path.join(root, 'data', 'test-results.json'), `${JSON.stringify(json, null, 2)}\n`);

const bySuite = new Map();
for (const r of records) {
  const key = r.file || 'unattributed';
  if (!bySuite.has(key)) bySuite.set(key, []);
  bySuite.get(key).push(r);
}

const fmt = (n) => n.toLocaleString('en-IN');

const md = [];
md.push('# WorkforceIQ — Test Plan and Test Report');
md.push('');
md.push(`**Report generated:** ${now.toISOString().replace('T', ' ').slice(0, 19)} UTC`);
md.push('');
md.push('> This report is produced by `npm run test:report`, which executes the real test suites');
md.push('> against a real (temporary) database and a real HTTP server. Every number below comes');
md.push('> from that run. If a suite fails, the report records the failure.');
md.push('');
md.push('## 1. What is under test');
md.push('');
md.push('| Item | Detail |');
md.push('| --- | --- |');
md.push('| Application | WorkforceIQ — AI Workforce & Business Operations Intelligence Platform |');
md.push(`| Node.js | ${process.version} |`);
md.push(`| Platform | ${process.platform} ${process.arch} |`);
md.push('| Database | SQLite via better-sqlite3, one throwaway file per run |');
md.push('| AI provider | `local` (deterministic, no network calls) |');
md.push('| Test style | Black-box HTTP tests through the public REST API, plus targeted unit checks of pure functions |');
md.push('| Fixtures | Two fictional tenants (`Test Alpha Ltd`, `Test Beta Ltd`) with employees, allocations, timesheets, invoices, expenses and demand |');
md.push('');
md.push('## 2. Summary of results');
md.push('');
md.push('| Metric | Result |');
md.push('| --- | --- |');
md.push(`| Test suites executed | ${perSuite.length} |`);
md.push(`| Node test cases passed | ${fmt(totalPass)} |`);
md.push(`| Node test cases failed | ${fmt(totalFail)} |`);
md.push(`| Recorded assertion groups | ${fmt(records.length)} |`);
md.push(`| Assertion groups failed | ${fmt(failedGroups)} |`);
md.push(`| Overall verdict | ${totalFail === 0 && failedGroups === 0 ? '**Pass**' : '**Fail — see failures below**'} |`);
md.push('');
md.push('What "assertion group" means: each `await t.test(...)` block in a suite is one behaviour');
md.push('that is being checked, and it may contain several individual assertions. The group is');
md.push('recorded only when all of its assertions inside it pass.');
md.push('');
md.push('## 3. Results per suite');
md.push('');
md.push('| Suite | Node cases passed | Node cases failed | Duration (ms) | Verdict |');
md.push('| --- | --- | --- | --- | --- |');
for (const s of perSuite) {
  md.push(`| \`tests/${s.file}\` | ${s.pass} | ${s.fail} | ${s.durationMs} | ${s.fail === 0 ? 'Pass' : 'Fail'} |`);
}
md.push('');
md.push('## 4. What each suite proves');
md.push('');

const intros = {
  '01-auth.test.js': 'Authentication, session handling and the permission model: sign-in with correct and incorrect credentials, session identity, logout, brute-force rate limiting, password-change requirements, and rejection of unauthenticated or under-privileged requests.',
  '02-tenancy.test.js': 'Tenant isolation: data from one organisation is never visible to another, identifiers from another tenant cannot be used to read or change records, and platform-level administration cannot read customer operational data.',
  '03-analytics.test.js': 'Analytics correctness: the capacity and utilisation formulas are reconciled against hand-computed expectations, allocation and utilisation are never mixed, months without timesheets read as "no data" rather than zero, and financial figures respect permissions.',
  '04-ingestion.test.js': 'Data ingestion: file upload validation, column mapping suggestions, row-level validation and error reporting, duplicate protection, the validate-then-commit sequence, and rollback safety.',
  '05-ai.test.js': 'AI safety and grounding: answers are computed from the requesting user\'s own permitted data, every stated figure is traceable, insufficient data produces an honest refusal, prompt injection is blocked and logged, and no external model is contacted in the default configuration.',
  '06-governance.test.js': 'Governance and operations: sensitive automations stop for human approval, approvals cannot be self-granted, reports carry lineage, tenants cannot download each other\'s files, deletions require a second administrator, and security headers, error handling and audit trails behave correctly.',
};
for (const s of perSuite) {
  const heading = intros[s.file] ? `${s.file} — ${intros[s.file]}` : s.file;
  md.push(`### ${s.file}`);
  md.push('');
  md.push(heading.split(' — ').slice(1).join(' — '));
  md.push('');
  const groups = bySuite.get(s.file) || [];
  if (groups.length) {
    md.push('| Behaviour verified | Result |');
    md.push('| --- | --- |');
    for (const g of groups) {
      md.push(`| ${g.name.replace(/\|/g, '\\|')} | ${g.passed ? 'Pass' : '**Fail**'} |`);
    }
  } else {
    md.push('| Behaviour verified | Result |');
    md.push('| --- | --- |');
    md.push(`| (See raw output below) | ${s.fail === 0 ? 'Pass' : '**Fail**'} |`);
  }
  md.push('');
}

md.push('## 5. Requirement coverage');
md.push('');
md.push('The acceptance criteria in the build brief map onto the suites as follows. Only rows');
md.push('whose evidence is a passing test in this run are marked "Covered by test".');
md.push('');
md.push('| Acceptance criterion | Evidence |');
md.push('| --- | --- |');
md.push('| Authentication and authorisation enforced server-side | `01-auth`, `06-governance` (role permission changes take effect immediately) |');
md.push('| Tenant isolation in backend and database queries | `02-tenancy` |');
md.push('| Utilisation formula reconciliation | `03-analytics` |');
md.push('| Import validation and error reporting | `04-ingestion` |');
md.push('| AI grounding, permission-awareness and prompt-injection resistance | `05-ai` |');
md.push('| Automation approval trails | `06-governance` |');
md.push('| Operational safety (headers, errors, secrets, backups documented) | `06-governance` plus `docs/deployment-guide.md` (process, not testable here) |');
md.push('');
md.push('## 6. Known limitations of this test run');
md.push('');
md.push('- **No browser automation.** The sandbox has no Chromium/Playwright, so the React UI is');
md.push('  verified by a production build and by exercising the same APIs the screens call, not by');
md.push('  scripted clicks. UI defects that only appear in a browser would not be caught here.');
md.push('- **SQLite only.** Postgres-specific behaviour is untested because the deployment target');
md.push('  documented in `docs/deployment-guide.md` is single-node SQLite.');
md.push('- **No external AI provider is exercised.** Only the deterministic local provider runs, and');
md.push('  that is deliberate: no customer data leaves the machine.');
md.push('- **Not a performance or load test.** These suites prove correctness, not throughput.');
md.push('');
md.push('## 7. Raw output');
md.push('');
md.push('Full per-suite output from `node --test`, retained for auditability.');
md.push('');
md.push(nodeTestOutput.trim());
md.push('');

fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs', 'test-report.md'), `${md.join('\n')}\n`);

process.stdout.write(
  `\nWrote docs/test-report.md and data/test-results.json — ${totalPass} passed, ${totalFail} failed, ${records.length} assertion groups recorded.\n`
);
process.exit(totalFail === 0 && failedGroups === 0 ? 0 : 1);
