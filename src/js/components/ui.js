import { h, clear } from '../dom.js';

/* ---------- Toasts ---------- */

export function toast(message, { type = 'info', title, duration = 4200 } = {}) {
  const region = document.getElementById('toast-region');
  if (!region) return;
  const node = h('div', { class: `toast toast-${type}` },
    h('div', null,
      title ? h('div', { class: 'toast-title' }, title) : null,
      h('div', null, message)),
    h('button', {
      class: 'toast-close',
      type: 'button',
      'aria-label': 'Dismiss notification',
      onclick: () => node.remove(),
    }, '×'));
  region.append(node);
  setTimeout(() => node.remove(), duration);
}

/* ---------- Dialog ---------- */

/**
 * Open an accessible modal dialog. Resolves with the value passed to
 * confirm(), or null when cancelled/closed.
 */
export function openDialog({ title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  const root = document.getElementById('dialog-root');
  const previous = document.activeElement;
  let resolveFn;

  const dialog = h('div', {
    class: 'dialog',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'dialog-title',
  },
    h('div', { class: 'dialog-header' }, h('h2', { id: 'dialog-title' }, title)),
    h('div', { class: 'dialog-body' }, body),
    h('div', { class: 'dialog-footer' },
      h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => close(null) }, cancelLabel),
      h('button', {
        class: `btn ${danger ? 'btn-danger' : ''}`,
        type: 'button',
        onclick: () => close(true),
      }, confirmLabel)));

  const backdrop = h('div', {
    class: 'dialog-backdrop',
    onclick: (event) => { if (event.target === backdrop) close(null); },
  }, dialog);

  function onKeyDown(event) {
    if (event.key === 'Escape') close(null);
    if (event.key === 'Tab') trapFocus(event);
  }

  function trapFocus(event) {
    const focusable = dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function close(result) {
    document.removeEventListener('keydown', onKeyDown);
    backdrop.remove();
    if (previous && previous.focus) previous.focus();
    resolveFn(result);
  }

  document.addEventListener('keydown', onKeyDown);
  root.append(backdrop);
  const focusTarget = dialog.querySelector('input, textarea, select') || dialog.querySelector('button');
  focusTarget?.focus();

  return new Promise((resolve) => { resolveFn = resolve; });
}

/* ---------- Small builders ---------- */

export function statusBadge(status, label) {
  const map = {
    pending: 'badge-pending',
    pending_senior: 'badge-pending',
    approved: 'badge-approved',
    rejected: 'badge-rejected',
    returned: 'badge-returned',
    cancelled: 'badge-cancelled',
    completed: 'badge-completed',
  };
  return h('span', { class: `badge ${map[status] || 'badge-neutral'}` }, label || status);
}

export function urgentBadge() {
  return h('span', { class: 'badge badge-urgent' }, 'URGENT');
}

export function typePill(type) {
  return h('span', { class: 'pill' }, type === 'external' ? 'External' : 'Internal');
}

export function skeletonCards(count = 3) {
  return h('div', { class: 'request-list', 'aria-hidden': 'true' },
    Array.from({ length: count }, () => h('div', { class: 'skeleton skeleton-card' })));
}

export function skeletonLines(count = 3, widths = ['80%', '60%', '40%']) {
  return h('div', { 'aria-hidden': 'true' },
    Array.from({ length: count }, (_, i) => h('div', {
      class: 'skeleton skeleton-line',
      style: { width: widths[i % widths.length] },
    })));
}

export function emptyState({ title, message, actionLabel, onAction }) {
  return h('div', { class: 'empty-state' },
    h('h3', null, title),
    h('p', null, message),
    actionLabel ? h('button', { class: 'btn', type: 'button', onclick: onAction }, actionLabel) : null);
}

export function spinner(label = 'Loading…') {
  return h('span', { class: 'spinner', role: 'status', 'aria-label': label });
}

export function loadingBlock(label = 'Loading…') {
  return h('div', { class: 'page-loading', role: 'status' },
    h('span', { class: 'spinner spinner-lg', 'aria-hidden': 'true' }),
    h('span', { class: 'sr-only' }, label));
}

export function alertBox(kind, title, message) {
  return h('div', { class: `alert alert-${kind}`, role: kind === 'danger' ? 'alert' : 'status' },
    h('div', null,
      title ? h('strong', null, title) : null,
      message ? h('span', null, message) : null));
}

export function pageHead(title, sub, actions = []) {
  return h('div', { class: 'page-head' },
    h('div', null,
      h('h1', null, title),
      sub ? h('p', { class: 'page-sub' }, sub) : null),
    actions.length ? h('div', { class: 'btn-row' }, actions) : null);
}

/** Form field builder with label, hint and error slot. */
export function field({ id, label, hint, required, control, errorId }) {
  const errorEl = h('span', { class: 'field-error', id: errorId || `${id}-error`, hidden: true });
  return h('div', { class: 'field' },
    h('label', { for: id }, label, required ? h('span', { class: 'field-required', 'aria-hidden': 'true' }, ' *') : null),
    control,
    hint ? h('span', { class: 'field-hint' }, hint) : null,
    errorEl);
}

/** Show/hide a field error and wire aria-invalid on the control. */
export function setFieldError(control, errorEl, message) {
  if (message) {
    errorEl.textContent = message;
    errorEl.hidden = false;
    control.setAttribute('aria-invalid', 'true');
    control.setAttribute('aria-describedby', errorEl.id);
  } else {
    errorEl.textContent = '';
    errorEl.hidden = true;
    control.removeAttribute('aria-invalid');
    control.removeAttribute('aria-describedby');
  }
}

/** Summary block listing every invalid field (focus target after submit). */
export function errorSummary(errors, fieldLabels) {
  const entries = Object.entries(errors).filter(([, message]) => !!message);
  if (!entries.length) return null;
  const box = h('div', { class: 'error-summary', tabindex: '-1', role: 'alert' },
    h('h3', null, `Please fix ${entries.length} problem${entries.length === 1 ? '' : 's'} before continuing`),
    h('ul', null, entries.map(([key, message]) => h('li', null,
      h('a', {
        href: `#${fieldLabels[key] ? fieldLabels[key] : ''}`,
        onclick: (event) => {
          event.preventDefault();
          document.getElementById(fieldLabels[key] || key)?.focus();
        },
      }, message)))));
  return box;
}

export { clear };
