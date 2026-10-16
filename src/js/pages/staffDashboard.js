import { h } from '../dom.js';
import { session } from '../auth.js';
import { apiGet } from '../api.js';
import { setTitle, roleLabel } from '../components/shell.js';
import { pageHead, emptyState, loadingBlock, alertBox } from '../components/ui.js';
import { staffRow } from '../components/requestCard.js';
import { HOUSES } from '../validation.js';

const STATUS_FILTERS = [
  ['', 'All'],
  ['pending', 'Awaiting housemaster'],
  ['pending_senior', 'Awaiting senior'],
  ['returned', 'Returned'],
  ['approved', 'Approved'],
  ['completed', 'Completed'],
  ['rejected', 'Rejected'],
  ['cancelled', 'Cancelled'],
];

export function staffDashboardPage() {
  setTitle('Review queue');
  const state = {
    status: '',
    type: '',
    house: '',
    q: '',
    urgent: false,
  };

  const root = h('div', { class: 'reveal' });
  const summarySlot = h('div', { class: 'summary-row' });
  const tableSlot = h('div', null, loadingBlock('Loading requests…'));

  const searchInput = h('input', {
    class: 'input',
    type: 'search',
    id: 'staff-search',
    placeholder: 'Name, index number, reference or destination',
    autocomplete: 'off',
  });
  let debounce;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { state.q = searchInput.value.trim(); refresh(); }, 300);
  });

  const filters = h('div', { class: 'filters' },
    h('div', { class: 'field search' },
      h('label', { for: 'staff-search' }, 'Search'),
      searchInput),
    h('div', { class: 'field' },
      h('label', { for: 'staff-type' }, 'Type'),
      h('select', { class: 'select', id: 'staff-type', onchange: (e) => { state.type = e.target.value; refresh(); } },
        h('option', { value: '' }, 'All types'),
        h('option', { value: 'internal' }, 'Internal'),
        h('option', { value: 'external' }, 'External'))),
    (session.user.role === 'senior' || session.user.role === 'admin')
      ? h('div', { class: 'field' },
          h('label', { for: 'staff-house' }, 'House'),
          h('select', { class: 'select', id: 'staff-house', onchange: (e) => { state.house = e.target.value; refresh(); } },
            h('option', { value: '' }, 'All houses'),
            HOUSES.map((house) => h('option', { value: house }, house))))
      : null,
    h('div', { class: 'field' },
      h('label', { for: 'staff-urgent' }, 'Priority'),
      h('select', { class: 'select', id: 'staff-urgent', onchange: (e) => { state.urgent = e.target.value === 'true'; refresh(); } },
        h('option', { value: '' }, 'All requests'),
        h('option', { value: 'true' }, 'Urgent only'))));

  async function refresh() {
    tableSlot.replaceChildren(loadingBlock('Loading requests…'));
    try {
      const data = await apiGet('/api/staff/requests', {
        query: {
          status: state.status || undefined,
          type: state.type || undefined,
          house: state.house || undefined,
          q: state.q || undefined,
          urgent: state.urgent ? 'true' : undefined,
        },
      });
      renderSummary(data.summary || {});
      renderTable(data.requests || []);
    } catch (err) {
      tableSlot.replaceChildren(emptyState({
        title: 'Could not load the queue',
        message: err.message || 'Please try again.',
        actionLabel: 'Try again',
        onAction: refresh,
      }));
    }
  }

  function renderSummary(summary) {
    const chips = STATUS_FILTERS.filter(([value]) => value !== 'rejected' && value !== 'cancelled')
      .map(([value, label]) => {
        const count = value ? (summary[value] || 0) : Object.values(summary).reduce((a, b) => a + b, 0);
        return h('button', {
          class: 'summary-chip',
          type: 'button',
          'aria-pressed': state.status === value ? 'true' : 'false',
          onclick: () => { state.status = value; refresh(); },
        }, label, h('strong', null, String(count)));
      });
    summarySlot.replaceChildren(...chips);
  }

  function renderTable(requests) {
    if (!requests.length) {
      tableSlot.replaceChildren(emptyState({
        title: 'Nothing in this queue',
        message: 'No requests match the current filters. New requests appear here as students submit them.',
        actionLabel: 'Clear filters',
        onAction: () => {
          state.status = ''; state.type = ''; state.house = ''; state.q = ''; state.urgent = false;
          searchInput.value = '';
          refresh();
        },
      }));
      return;
    }
    tableSlot.replaceChildren(h('div', { class: 'table-wrap' },
      h('table', { class: 'table' },
        h('thead', null,
          h('tr', null,
            h('th', { scope: 'col' }, 'Request'),
            h('th', { scope: 'col' }, 'Student'),
            h('th', { scope: 'col' }, 'Type'),
            h('th', { scope: 'col' }, 'Destination'),
            h('th', { scope: 'col' }, 'Departs'),
            h('th', { scope: 'col' }, 'Status'))),
        h('tbody', null, requests.map((r) => staffRow(r, session.user.role))))));
  }

  refresh();

  const scopeNote = session.user.role === 'housemaster'
    ? `Showing students in ${session.houses.join(', ')}.`
    : session.user.role === 'senior'
      ? 'Showing all requests that require senior approval.'
      : 'Read-only oversight view. Administrators cannot approve requests.';

  root.append(
    pageHead('Review queue', `${roleLabel(session.user.role)} · ${scopeNote}`),
    session.user.role === 'housemaster' ? h('div') : alertBox('info', 'Scope', scopeNote),
    summarySlot,
    filters,
    tableSlot);
  return root;
}
