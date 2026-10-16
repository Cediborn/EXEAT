import { h } from '../dom.js';
import { session } from '../auth.js';
import { apiPost } from '../api.js';
import { navigate } from '../router.js';
import { setTitle } from '../components/shell.js';
import { field, setFieldError, errorSummary, toast, alertBox } from '../components/ui.js';
import { CATEGORIES, validateApplicationForm, categoryLabel } from '../validation.js';
import { formatDateTime } from '../format.js';
import { ApiError } from '../api.js';

/**
 * Two-step application form: details → review → submit.
 * A per-form idempotency key makes retried submissions safe, and the submit
 * button is disabled while a request is in flight.
 */
export function applyPage({ query }) {
  setTitle('Apply for an exeat');
  const profile = session.profile || {};

  const state = {
    type: query.type === 'external' ? 'external' : query.type === 'internal' ? 'internal' : null,
    values: {
      category: '',
      reason: '',
      destination: '',
      departDate: '',
      departTime: '',
      returnDate: '',
      returnTime: '',
      guardianName: profile?.guardian_name || '',
      guardianPhone: profile?.guardian_phone || '',
      urgent: false,
    },
    step: query.type ? 'form' : 'type',
    submitting: false,
    idempotencyKey: `req-${crypto.randomUUID()}`,
  };

  const root = h('div', { class: 'reveal' });

  function render() {
    root.replaceChildren(
      h('div', { class: 'page-head' },
        h('div', null,
          h('h1', null, 'Apply for an exeat'),
          h('p', { class: 'page-sub' }, 'Your name, class and house come from your school account.'))),
      stepper(),
      state.step === 'type' ? typeChooser() : state.step === 'form' ? formStep() : reviewStep());
  }

  function stepper() {
    const stepItem = (index, label, key) => {
      const isDone = state.step === 'review' || (state.step === 'form' && index === 1 && state.type);
      const isActive = (state.step === 'type' && index === 1)
        || (state.step === 'form' && index === 2)
        || (state.step === 'review' && index === 3);
      return h('span', { class: `stepper-item ${isDone ? 'is-done' : ''} ${isActive ? 'is-active' : ''}` },
        h('span', { class: 'stepper-dot' }, isDone ? '✓' : String(index)),
        label);
    };
    return h('div', { class: 'stepper' },
      stepItem(1, 'Exeat type', 'type'),
      h('span', { class: 'stepper-sep' }, '→'),
      stepItem(2, 'Details', 'form'),
      h('span', { class: 'stepper-sep' }, '→'),
      stepItem(3, 'Review & submit', 'review'));
  }

  function typeChooser() {
    return h('div', { class: 'stack-lg' },
      h('div', { class: 'type-grid' },
        typeCard('internal', 'Internal exeat',
          'Movement within the local area. Reviewed by your Housemaster or Housemistress only.'),
        typeCard('external', 'External exeat',
          'Travel outside the local area. Needs Senior Housemaster approval and at least 24 hours’ notice.')),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn btn-secondary', type: 'button', onclick: () => navigate('#/app') }, 'Back to dashboard')));
  }

  function typeCard(type, title, description) {
    return h('button', {
      class: 'type-card',
      type: 'button',
      'aria-pressed': state.type === type ? 'true' : 'false',
      onclick: () => {
        state.type = type;
        state.step = 'form';
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
    },
      h('h3', null, title),
      h('p', null, description));
  }

  /* ------------------------------ form step ------------------------------ */

  const controls = {};
  const errorEls = {};

  function bind(id, control, opts = {}) {
    controls[id] = control;
    const node = field({ id, label: opts.label, hint: opts.hint, required: opts.required !== false, control });
    errorEls[id] = node.querySelector('.field-error');
    return node;
  }

  function text(id, props, opts) {
    const control = h('input', { class: 'input', id, name: id, ...props });
    control.value = state.values[id] ?? '';
    control.addEventListener('input', () => { state.values[id] = control.value; });
    return bind(id, control, opts);
  }

  function select(id, options, opts) {
    const control = h('select', { class: 'select', id, name: id },
      h('option', { value: '' }, opts.placeholder || 'Select…'),
      options.map((opt) => typeof opt === 'string'
        ? h('option', { value: opt }, opt)
        : h('option', { value: opt.value }, opt.label)));
    control.value = state.values[id] || '';
    control.addEventListener('change', () => {
      state.values[id] = control.value;
      if (id === 'category') {
        const allowed = CATEGORIES.find((c) => c.value === control.value)?.urgentAllowed;
        if (!allowed) {
          state.values.urgent = false;
          if (controls.urgent) controls.urgent.checked = false;
        }
        urgentRow.hidden = !(CATEGORIES.find((c) => c.value === control.value)?.urgentAllowed);
      }
    });
    return bind(id, control, opts);
  }

  const urgentRow = h('div', { class: 'field' },
    h('label', { class: 'checkbox' },
      h('input', {
        type: 'checkbox',
        id: 'urgent',
        onchange: (event) => { state.values.urgent = event.target.checked; },
      }),
      h('span', { class: 'checkbox-text' },
        h('strong', null, 'This is urgent (medical)'),
        h('span', { style: { color: 'var(--text-muted)', 'font-size': 'var(--text-sm)' } },
          'Urgent medical requests are shown at the top of the review queue and flagged to the senior housemaster. For emergencies, also call your housemaster or the school emergency number — do not rely on this form alone.'))));
  controls.urgent = urgentRow.querySelector('input');
  errorEls.urgent = h('span', { class: 'field-error', id: 'urgent-error', hidden: true });
  urgentRow.append(errorEls.urgent);

  function formStep() {
    const summarySlot = h('div');
    const guardianSection = h('div', { class: 'form-section' },
      h('h3', null, 'Parent or guardian'),
      h('p', { class: 'section-desc' },
        state.type === 'external'
          ? 'Required for external exeats — your guardian can be alerted when the pass is approved.'
          : 'Optional for internal exeats.'),
      h('div', { class: 'form-grid form-grid-2' },
        text('guardianName', { type: 'text', placeholder: 'Parent or guardian name', autocomplete: 'name' },
          { label: 'Guardian name', required: state.type === 'external' }),
        text('guardianPhone', { type: 'tel', inputmode: 'tel', placeholder: '024 123 4567' },
          { label: 'Guardian phone', required: state.type === 'external' })));

    guardianSection.hidden = false;

    const form = h('form', {
      novalidate: true,
      onsubmit: (event) => {
        event.preventDefault();
        const result = validateApplicationForm({ type: state.type, ...state.values });
        Object.values(errorEls).forEach((el) => { el.hidden = true; el.textContent = ''; });
        Object.entries(controls).forEach(([key, control]) => control.removeAttribute('aria-invalid'));

        if (!result.ok) {
          for (const [key, message] of Object.entries(result.errors)) {
            if (errorEls[key] && controls[key]) setFieldError(controls[key], errorEls[key], message);
          }
          const summary = errorSummary(result.errors, {
            category: 'category', reason: 'reason', destination: 'destination',
            departAt: 'departDate', returnAt: 'returnDate',
            guardianName: 'guardianName', guardianPhone: 'guardianPhone', urgent: 'urgent',
          });
          summarySlot.replaceChildren(summary || h('div'));
          if (summary) summary.focus();
          return;
        }
        summarySlot.replaceChildren();
        state.step = 'review';
        render();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
    },
      summarySlot,
      h('div', { class: 'form-section' },
        h('h3', null, 'Reason for leaving'),
        h('p', { class: 'section-desc' }, 'Be clear — your housemaster reads this before deciding.'),
        select('category', CATEGORIES.map((c) => ({ value: c.value, label: c.label })), { label: 'Category', placeholder: 'Select a category' }),
        text('reason', {
          type: 'text', placeholder: 'e.g. Visiting my guardian in town for the weekend',
        }, { label: 'Purpose', hint: 'At least 10 characters.' }),
        text('destination', { type: 'text', placeholder: 'e.g. Cape Coast — Ridge home' }, { label: 'Destination' }),
        urgentRow),
      h('div', { class: 'form-section' },
        h('h3', null, 'When you are leaving and returning'),
        h('p', { class: 'section-desc' }, state.type === 'external'
          ? 'External exeats need at least 24 hours’ notice before departure.'
          : 'Your housemaster approves a specific window — stick to it.'),
        h('div', { class: 'form-grid form-grid-2' },
          text('departDate', { type: 'date' }, { label: 'Departure date' }),
          text('departTime', { type: 'time' }, { label: 'Departure time' })),
        h('div', { class: 'form-grid form-grid-2' },
          text('returnDate', { type: 'date' }, { label: 'Return date' }),
          text('returnTime', { type: 'time' }, { label: 'Return time' }))),
      guardianSection,
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', type: 'submit' }, 'Review request'),
        h('button', {
          class: 'btn btn-secondary',
          type: 'button',
          onclick: () => { state.step = 'type'; render(); },
        }, 'Change type')));

    urgentRow.hidden = !(CATEGORIES.find((c) => c.value === state.values.category)?.urgentAllowed);

    return h('div', { class: 'card card-pad', style: { 'max-width': '46rem' } },
      h('h2', { style: { 'margin-bottom': 'var(--space-5)' } },
        state.type === 'external' ? 'External exeat' : 'Internal exeat'),
      form);
  }

  /* ------------------------------ review step ---------------------------- */

  function reviewStep() {
    const v = state.values;
    const summary = h('dl', { class: 'review-list' },
      reviewRow('Type', state.type === 'external' ? 'External exeat' : 'Internal exeat'),
      reviewRow('Student', `${session.user.fullName}${profile?.class_year ? ` · ${profile.class_year}` : ''}${profile?.house ? ` · ${profile.house}` : ''}`),
      reviewRow('Category', categoryLabel(v.category)),
      reviewRow('Purpose', v.reason),
      reviewRow('Destination', v.destination),
      reviewRow('Depart', `${v.departDate} ${v.departTime}`),
      reviewRow('Return', `${v.returnDate} ${v.returnTime}`),
      state.type === 'external' ? reviewRow('Guardian', `${v.guardianName} · ${v.guardianPhone}`) : null,
      v.urgent ? reviewRow('Priority', 'Urgent medical request') : null);

    const serverError = h('div', { class: 'alert alert-danger', role: 'alert', hidden: true });
    const submitBtn = h('button', { class: 'btn btn-lg', type: 'submit' }, 'Submit request');

    const form = h('form', {
      novalidate: true,
      onsubmit: async (event) => {
        event.preventDefault();
        if (state.submitting) return;
        state.submitting = true;
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting…';
        serverError.hidden = true;
        try {
          const payload = { ...v, type: state.type };
          const data = await apiPost('/api/requests', payload, {
            headers: { 'idempotency-key': state.idempotencyKey },
          });
          toast(`${data.request.reference} submitted for approval.`, { type: 'success', title: 'Request sent' });
          navigate(`#/app/requests/${data.request.id}`);
        } catch (err) {
          if (err instanceof ApiError && err.status === 400 && err.errors) {
            // Server-side validation changed (e.g. time passed) — send the user back.
            Object.assign(state.values, pick(err.errors));
            toast('Some details need updating. Please review the form again.', { type: 'error' });
            state.step = 'form';
            render();
            return;
          }
          serverError.textContent = err.message || 'The request could not be submitted. Your details are still here — please try again.';
          serverError.hidden = false;
          serverError.scrollIntoView({ block: 'center', behavior: 'smooth' });
        } finally {
          state.submitting = false;
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit request';
        }
      },
    },
      serverError,
      h('div', { class: 'card', style: { 'margin-bottom': 'var(--space-6)' } },
        h('div', { class: 'card-body' }, summary)),
      h('div', { class: 'btn-row' },
        submitBtn,
        h('button', {
          class: 'btn btn-secondary',
          type: 'button',
          onclick: () => { state.step = 'form'; render(); },
        }, 'Edit details')));

    return h('div', { style: { 'max-width': '46rem' } },
      state.type === 'external'
        ? h('div', { style: { 'margin-bottom': 'var(--space-5)' } },
            alertBox('info', 'External exeat', 'This needs your Housemaster’s approval and then the Senior Housemaster’s approval. You will get your pass only after both.'))
        : null,
      h('div', { class: 'card card-pad' },
        h('h2', { style: { 'margin-bottom': 'var(--space-5)' } }, 'Review your request'),
        form));
  }

  render();
  return root;
}

function reviewRow(label, value) {
  return h('div', { class: 'review-row' },
    h('dt', null, label),
    h('dd', null, value || '—'));
}

function pick(errors) {
  const out = {};
  for (const key of Object.keys(errors)) {
    if (['reason', 'destination', 'guardianName', 'guardianPhone'].includes(key)) out[key] = '';
  }
  return out;
}
