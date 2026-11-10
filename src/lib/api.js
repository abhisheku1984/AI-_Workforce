/**
 * Thin fetch wrapper.
 *
 * The session travels BOTH ways:
 *   1. as the `wiq_session` cookie (HttpOnly, SameSite as configured), and
 *   2. as a bearer token held in this browser's localStorage.
 *
 * The cookie is the primary mechanism and is what protects a normal deployment. The
 * bearer token exists because some environments block or partition cookies outright —
 * an embedded preview frame, a browser with third-party cookies disabled, or a portal
 * that strips Set-Cookie. Without it, sign-in "succeeds" and every following request
 * arrives unauthenticated, which is indistinguishable from a wrong password to the user.
 *
 * The token is the same opaque 32-byte session token, so the server revokes both
 * representations together: signing out, or changing a password, invalidates it.
 * `credentials: 'include'` is used so the cookie path keeps working even when the app is
 * served from a different origin than the API.
 */
const TOKEN_KEY = 'wiq.session.token';

/**
 * Some sandboxed frames throw on any localStorage access. Keep the token in memory as
 * well, so a session survives within the page even when storage is unavailable.
 */
let memoryToken = null;

export class ApiClientError extends Error {
  constructor(message, status, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getSessionToken() {
  try {
    const stored = window.localStorage.getItem(TOKEN_KEY);
    if (stored) return stored;
  } catch {
    /* storage unavailable — fall through to the in-memory copy */
  }
  return memoryToken;
}

export function setSessionToken(token) {
  memoryToken = token || null;
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable — the in-memory copy still authenticates this page */
  }
}

export function clearSessionToken() {
  setSessionToken(null);
}

function authHeaders(headers) {
  const token = getSessionToken();
  return token ? { ...headers, authorization: `Bearer ${token}` } : { ...headers };
}

/** Raised when the server answers 401 and the caller needs to re-authenticate. */
export const UNAUTHENTICATED = 'UNAUTHENTICATED';

async function request(path, { method = 'GET', body, headers = {}, signal } = {}) {
  const opts = { method, credentials: 'include', headers: authHeaders(headers), signal };
  if (body !== undefined) {
    if (body instanceof FormData) {
      opts.body = body;
    } else {
      opts.headers['content-type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
  }
  const res = await fetch(path, opts);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!res.ok) {
    const err = json?.error || {};
    if (res.status === 401) clearSessionToken();
    throw new ApiClientError(err.message || `Request failed (${res.status})`, res.status, err.code || 'REQUEST_FAILED', err.details);
  }
  return json;
}

export const api = {
  get: (path, opts) => request(path, opts),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
  patch: (path, body, opts) => request(path, { ...opts, method: 'PATCH', body }),
  put: (path, body, opts) => request(path, { ...opts, method: 'PUT', body }),
  del: (path, opts) => request(path, { ...opts, method: 'DELETE' }),
  upload: (path, formData) => request(path, { method: 'POST', body: formData }),
};

export function qs(params = {}) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, v);
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export async function downloadFile(url, filename) {
  const res = await fetch(url, { credentials: 'include', headers: authHeaders({}) });
  if (!res.ok) {
    let msg = 'Download failed.';
    try { msg = (await res.json()).error?.message || msg; } catch { /* ignore */ }
    throw new ApiClientError(msg, res.status, 'DOWNLOAD_FAILED');
  }
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
