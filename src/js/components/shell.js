import { h, clear } from '../dom.js';
import { session, signOut, homeRouteFor, roleLabel, portalSignIn } from '../auth.js';
import { navigate } from '../router.js';
import { APP_NAME } from '../config.js';

const PUBLIC_LINKS = [
  { href: '#/', label: 'Home' },
  { href: '#/announcements', label: 'Announcements' },
  { href: '#/help', label: 'How it works' },
];

const STUDENT_LINKS = [
  { href: '#/app', label: 'Dashboard' },
  { href: '#/app/new', label: 'Apply' },
  { href: '#/announcements', label: 'Announcements' },
];

const STAFF_LINKS = [
  { href: '#/staff', label: 'Review queue' },
  { href: '#/announcements', label: 'Announcements' },
];

const GATE_LINKS = [
  { href: '#/gate', label: 'Verify pass' },
];

const ADMIN_LINKS = [
  { href: '#/admin', label: 'Admin' },
  { href: '#/staff', label: 'Review queue' },
];

function linksFor(role) {
  if (role === 'student') return STUDENT_LINKS;
  if (role === 'housemaster' || role === 'senior') return STAFF_LINKS;
  if (role === 'gate') return GATE_LINKS;
  if (role === 'admin') return ADMIN_LINKS;
  return PUBLIC_LINKS;
}

export function renderShell() {
  const nav = document.getElementById('main-nav');
  const actions = document.getElementById('header-actions');
  const mobile = document.getElementById('mobile-nav');
  const toggle = document.getElementById('nav-toggle');
  const role = session.user?.role;
  const links = linksFor(role);
  const hash = window.location.hash || '#/';

  clear(nav);
  clear(actions);
  clear(mobile);

  for (const link of links) {
    const isCurrent = hash === link.href || (link.href !== '#/' && hash.startsWith(link.href));
    nav.append(h('a', { href: link.href, 'aria-current': isCurrent ? 'page' : null }, link.label));
    mobile.append(h('a', { href: link.href, 'aria-current': isCurrent ? 'page' : null }, link.label));
  }

  if (session.user) {
    const home = homeRouteFor(session.user.role);
    actions.append(
      h('a', { class: 'btn btn-secondary btn-sm', href: home }, session.user.fullName.split(' ')[0] || 'Account'),
      h('button', {
        class: 'btn btn-sm',
        type: 'button',
        onclick: async () => {
          await signOut();
          closeMobileNav();
          navigate('#/');
        },
      }, 'Sign out'));
    mobile.append(h('button', {
      class: 'btn',
      type: 'button',
      onclick: async () => {
        await signOut();
        closeMobileNav();
        navigate('#/');
      },
    }, 'Sign out'));
  } else {
    actions.append(
      h('a', {
        class: 'btn btn-secondary btn-sm', href: '#/signin',
        onclick: (e) => { e.preventDefault(); portalSignIn('staff'); },
      }, 'Staff sign in'),
      h('a', {
        class: 'btn btn-sm', href: '#/signin?role=student',
        onclick: (e) => { e.preventDefault(); portalSignIn('student'); },
      }, 'Student portal'));
    mobile.append(h('a', {
      class: 'btn', href: '#/signin',
      onclick: (e) => { e.preventDefault(); portalSignIn('staff'); },
    }, 'Sign in'));
  }

  toggle.onclick = () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
    toggle.setAttribute('aria-label', open ? 'Open menu' : 'Close menu');
    mobile.hidden = open;
  };
}

export function closeMobileNav() {
  const toggle = document.getElementById('nav-toggle');
  const mobile = document.getElementById('mobile-nav');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'Open menu');
  mobile.hidden = true;
}

/** Honest, non-blocking notice when the API cannot be reached. */
export function showBanner(kind, message) {
  const slot = document.getElementById('banner-slot');
  clear(slot);
  if (!message) return;
  slot.append(h('div', { class: `app-banner app-banner-${kind}` },
    h('span', { 'aria-hidden': 'true' }, kind === 'danger' ? '⚠' : 'ℹ'),
    h('span', null, message)));
}

export function bootTitle() {
  document.title = `${APP_NAME} — Your exeat, simplified`;
}

export function setTitle(title) {
  document.title = `${title} · ${APP_NAME}`;
}

export function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export { roleLabel };
