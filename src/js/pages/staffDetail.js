import { h } from '../dom.js';
import { apiGet, apiPost } from '../api.js';
import { setTitle } from '../components/shell.js';
import { statusBadge, urgentBadge, typePill, loadingBlock, openDialog, toast, emptyState } from '../components/ui.js';
import { timeline } from '../components/timeline.js';
import { passCard } from '../components/passCard.js';
import { formatDateTime, durationLabel, relativeTime } from '../format.js';
import { categoryLabel } from '../validation.js';
import { navigate } from '../router.js';

export async function staffDetailPage({ params }) {
  setTitle('Review request');
  const root = h('div', null, loadingBlock('Loading request…'));

  async function load() {
    try {
      const data = await apiGet(`/api/staff/requests/${params.id}`);
      render(data);
    } catch (err) {
      root.replaceChildren(emptyState({
        title: err.status === 403 ? 'Outside your access' : err.status === 404 ? 'Request not found' : 'Could not load this request',
        message: err.message || 'Please try again.',
        actionLabel: 'Back to queue',
        onAction: () => navigate('#/staff'),
      }));
    }
  }

  function render(payload) {
    const { request, student, approvals, timeline: events, pass, canDecide } = payload;
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
                detail('Departs', formatDateTime(request.departAt)),
                detail('Return by', formatDateTime(request.returnAt)),
                detail('Duration', durationLabel(request.departAt, request.returnAt)),
                detail('Submitted', request.submittedAt ? `${formatDateTime(request.submittedAt)} (${relativeTime(request.submittedAt)})` : '—')))),
          h('div', { class: 'card' },
            h('div', { class: 'card-header' }, h('h2', null, 'Decision history')),
            h('div', { class: 'card-body' },
              approvals.length
                ? h('ul', { class: 'stack' }, approvals.map((a) => h('li', { class: 'note' },
                    h('div', null,
                      h('div', { class: 'note-title' },
                        `${a.decision === 'approved' ? 'Approved' : a.decision === 'rejected' ? 'Rejected' : 'Returned'} by ${a.reviewerName}`),
                      h('div', { class: 'note-body' }, a.comment || 'No comment recorded.'),
                      h('div', { class: 'note-time' }, `${a.stage === 'senior' ? 'Senior stage' : 'Housemaster stage'} · ${formatDateTime(a.at)}`)))))
                : h('p', { style: { color: 'var(--text-muted)' } }, 'No decisions recorded yet.'))),
          h('div', { class: 'card' },
            h('div', { class: 'card-header' }, h('h2', null, 'Timeline')),
            h('div', { class: 'card-body' }, timeline(events)))),
        h('div', { class: 'stack' },
          pass ? passCard({ pass, request, student }) : null,
          canDecide ? decisionPanel(request, load) : waitingPanel(request))));
  }

  function detail(label, value) {
    return h('div', { class: 'detail-item' },
      h('dt', null, label),
      h('dd', null, value || '—'));
  }

  function waitingPanel(request) {
    const text = {
      pending: 'Waiting for the housemaster of this student’s house.',
      pending_senior: 'Waiting for the Senior Housemaster’s decision.',
    }[request.status] || 'No decision is required right now.';
    return h('div', { class: 'card card-pad' },
      h('h3', { style: { 'margin-bottom': 'var(--space-2)' } }, 'No action available'),
      h('p', { style: { color: 'var(--text-muted)' } }, text));
  }

  function decisionPanel(request, reload) {
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
            comment.value.trim() ? h('p', { style: { 'font-style': 'italic' } }, `Your note: “${comment.value.trim()}”`) : null),
          confirmLabel: `Yes, ${verb}`,
          danger: decision !== 'approved',
        });
        if (!confirmed) return;
        try {
          const data = await apiPost(`/api/staff/requests/${request.id}/decision`, {
            decision,
            comment: comment.value.trim(),
          });
          toast(
            decision === 'approved' && data.request.status === 'pending_senior'
              ? 'Approved — sent to the Senior Housemaster.'
              : `Request ${decision === 'approved' ? 'approved' : decision === 'rejected' ? 'rejected' : 'returned'}.`,
            { type: decision === 'rejected' ? 'error' : 'success' });
          reload();
        } catch (err) {
          toast(err.message || 'Decision could not be recorded.', { type: 'error' });
        }
      },
    }, label);

    return h('div', { class: 'card card-pad' },
      h('h2', { style: { 'margin-bottom': 'var(--space-4)' } }, 'Your decision'),
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
