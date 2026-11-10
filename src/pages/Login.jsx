import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';

const DEMO_ACCOUNTS = [
  { org: 'IT Services (Nexora)', email: 'admin@nexora-demo.example', role: 'Organization Administrator' },
  { org: 'IT Services (Nexora)', email: 'coo@nexora-demo.example', role: 'Executive' },
  { org: 'IT Services (Nexora)', email: 'finance@nexora-demo.example', role: 'Finance' },
  { org: 'IT Services (Nexora)', email: 'wfm@nexora-demo.example', role: 'Workforce Manager' },
  { org: 'IT Services (Nexora)', email: 'pm@nexora-demo.example', role: 'Project Manager' },
  { org: 'IT Services (Nexora)', email: 'analyst@nexora-demo.example', role: 'Analyst' },
  { org: 'IT Services (Nexora)', email: 'viewer@nexora-demo.example', role: 'Read-only' },
  { org: 'IT Services (Nexora)', email: 'dept.manager@nexora-demo.example', role: 'Dept Manager (scoped)' },
  { org: 'BPO (ContactBridge)', email: 'admin@contactbridge-demo.example', role: 'Organization Administrator' },
  { org: 'BPO (ContactBridge)', email: 'coo@contactbridge-demo.example', role: 'Executive' },
  { org: 'GCC (Helios)', email: 'admin@heliosgcc-demo.example', role: 'Organization Administrator' },
  { org: 'GCC (Helios)', email: 'finance@heliosgcc-demo.example', role: 'Finance' },
];

const DEMO_PASSWORD = 'DemoPass!2026';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showDemo, setShowDemo] = useState(false);
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  async function submit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json?.error?.message || 'Sign-in failed. Check your email and password.');
        return;
      }
      await refresh();
      navigate(location.state?.from || '/', { replace: true });
    } catch {
      setError('Could not reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function pick(account) {
    setEmail(account.email);
    setPassword(DEMO_PASSWORD);
    setError(null);
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-white">
      {/* Brand panel */}
      <div className="hidden lg:flex flex-col justify-between bg-ink-900 text-white p-12">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-600 grid place-items-center font-bold">W</div>
            <div>
              <p className="font-semibold">WorkforceIQ</p>
              <p className="text-xs text-ink-400">Business Operations Intelligence</p>
            </div>
          </div>
          <h1 className="mt-14 text-3xl font-semibold leading-tight max-w-md">
            Connect workforce, projects and financial performance — and act on it.
          </h1>
          <p className="mt-4 text-sm text-ink-300 max-w-md leading-relaxed">
            Utilization and capacity, project demand and staffing gaps, workforce cost and margin,
            and evidence-backed AI recommendations — in one governed platform.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-ink-300 max-w-md">
            {[
              'Every number traceable to a definition and a data source',
              'AI answers grounded in only the data you are authorised to see',
              'Recommendations with evidence, assumptions and approval gates',
              'Strict tenant isolation enforced in the backend, not the interface',
            ].map((t) => (
              <li key={t} className="flex gap-2.5">
                <svg className="w-4 h-4 mt-0.5 shrink-0 text-brand-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m5 13 4 4L19 7" /></svg>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-[11px] text-ink-500 max-w-md leading-relaxed">
          This environment contains fictional demonstration data for three hypothetical customers.
          Figures shown are not real company results, and no customer outcomes are claimed.
        </p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="w-9 h-9 rounded-lg bg-brand-600 text-white grid place-items-center font-bold">W</div>
            <div>
              <p className="font-semibold text-ink-900">WorkforceIQ</p>
              <p className="text-xs text-ink-500">Business Operations Intelligence</p>
            </div>
          </div>
          <h2 className="text-xl font-semibold text-ink-900">Sign in</h2>
          <p className="text-sm text-ink-500 mt-1">Use your organization account.</p>

          <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
            <div>
              <label htmlFor="email" className="label">Work email</label>
              <input id="email" type="email" autoComplete="username" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
            </div>
            <div>
              <label htmlFor="password" className="label">Password</label>
              <input id="password" type="password" autoComplete="current-password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••" />
            </div>
            {error && (
              <div className="rounded-lg bg-danger-50 border border-danger-500/30 px-3 py-2 text-[13px] text-danger-700" role="alert">
                {error}
              </div>
            )}
            <button type="submit" className="btn-primary w-full" disabled={busy || !email || !password}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="mt-6 rounded-xl border border-ink-200 p-3">
            <button type="button" className="flex w-full items-center justify-between text-sm font-medium text-ink-700" onClick={() => setShowDemo((v) => !v)} aria-expanded={showDemo}>
              Demonstration accounts
              <span className="text-ink-400" aria-hidden>{showDemo ? '−' : '+'}</span>
            </button>
            {showDemo && (
              <div className="mt-3 space-y-1 max-h-72 overflow-y-auto pr-1">
                <p className="text-[11px] text-ink-500 mb-2">
                  Click an account to fill the form. Shared password <code className="bg-ink-100 rounded px-1 py-0.5 font-mono text-[11px]">{DEMO_PASSWORD}</code>.
                  Data is fictional.
                </p>
                {DEMO_ACCOUNTS.map((a) => (
                  <button key={a.email} type="button" onClick={() => pick(a)} className="w-full text-left rounded-md px-2 py-1.5 hover:bg-ink-100">
                    <span className="block text-[12px] font-medium text-ink-800">{a.role}</span>
                    <span className="block text-[11px] text-ink-500">{a.org} · {a.email}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <p className="mt-6 text-[11px] text-ink-400 leading-relaxed">
            Access is logged. After several failed attempts an account is temporarily locked.
            Session cookies are HTTP-only and expire automatically.
          </p>
        </div>
      </div>
    </div>
  );
}
