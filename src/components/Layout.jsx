import React, { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { titleCase } from '../lib/format';

function Icon({ name, className = 'w-4.5 h-4.5' }) {
  const paths = {
    dashboard: 'M3 3h7v7H3V3Zm11 0h7v4h-7V3ZM3 14h7v7H3v-7Zm11-3h7v10h-7V11Z',
    workforce: 'M16 11a4 4 0 1 0-8 0 4 4 0 0 0 8 0Zm-4 6c-3.3 0-8 1.7-8 5v1h16v-1c0-3.3-4.7-5-8-5Z',
    projects: 'M4 5h7v6H4V5Zm9 0h7v3h-7V5ZM4 13h7v6H4v-6Zm9 3h7v3h-7v-3Z',
    data: 'M12 3c4.4 0 8 1.3 8 3v12c0 1.7-3.6 3-8 3s-8-1.3-8-3V6c0-1.7 3.6-3 8-3Zm0 2c-3.9 0-6 .9-6 1s2.1 1 6 1 6-.9 6-1-2.1-1-6-1Z',
    insights: 'M12 2a7 7 0 0 0-4 12.7V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.3A7 7 0 0 0 12 2Zm-2 18h4a2 2 0 0 1-4 0Z',
    assistant: 'M4 4h16v12H8l-4 4V4Zm4 4h8M8 11h5',
    forecast: 'M3 17l6-6 4 4 8-8M21 7v5h-5',
    reports: 'M6 2h9l5 5v15H6V2Zm8 1v5h5M9 13h7M9 17h7',
    admin: 'M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Zm0 6a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Zm0 11c-1.7-.6-3.1-1.7-4-3.2.9-1.1 2.4-1.8 4-1.8s3.1.7 4 1.8c-.9 1.5-2.3 2.6-4 3.2Z',
    governance: 'M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Zm-1 6h2v4h-2V8Zm0 6h2v2h-2v-2Z',
    metric: 'M4 19h16M7 19V9m5 10V4m5 15v-7',
    scenario: 'M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm13 0v6m-3-3h6',
  };
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={paths[name] || paths.dashboard} />
    </svg>
  );
}

const NAV = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', perm: ['analytics.utilization', 'analytics.executive'], end: true },
  { to: '/workforce', label: 'Workforce', icon: 'workforce', perm: 'workforce.view' },
  { to: '/utilization', label: 'Utilization', icon: 'metric', perm: 'analytics.utilization' },
  { to: '/projects', label: 'Projects & Demand', icon: 'projects', perm: 'project.view' },
  { to: '/allocation', label: 'Allocation', icon: 'scenario', perm: 'allocation.view' },
  { to: '/finance', label: 'Finance', icon: 'reports', perm: ['finance.view', 'workforce.cost.view'] },
  { to: '/insights', label: 'AI Insights', icon: 'insights', perm: 'ai.insights' },
  { to: '/assistant', label: 'AI Assistant', icon: 'assistant', perm: 'ai.assistant' },
  { to: '/forecast', label: 'Forecast', icon: 'forecast', perm: 'forecast.view' },
  { to: '/reports', label: 'Reports', icon: 'reports', perm: 'report.view' },
  { to: '/data', label: 'Data', icon: 'data', perm: 'import.manage' },
  { to: '/governance', label: 'Automation', icon: 'governance', perm: ['automation.manage', 'approval.manage'] },
  { to: '/admin', label: 'Administration', icon: 'admin', perm: ['org.view', 'user.view', 'audit.view'] },
];

export function Layout({ children }) {
  const { user, org, roles, signOut, permissions, notifications, can, isPlatformAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);

  useEffect(() => { setMobileOpen(false); setUserMenu(false); }, [location.pathname]);

  const primaryRole = roles?.[0]?.name || (isPlatformAdmin ? 'Platform Administrator' : 'User');
  const visibleNav = NAV.filter((n) => can(n.perm));

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[248px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-sm">Skip to content</a>

      {/* sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-[248px] bg-ink-900 text-white flex flex-col transition-transform lg:static lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="px-4 h-14 flex items-center gap-2.5 border-b border-white/10">
          <div className="w-8 h-8 rounded-lg bg-brand-600 grid place-items-center font-bold text-sm">W</div>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight">WorkforceIQ</p>
            <p className="text-[11px] text-ink-400 truncate">Operations intelligence</p>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5" aria-label="Main navigation">
          {visibleNav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}
            >
              <Icon name={n.icon} />
              <span className="truncate">{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="px-3 py-3 border-t border-white/10 text-[11px] text-ink-400 space-y-1">
          <p className="flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-positive-500" /> Demo environment</p>
          <p>Fictional demonstration data</p>
        </div>
      </aside>

      {mobileOpen && <button type="button" aria-label="Close navigation" className="fixed inset-0 z-30 bg-ink-950/40 lg:hidden" onClick={() => setMobileOpen(false)} />}

      <div className="flex flex-col min-w-0">
        <header className="sticky top-0 z-20 h-14 bg-white/95 backdrop-blur border-b border-ink-200 flex items-center gap-3 px-4 lg:px-6 no-print">
          <button type="button" className="lg:hidden btn-ghost btn-sm" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink-800 truncate">{org?.name || 'WorkforceIQ'}</p>
            <p className="text-[11px] text-ink-500 truncate">{primaryRole}{org?.currency ? ` · ${org.currency}` : ''}</p>
          </div>
          <div className="flex items-center gap-2">
            <NavLink to="/notifications" className="relative btn-ghost btn-sm" aria-label={`Notifications (${notifications || 0} unread)`}>
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" /></svg>
              {notifications > 0 && <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-danger-500" />}
            </NavLink>
            <div className="relative">
              <button type="button" onClick={() => setUserMenu((v) => !v)} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-ink-100" aria-expanded={userMenu} aria-haspopup="menu">
                <span className="w-7 h-7 rounded-full bg-brand-100 text-brand-700 grid place-items-center text-xs font-semibold">
                  {(user?.full_name || 'U').split(' ').map((p) => p[0]).slice(0, 2).join('')}
                </span>
                <span className="hidden sm:block text-left">
                  <span className="block text-[13px] font-medium text-ink-800 leading-tight">{user?.full_name}</span>
                  <span className="block text-[11px] text-ink-500 leading-tight">{user?.title || primaryRole}</span>
                </span>
              </button>
              {userMenu && (
                <div className="absolute right-0 mt-1 w-56 card p-1 shadow-raised z-30" role="menu">
                  <div className="px-3 py-2 border-b border-ink-100">
                    <p className="text-xs font-medium text-ink-800 truncate">{user?.email}</p>
                    <p className="text-[11px] text-ink-500">{permissions.length} permissions granted</p>
                  </div>
                  <button type="button" role="menuitem" className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-ink-100" onClick={() => navigate('/account')}>Account & security</button>
                  <button type="button" role="menuitem" className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-ink-100" onClick={() => navigate('/settings')}>Settings</button>
                  <button
                    type="button"
                    role="menuitem"
                    className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-ink-100 text-danger-700"
                    onClick={async () => { await signOut(); navigate('/login'); }}
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <main id="main" className="flex-1 px-4 lg:px-6 py-5 max-w-[1600px] w-full mx-auto">
          {children}
        </main>
        <footer className="px-4 lg:px-6 py-4 text-[11px] text-ink-400 border-t border-ink-200 no-print">
          WorkforceIQ · Demonstration build · All organizations, people and figures in this environment are fictional. Not for production use without the documented deployment and security review.
        </footer>
      </div>
    </div>
  );
}

export { Icon, titleCase };
