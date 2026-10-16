import { API_BASE, DEMO_MODE } from './config.js';
import { demoHandle } from './demo/api.js';

/**
 * Thin API client.
 *  - sends the CSRF token for mutating requests
 *  - keeps cookies (session) via credentials: 'include'
 *  - normalises errors into { status, message, errors }
 *  - tracks reachability so the UI can be honest when no backend is connected
 */
export const apiState = {
  reachable: null, // null = unknown, true/false after a call
  lastError: null,
};

export class ApiError extends Error {
  constructor(status, message, errors) {
    super(message);
    this.status = status;
    this.errors = errors || null;
  }
}

function readCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Fallback CSRF token for cross-origin hosting (e.g. GitHub Pages talking to
 * the local API): JavaScript on another origin cannot read the localhost CSRF
 * cookie, so the token from the login/me JSON responses is kept in memory.
 * The cookie still takes priority on same-origin deployments.
 */
let sessionCsrfToken = null;

export function setCsrfToken(token) {
  sessionCsrfToken = token || null;
}

export async function api(path, { method = 'GET', body, headers = {}, query } = {}) {
  if (DEMO_MODE) {
    // Hosted demo: every endpoint is answered in-browser by the demo adapter
    // (localStorage-backed), so the full UI works without a backend.
    try {
      const data = await demoHandle(method, path, { body, query, headers });
      apiState.reachable = true;
      apiState.lastError = null;
      return data;
    } catch (err) {
      apiState.reachable = true;
      throw err instanceof ApiError ? err : new ApiError(err.status || 400, err.message, err.errors);
    }
  }

  let url = `${API_BASE}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') params.set(k, v);
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const csrf = readCookie('entryout_csrf') || sessionCsrfToken;
  const init = {
    method,
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };

  let res;
  try {
    res = await fetch(url, init);
    apiState.reachable = true;
    apiState.lastError = null;
  } catch (err) {
    apiState.reachable = false;
    apiState.lastError = err;
    throw new ApiError(0, 'Cannot reach the Entryout server. Check your connection and try again.');
  }

  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }

  if (!res.ok) {
    const message = (data && data.error) || `Request failed (${res.status}).`;
    throw new ApiError(res.status, message, data && data.errors);
  }
  return data;
}

export const apiGet = (path, opts) => api(path, { ...opts, method: 'GET' });
export const apiPost = (path, body, opts) => api(path, { ...opts, method: 'POST', body });
export const apiPatch = (path, body, opts) => api(path, { ...opts, method: 'PATCH', body });
export const apiPut = (path, body, opts) => api(path, { ...opts, method: 'PUT', body });

/**
 * Lightweight reachability probe used by the shell.
 * A static host (e.g. GitHub Pages) answers /api/health with an HTML 404 page,
 * so only a real `{ ok: true }` JSON payload counts as reachable — otherwise the
 * UI must say the backend is not connected instead of pretending.
 */
export async function checkHealth() {
  try {
    const data = await apiGet('/api/health');
    return !!(data && data.ok);
  } catch {
    return false;
  }
}
