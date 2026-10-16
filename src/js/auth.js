import { apiGet, apiPost, setCsrfToken } from './api.js';
import { navigate } from './router.js';
import { DEV_BYPASS_AUTH, DEMO_MODE } from './config.js';
import { toast, openDialog } from './components/ui.js';
import { h } from './dom.js';

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
 * Demo-mode session (hosted demonstration build): signs in as the seeded
 * identity for the chosen role through the in-browser demo adapter.
 */
export async function demoSessionSignIn(role) {
  const data = await apiPost('/api/auth/demo-session', { role });
  session.user = data.user;
  session.profile = data.profile;
  session.houses = data.houses || [];
  session.loaded = true;
  if (data.csrfToken) setCsrfToken(data.csrfToken);
  emit();
  return data;
}

/** Role picker shown for the staff portal button in demo mode. */
async function pickDemoStaffRole() {
  const roles = [
    ['housemaster', 'Housemaster / Housemistress', 'Reviews requests for your house'],
    ['senior', 'Senior Housemaster', 'Approves external exeats'],
    ['gate', 'Gate officer', 'Verifies passes at the gate'],
    ['admin', 'Administrator', 'Accounts, announcements and policies'],
  ];
  const name = 'demo-staff-role';
  const body = h('div', { class: 'stack' },
    roles.map(([value, label, desc], i) => h('label', { class: 'checkbox' },
      h('input', { type: 'radio', name, value, ...(i === 0 ? { checked: true } : {}) }),
      h('span', { class: 'checkbox-text' },
        h('strong', null, label),
        h('span', { style: { display: 'block', color: 'var(--text-muted)', 'font-size': 'var(--text-sm)' } }, desc)))));
  const confirmed = await openDialog({
    title: 'Choose a demo staff role',
    body,
    confirmLabel: 'Enter workspace',
    cancelLabel: 'Cancel',
  });
  if (!confirmed) return null;
  const checked = body.querySelector(`input[name="${name}"]:checked`);
  return checked ? checked.value : null;
}

/**
 * Entry point for the portal buttons:
 *  - demo mode: opens the matching dashboard (staff first picks a role)
 *  - development bypass: opens a demo test session through the local API
 *  - otherwise: navigates to the original sign-in page
 */
export async function portalSignIn(kind) {
  const fallback = kind === 'student' ? '#/signin?role=student' : '#/signin';

  if (DEMO_MODE) {
    if (session.user) {
      navigate(homeRouteFor(session.user.role));
      return true;
    }
    try {
      if (kind === 'student') {
        await demoSessionSignIn('student');
        navigate('#/app');
      } else {
        const role = await pickDemoStaffRole();
        if (!role) return false;
        await demoSessionSignIn(role);
        navigate(homeRouteFor(role));
      }
      return true;
    } catch {
      navigate(fallback);
      return false;
    }
  }

  if (!DEV_BYPASS_AUTH || session.user) {
    navigate(session.user ? homeRouteFor(session.user.role) : fallback);
    return false;
  }
  try {
    await devSessionSignIn(kind);
    navigate(kind === 'student' ? '#/app' : '#/staff');
    return true;
  } catch (err) {
    navigate(fallback); // bypass unavailable → original authentication flow
    if (DEV_BYPASS_AUTH && err && err.status === 0) {
      // Network-level failure (typical when browsing the hosted site: the
      // browser blocked the first request to the developer's local API behind
      // its one-time "local network access" prompt). Allow it and click again.
      toast('Could not reach the local demo API. If your browser asked for local-network access, allow it, then click the button again.', { type: 'error', title: 'Demo session unavailable' });
    }
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
