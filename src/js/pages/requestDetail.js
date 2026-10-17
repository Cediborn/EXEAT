import { h } from '../dom.js';
import { apiGet, apiPost, apiPatch } from '../api.js';
import { setTitle } from '../components/shell.js';
import { statusBadge, urgentBadge, typePill, loadingBlock, alertBox, openDialog, toast, emptyState } from '../components/ui.js';
import { timeline } from '../components/timeline.js';
import { passCard } from '../components/passCard.js';
import { formatDateTime, durationLabel } from '../format.js';
import { categoryLabel } from '../validation.js';
import { navigate } from '../router.js';

export async function requestDetailPage({ params }) {
  setTitle('Request details');
  const root = h('div', null, loadingBlock('Loading request…'));
  let data;

  try {
    data = await apiGet(`/api/requests/${params.id}`);
  } catch (err) {
    root.replaceChildren(emptyState({
      title: err.status === 404 ? 'Request not found' : 'Could not load this request',
      message: err.status === 404
        ? 'This request does not exist or belongs to another student.'
        : (err.message || 'Please try again.'),
      actionLabel: 'Back to my requests',
      onAction: () => navigate('#/app'),
    }));
    return root;
  }

  render(data);
  return root;

  function render(payload) {
    const { request, student, pass, timeline: events, approvals } = payload;
    const approvalList = approvals || [];
    const latestDecision = [...approvalList].reverse().find((a) => ['rejected', 'returned', 'approved'].includes(a.decision));
    const rejectionReason = request.status === 'rejected' && latestDecision?.decision === 'rejected'
      ? latestDecision.comment : null;
    const correctionReason = request.status === 'returned' && latestDecision?.decision === 'returned'
      ? latestDecision.comment : null;
    const canCancel = ['pending', 'pending_senior', 'approved', 'returned'].includes(request.status);
    const needsCorrection = request.status === 'returned';

    root.replaceChildren(
      h('div', { class: 'page-head' },
        h('div', null,
          h('a', { href: '#/app', style: { 'font-size': 'var(--text-sm)', 'font-weight': 600 } }, '← My requests'),
          h('h1', { style: { 'margin-top': 'var(--space-2)' } }, request.destination),
          h('div', { style: { display: 'flex', gap: 'var(--space-2)', 'margin-top': 'var(--space-2)', 'flex-wrap': 'wrap', 'align-items': 'center' } },
            h('span', { class: 'request-ref' }, request.reference),
            typePill(request.type),
            request.urgent ? urgentBadge() : null,
            statusBadge(request.status, request.statusLabel)))),
      h('div', { class: 'split split-wide' },
        h('div', { class: 'stack-lg' },
          rejectionReason ? alertBox('danger', 'Rejected — reason', rejectionReason) : null,
          h('div', { class: 'card' },
            h('div', { class: 'card-header' }, h('h2', null, 'Request details')),
            h('div', { class: 'card-body' },
              h('dl', { class: 'detail-grid' },
                detail('Category', categoryLabel(request.category)),
                detail('Purpose', request.reason),
                detail('Destination', request.destination),
                detail('Type', request.type === 'external' ? 'External exeat' : 'Internal exeat'),
                detail('Submitted', request.submittedAt ? formatDateTime(request.submittedAt) : '—'),
                detail('Urgency', request.urgent ? 'Urgent (medical)' : 'Standard'),
                student?.indexNumber ? detail('Index number', student.indexNumber) : null,
                student?.house ? detail('House', student.house) : null,
                request.guardianName ? detail('Guardian', `${request.guardianName} · ${request.guardianPhone}`) : null,
                request.cancelReason ? detail('Cancellation reason', request.cancelReason) : null))),
          datesCard(request),
          needsCorrection ? correctionPanel(request, correctionReason) : null,
          h('div', { class: 'card' },
            h('div', { class: 'card-header' }, h('h2', null, 'Timeline')),
            h('div', { class: 'card-body' }, timeline(events)))),
        h('div', { class: 'stack' },
          pass ? passCard({ pass, request, student }) : statusPanel(request),
          canCancel ? cancelPanel(request) : null)));
  }

  function detail(label, value) {
    return h('div', { class: 'detail-item' },
      h('dt', null, label),
      h('dd', null, value || '—'));
  }

  /**
   * Original requested dates, the schedule proposed while the request is in
   * senior review, and the finally authorised schedule after approval.
   * Staff adjustments never overwrite the original request.
   */
  function datesCard(request) {
    const proposed = request.status === 'pending_senior' && (request.proposedDepartAt || request.proposedReturnAt)
      ? h('div', { style: { 'margin-top': 'var(--space-4)' } },
        h('h3', { style: { 'font-size': 'var(--text-md)', 'margin-bottom': 'var(--space-2)' } }, 'Proposed by your Housemaster'),
        h('p', { style: { color: 'var(--text-muted)', 'font-size': 'var(--text-sm)', 'margin-bottom': 'var(--space-2)' } },
          'Your Housemaster proposed these times. The Senior Housemaster must still approve before your pass is issued.'),
        h('dl', { class: 'detail-grid' },
          detail('Departs', formatDateTime(request.proposedDepartAt || request.departAt)),
          detail('Return by', formatDateTime(request.proposedReturnAt || request.returnAt))))
      : null;
    const approved = ['approved', 'completed'].includes(request.status) && (request.approvedDepartAt || request.approvedReturnAt)
      ? h('div', { style: { 'margin-top': 'var(--space-4)' } },
        h('h3', { style: { 'font-size': 'var(--text-md)', 'margin-bottom': 'var(--space-2)' } }, 'Authorised schedule'),
        h('dl', { class: 'detail-grid' },
          detail('Departs', formatDateTime(request.approvedDepartAt || request.departAt)),
          detail('Return by', formatDateTime(request.approvedReturnAt || request.returnAt)),
          detail('Duration', durationLabel(request.approvedDepartAt || request.departAt, request.approvedReturnAt || request.returnAt))))
      : null;
    return h('div', { class: 'card' },
      h('div', { class: 'card-header' }, h('h2', null, 'Dates')),
      h('div', { class: 'card-body' },
        h('h3', { style: { 'font-size': 'var(--text-md)', 'margin-bottom': 'var(--space-2)' } }, 'Your original request'),
        h('dl', { class: 'detail-grid' },
          detail('Departs', formatDateTime(request.departAt)),
          detail('Return by', formatDateTime(request.returnAt)),
          detail('Duration', durationLabel(request.departAt, request.returnAt))),
        proposed,
        approved));
  }

  function statusPanel(request) {
    const messages = {
      pending: 'Your Housemaster or Housemistress is reviewing this request. You do not need to do anything yet.',
      pending_senior: 'Your Housemaster approved this request. The Senior Housemaster now needs to approve it before your pass is issued.',
      rejected: 'This request was rejected. If you believe this is a mistake, speak to your Housemaster.',
      returned: 'Your Housemaster returned this request for correction. Update the details below and resubmit.',
      cancelled: 'You cancelled this request.',
      completed: 'This exeat is complete — your return was recorded at the gate.',
    };
    const proposalNote = request.status === 'pending_senior' && request.proposedReturnAt
      ? h('p', { style: { 'font-size': 'var(--text-sm)', 'margin-top': 'var(--space-2)' } },
        `Your Housemaster proposes: departs ${formatDateTime(request.proposedDepartAt || request.departAt)} — returns ${formatDateTime(request.proposedReturnAt)}.`)
      : null;
    return h('div', { class: 'card card-pad' },
      h('h2', { style: { 'margin-bottom': 'var(--space-2)' } }, request.statusLabel),
      h('p', { style: { color: 'var(--text-muted)' } }, messages[request.status] || ''),
      proposalNote,
      request.status === 'pending_senior'
        ? h('div', { class: 'alert alert-info' }, h('span', null, 'External exeats always need both approvals.'))
        : null);
  }

  function cancelPanel(request) {
    const btn = h('button', { class: 'btn btn-secondary btn-block', type: 'button' }, 'Cancel this request');
    btn.addEventListener('click', async () => {
      const reasonInput = h('textarea', { class: 'textarea', id: 'cancel-reason', placeholder: 'e.g. My plans changed and I am staying on campus.' });
      const errorEl = h('span', { class: 'field-error', hidden: true });
      const confirmed = await openDialog({
        title: 'Cancel this exeat request?',
        body: h('div', null,
          h('p', null, 'The request will be cancelled and any issued pass will stop working. This cannot be undone.'),
          h('div', { class: 'field' },
            h('label', { for: 'cancel-reason' }, 'Reason'),
            reasonInput,
            errorEl)),
        confirmLabel: 'Cancel request',
        danger: true,
      });
      if (!confirmed) return;
      if (reasonInput.value.trim().length < 3) {
        errorEl.textContent = 'Please give a short reason.';
        errorEl.hidden = false;
        return;
      }
      try {
        const data = await apiPost(`/api/requests/${request.id}/cancel`, { reason: reasonInput.value.trim() });
        toast('Request cancelled.', { type: 'success' });
        const fresh = await apiGet(`/api/requests/${request.id}`);
        render(fresh);
      } catch (err) {
        toast(err.message || 'Could not cancel the request.', { type: 'error' });
      }
    });
    return h('div', { class: 'card card-pad' },
      h('h3', { style: { 'margin-bottom': 'var(--space-2)' } }, 'Changed your mind?'),
      h('p', { style: { color: 'var(--text-muted)', 'font-size': 'var(--text-sm)', 'margin-bottom': 'var(--space-4)' } },
        'You can cancel while the request is still awaiting approval or has just been approved.'),
      btn);
  }

  function correctionPanel(request, correctionReason) {
    const inputs = {
      category: h('select', { class: 'select', id: 'fix-category' },
        h('option', { value: '' }, 'Select…'),
        [{ value: 'medical_appointment', label: 'Medical appointment' },
          { value: 'illness', label: 'Illness or urgent medical attention' },
          { value: 'family', label: 'Family outing or bereavement' },
          { value: 'personal', label: 'Approved personal outing' },
          { value: 'school_activity', label: 'School activity' },
          { value: 'other', label: 'Other authorised reason' }]
          .map((c) => h('option', { value: c.value }, c.label))),
      reason: h('textarea', { class: 'textarea', id: 'fix-reason' }),
      destination: h('input', { class: 'input', id: 'fix-destination', type: 'text' }),
      departDate: h('input', { class: 'input', id: 'fix-departDate', type: 'date' }),
      departTime: h('input', { class: 'input', id: 'fix-departTime', type: 'time' }),
      returnDate: h('input', { class: 'input', id: 'fix-returnDate', type: 'date' }),
      returnTime: h('input', { class: 'input', id: 'fix-returnTime', type: 'time' }),
      guardianName: h('input', { class: 'input', id: 'fix-guardianName', type: 'text' }),
      guardianPhone: h('input', { class: 'input', id: 'fix-guardianPhone', type: 'tel' }),
    };
    inputs.category.value = request.category;
    inputs.reason.value = request.reason;
    inputs.destination.value = request.destination;
    inputs.departDate.value = toDate(request.departAt);
    inputs.departTime.value = toTime(request.departAt);
    inputs.returnDate.value = toDate(request.returnAt);
    inputs.returnTime.value = toTime(request.returnAt);
    inputs.guardianName.value = request.guardianName || '';
    inputs.guardianPhone.value = request.guardianPhone || '';

    const errorBox = h('div', { class: 'alert alert-danger', role: 'alert', hidden: true });
    const submitBtn = h('button', { class: 'btn', type: 'submit' }, 'Save and resubmit');

    const form = h('form', {
      novalidate: true,
      onsubmit: async (event) => {
        event.preventDefault();
        submitBtn.disabled = true;
        errorBox.hidden = true;
        try {
          await apiPatch(`/api/requests/${request.id}`, {
            type: request.type,
            category: inputs.category.value,
            reason: inputs.reason.value,
            destination: inputs.destination.value,
            departDate: inputs.departDate.value,
            departTime: inputs.departTime.value,
            returnDate: inputs.returnDate.value,
            returnTime: inputs.returnTime.value,
            guardianName: inputs.guardianName.value,
            guardianPhone: inputs.guardianPhone.value,
          });
          toast('Request resubmitted to your Housemaster.', { type: 'success' });
          const fresh = await apiGet(`/api/requests/${request.id}`);
          render(fresh);
        } catch (err) {
          errorBox.textContent = err.message || 'Could not resubmit. Please try again.';
          errorBox.hidden = false;
        } finally {
          submitBtn.disabled = false;
        }
      },
    },
      errorBox,
      h('div', { class: 'form-grid form-grid-2' },
        h('div', { class: 'field' }, h('label', { for: 'fix-category' }, 'Category'), inputs.category),
        h('div', { class: 'field' }, h('label', { for: 'fix-destination' }, 'Destination'), inputs.destination)),
      h('div', { class: 'field' }, h('label', { for: 'fix-reason' }, 'Purpose'), inputs.reason),
      h('div', { class: 'form-grid form-grid-2' },
        h('div', { class: 'field' }, h('label', { for: 'fix-departDate' }, 'Departure date'), inputs.departDate),
        h('div', { class: 'field' }, h('label', { for: 'fix-departTime' }, 'Departure time'), inputs.departTime)),
      h('div', { class: 'form-grid form-grid-2' },
        h('div', { class: 'field' }, h('label', { for: 'fix-returnDate' }, 'Return date'), inputs.returnDate),
        h('div', { class: 'field' }, h('label', { for: 'fix-returnTime' }, 'Return time'), inputs.returnTime)),
      h('div', { class: 'form-grid form-grid-2' },
        h('div', { class: 'field' }, h('label', { for: 'fix-guardianName' }, 'Guardian name'), inputs.guardianName),
        h('div', { class: 'field' }, h('label', { for: 'fix-guardianPhone' }, 'Guardian phone'), inputs.guardianPhone)),
      submitBtn);

    return h('div', { class: 'card card-pad' },
      h('h2', { style: { 'margin-bottom': 'var(--space-2)' } }, 'Correction needed'),
      correctionReason
        ? h('div', { class: 'alert alert-info', style: { 'margin-bottom': 'var(--space-4)' } },
          h('div', { style: { 'font-weight': 600, 'margin-bottom': 'var(--space-1)' } }, 'What needs changing'),
          h('span', null, correctionReason))
        : null,
      h('p', { style: { color: 'var(--text-muted)', 'margin-bottom': 'var(--space-5)' } },
        'Update the details below and resubmit — it goes back to your Housemaster. Everything you entered before is kept below.'),
      form);
  }
}

function toDate(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function toTime(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
