import { h } from '../dom.js';
import { session, roleLabel } from '../auth.js';
import { apiGet, apiPost } from '../api.js';
import { setTitle, greeting } from '../components/shell.js';
import { skeletonCards, emptyState, pageHead, toast } from '../components/ui.js';
import { requestCard } from '../components/requestCard.js';
import { formatDateTime, relativeTime } from '../format.js';

export async function studentDashboard() {
  setTitle('My dashboard');
  const user = session.user;
  const profile = session.profile;

  const statsSlot = h('div', { class: 'stat-grid' });
  const listSlot = h('div', null, skeletonCards(3));
  const notesSlot = h('div', { class: 'note-list' }, h('div', { class: 'skeleton skeleton-line', style: { height: '3rem' } }));

  async function refresh() {
    try {
      const [data, notes] = await Promise.all([
        apiGet('/api/requests/mine'),
        apiGet('/api/notifications'),
      ]);
      renderStats(data.requests || []);
      renderList(data.requests || []);
      renderNotes(notes.notifications || []);
    } catch (err) {
      listSlot.replaceChildren(emptyState({
        title: 'Could not load your requests',
        message: err.message || 'Please check your connection and try again.',
        actionLabel: 'Try again',
        onAction: refresh,
      }));
    }
  }

  function renderStats(requests) {
    const pending = requests.filter((r) => ['pending', 'pending_senior'].includes(r.status)).length;
    const approved = requests.filter((r) => ['approved'].includes(r.status)).length;
    const returned = requests.filter((r) => r.status === 'returned').length;
    const completed = requests.filter((r) => r.status === 'completed').length;
    statsSlot.replaceChildren(
      stat(pending, pending === 1 ? 'Awaiting approval' : 'Awaiting approval', pending > 0),
      stat(approved, approved === 1 ? 'Approved pass ready' : 'Approved passes ready', false),
      stat(returned, 'Needs your correction', false),
      stat(completed, 'Completed exeats', false));
  }

  function stat(value, label, accent) {
    return h('div', { class: `stat ${accent ? 'stat-accent' : ''}` },
      h('div', { class: 'stat-value' }, String(value)),
      h('div', { class: 'stat-label' }, label));
  }

  function renderList(requests) {
    if (!requests.length) {
      listSlot.replaceChildren(emptyState({
        title: 'No exeat requests yet',
        message: 'When you apply for an exeat, you can track its approval here and find your pass once it is approved.',
        actionLabel: 'Apply for an exeat',
        onAction: () => { window.location.hash = '#/app/new'; },
      }));
      return;
    }
    const open = requests.filter((r) => !['completed', 'cancelled', 'rejected'].includes(r.status));
    const past = requests.filter((r) => ['completed', 'cancelled', 'rejected'].includes(r.status));
    listSlot.replaceChildren(
      open.length ? h('div', { class: 'request-list' }, open.map(requestCard)) : null,
      past.length ? h('div', { class: 'section', style: { 'margin-top': 'var(--space-8)' } },
        h('div', { class: 'section-head' }, h('h2', null, 'Earlier requests')),
        h('div', { class: 'request-list' }, past.map(requestCard))) : null);
  }

  function renderNotes(notes) {
    if (!notes.length) {
      notesSlot.replaceChildren(h('p', { style: { color: 'var(--text-muted)', 'font-size': 'var(--text-sm)' } },
        'No notifications yet.'));
      return;
    }
    notesSlot.replaceChildren(...notes.slice(0, 6).map((n) => h('div', { class: `note ${n.readAt ? '' : 'is-unread'}` },
      h('div', null,
        h('div', { class: 'note-title' }, n.title),
        h('div', { class: 'note-body' }, n.body),
        h('div', { class: 'note-time' }, relativeTime(n.createdAt))))));
    if (notes.some((n) => !n.readAt)) {
      apiPost('/api/notifications/read-all', {}).catch(() => {});
    }
  }

  refresh();

  const urgentNotice = h('div');

  return h('div', { class: 'reveal' },
    pageHead(`${greeting()}, ${user.fullName.split(' ')[0]}`,
      `${roleLabel(user.role)}${profile ? ` · ${profile.class_year || profile.classYear || ''} · ${profile.house || ''}` : ''}`,
      [h('button', { class: 'btn', type: 'button', onclick: () => { window.location.hash = '#/app/new'; } }, 'Apply for an exeat')]),

    urgentNotice,

    statsSlot,

    h('div', { class: 'split split-main' },
      h('section', null,
        h('div', { class: 'section-head' }, h('h2', null, 'My requests')),
        listSlot),
      h('aside', { class: 'stack' },
        h('div', { class: 'card' },
          h('div', { class: 'card-header' }, h('h2', null, 'Notifications')),
          h('div', { class: 'card-body' }, notesSlot)),
        h('div', { class: 'card card-pad' },
          h('h3', { style: { 'margin-bottom': 'var(--space-2)' } }, 'Need help?'),
          h('p', { style: { color: 'var(--text-muted)', 'font-size': 'var(--text-sm)' } },
            'Speak to your Housemaster or Housemistress if a request is urgent. For medical emergencies, call the school immediately as well as submitting a request.'),
          h('a', { class: 'btn btn-secondary btn-sm', href: '#/announcements', style: { 'margin-top': 'var(--space-3)' } }, 'School announcements')))));
}
