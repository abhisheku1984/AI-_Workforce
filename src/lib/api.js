/** Thin fetch wrapper. Cookies carry the session; credentials always included. */
export class ApiClientError extends Error {
  constructor(message, status, code, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request(path, { method = 'GET', body, headers = {}, signal } = {}) {
  const opts = { method, credentials: 'same-origin', headers: { ...headers }, signal };
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
  const res = await fetch(url, { credentials: 'same-origin' });
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
