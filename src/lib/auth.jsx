import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getSessionToken, clearSessionToken } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, permissions: [], org: null, roles: [], modules: [], scopes: null, isPlatformAdmin: false, notifications: 0, authIssue: null, diagnostics: null });

  const refresh = useCallback(async () => {
    let data;
    try {
      ({ data } = await api.get('/api/auth/me'));
    } catch (err) {
      setState((s) => ({ ...s, loading: false, user: null, authIssue: err?.code || 'REQUEST_FAILED' }));
      return null;
    }
    if (!data.user) {
      // Distinguish "never signed in" from "signed in but the session did not stick".
      // Without this the app silently bounces to the sign-in page and the user has no idea why.
      setState((s) => ({
        ...s, loading: false, user: null, authIssue: data.reason || null,
        diagnostics: data.diagnostics || null,
      }));
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
      try { await api.post('/api/auth/logout', {}); } catch { /* signing out locally regardless */ }
      clearSessionToken();
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
        const json = await api.get(path);
        if (!alive) return;
        setState({ loading: false, data: json?.data, meta: json?.meta, error: null });
      } catch (e) {
        if (!alive) return;
        setState({
          loading: false, data: null,
          error: e?.message || 'Network problem. Please check your connection and try again.',
          code: e?.code,
        });
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, skip, tick, ...deps]);

  return { ...state, reload };
}
