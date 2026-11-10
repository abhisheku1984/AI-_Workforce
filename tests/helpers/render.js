/**
 * Render the real application in a DOM, for the smoke tests.
 *
 * Blank-page bugs cannot be caught by asserting on source text, and they cannot be caught by the
 * API tests either, because the API was fine both times the interface went blank. The only check
 * that would have caught them is rendering the application and looking at the output.
 *
 * happy-dom is a dev dependency. If it is not installed the smoke tests skip with a clear
 * message rather than failing the suite on an environment problem.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const REPO = path.resolve(import.meta.dirname, '..', '..');

// Each render needs its own module instance of the application, otherwise the second render of a
// route gets the cached module back, never mounts, and looks like a blank page that is not there.
let renderCount = 0;

export function domAvailable() {
  try {
    createRequire(path.join(REPO, 'package.json')).resolve('happy-dom');
    return true;
  } catch { return false; }
}

/** Build a signed-in principal the UI will accept. */
export function principalFixture() {
  return {
    user: {
      id: 2, email: 'admin@nexora-demo.example', full_name: 'Nexora Administrator',
      title: 'Organization Administrator', isPlatformAdmin: false,
    },
    org: { id: 1, name: 'Nexora IT Services (Demo)', currency: 'INR' },
    roles: [{ code: 'org_admin', name: 'Organization Administrator' }],
    permissions: [
      'org.view', 'org.manage', 'user.view', 'workforce.view', 'workforce.manage', 'project.view',
      'project.manage', 'allocation.view', 'allocation.manage', 'finance.view', 'analytics.utilization',
      'analytics.executive', 'report.view', 'ai.assistant', 'ai.insights', 'forecast.view',
      'import.manage', 'automation.manage', 'approval.manage', 'audit.view',
      'crm.view', 'crm.draft', 'crm.manage', 'crm.approve',
    ],
    modules: ['org_admin', 'crm'],
    scopes: null,
    notifications: 1,
  };
}

/**
 * Follow a route in the real app.
 * `payloads` is a function (url) => body, so a test can choose between "endpoint returns data"
 * and "endpoint returns nothing yet", which is the state that blanked the pages.
 */
export async function renderRoute(route = '/', { payloads } = {}) {
  const { Window } = await import('happy-dom');
  const window = new Window({ url: `http://localhost:4000${route}`, width: 1280, height: 900 });

  for (const key of ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'HTMLElement',
    'Element', 'Node', 'Event', 'CustomEvent', 'getComputedStyle', 'matchMedia', 'requestAnimationFrame',
    'cancelAnimationFrame', 'location', 'history', 'SVGElement', 'MutationObserver']) {
    const value = window[key];
    if (value === undefined) continue;
    try { globalThis[key] = value; } catch { /* some globals are getter-only */ }
  }

  const principal = principalFixture();
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    let body = { data: null };
    if (u.includes('/auth/me')) body = { data: principal };
    else if (payloads) body = payloads(u) ?? { data: null };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  window.fetch = globalThis.fetch;

  document.body.innerHTML = '<div id="root"></div>';
  const errors = [];
  const realError = console.error;
  console.error = (...args) => { errors.push(args.map(String).join(' ')); };

  try {
    renderCount += 1;
    await import(`${pathToFileURL(path.join(REPO, 'src/main.jsx')).href}?route=${encodeURIComponent(route)}&render=${renderCount}`);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return {
      html: document.getElementById('root').innerHTML,
      text: document.body.textContent || '',
      errors: errors.filter((e) => !/Warning|act\(|not wrapped|Future Flag/.test(e)),
      calls,
    };
  } finally {
    console.error = realError;
  }
}
