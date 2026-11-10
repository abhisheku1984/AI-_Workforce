/**
 * Interface smoke tests.
 *
 * These exist because the application went blank twice, and neither time did any existing test
 * notice: the API was healthy, the source was syntactically valid, and the bundle built cleanly.
 * The failures were render-time errors — a temporal dead zone in a hook dependency list, and
 * pages reading `.data.x` before the request resolved.
 *
 * The only check that catches that class of bug is to render the application and look at the
 * result. So that is what these tests do, through the real entry point, with the API stubbed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

// The application is written in JSX, which node cannot parse on its own. Register the loader here
// rather than relying on a command-line flag, so that plain `npm test` runs these tests too.
if (!process.env.WORKFORCEIQ_JSX_LOADER) {
  register('./support/jsx-loader.mjs', import.meta.url);
  process.env.WORKFORCEIQ_JSX_LOADER = '1';
}

const { domAvailable, renderRoute } = await import('./helpers/render.js');

const SKIP = domAvailable() ? false : 'happy-dom is not installed — run npm install';

const ROUTES = [
  '/', '/workforce', '/utilization', '/projects', '/crm', '/allocation', '/finance',
  '/insights', '/assistant', '/forecast', '/reports', '/data', '/governance', '/admin',
  '/settings', '/account', '/notifications', '/metrics',
];

test('Interface: every route renders something', { skip: SKIP }, async (t) => {
  for (const route of ROUTES) {
    await t.test(`${route} renders without throwing`, async () => {
      const { html, errors } = await renderRoute(route);
      assert.ok(html.trim().length > 0, `${route} rendered an empty page`);
      assert.deepEqual(errors, [], `${route} produced render errors:\n${errors.join('\n')}`);
    });
  }
});

test('Interface: renders with no API data at all', { skip: SKIP }, async (t) => {
  // This is the state that blanked Reports, Governance, Admin, Settings and Metrics: every
  // endpoint returning { data: null } while requests are in flight or after they fail.
  for (const route of ['/crm', '/reports', '/governance', '/admin', '/settings', '/metrics']) {
    await t.test(`${route} survives an empty response`, async () => {
      const { html, errors } = await renderRoute(route, { payloads: () => ({ data: null }) });
      assert.ok(html.trim().length > 0, `${route} went blank when the API returned nothing`);
      assert.deepEqual(errors, [], `${route} threw with no data:\n${errors.join('\n')}`);
    });
  }
});

test('Interface: the shell contains the navigation and the AI author', { skip: SKIP }, async (t) => {
  await t.test('the signed-in shell renders its navigation', async () => {
    const { html } = await renderRoute('/');
    assert.match(html, /Main navigation/, 'the sidebar did not render');
    assert.match(html, /crm/i, 'the CRM link is missing from the navigation');
  });

  await t.test('the AI author button is present on every page', async () => {
    for (const route of ['/', '/crm', '/assistant', '/finance']) {
      const { html } = await renderRoute(route);
      assert.match(html, /AI author/, `no AI author button on ${route}`);
    }
  });

  await t.test('the CRM page shows its approval queue', async () => {
    const { text } = await renderRoute('/crm', {
      payloads: (u) => (u.includes('/crm/summary')
        ? { data: { total: 0, open_count: 0, open_value: 0, won_value: 0, by_stage: [] } }
        : { data: [] }),
    });
    assert.match(text, /Waiting for approval/);
  });
});
