import { h } from '../dom.js';
import { session, portalSignIn } from '../auth.js';
import { navigate } from '../router.js';
import { apiGet } from '../api.js';
import { setTitle } from '../components/shell.js';
import { skeletonCards, alertBox } from '../components/ui.js';
import { formatDateTime } from '../format.js';

export async function landingPage() {
  setTitle('Your exeat, simplified');
  const announcementsSlot = h('div', null, skeletonCards(2));

  apiGet('/api/announcements')
    .then((data) => {
      const items = (data.announcements || []).slice(0, 3);
      if (!items.length) {
        announcementsSlot.replaceChildren(
          h('p', { style: { color: 'var(--text-muted)' } }, 'No announcements right now.'));
        return;
      }
      announcementsSlot.replaceChildren(h('div', { class: 'announce-list' },
        items.map((a) => h('article', { class: `announce announce-${a.level}` },
          h('div', { class: 'announce-head' },
            h('span', { class: `badge ${a.level === 'urgent' ? 'badge-urgent' : a.level === 'policy' ? 'badge-pending' : 'badge-neutral'}` },
              a.level === 'urgent' ? 'Urgent' : a.level === 'policy' ? 'Policy' : 'Info'),
            h('h3', null, a.title)),
          h('p', null, a.body),
          h('p', { style: { color: 'var(--text-muted)', 'font-size': 'var(--text-xs)', margin: '0.5rem 0 0' } },
            formatDateTime(a.createdAt))))));
    })
    .catch(() => {
      announcementsSlot.replaceChildren(
        alertBox('warning', 'Announcements unavailable', 'We could not load school announcements right now.'));
    });

  const isStudent = session.user?.role === 'student';

  const page = h('div', { class: 'reveal' },
    /* Hero */
    h('section', { class: 'hero' },
      h('div', null,
        h('span', { class: 'hero-eyebrow' }, 'School exeat management'),
        h('h1', null, 'Your exeat. ', h('span', { class: 'accent' }, 'Simplified.')),
        h('p', { class: 'hero-lead' },
          'Request permission, track approvals, and access your authorised exeat pass in one place.'),
        h('div', { class: 'hero-actions' },
          isStudent
            ? h('button', { class: 'btn btn-lg', type: 'button', onclick: () => navigate('#/app') }, 'Go to my dashboard')
            : h('button', { class: 'btn btn-lg', type: 'button', onclick: portalClick('student') }, 'Student portal'),
          h('button', {
            class: 'btn btn-secondary btn-lg',
            type: 'button',
            onclick: session.user ? () => navigate(homeFor(session.user.role)) : portalClick('staff'),
          }, session.user ? 'My workspace' : 'Staff sign in')),
        h('p', { class: 'hero-note' },
          'Internal and external exeats · Housemaster and Senior Housemaster approvals · Digital gate pass')),

      h('div', { class: 'hero-visual', 'aria-hidden': 'true' },
        h('div', { class: 'hero-pass' },
          h('div', { class: 'hero-pass-top' },
            h('div', null,
              h('div', { style: { 'font-size': '0.7rem', 'text-transform': 'uppercase', 'letter-spacing': '0.08em', opacity: 0.9 } }, 'Exeat pass'),
              h('div', { class: 'code' }, 'EXE-2026-0042')),
            h('div', { style: { 'font-size': '0.75rem', 'font-weight': 600 } }, '✓ APPROVED')),
          h('div', { class: 'hero-pass-body' },
            h('div', { class: 'hero-pass-row' }, h('span', null, 'Student'), h('span', null, 'K. Mensah · SHS 2')),
            h('div', { class: 'hero-pass-row' }, h('span', null, 'House'), h('span', null, 'Balmer-Acquaah')),
            h('div', { class: 'hero-pass-row' }, h('span', null, 'Destination'), h('span', null, 'Cape Coast')),
            h('div', { class: 'hero-pass-row' }, h('span', null, 'Depart'), h('span', null, 'Sat, 8:00 am')),
            h('div', { class: 'hero-pass-row' }, h('span', null, 'Return by'), h('span', null, 'Sun, 5:00 pm')),
            h('div', { style: { 'font-family': 'var(--font-mono)', 'letter-spacing': '0.14em', 'font-weight': 700, 'font-size': '1.1rem', 'text-align': 'center', padding: '0.75rem', border: '1.5px dashed var(--coral-400)', 'border-radius': 'var(--radius)', background: 'var(--accent-soft)' } }, 'MFSQ 4T2K 8ZPW'))))),

    /* Three steps */
    h('section', { class: 'section' },
      h('div', { class: 'section-title' },
        h('h2', null, 'How it works'),
        h('p', null, 'Three simple steps to request your exeat')),
      h('div', { class: 'steps reveal-stagger' },
        step(1, 'Fill the form',
          'Enter your reason, destination, and when you will leave and return. Your name, class and house come from your school account.'),
        step(2, 'Get approval',
          'Your Housemaster or Housemistress reviews the request. External exeats also need the Senior Housemaster’s approval.'),
        step(3, 'Go and return',
          'Your parent or guardian can be alerted. Show your approved exeat pass at the school gate when you leave and when you return.'))),

    /* Features */
    h('section', { class: 'section' },
      h('div', { class: 'feature-grid reveal-stagger' },
        feature('⏱', 'Faster reviews', 'No more queuing with the exeat book. Requests reach the right housemaster instantly.'),
        feature('🔐', 'Verified passes', 'Every pass is issued by the school record — a screenshot cannot fake an approval.'),
        feature('📱', 'Built for phones', 'Apply, track and show your pass from any phone, even on a slow connection.'))),

    /* Announcements */
    h('section', { class: 'section' },
      h('div', { class: 'section-head' },
        h('h2', null, 'School announcements'),
        h('a', { href: '#/announcements' }, 'View all')),
      announcementsSlot),

    /* CTA */
    h('section', { class: 'card card-pad', style: { textAlign: 'center' } },
      h('h2', { style: { 'margin-bottom': 'var(--space-2)' } }, 'Ready to request your exeat?'),
      h('p', { style: { color: 'var(--text-muted)', 'margin-bottom': 'var(--space-5)' } },
        'Sign in with the student ID given to you by the school.'),
      h('div', { class: 'btn-row', style: { justifyContent: 'center' } },
        h('button', { class: 'btn', type: 'button', onclick: portalClick('student') }, 'Student sign in'),
        h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => navigate('#/help') }, 'How it works'))));

  return page;
}

/**
 * Portal buttons: with the development bypass enabled they open the dashboard
 * directly via a demo test session; otherwise they go to the sign-in page.
 * Behaviour, labels and styling outside of that are unchanged.
 */
function portalClick(kind) {
  return async (event) => {
    const btn = event.currentTarget;
    if (btn) btn.disabled = true;
    try {
      await portalSignIn(kind);
    } finally {
      if (btn && btn.isConnected) btn.disabled = false;
    }
  };
}

function step(number, title, text) {
  return h('div', { class: 'step' },
    h('div', { class: 'step-number' }, String(number)),
    h('h3', null, title),
    h('p', null, text));
}

function feature(icon, title, text) {
  return h('div', { class: 'feature' },
    h('h3', null, h('span', { class: 'feature-icon', 'aria-hidden': 'true' }, icon), title),
    h('p', null, text));
}

function homeFor(role) {
  if (role === 'student') return '#/app';
  if (role === 'gate') return '#/gate';
  if (role === 'admin') return '#/admin';
  return '#/staff';
}
