import { Router } from 'express';
import { getDb, newId, nowIso } from '../db.js';
import { asyncHandler, badRequest, conflict, forbidden } from '../middleware/errors.js';
import { requireAuth, requireRole, audit } from '../middleware/auth.js';
import { lookupPass, passState } from '../services/passes.js';
import { notify } from '../services/notifications.js';

export const gateRouter = Router();
gateRouter.use(requireAuth, requireRole('gate', 'admin', 'senior', 'housemaster'));

function present(lookup) {
  const { pass, request, student } = lookup;
  const state = passState(pass, request);
  return {
    valid: state.valid,
    state: state.state,
    message: state.message,
    pass: {
      code: pass.code,
      status: pass.status,
      expiresAt: pass.expires_at,
      departedAt: pass.departed_at,
      returnedAt: pass.returned_at,
    },
    request: {
      reference: request.reference,
      type: request.type,
      destination: request.destination,
      departAt: request.depart_at,
      returnAt: request.return_at,
      status: request.status,
      urgent: !!request.urgent,
    },
    // Gate staff only receive identity data needed to check the student at the
    // gate. The reason for leaving and guardian details are deliberately omitted.
    student: student ? {
      fullName: student.full_name,
      indexNumber: student.index_number,
      classYear: student.class_year,
      house: student.house,
    } : null,
  };
}

gateRouter.post('/verify', (req, res) => {
  const lookup = lookupPass(req.body?.code);
  if (!lookup.ok) {
    return res.status(404).json({
      valid: false,
      state: lookup.reason,
      message: lookup.reason === 'not_found'
        ? 'No pass matches that code. Check the code and try again.'
        : 'Enter the pass code exactly as printed on the pass.',
    });
  }
  res.json(present(lookup));
});

gateRouter.post('/depart', asyncHandler(async (req, res) => {
  const lookup = lookupPass(req.body?.code);
  if (!lookup.ok) throw badRequest('No pass matches that code.');
  const { pass, request } = lookup;
  const state = passState(pass, request);
  if (pass.departed_at) throw conflict('This student has already been recorded as departed.');
  if (!state.valid) throw conflict(state.message);

  const now = nowIso();
  const db = getDb();
  db.prepare('UPDATE passes SET departed_at = ? WHERE id = ?').run(now, pass.id);
  db.prepare('INSERT INTO movement_events (id, request_id, type, recorded_at, recorded_by, note) VALUES (?, ?, ?, ?, ?, ?)')
    .run(newId(), request.id, 'departure', now, req.user.id, req.body?.note ? String(req.body.note).slice(0, 200) : null);
  audit(req.user.id, 'gate_departure', 'passes', pass.id, { reference: request.reference });
  notify({
    userId: request.student_id,
    type: 'departure_recorded',
    title: 'Departure recorded',
    body: `${request.reference}: you are checked out. Remember to return by the authorised time.`,
  });
  const fresh = lookupPass(req.body?.code);
  res.json(present(fresh));
}));

gateRouter.post('/return', asyncHandler(async (req, res) => {
  const lookup = lookupPass(req.body?.code);
  if (!lookup.ok) throw badRequest('No pass matches that code.');
  const { pass, request } = lookup;
  if (pass.returned_at) throw conflict('This student has already been recorded as returned.');
  if (!pass.departed_at) throw conflict('Record the departure before recording a return.');

  const now = nowIso();
  const db = getDb();
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE passes SET returned_at = ?, status = ? WHERE id = ?').run(now, 'completed', pass.id);
    db.prepare("UPDATE exeat_requests SET status = 'completed', updated_at = ? WHERE id = ?").run(now, request.id);
    db.prepare('INSERT INTO movement_events (id, request_id, type, recorded_at, recorded_by, note) VALUES (?, ?, ?, ?, ?, ?)')
      .run(newId(), request.id, 'return', now, req.user.id, req.body?.note ? String(req.body.note).slice(0, 200) : null);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  audit(req.user.id, 'gate_return', 'passes', pass.id, { reference: request.reference });
  notify({
    userId: request.student_id,
    type: 'return_recorded',
    title: 'Return recorded',
    body: `${request.reference}: your return has been recorded. Welcome back.`,
  });
  const fresh = lookupPass(req.body?.code);
  res.json(present(fresh));
}));

/** Recent gate activity for the officers on duty. */
gateRouter.get('/movements', (req, res) => {
  const rows = getDb().prepare(`
    SELECT m.*, r.reference, u.full_name AS student_name, s.house, s.class_year
    FROM movement_events m
    JOIN exeat_requests r ON r.id = m.request_id
    JOIN users u ON u.id = r.student_id
    JOIN students s ON s.user_id = r.student_id
    ORDER BY m.recorded_at DESC
    LIMIT 50`).all();
  res.json({
    movements: rows.map((m) => ({
      id: m.id,
      type: m.type,
      reference: m.reference,
      studentName: m.student_name,
      house: m.house,
      classYear: m.class_year,
      recordedAt: m.recorded_at,
    })),
  });
});
