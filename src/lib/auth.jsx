import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, permissions: [], org: null, roles: [], modules: [], scopes: null, isPlatformAdmin: false, notifications: 0 });

  const refresh = useCallback(async () => {
    const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
    if (!res.ok) { setState((s) => ({ ...s, loading: false, user: null })); return null; }
    const { data } = await res.json();
    if (!data.user) {
      setState({ loading: false, user: null, permissions: [], org: null, roles: [], modules: [], scopes: null, isPlatformAdmin: false, notifications: 0 });
      return null;
    }
    setState({
      loading: false,
      ...data,
      permissions: data.permissions || [],
      isPlatformAdmin: Boolean(data.user.isPlatformAdmin),
    });
    return data;
  }, []);

  useEffect(() => { refresh().catch(() => setState((s) => ({ ...s, loading: false }))); }, [refresh]);

  const can = useCallback((perm) => {
    if (!perm) return true;
    if (state.isPlatformAdmin) return true;
    const list = Array.isArray(perm) ? perm : [perm];
    return list.some((p) => state.permissions.includes(p));
  }, [state.permissions, state.isPlatformAdmin]);

  const value = useMemo(() => ({
    ...state,
    signedIn: Boolean(state.user),
    refresh,
    can,
    signOut: async () => {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
      setState({ loading: false, user: null, permissions: [], org: null, roles: [], modules: [], scopes: null, isPlatformAdmin: false, notifications: 0 });
    },
  }), [state, refresh, can]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/* ------------------------------------------------------------------ data fetching */
export function useApi(path, { deps = [], skip = false } = {}) {
  const [state, setState] = useState({ loading: !skip, data: null, error: null });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (skip || !path) { setState({ loading: false, data: null, error: null }); return undefined; }
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    (async () => {
      try {
        const res = await fetch(path, { credentials: 'same-origin' });
        const json = await res.json().catch(() => null);
        if (!alive) return;
        if (!res.ok) {
          setState({ loading: false, data: null, error: json?.error?.message || 'Could not load data.', code: json?.error?.code });
          return;
        }
        setState({ loading: false, data: json?.data, meta: json?.meta, error: null });
      } catch (e) {
        if (alive) setState({ loading: false, data: null, error: 'Network problem. Please check your connection and try again.' });
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, skip, tick, ...deps]);

  return { ...state, reload };
}
