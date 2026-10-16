import { h } from '../dom.js';
import { API_BASE } from '../config.js';
import { formatDateTime } from '../format.js';
import { toast } from './ui.js';

/**
 * Digital exeat pass. The verification code is issued by the server after all
 * required approvals; this component only displays what the server returns.
 */
export function passCard({ pass, request, student }) {
  const codeNode = h('span', { class: 'pass-code-value' }, formatCode(pass.code));

  const copyBtn = h('button', {
    class: 'btn btn-secondary btn-sm',
    type: 'button',
    onclick: async () => {
      try {
        await navigator.clipboard.writeText(pass.code);
        toast('Pass code copied.', { type: 'success' });
      } catch {
        toast('Could not copy automatically — please note the code shown.', { type: 'error' });
      }
    },
  }, 'Copy code');

  const printBtn = h('button', {
    class: 'btn btn-secondary btn-sm',
    type: 'button',
    onclick: () => window.print(),
  }, 'Print');

  const qrImg = h('img', {
    src: `${API_BASE}/api/requests/${request.id}/pass/qr.svg`,
    alt: 'QR code containing this pass verification code',
    width: '132',
    height: '132',
    loading: 'lazy',
  });
  qrImg.addEventListener('error', () => {
    qrBox.replaceChildren(
      h('p', { style: { color: 'var(--text-muted)', 'font-size': 'var(--text-sm)', margin: 0 } },
        'QR code unavailable offline. Gate officers can type the code below instead.'));
  });

  const qrBox = h('div', { class: 'pass-qr' },
    qrImg,
    h('div', { style: { flex: '1 1 12rem' } },
      h('p', { style: { 'font-size': 'var(--text-sm)', color: 'var(--text-muted)', margin: 0 } },
        'Show this pass at the school gate. The gate officer scans the code or types it in to confirm it is valid.'),
      h('div', { class: 'btn-row', style: { 'margin-top': 'var(--space-3)' } }, copyBtn, printBtn)));

  const state = pass.state || 'active';
  const stateNote = {
    active: { kind: 'success', text: 'This pass is valid for the authorised window.' },
    departed: { kind: 'warning', text: 'Departure recorded. Remember to return by the authorised time.' },
    completed: { kind: 'info', text: 'This exeat has been completed — the return was recorded.' },
    revoked: { kind: 'danger', text: `This pass was revoked${pass.revokeReason ? `: ${pass.revokeReason}` : '.'}` },
    expired: { kind: 'danger', text: 'This pass has expired.' },
  }[state] || { kind: 'info', text: '' };

  return h('div', { class: 'pass-card pass-print-area' },
    h('div', { class: 'pass-head' },
      h('div', null,
        h('div', { class: 'pass-label' }, 'Entryout exeat pass'),
        h('div', { class: 'pass-ref' }, request.reference)),
      h('div', { style: { textAlign: 'right', 'font-size': 'var(--text-sm)' } },
        h('div', { style: { 'font-weight': 700 } }, student?.fullName || ''),
        h('div', { style: { opacity: 0.9 } }, `${student?.classYear || ''} · ${student?.house || ''}`))),
    h('div', { class: 'pass-body' },
      h('div', { class: `alert alert-${stateNote.kind}` }, h('span', null, stateNote.text)),
      h('div', { class: 'pass-grid' },
        passItem('Index number', student?.indexNumber || '—'),
        passItem('Type', request.type === 'external' ? 'External exeat' : 'Internal exeat'),
        passItem('Destination', request.destination),
        passItem('Authorised departure', formatDateTime(request.departAt)),
        passItem('Return by', formatDateTime(request.returnAt)),
        passItem('Issued', formatDateTime(pass.issuedAt || pass.issued_at))),
      h('div', { class: 'pass-code' },
        h('div', null,
          h('div', { style: { 'font-size': 'var(--text-xs)', 'text-transform': 'uppercase', 'font-weight': 700, color: 'var(--text-muted)' } }, 'Verification code'),
          codeNode),
        h('span', { class: 'badge badge-approved' }, 'Approved')),
      qrBox),
    h('div', { class: 'pass-foot' },
      'A pass is only valid while the school approval is active and the authorised return time has not passed. Gate officers confirm every pass against the school record.'));
}

function passItem(label, value) {
  return h('div', { class: 'detail-item' },
    h('div', { style: { 'font-size': 'var(--text-xs)', 'text-transform': 'uppercase', 'letter-spacing': '0.04em', color: 'var(--text-muted)', 'font-weight': 600, 'margin-bottom': '0.25rem' } }, label),
    h('div', { style: { fontWeight: 500 } }, value));
}

/** Group the code for readability: ABCD 1234 EFGH */
function formatCode(code) {
  return String(code || '').replace(/(.{4})/g, '$1 ').trim();
}
