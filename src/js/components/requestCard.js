import { h } from '../dom.js';
import { statusBadge, urgentBadge, typePill } from './ui.js';
import { formatDateTime, relativeTime, durationLabel } from '../format.js';
import { categoryLabel } from '../validation.js';

/** Compact card linking to a request's detail page. */
export function requestCard(request) {
  return h('a', {
    class: 'request-card',
    href: `#/app/requests/${request.id}`,
  },
    h('div', { class: 'request-card-top' },
      h('span', { class: 'request-ref' }, request.reference),
      h('span', { style: { display: 'flex', gap: '0.5rem', alignItems: 'center' } },
        request.urgent ? urgentBadge() : null,
        statusBadge(request.status, request.statusLabel))),
    h('h3', null, request.destination),
    h('p', { style: { color: 'var(--text-muted)', 'font-size': 'var(--text-sm)', margin: 0 } },
      categoryLabel(request.category)),
    h('div', { class: 'request-meta' },
      h('span', null, typePill(request.type)),
      h('span', null, `Departs ${formatDateTime(request.departAt)}`),
      h('span', null, `Back ${formatDateTime(request.returnAt)}`),
      h('span', null, durationLabel(request.departAt, request.returnAt)),
      request.submittedAt ? h('span', null, `Submitted ${relativeTime(request.submittedAt)}`) : null));
}

/** Staff queue row. */
export function staffRow(request, role) {
  const canDecide = ['pending', 'pending_senior'].includes(request.status)
    && !(role === 'senior' && request.status === 'pending')
    && !(role === 'housemaster' && request.status === 'pending_senior');
  return h('tr', null,
    h('td', null,
      h('a', { class: 'row-link', href: `#/staff/requests/${request.id}` }, request.reference),
      h('div', { style: { color: 'var(--text-muted)', 'font-size': 'var(--text-xs)' } },
        canDecide ? 'Action needed' : 'View only')),
    h('td', null,
      h('div', { style: { fontWeight: 600 } }, request.student?.fullName || '—'),
      h('div', { style: { color: 'var(--text-muted)', 'font-size': 'var(--text-xs)' } },
        `${request.student?.classYear || ''} · ${request.student?.house || ''}`)),
    h('td', null, typePill(request.type)),
    h('td', null, request.destination,
      h('div', { style: { color: 'var(--text-muted)', 'font-size': 'var(--text-xs)' } },
        categoryLabel(request.category))),
    h('td', null, formatDateTime(request.departAt)),
    h('td', null, h('span', { style: { display: 'inline-flex', gap: '0.35rem', 'flex-wrap': 'wrap' } },
      request.urgent ? urgentBadge() : null,
      statusBadge(request.status, request.statusLabel))));
}
