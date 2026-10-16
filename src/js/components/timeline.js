import { h } from '../dom.js';
import { formatDateTime, relativeTime } from '../format.js';

/** Vertical approval/movement timeline. */
export function timeline(events) {
  if (!events?.length) {
    return h('p', { style: { color: 'var(--text-muted)' } }, 'No events recorded yet.');
  }
  return h('ol', { class: 'timeline' }, events.map((event) => {
    const label = event.label || '';
    const tone = /Approved|Departed|Returned to/.test(label) ? 'is-positive'
      : /Rejected|Cancelled/.test(label) ? 'is-negative'
        : /Submitted|created/i.test(label) ? 'is-active' : '';
    return h('li', { class: `timeline-item ${tone}` },
      h('span', { class: 'timeline-dot', 'aria-hidden': 'true' }),
      h('div', { class: 'timeline-label' }, label),
      h('div', { class: 'timeline-time' }, `${formatDateTime(event.at)} · ${relativeTime(event.at)}`),
      event.detail ? h('div', { class: 'timeline-detail' }, event.detail) : null);
  }));
}
