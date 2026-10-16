import { h } from '../dom.js';
import { apiGet, apiPost } from '../api.js';
import { setTitle } from '../components/shell.js';
import { toast, alertBox } from '../components/ui.js';
import { formatDateTime, relativeTime } from '../format.js';

/**
 * Gate verification. Gate officers only receive the identity data needed to
 * check a student at the gate — never the reason for leaving.
 */
export function gatePage() {
  setTitle('Verify exeat pass');

  const input = h('input', {
    class: 'input',
    id: 'pass-code',
    type: 'text',
    inputmode: 'text',
    autocomplete: 'off',
    autocapitalize: 'characters',
    spellcheck: 'false',
    placeholder: 'ENTER PASS CODE',
    'aria-label': 'Exeat pass verification code',
  });

  const resultSlot = h('div', { class: 'gate-result' });
  const logSlot = h('div', { class: 'note-list' });

  const verifyBtn = h('button', { class: 'btn btn-lg', type: 'submit' }, 'Verify pass');
  const form = h('form', {
    onsubmit: (event) => {
      event.preventDefault();
      verify(input.value);
    },
  },
    h('div', { class: 'gate-input-row' },
      input,
      verifyBtn),
    h('p', { style: { color: 'var(--text-muted)', 'font-size': 'var(--text-sm)', 'margin-top': 'var(--space-3)' } },
      'Type the verification code printed on the student’s pass (or scan the QR into this field).'));

  input.addEventListener('input', () => {
    input.value = input.value.toUpperCase();
  });

  async function verify(code) {
    const clean = String(code || '').trim();
    if (!clean) {
      toast('Enter a pass code first.', { type: 'error' });
      input.focus();
      return;
    }
    verifyBtn.disabled = true;
    resultSlot.replaceChildren(h('div', { class: 'page-loading' }, h('span', { class: 'spinner' })));
    try {
      const data = await apiPost('/api/gate/verify', { code: clean });
      renderResult(data);
    } catch (err) {
      const data = err.errors || null;
      renderResult({
        valid: false,
        state: err.status === 404 ? 'not_found' : 'error',
        message: err.message || 'Verification failed.',
        student: null,
        request: null,
        pass: null,
        _data: data,
      });
    } finally {
      verifyBtn.disabled = false;
    }
  }

  function renderResult(data) {
    const valid = !!data.valid;
    const verdict = h('div', { class: `gate-verdict ${valid ? 'is-valid' : 'is-invalid'}`, role: 'status' },
      h('div', { class: 'gate-verdict-icon', 'aria-hidden': 'true' }, valid ? '✓' : '✕'),
      h('div', null,
        h('h2', null, valid
          ? (data.pass?.departedAt && !data.pass?.returnedAt ? 'Already departed' : 'Pass is valid')
          : 'Pass not valid'),
        h('p', null, data.message || (valid ? 'Identity matches the school record.' : 'This code cannot be used to leave campus.'))));

    const actions = [];
    if (valid && !data.pass?.departedAt) {
      actions.push(gateAction('Record departure', 'depart', 'btn-success', data.pass.code));
    }
    if (valid && data.pass?.departedAt && !data.pass?.returnedAt) {
      actions.push(gateAction('Record return', 'return', 'btn', data.pass.code));
    }

    resultSlot.replaceChildren(
      verdict,
      data.student ? h('div', { class: 'card' },
        h('div', { class: 'card-header' },
          h('h2', null, data.student.fullName),
          h('span', { class: 'pill' }, data.request?.type === 'external' ? 'External' : 'Internal')),
        h('div', { class: 'card-body' },
          h('dl', { class: 'detail-grid' },
            gItem('Index number', data.student.indexNumber),
            gItem('Class', data.student.classYear),
            gItem('House', data.student.house),
            gItem('Destination', data.request?.destination),
            gItem('Authorised window', `${formatDateTime(data.request?.departAt)} → ${formatDateTime(data.request?.returnAt)}`),
            gItem('Reference', data.request?.reference)),
          data.request?.urgent ? h('div', { style: { 'margin-top': 'var(--space-4)' } },
            h('span', { class: 'badge badge-urgent' }, 'URGENT MEDICAL REQUEST')) : null,
          actions.length ? h('div', { class: 'btn-row', style: { 'margin-top': 'var(--space-5)' } }, actions) : null,
          h('p', { style: { color: 'var(--text-muted)', 'font-size': 'var(--text-xs)', 'margin-top': 'var(--space-4)' } },
            'Reason for leaving is not shown at the gate by design.')))
        : null);
  }

  function gItem(label, value) {
    return h('div', { class: 'detail-item' },
      h('dt', null, label),
      h('dd', null, value || '—'));
  }

  function gateAction(label, endpoint, className, code) {
    const btn = h('button', { class: `btn ${className}`, type: 'button' }, label);
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        const data = await apiPost(`/api/gate/${endpoint}`, { code });
        toast(endpoint === 'depart' ? 'Departure recorded.' : 'Return recorded.', { type: 'success' });
        renderResult(data);
        loadLog();
      } catch (err) {
        toast(err.message || 'Could not record.', { type: 'error' });
        btn.disabled = false;
        btn.textContent = label;
      }
    });
    return btn;
  }

  async function loadLog() {
    try {
      const data = await apiGet('/api/gate/movements');
      const movements = data.movements || [];
      if (!movements.length) {
        logSlot.replaceChildren(h('p', { style: { color: 'var(--text-muted)', 'font-size': 'var(--text-sm)' } },
          'No movements recorded yet today.'));
        return;
      }
      logSlot.replaceChildren(...movements.slice(0, 12).map((m) => h('div', { class: 'note' },
        h('div', null,
          h('div', { class: 'note-title' },
            `${m.type === 'departure' ? 'Departed' : 'Returned'} · ${m.studentName}`),
          h('div', { class: 'note-body' }, `${m.reference} · ${m.classYear} · ${m.house}`),
          h('div', { class: 'note-time' }, `${formatDateTime(m.recordedAt)} · ${relativeTime(m.recordedAt)}`)))));
    } catch {
      logSlot.replaceChildren(alertBox('warning', 'Activity unavailable', 'Could not load recent gate activity.'));
    }
  }

  loadLog();

  return h('div', { class: 'reveal', style: { 'max-width': '48rem' } },
    h('div', { class: 'page-head' },
      h('div', null,
        h('h1', null, 'Gate verification'),
        h('p', { class: 'page-sub' }, 'Check a student’s pass, then record departure or return.'))),
    h('div', { class: 'card card-pad', style: { 'margin-bottom': 'var(--space-6)' } }, form),
    resultSlot,
    h('div', { class: 'card', style: { 'margin-top': 'var(--space-6)' } },
      h('div', { class: 'card-header' }, h('h2', null, 'Recent gate activity')),
      h('div', { class: 'card-body' }, logSlot)));
}
