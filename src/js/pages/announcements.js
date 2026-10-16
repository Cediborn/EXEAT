import { h } from '../dom.js';
import { apiGet } from '../api.js';
import { setTitle, showBanner } from '../components/shell.js';
import { skeletonCards, alertBox, loadingBlock } from '../components/ui.js';
import { formatDateTime } from '../format.js';

export async function announcementsPage() {
  setTitle('Announcements');
  const list = h('div', { class: 'announce-list' }, skeletonCards(2));

  try {
    const data = await apiGet('/api/announcements');
    const items = data.announcements || [];
    if (!items.length) {
      list.replaceChildren(h('div', { class: 'empty-state' },
        h('h3', null, 'No announcements'),
        h('p', null, 'School notices will appear here.')));
    } else {
      list.replaceChildren(...items.map((a) => h('article', { class: `announce announce-${a.level}` },
        h('div', { class: 'announce-head' },
          h('span', { class: `badge ${a.level === 'urgent' ? 'badge-urgent' : a.level === 'policy' ? 'badge-pending' : 'badge-neutral'}` },
            a.level === 'urgent' ? 'Urgent' : a.level === 'policy' ? 'Policy' : 'Info'),
          h('h3', null, a.title)),
        h('p', null, a.body),
        h('p', { style: { color: 'var(--text-muted)', 'font-size': 'var(--text-xs)', margin: '0.5rem 0 0' } },
          formatDateTime(a.createdAt)))));
    }
  } catch (err) {
    showBanner('danger', 'Could not reach the Entryout server to load announcements.');
    list.replaceChildren(alertBox('warning', 'Announcements unavailable', 'Check your connection and reload the page.'));
  }

  return h('div', { class: 'reveal', style: { 'max-width': '46rem', margin: '0 auto' } },
    h('div', { class: 'page-head' },
      h('div', null,
        h('h1', null, 'School announcements'),
        h('p', { class: 'page-sub' }, 'Rules and notices from the school administration.'))),
    list);
}
