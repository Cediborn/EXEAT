import { h } from '../dom.js';
import { apiGet, apiPost } from '../api.js';
import { setTitle } from '../components/shell.js';
import { statusBadge, urgentBadge, typePill, loadingBlock, openDialog, toast, emptyState } from '../components/ui.js';
import { timeline } from '../components/timeline.js';
import { passCard } from '../components/passCard.js';
import { formatDateTime, durationLabel, relativeTime } from '../format.js';
import { categoryLabel } from '../validation.js';
import { navigate } from '../router.js';

/** Split an ISO instant into local date/time parts for the date inputs. */
function isoParts(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

const MINUTE = 60 * 1000;
const minuteOf = (iso) => Math.floor(new Date(iso).getTime() / MINUTE);

export async function staffDetailPage({ params }) {
  setTitle('Review request');
  const root = h('div', null, loadingBlock('Loading request…'));

  async function load() {
    try {
      const data = await apiGet(`/api/staff/requests/${params.id}`);
      render(data);
    } catch (err) {
      // Log unexpected (non-HTTP) failures; 403/404 are shown in the UI.
      if (!err.status) console.error(err);
      root.replaceChildren(emptyState({
        title: err.status === 403 ? 'Outside your access' : err.status === 404 ? 'Request not found' : 'Could not load this request',
        message: err.message || 'Please try again.',
        actionLabel: 'Back to queue',
        onAction: () => navigate('#/staff'),
      }));
    }
  }

  function render(payload) {
    const { request, student, approvals, timeline: events, pass, canDecide, policy } = payload;
    const maxHours = Number(policy?.maxDurationHours) || 72;

    const currentDepart = request.approvedDepartAt || request.proposedDepartAt || request.departAt;
    const currentReturn = request.approvedReturnAt || request.proposedReturnAt || request.returnAt;
    const proposalTouched = Boolean(request.proposedDepartAt || request.approvedDepartAt);
    const departParts = isoParts(currentDepart);
    const returnParts = isoParts(currentReturn);

    const dateCtl = {
      departDate: h('input', { class: 'input', type: 'date', id: 'prop-departDate', value: departParts.date }),
      departTime: h('input', { class: 'input', type: 'time', id: 'prop-departTime', value: departParts.time }),
      returnDate: h('input', { class: 'input', type: 'date', id: 'prop-returnDate', value: returnParts.date }),
      returnTime: h('input', { class: 'input', type: 'time', id: 'prop-returnTime', value: returnParts.time }),
      reason: h('textarea', {
        class: 'textarea',
        id: 'prop-dateReason',
        placeholder: 'e.g. The requested period is longer than necessary — return two days earlier.',
      }),
      departError: h('span', { class: 'field-error', hidden: true }),
      returnError: h('span', { class: 'field-error', hidden: true }),
      reasonError: h('span', { class: 'field-error', hidden: true }),
      hint: h('span', { class: 'field-hint' },
        `Required whenever you change the times. The school limit is ${maxHours} hours.`),
    };

    /** Read the proposed schedule; returns null when inputs are incomplete. */
    function readProposed() {
      if (!dateCtl.departDate.value || !dateCtl.departTime.value
        || !dateCtl.returnDate.value || !dateCtl.returnTime.value) return null;
      const depart = new Date(`${dateCtl.departDate.value}T${dateCtl.departTime.value}`);
      const ret = new Date(`${dateCtl.returnDate.value}T${dateCtl.returnTime.value}`);
      if (Number.isNaN(depart.getTime()) || Number.isNaN(ret.getTime())) return null;
      return { depart, ret };
    }

    function clearDateErrors() {
      dateCtl.departError.hidden = true;
      dateCtl.returnError.hidden = true;
      dateCtl.reasonError.hidden = true;
      dateCtl.departDate.removeAttribute('aria-invalid');
      dateCtl.returnDate.removeAttribute('aria-invalid');
      dateCtl.reason.removeAttribute('aria-invalid');
    }

    function fail(input, errorEl, message) {
      errorEl.textContent = message;
      errorEl.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    }

    /**
     * Validate the proposed schedule against the current one.
     * @returns {{ ok: boolean, changed: boolean, departISO?: string, returnISO?: string }}
     */
    function validateDates() {
      clearDateErrors();
      const proposed = readProposed();
      if (!proposed) {
        fail(dateCtl.returnDate, dateCtl.returnError, 'Fill in all four proposed date and time fields.');
        return { ok: false, changed: false };
      }
      if (proposed.ret.getTime() <= proposed.depart.getTime()) {
        fail(dateCtl.returnDate, dateCtl.returnError, 'The proposed return must be after the proposed departure.');
        return { ok: false, changed: false };
      }
      const hours = (proposed.ret.getTime() - proposed.depart.getTime()) / 3600000;
      if (hours > maxHours) {
        fail(dateCtl.returnDate, dateCtl.returnError,
          `The proposed schedule may not exceed ${maxHours} hours — the school's configured limit.`);
        return { ok: false, changed: false };
      }
      const changed = minuteOf(proposed.depart) !== minuteOf(currentDepart)
        || minuteOf(proposed.ret) !== minuteOf(currentReturn);
      if (changed && dateCtl.reason.value.trim().length < 5) {
        fail(dateCtl.reason, dateCtl.reasonError, 'Explain why you are changing the proposed times (at least 5 characters).');
        return { ok: false, changed: true };
      }
      return {
        ok: true,
        changed,
        departISO: proposed.depart.toISOString(),
        returnISO: proposed.ret.toISOString(),
      };
    }

    root.replaceChildren(
      h('div', { class: 'page-head' },
        h('div', null,
          h('a', { href: '#/staff', style: { 'font-size': 'var(--text-sm)', 'font-weight': 600 } }, '← Review queue'),
          h('h1', { style: { 'margin-top': 'var(--space-2)' } }, request.destination),
          h('div', { style: { display: 'flex', gap: 'var(--space-2)', 'margin-top': 'var(--space-2)', 'flex-wrap': 'wrap', 'align-items': 'center' } },
            h('span', { class: 'request-ref' }, request.reference),
            typePill(request.type),
            request.urgent ? urgentBadge() : null,
            statusBadge(request.status, request.statusLabel)))),
      h('div', { class: 'split split-wide' },
        h('div', { class: 'stack-lg' },
          h('div', { class: 'card' },
            h('div', { class: 'card-header' }, h('h2', null, 'Student')),
            h('div', { class: 'card-body' },
              h('dl', { class: 'detail-grid' },
                detail('Name', student.fullName),
                detail('Index number', student.indexNumber),
                detail('Class', student.classYear),
                detail('House', student.house),
                detail('Student ID', student.username),
                detail('Guardian', student.guardianName ? `${student.guardianName} · ${student.guardianPhone}` : '—')))),
          h('div', { class: 'card' },
            h('div', { class: 'card-header' }, h('h2', null, 'Request')),
            h('div', { class: 'card-body' },
              h('dl', { class: 'detail-grid' },
                detail('Category', categoryLabel(request.category)),
                detail('Type', request.type === 'external' ? 'External exeat' : 'Internal exeat'),
                detail('Purpose', request.reason),
                detail('Destination', request.destination),
                detail('Urgency', request.urgent ? 'Urgent (medical)' : 'Standard'),
                detail('Submitted', request.submittedAt ? `${formatDateTime(request.submittedAt)} (${relativeTime(request.submittedAt)})` : '—')))),
          datesCard(request, canDecide, dateCtl, proposalTouched),
          h('div', { class: 'card' },
            h('div', { class: 'card-header' }, h('h2', null, 'Decision history')),
            h('div', { class: 'card-body' },
              approvals.length
                ? h('ul', { class: 'stack' }, approvals.map((a) => h('li', { class: 'note' },
                    h('div', null,
                      h('div', { class: 'note-title' },
                        `${a.decision === 'approved' ? 'Approved' : a.decision === 'rejected' ? 'Rejected' : 'Returned'} by ${a.reviewerName}`),
                      a.proposedReturnAt
                        ? h('div', { class: 'note-body' },
                          `Authorised schedule: departs ${formatDateTime(a.proposedDepartAt)} — returns ${formatDateTime(a.proposedReturnAt)}`)
                        : null,
                      a.dateReason
                        ? h('div', { class: 'note-body', style: { 'font-style': 'italic' } }, `Date adjustment: ${a.dateReason}`)
                        : null,
                      h('div', { class: 'note-body' }, a.comment || 'No comment recorded.'),
                      h('div', { class: 'note-time' }, `${a.stage === 'senior' ? 'Senior stage' : 'Housemaster stage'} · ${formatDateTime(a.at)}`)))))
                : h('p', { style: { color: 'var(--text-muted)' } }, 'No decisions recorded yet.'))),
          h('div', { class: 'card' },
            h('div', { class: 'card-header' }, h('h2', null, 'Timeline')),
            h('div', { class: 'card-body' }, timeline(events)))),
        h('div', { class: 'stack' },
          pass ? passCard({ pass, request, student }) : null,
          canDecide ? decisionPanel(request, load, dateCtl, validateDates) : waitingPanel(request, approvals))));
  }

  function detail(label, value) {
    return h('div', { class: 'detail-item' },
      h('dt', null, label),
      h('dd', null, value || '—'));
  }

  /**
   * Original student request vs proposed schedule vs final authorised
   * schedule. Editable for the reviewer who can decide right now; read-only
   * for everyone else. The original request is never overwritten.
   */
  function datesCard(request, canDecide, dateCtl, proposalTouched) {
    const original = h('dl', { class: 'detail-grid' },
      detail('Departs', formatDateTime(request.departAt)),
      detail('Return by', formatDateTime(request.returnAt)),
      detail('Duration', durationLabel(request.departAt, request.returnAt)));

    const body = [original];

    if (canDecide) {
      body.push(
        h('hr', { class: 'divider', style: { margin: 'var(--space-5) 0' } }),
        h('h3', { style: { 'font-size': 'var(--text-md)', 'margin-bottom': 'var(--space-1)' } }, 'Proposed schedule'),
        h('p', { style: { color: 'var(--text-muted)', 'font-size': 'var(--text-sm)', 'margin-bottom': 'var(--space-4)' } },
          'Shorten the absence if the student asked for more time than needed. The times above show what the student originally requested.'),
        h('div', { class: 'form-grid form-grid-2' },
          h('div', { class: 'field' },
            h('label', { for: 'prop-departDate' }, 'Proposed departure'),
            h('div', { style: { display: 'flex', gap: 'var(--space-2)' } },
              dateCtl.departDate, dateCtl.departTime),
            dateCtl.departError),
          h('div', { class: 'field' },
            h('label', { for: 'prop-returnDate' }, 'Proposed return'),
            h('div', { style: { display: 'flex', gap: 'var(--space-2)' } },
              dateCtl.returnDate, dateCtl.returnTime),
            dateCtl.returnError)),
        h('div', { class: 'field' },
          h('label', { for: 'prop-dateReason' }, 'Adjustment reason'),
          dateCtl.reason,
          dateCtl.hint,
          dateCtl.reasonError));
    } else {
      body.push(
        h('hr', { class: 'divider', style: { margin: 'var(--space-5) 0' } }),
        h('h3', { style: { 'font-size': 'var(--text-md)', 'margin-bottom': 'var(--space-2)' } },
          request.approvedReturnAt ? 'Authorised schedule' : 'Current proposed schedule'),
        h('dl', { class: 'detail-grid' },
          detail('Departs', formatDateTime(request.approvedDepartAt || request.proposedDepartAt || request.departAt)),
          detail('Return by', formatDateTime(request.approvedReturnAt || request.proposedReturnAt || request.returnAt))),
        !proposalTouched
          ? h('p', { style: { color: 'var(--text-muted)', 'font-size': 'var(--text-sm)' } },
            'No adjustments yet — the student’s requested times stand.')
          : null);
    }

    return h('div', { class: 'card' },
      h('div', { class: 'card-header' }, h('h2', null, 'Dates under review')),
      h('div', { class: 'card-body' }, ...body));
  }

  function waitingPanel(request, approvals) {
    const text = {
      pending: 'Waiting for the housemaster of this student’s house.',
      pending_senior: 'Waiting for the Senior Housemaster’s decision.',
    }[request.status] || 'No decision is required right now.';
    const proposal = request.approvedReturnAt || request.proposedReturnAt
      ? h('p', { style: { 'font-size': 'var(--text-sm)', 'margin-top': 'var(--space-2)' } },
        `Proposed schedule on file: departs ${formatDateTime(request.approvedDepartAt || request.proposedDepartAt)} — returns ${formatDateTime(request.approvedReturnAt || request.proposedReturnAt)}.`)
      : null;
    const stageNote = request.status === 'pending_senior' && approvals.length
      ? h('p', { style: { 'font-size': 'var(--text-sm)', 'margin-top': 'var(--space-2)' } },
        `Housemaster ${approvals[approvals.length - 1]?.reviewerName || ''} approved this request; it now needs senior approval.`)
      : null;
    return h('div', { class: 'card card-pad' },
      h('h3', { style: { 'margin-bottom': 'var(--space-2)' } }, 'No action available'),
      h('p', { style: { color: 'var(--text-muted)' } }, text),
      stageNote,
      proposal);
  }

  function decisionPanel(request, reload, dateCtl, validateDates) {
    const comment = h('textarea', {
      class: 'textarea',
      id: 'decision-comment',
      placeholder: 'Optional for approvals; required when rejecting or returning.',
    });
    const commentError = h('span', { class: 'field-error', hidden: true });

    const makeBtn = (label, decision, className) => h('button', {
      class: `btn ${className}`,
      type: 'button',
      onclick: async () => {
        const needsComment = decision !== 'approved';
        if (needsComment && comment.value.trim().length < 5) {
          commentError.textContent = 'Give the student a clear reason (at least 5 characters).';
          commentError.hidden = false;
          comment.setAttribute('aria-invalid', 'true');
          comment.focus();
          return;
        }
        commentError.hidden = true;

        let datePayload = null;
        let dateSummary = null;
        if (decision === 'approved') {
          const v = validateDates();
          if (!v.ok) return;
          datePayload = { proposedDepartAt: v.departISO, proposedReturnAt: v.returnISO };
          if (v.changed) {
            datePayload.dateReason = dateCtl.reason.value.trim();
            dateSummary = h('div', null,
              h('p', null,
                `Proposed schedule: departs ${formatDateTime(v.departISO)} — returns ${formatDateTime(v.returnISO)}.`),
              h('p', { style: { 'font-size': 'var(--text-sm)' } },
                `The student originally requested: ${formatDateTime(request.departAt)} — ${formatDateTime(request.returnAt)}.`),
              h('p', { style: { 'font-style': 'italic' } }, `Date adjustment: ${datePayload.dateReason}`));
          }
        }

        const verb = decision === 'approved' ? 'approve' : decision === 'rejected' ? 'reject' : 'return for correction';
        const confirmed = await openDialog({
          title: `${verb[0].toUpperCase()}${verb.slice(1)} this request?`,
          body: h('div', null,
            h('p', null, decision === 'approved'
              ? (request.requiresSenior && request.status === 'pending'
                ? 'The student will then need the Senior Housemaster’s approval.'
                : 'A digital exeat pass will be issued to the student immediately.')
              : decision === 'rejected'
                ? 'The student will see your reason. No pass will be issued.'
                : 'The student can edit and resubmit this request. It returns to the housemaster stage.'),
            dateSummary,
            comment.value.trim() ? h('p', { style: { 'font-style': 'italic' } }, `Your note: “${comment.value.trim()}”`) : null),
          confirmLabel: `Yes, ${verb}`,
          danger: decision !== 'approved',
        });
        if (!confirmed) return;
        try {
          const data = await apiPost(`/api/staff/requests/${request.id}/decision`, {
            decision,
            comment: comment.value.trim(),
            ...(datePayload || {}),
          });
          toast(
            decision === 'approved' && data.request.status === 'pending_senior'
              ? 'Approved — sent to the Senior Housemaster.'
              : `Request ${decision === 'approved' ? 'approved' : decision === 'rejected' ? 'rejected' : 'returned'}.`,
            { type: decision === 'rejected' ? 'error' : 'success' });
          reload();
        } catch (err) {
          const fieldErrors = err.errors || {};
          if (fieldErrors.dateReason) {
            fail(dateCtl.reason, dateCtl.reasonError, fieldErrors.dateReason);
          } else if (fieldErrors.proposedReturnAt) {
            fail(dateCtl.returnDate, dateCtl.returnError, fieldErrors.proposedReturnAt);
          }
          toast(err.message || 'Decision could not be recorded.', { type: 'error' });
        }
      },
    }, label);

    return h('div', { class: 'card card-pad' },
      h('h2', { style: { 'margin-bottom': 'var(--space-4)' } }, 'Your decision'),
      h('p', { style: { color: 'var(--text-muted)', 'font-size': 'var(--text-sm)', 'margin-bottom': 'var(--space-4)' } },
        'Approving uses the proposed schedule shown under “Dates under review”. Rejecting or returning requires a reason for the student.'),
      h('div', { class: 'field' },
        h('label', { for: 'decision-comment' }, 'Note to student'),
        comment,
        h('span', { class: 'field-hint' }, 'Required when rejecting or returning a request.'),
        commentError),
      h('div', { class: 'btn-row' },
        makeBtn('Approve', 'approved', 'btn-success'),
        makeBtn('Return for correction', 'returned', 'btn-secondary'),
        makeBtn('Reject', 'rejected', 'btn-danger')));
  }

  await load();
  return root;
}
