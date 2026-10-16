import { Router } from 'express';
import { getDb } from '../db.js';
import { asyncHandler, badRequest, forbidden, notFound } from '../middleware/errors.js';
import { requireAuth, requireRole, audit } from '../middleware/auth.js';
import { decide, serializeRequest, timeline, STATUS_LABELS } from '../services/workflow.js';

export const staffRouter = Router();
staffRouter.use(requireAuth, requireRole('housemaster', 'senior', 'admin'));

/**
 * Scope rule:
 *  - housemaster: students in their assigned houses
 *  - senior: every request that requires senior approval, plus its history
 *  - admin: read-only oversight of all requests (admins cannot approve)
 */
function scopedQuery(req) {
  const db = getDb();
  if (req.user.role === 'housemaster') {
    if (!req.houses.length) return { sql: 'WHERE 1 = 0', params: [] };
    const holes = req.houses.map(() => '?').join(',');
    return {
      sql: `WHERE s.house IN (${holes})`,
      params: req.houses,
    };
  }
  if (req.user.role === 'senior') return { sql: 'WHERE r.requires_senior = 1', params: [] };
  return { sql: '', params: [] };
}

staffRouter.get('/requests', asyncHandler(async (req, res) => {
  const db = getDb();
  const scope = scopedQuery(req);
  const filters = [scope.sql];
  const params = [...scope.params];

  const status = String(req.query.status || '');
  if (status) {
    filters.push('AND r.status = ?');
    params.push(status);
  } else if (req.user.role !== 'admin') {
    // Default view: open work items plus recent history.
    filters.push("AND r.status IN ('pending','pending_senior','approved','returned','rejected','cancelled','completed')");
  }

  const type = String(req.query.type || '');
  if (['internal', 'external'].includes(type)) {
    filters.push('AND r.type = ?');
    params.push(type);
  }
  const house = String(req.query.house || '');
  if (house && (req.user.role !== 'housemaster' || req.houses.includes(house))) {
    filters.push('AND s.house = ?');
    params.push(house);
  }
  if (req.query.urgent === 'true') filters.push('AND r.urgent = 1');
  if (req.query.from) {
    filters.push('AND r.depart_at >= ?');
    params.push(String(req.query.from));
  }
  if (req.query.to) {
    filters.push('AND r.depart_at <= ?');
    params.push(String(req.query.to));
  }

  const q = String(req.query.q || '').trim();
  if (q) {
    filters.push('AND (u.full_name LIKE ? OR s.index_number LIKE ? OR r.reference LIKE ? OR r.destination LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  const where = filters.join(' ').replace(/\s+/g, ' ').trim();
  const rows = db.prepare(`
    SELECT r.*, u.full_name AS student_name, s.index_number, s.class_year, s.house,
      (SELECT COUNT(*) FROM approval_records a WHERE a.request_id = r.id) AS decision_count,
      (SELECT p.code FROM passes p WHERE p.request_id = r.id) AS pass_code
    FROM exeat_requests r
    JOIN users u ON u.id = r.student_id
    JOIN students s ON s.user_id = r.student_id
    ${where}
    ORDER BY r.urgent DESC,
      CASE r.status WHEN 'pending' THEN 0 WHEN 'pending_senior' THEN 1 WHEN 'returned' THEN 2 ELSE 3 END,
      r.depart_at ASC
    LIMIT 200`).all(...params);

  const counts = db.prepare(`
    SELECT r.status, COUNT(*) AS n
    FROM exeat_requests r
    JOIN users u ON u.id = r.student_id
    JOIN students s ON s.user_id = r.student_id
    ${where}
    GROUP BY r.status`).all(...params);
  const summary = Object.fromEntries(counts.map((c) => [c.status, c.n]));

  res.json({
    requests: rows.map((row) => ({
      ...serializeRequest(row),
      student: {
        fullName: row.student_name,
        indexNumber: row.index_number,
        classYear: row.class_year,
        house: row.house,
      },
      decisionCount: row.decision_count,
      passCode: req.user.role === 'gate' ? null : row.pass_code,
    })),
    summary,
    statusLabels: STATUS_LABELS,
  });
}));

staffRouter.get('/requests/:id', asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare(`
    SELECT r.*, u.full_name AS student_name, u.username AS student_username,
      s.index_number, s.class_year, s.house, s.guardian_name, s.guardian_phone
    FROM exeat_requests r
    JOIN users u ON u.id = r.student_id
    JOIN students s ON s.user_id = r.student_id
    WHERE r.id = ?`).get(req.params.id);
  if (!row) throw notFound('Request not found.');

  if (req.user.role === 'housemaster' && !req.houses.includes(row.house)) {
    throw forbidden('You can only view students in your house.');
  }
  if (req.user.role === 'senior' && !row.requires_senior) {
    throw forbidden('That request does not require senior approval.');
  }

  const approvals = db.prepare(`SELECT a.*, u.full_name AS reviewer_name, u.role AS reviewer_role
    FROM approval_records a JOIN users u ON u.id = a.reviewer_id
    WHERE a.request_id = ? ORDER BY a.created_at ASC`).all(row.id);

  const pass = db.prepare('SELECT * FROM passes WHERE request_id = ?').get(row.id);
  const profile = db.prepare('SELECT * FROM students WHERE user_id = ?').get(row.student_id);

  const stage = row.status === 'pending' ? 'housemaster' : row.status === 'pending_senior' ? 'senior' : null;
  const canDecide = !!stage && req.user.role !== 'admin' && req.user.id !== row.student_id
    && (req.user.role === 'senior' ? stage === 'senior' : req.houses.includes(row.house));

  res.json({
    request: serializeRequest(row, { includeGuardian: true }),
    student: {
      fullName: row.student_name,
      username: row.student_username,
      indexNumber: row.index_number,
      classYear: row.class_year,
      house: row.house,
      guardianName: row.guardian_name,
      guardianPhone: row.guardian_phone,
    },
    approvals: approvals.map((a) => ({
      stage: a.stage,
      decision: a.decision,
      comment: a.comment,
      reviewerName: a.reviewer_name,
      at: a.created_at,
    })),
    timeline: timeline(row.id),
    pass: pass ? {
      code: pass.code,
      status: pass.status,
      issuedAt: pass.issued_at,
      expiresAt: pass.expires_at,
      departedAt: pass.departed_at,
      returnedAt: pass.returned_at,
    } : null,
    canDecide,
    nextStage: stage,
  });
}));

staffRouter.post('/requests/:id/decision', asyncHandler(async (req, res) => {
  const decision = String(req.body?.decision || '');
  if (!['approved', 'rejected', 'returned'].includes(decision)) {
    throw badRequest('Choose approve, reject, or return for correction.');
  }
  const result = decide(req.user, req.params.id, decision, req.body?.comment);
  audit(req.user.id, `request_${decision}`, 'exeat_requests', req.params.id, { stage: result.request.status });
  res.json({ request: result.request, pass: result.pass ? { code: result.pass.code } : null });
}));
