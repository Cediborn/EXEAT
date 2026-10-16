import { apiGet, apiPost } from './api.js';

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
  } catch {
    session.user = null;
    session.profile = null;
    session.houses = [];
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
  emit();
  return data;
}

export async function register(payload) {
  const data = await apiPost('/api/auth/register', payload);
  session.user = data.user;
  session.profile = data.profile;
  session.loaded = true;
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
    emit();
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
