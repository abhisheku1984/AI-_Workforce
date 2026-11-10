import { migrate, getDb, closeDb } from '../db/index.js';
import { seedAll, seedPlatformAdmin } from './scenarios.js';
import { generateInsights } from '../ai/insights.js';
import { loadPrincipal } from '../auth/session.js';
import { createSession } from '../auth/session.js';
import { resolvePeriod } from '../lib/capacity.js';
import { getDb as db } from '../db/index.js';

/**
 * Seeds the three fictional demonstration organizations and generates their
 * initial insights so the app is immediately demonstrable.
 */
async function main() {
  migrate();
  const platform = await seedPlatformAdmin();
  if (platform.created) {
    console.log(`[seed] platform admin: ${platform.email} / ${platform.password} (must change password at first sign-in)`);
  }
  const results = await seedAll();

  // Generate insights as each org's administrator so scope matches a real user.
  for (const r of results) {
    if (!r.orgId) continue;
    const admin = db().prepare(`SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id
        JOIN roles ro ON ro.id = ur.role_id WHERE u.org_id = ? AND ro.code = 'org_admin' LIMIT 1`).get(r.orgId);
    if (!admin) continue;
    const { token } = createSession({ userId: admin.id, orgId: r.orgId, ip: 'seed', userAgent: 'seed' });
    const principal = loadPrincipal(token);
    const period = resolvePeriod({ month: new Date().toISOString().slice(0, 7) });
    const gen = generateInsights(principal, { period });
    console.log(`[seed] insights for org ${r.orgId} (${r.slug}): ${gen.generated} generated`);
  }

  console.log('\n[seed] Demo sign-in credentials (all demo organizations):');
  console.log('  organisation                email                              role');
  for (const s of [
    { slug: 'demo-it-services', domain: 'nexora-demo.example' },
    { slug: 'demo-bpo', domain: 'contactbridge-demo.example' },
    { slug: 'demo-gcc', domain: 'heliosgcc-demo.example' },
  ]) {
    for (const u of ['admin', 'coo', 'finance', 'wfm', 'pm', 'analyst', 'viewer', 'dept.manager']) {
      console.log(`  ${s.slug.padEnd(26)} ${`${u}@${s.domain}`.padEnd(34)} ${u}`);
    }
  }
  console.log('\n  Shared demo password: DemoPass!2026');
  console.log('  IMPORTANT: demo data is fictional and must not be used as evidence of real customer results.\n');
  closeDb();
}

main().catch((err) => { console.error(err); process.exit(1); });
