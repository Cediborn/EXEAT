import { apiGet, apiPost, setCsrfToken } from './api.js';
import { navigate } from './router.js';
import { DEV_BYPASS_AUTH } from './config.js';

/**
 * Session state for the current browser tab.
 * The server is the authority; this cache only avoids extra round trips for
 * navigation rendering. Every protected action is still checked server-side.
 */
export const session = {
  user: null,
  profile: null,
  houses: [],
  loaded: false,
  listeners: new Set(),
};

export function onChange(fn) {
  session.listeners.add(fn);
  return () => session.listeners.delete(fn);
}

function emit() {
  for (const fn of session.listeners) fn(session);
}

export async function loadSession() {
  try {
    const data = await apiGet('/api/auth/me');
    session.user = data.user;
    session.profile = data.profile;
    session.houses = data.houses || [];
    if (data.csrfToken) setCsrfToken(data.csrfToken);
  } catch {
    session.user = null;
    session.profile = null;
    session.houses = [];
    setCsrfToken(null);
  } finally {
    session.loaded = true;
    emit();
  }
  return session;
}

export async function signIn(identifier, password) {
  const data = await apiPost('/api/auth/login', { identifier, password });
  session.user = data.user;
  session.profile = data.profile;
  session.loaded = true;
  if (data.csrfToken) setCsrfToken(data.csrfToken);
  emit();
  return data;
}

export async function register(payload) {
  const data = await apiPost('/api/auth/register', payload);
  session.user = data.user;
  session.profile = data.profile;
  session.loaded = true;
  if (data.csrfToken) setCsrfToken(data.csrfToken);
  emit();
  return data;
}

export async function signOut() {
  try {
    await apiPost('/api/auth/logout', {});
  } finally {
    session.user = null;
    session.profile = null;
    session.houses = [];
    setCsrfToken(null);
    emit();
  }
}

/**
 * Temporary development bypass (see config.js `devBypassAuth`).
 * Signs in as the server's demo test identity through the normal session API —
 * no credentials involved, and nothing about the real sign-in pages changes.
 * If the API has the bypass disabled (e.g. production), this throws and the
 * caller falls back to the original sign-in page.
 */
export async function devSessionSignIn(kind) {
  const data = await apiPost('/api/auth/dev-session', { role: kind });
  session.user = data.user;
  session.profile = data.profile;
  session.houses = [];
  session.loaded = true;
  if (data.csrfToken) setCsrfToken(data.csrfToken);
  emit();
  return data;
}

/**
 * Entry point for the portal buttons: with the development bypass active it
 * opens the matching dashboard directly; otherwise (bypass off, production, or
 * API unavailable) it navigates to the original sign-in page, exactly as before.
 */
export async function portalSignIn(kind) {
  const fallback = kind === 'student' ? '#/signin?role=student' : '#/signin';
  if (!DEV_BYPASS_AUTH || session.user) {
    navigate(session.user ? homeRouteFor(session.user.role) : fallback);
    return false;
  }
  try {
    await devSessionSignIn(kind);
    navigate(kind === 'student' ? '#/app' : '#/staff');
    return true;
  } catch {
    navigate(fallback); // bypass unavailable → original authentication flow
    return false;
  }
}

export const homeRouteFor = (role) => {
  if (role === 'student') return '#/app';
  if (role === 'housemaster' || role === 'senior') return '#/staff';
  if (role === 'gate') return '#/gate';
  if (role === 'admin') return '#/admin';
  return '#/';
};

export const roleLabel = (role) => ({
  student: 'Student',
  housemaster: 'Housemaster / Housemistress',
  senior: 'Senior Housemaster',
  gate: 'Gate officer',
  admin: 'Administrator',
}[role] || role);
