import { Router } from 'express';
import QRCode from 'qrcode';
import { getDb } from '../db.js';
import { asyncHandler, badRequest, notFound } from '../middleware/errors.js';
import { requireAuth, requireRole, audit } from '../middleware/auth.js';
import { createRequest, resubmitRequest, cancelRequest, serializeRequest, timeline } from '../services/workflow.js';
import { lookupPass, passState } from '../services/passes.js';

export const requestsRouter = Router();
requestsRouter.use(requireAuth, requireRole('student'));

function ownRequest(req, id) {
  const row = getDb().prepare('SELECT * FROM exeat_requests WHERE id = ? AND student_id = ?').get(id, req.user.id);
  if (!row) throw notFound('Request not found.');
  return row;
}

requestsRouter.get('/mine', (req, res) => {
  const rows = getDb().prepare('SELECT * FROM exeat_requests WHERE student_id = ? ORDER BY created_at DESC').all(req.user.id);
  const db = getDb();
  res.json({
    requests: rows.map((row) => {
      const pass = db.prepare('SELECT code, status, departed_at, returned_at, expires_at FROM passes WHERE request_id = ?').get(row.id);
      return {
        ...serializeRequest(row, { includeGuardian: true }),
        pass: pass ? {
          code: pass.code,
          status: pass.status,
          departedAt: pass.departed_at,
          returnedAt: pass.returned_at,
          expiresAt: pass.expires_at,
          hasPass: true,
        } : null,
      };
    }),
  });
});

requestsRouter.post('/', asyncHandler(async (req, res) => {
  const key = cleanIdempotencyKey(req.get('idempotency-key') || req.body?.idempotencyKey);
  const request = createRequest(req.user, req.body || {}, key);
  audit(req.user.id, 'request_submitted', 'exeat_requests', request.id, { reference: request.reference });
  res.status(201).json({ request });
}));

requestsRouter.get('/:id', asyncHandler(async (req, res) => {
  const row = ownRequest(req, req.params.id);
  const db = getDb();
  const profile = db.prepare('SELECT index_number, class_year, house FROM students WHERE user_id = ?').get(req.user.id);
  const pass = db.prepare('SELECT * FROM passes WHERE request_id = ?').get(row.id);
  const approvals = db.prepare(`SELECT a.*, u.full_name AS reviewer_name
    FROM approval_records a JOIN users u ON u.id = a.reviewer_id
    WHERE a.request_id = ? ORDER BY a.created_at ASC`).all(row.id);
  res.json({
    request: serializeRequest(row, { includeGuardian: true }),
    student: {
      fullName: req.user.full_name,
      indexNumber: profile?.index_number,
      classYear: profile?.class_year,
      house: profile?.house,
    },
    approvals: approvals.map((a) => ({
      stage: a.stage,
      decision: a.decision,
      comment: a.comment,
      reviewerName: a.reviewer_name,
      at: a.created_at,
      proposedDepartAt: a.proposed_depart_at || null,
      proposedReturnAt: a.proposed_return_at || null,
      dateReason: a.date_reason || null,
    })),
    timeline: timeline(row.id),
    pass: pass ? {
      code: pass.code,
      status: pass.status,
      issuedAt: pass.issued_at,
      expiresAt: pass.expires_at,
      departedAt: pass.departed_at,
      returnedAt: pass.returned_at,
      revokedAt: pass.revoked_at,
      revokeReason: pass.revoke_reason,
    } : null,
  });
}));

requestsRouter.patch('/:id', asyncHandler(async (req, res) => {
  const row = ownRequest(req, req.params.id);
  const request = resubmitRequest(req.user, row.id, req.body || {});
  audit(req.user.id, 'request_corrected', 'exeat_requests', row.id, { reference: request.reference });
  res.json({ request });
}));

requestsRouter.post('/:id/cancel', asyncHandler(async (req, res) => {
  const row = ownRequest(req, req.params.id);
  const request = cancelRequest(req.user, row.id, req.body?.reason);
  audit(req.user.id, 'request_cancelled', 'exeat_requests', row.id, { reference: request.reference });
  res.json({ request });
}));

/** Public pass data for the owning student (never exposes the full queue). */
requestsRouter.get('/:id/pass', asyncHandler(async (req, res) => {
  const row = ownRequest(req, req.params.id);
  const pass = getDb().prepare('SELECT * FROM passes WHERE request_id = ?').get(row.id);
  if (!pass) throw notFound('No pass has been issued for this request.');
  const state = passState(pass, row);
  res.json({
    pass: {
      code: pass.code,
      status: pass.status,
      issuedAt: pass.issued_at,
      expiresAt: pass.expires_at,
      departedAt: pass.departed_at,
      returnedAt: pass.returned_at,
      valid: state.valid,
      state: state.state,
      message: state.message,
    },
  });
}));

/** QR code for the student's own pass (contains only the pass code). */
requestsRouter.get('/:id/pass/qr.svg', asyncHandler(async (req, res) => {
  const row = ownRequest(req, req.params.id);
  const pass = getDb().prepare('SELECT * FROM passes WHERE request_id = ?').get(row.id);
  if (!pass) throw notFound('No pass has been issued for this request.');
  const svg = await QRCode.toString(pass.code, {
    type: 'svg',
    margin: 1,
    width: 260,
    color: { dark: '#18181B', light: '#FFFFFF' },
  });
  res.set('content-type', 'image/svg+xml').set('cache-control', 'no-store').send(svg);
}));

function cleanIdempotencyKey(raw) {
  if (!raw) return null;
  const value = String(raw).slice(0, 64);
  return /^[A-Za-z0-9-]{8,64}$/.test(value) ? value : null;
}
