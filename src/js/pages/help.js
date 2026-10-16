import { h } from '../dom.js';
import { setTitle } from '../components/shell.js';
import { navigate } from '../router.js';
import { session } from '../auth.js';

export function helpPage() {
  setTitle('How it works');

  const steps = [
    ['Sign in with your school account',
      'Students sign in with the student ID issued by the school. Housemasters, Senior Housemasters and gate officers use their staff accounts.'],
    ['Choose internal or external exeat',
      'An internal exeat covers movement within the local area. An external exeat needs the Senior Housemaster’s approval and at least 24 hours’ notice.'],
    ['Enter your reason, destination and times',
      'Say clearly why you are leaving, where you are going, when you will leave and when you will be back. Medical categories can be marked urgent.'],
    ['Housemaster reviews your request',
      'Your Housemaster or Housemistress sees the request in their queue and approves, rejects, or returns it for correction with a reason.'],
    ['Senior approval for external exeats',
      'External exeats continue to the Senior Housemaster after the housemaster approves. No pass is issued while an approval is still outstanding.'],
    ['Show your digital pass at the gate',
      'Once every required approval is recorded, your pass appears on your dashboard. The gate officer verifies the code, records your departure and your return.'],
  ];

  return h('div', { class: 'reveal', style: { 'max-width': '46rem', margin: '0 auto' } },
    h('div', { class: 'page-head' },
      h('div', null,
        h('h1', null, 'How Entryout works'),
        h('p', { class: 'page-sub' }, 'The digital version of the school exeat book — same rules, less paperwork.'))),

    h('div', { class: 'help-steps section' },
      steps.map(([title, text], index) => h('div', { class: 'help-step' },
        h('div', { class: 'help-num' }, String(index + 1)),
        h('div', null, h('h3', null, title), h('p', null, text))))),

    h('section', { class: 'section card card-pad' },
      h('h2', { style: { 'margin-bottom': 'var(--space-3)' } }, 'Things to know'),
      h('ul', { style: { display: 'grid', gap: 'var(--space-3)' } },
        bullet('Medical emergencies', 'Mark a medical request as urgent so it rises to the top of the review queue — and call your housemaster or the school emergency number as well. Software does not replace an emergency call.'),
        bullet('Parent or guardian', 'External exeats need a guardian contact. Guardians can be alerted when a pass is approved, once an SMS provider is connected.'),
        bullet('Approval is not departure', 'An approved pass lets you leave during the authorised window. The gate officer records when you actually leave and return.'),
        bullet('Returned for correction', 'If your housemaster returns the request, fix what they asked for and resubmit. It goes back to the housemaster stage.'),
        bullet('Privacy', 'Your reason for leaving is only visible to the staff who approve requests — not to gate officers.'))),

    h('div', { class: 'btn-row' },
      session.user
        ? h('a', { class: 'btn', href: session.user.role === 'student' ? '#/app' : '#/staff' }, 'Go to my workspace')
        : h('button', { class: 'btn', type: 'button', onclick: () => navigate('#/signin') }, 'Sign in'),
      h('a', { class: 'btn btn-secondary', href: '#/announcements' }, 'School announcements')));
}

function bullet(title, text) {
  return h('li', { style: { display: 'flex', gap: 'var(--space-3)' } },
    h('span', { style: { color: 'var(--accent-strong)', 'font-weight': 700 } }, '•'),
    h('div', null, h('strong', null, title), ' — ', h('span', { style: { color: 'var(--ink-700)' } }, text)));
}
