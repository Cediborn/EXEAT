import { API_BASE } from './config.js';

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

export async function api(path, { method = 'GET', body, headers = {}, query } = {}) {
  let url = `${API_BASE}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') params.set(k, v);
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const csrf = readCookie('entryout_csrf');
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

/** Lightweight reachability probe used by the shell. */
export async function checkHealth() {
  try {
    await apiGet('/api/health');
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.status === 0) return false;
    return true; // server answered, even with an error
  }
}
