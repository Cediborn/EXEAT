import { getDb, newId, nowIso, getNumberSetting } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../middleware/errors.js';
import { validateApplication, HOUSES } from './validate.js';
import { issuePass, revokePass } from './passes.js';
import { notify, notifyRoles } from './notifications.js';

export const STATUS_LABELS = {
  pending: 'Pending housemaster approval',
  pending_senior: 'Pending senior housemaster approval',
  approved: 'Approved',
  rejected: 'Rejected',
  returned: 'Returned for correction',
  cancelled: 'Cancelled',
  completed: 'Completed',
};

function nextReference(db) {
  const year = new Date().getFullYear();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'request_counter'").get();
  const next = Number(row?.value || 0) + 1;
  db.prepare("UPDATE settings SET value = ?, updated_at = ? WHERE key = 'request_counter'").run(String(next), nowIso());
  return `EXE-${year}-${String(next).padStart(4, '0')}`;
}

function studentProfile(db, userId) {
  return db.prepare('SELECT * FROM students WHERE user_id = ?').get(userId);
}

/** Reviewers that must act at the given stage. */
export function reviewersForStage(db, request, stage) {
  if (stage === 'senior') {
    return db.prepare("SELECT id, email, full_name FROM users WHERE role = 'senior' AND active = 1").all();
  }
  const profile = studentProfile(db, request.student_id);
  if (!profile) return [];
  const assigned = db.prepare(`SELECT u.id, u.email, u.full_name FROM users u
    JOIN staff_assignments sa ON sa.user_id = u.id
    WHERE u.role = 'housemaster' AND u.active = 1 AND sa.house = ?`).all(profile.house);
  return assigned;
}

function notifyReviewers(db, request, stage, urgent) {
  const reviewers = reviewersForStage(db, request, stage);
  const profile = studentProfile(db, request.student_id);
  for (const reviewer of reviewers) {
    notify({
      userId: reviewer.id,
      emailTo: reviewer.email,
      type: urgent ? 'request_urgent' : 'request_submitted',
      title: urgent ? 'URGENT exeat request' : 'New exeat request',
      body: `${profile?.class_year || 'A student'} · ${request.reference} is waiting for ${stage === 'senior' ? 'senior' : 'housemaster'} review.`,
      link: `#/staff/requests/${request.id}`,
    });
  }
  if (urgent) {
    notifyRoles(['admin', 'senior'], {
      type: 'request_urgent',
      title: 'Urgent medical exeat submitted',
      body: `An urgent request (${request.reference}) needs immediate attention.`,
      link: `#/staff/requests/${request.id}`,
    });
  }
}

/**
 * Create and immediately submit a new exeat request for the signed-in student.
 * @param {object} user authenticated user row
 * @param {object} body application payload
 * @param {string} idempotencyKey client generated key to make retries safe
 */
export function createRequest(user, body, idempotencyKey) {
  const db = getDb();
  const profile = studentProfile(db, user.id);
  if (!profile) throw badRequest('Your student profile is incomplete. Ask the school office to complete it.');

  if (idempotencyKey) {
    const existing = db.prepare('SELECT * FROM exeat_requests WHERE idempotency_key = ?').get(idempotencyKey);
    if (existing) return serializeRequest(existing);
  }

  const result = validateApplication(body);
  if (!result.ok) throw badRequest('Please fix the highlighted fields.', result.errors);

  const now = nowIso();
  const id = newId();
  const reference = nextReference(db);
  const data = result.value;

  db.prepare(`INSERT INTO exeat_requests
    (id, reference, student_id, type, category, reason, destination, guardian_name, guardian_phone,
     depart_at, return_at, urgent, requires_senior, status, idempotency_key, submitted_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`)
    .run(id, reference, user.id, data.type, data.category, data.reason, data.destination,
      data.guardianName || profile.guardian_name, data.guardianPhone || profile.guardian_phone,
      data.departAt, data.returnAt, data.urgent, data.requiresSenior,
      idempotencyKey || null, now, now, now);

  const request = db.prepare('SELECT * FROM exeat_requests WHERE id = ?').get(id);
  notifyReviewers(db, request, 'housemaster', data.urgent === 1);

  return serializeRequest(request);
}

/** Update a request that was returned for correction, then resubmit it. */
export function resubmitRequest(user, requestId, body) {
  const db = getDb();
  const request = db.prepare('SELECT * FROM exeat_requests WHERE id = ?').get(requestId);
  if (!request || request.student_id !== user.id) throw notFound('Request not found.');
  if (request.status !== 'returned') {
    throw conflict('Only requests returned for correction can be edited.');
  }

  const result = validateApplication(body);
  if (!result.ok) throw badRequest('Please fix the highlighted fields.', result.errors);
  const data = result.value;
  const now = nowIso();

  db.prepare(`UPDATE exeat_requests SET type = ?, category = ?, reason = ?, destination = ?,
    guardian_name = ?, guardian_phone = ?, depart_at = ?, return_at = ?, urgent = ?, requires_senior = ?,
    status = 'pending', updated_at = ? WHERE id = ?`)
    .run(data.type, data.category, data.reason, data.destination, data.guardianName, data.guardianPhone,
      data.departAt, data.returnAt, data.urgent, data.requiresSenior, now, requestId);

  const updated = db.prepare('SELECT * FROM exeat_requests WHERE id = ?').get(requestId);
  notifyReviewers(db, updated, 'housemaster', data.urgent === 1);
  return serializeRequest(updated);
}

export function cancelRequest(user, requestId, reason) {
  const db = getDb();
  const request = db.prepare('SELECT * FROM exeat_requests WHERE id = ?').get(requestId);
  if (!request || request.student_id !== user.id) throw notFound('Request not found.');
  if (!['pending', 'pending_senior', 'approved', 'returned'].includes(request.status)) {
    throw conflict('This request can no longer be cancelled.');
  }
  const cleanReason = String(reason || '').trim().slice(0, 300);
  if (!cleanReason) throw badRequest('Tell us why you are cancelling.');
  const now = nowIso();
  db.prepare("UPDATE exeat_requests SET status = 'cancelled', cancel_reason = ?, updated_at = ? WHERE id = ?")
    .run(cleanReason, now, requestId);
  revokePass(requestId, `Cancelled by student: ${cleanReason}`, user.id);
  notifyRoles(['housemaster', 'senior', 'admin'], {
    type: 'request_cancelled',
    title: 'Exeat request cancelled',
    body: `${request.reference} was cancelled by the student.`,
    link: `#/staff/requests/${request.id}`,
  });
  return serializeRequest(db.prepare('SELECT * FROM exeat_requests WHERE id = ?').get(requestId));
}

/**
 * Record an approval decision. The server independently verifies that the
 * reviewer is authorised for the request's current stage and house.
 */
export function decide(reviewer, requestId, decision, comment, dateFields = {}) {
  const db = getDb();
  const request = db.prepare('SELECT * FROM exeat_requests WHERE id = ?').get(requestId);
  if (!request) throw notFound('Request not found.');
  if (reviewer.id === request.student_id) throw forbidden('You cannot make a decision on your own request.');

  const cleanComment = String(comment || '').trim().slice(0, 500);
  if (['rejected', 'returned'].includes(decision) && cleanComment.length < 5) {
    throw badRequest('Give the student a clear reason (at least 5 characters).', { comment: 'A reason is required.' });
  }
  if (!['approved', 'rejected', 'returned'].includes(decision)) {
    throw badRequest('Unknown decision.');
  }

  const stage = request.status === 'pending' ? 'housemaster'
    : request.status === 'pending_senior' ? 'senior' : null;
  if (!stage) throw conflict('This request is not awaiting a decision.');

  if (reviewer.role === 'housemaster') {
    if (stage !== 'housemaster') throw forbidden('This request has moved past the housemaster stage.');
    const profile = studentProfile(db, request.student_id);
    const houses = db.prepare('SELECT house FROM staff_assignments WHERE user_id = ?').all(reviewer.id).map((r) => r.house);
    if (!profile || !houses.includes(profile.house)) {
      throw forbidden('You are not the housemaster for this student.');
    }
  } else if (reviewer.role === 'senior') {
    if (stage !== 'senior') throw forbidden('This request is not waiting for senior approval.');
  } else {
    throw forbidden('Your role cannot make approval decisions.');
  }

  /*
   * Proposed dates (Phase 4): staff may shorten the requested schedule when
   * approving. The student's original depart_at/return_at are never touched;
   * proposals are validated, stored on the approval record, mirrored onto the
   * request as proposed_*, and frozen into approved_* on final approval.
   */
  let proposedDepartAt = null;
  let proposedReturnAt = null;
  let dateReason = null;
  if (decision === 'approved'
    && (dateFields.proposedDepartAt || dateFields.proposedReturnAt)) {
    const rawDepart = String(dateFields.proposedDepartAt || '').trim();
    const rawReturn = String(dateFields.proposedReturnAt || '').trim();
    if (!rawDepart || !rawReturn) {
      throw badRequest('Provide both a proposed departure and a proposed return time.',
        { proposedReturnAt: 'Both proposed times are required.' });
    }
    const departDate = new Date(rawDepart);
    const returnDate = new Date(rawReturn);
    if (Number.isNaN(departDate.getTime()) || Number.isNaN(returnDate.getTime())) {
      throw badRequest('One of the proposed dates is not a valid date.',
        { proposedReturnAt: 'Enter a valid date.' });
    }
    const currentDepart = request.approved_depart_at || request.proposed_depart_at || request.depart_at;
    const currentReturn = request.approved_return_at || request.proposed_return_at || request.return_at;
    // Compare at minute granularity: the UI round-trips through date+time
    // inputs, which drop seconds, and that must not count as a change.
    const minute = (iso) => Math.floor(new Date(iso).getTime() / 60000);
    const changed = minute(departDate) !== minute(new Date(currentDepart))
      || minute(returnDate) !== minute(new Date(currentReturn));
    if (changed) {
      dateReason = String(dateFields.dateReason || '').trim().slice(0, 500);
      if (dateReason.length < 5) {
        throw badRequest('Explain why you are changing the proposed dates.',
          { dateReason: 'A reason is required when dates change.' });
      }
      if (returnDate.getTime() <= departDate.getTime()) {
        throw badRequest('The proposed return time must be after the proposed departure time.',
          { proposedReturnAt: 'Return must be after departure.' });
      }
      const hours = (returnDate.getTime() - departDate.getTime()) / 3600000;
      const maxDuration = getNumberSetting('max_duration_hours', 72);
      if (hours > maxDuration) {
        throw badRequest(
          `The proposed schedule may not exceed ${maxDuration} hours — the school's configured limit.`,
          { proposedReturnAt: `Shorten the schedule to ${maxDuration} hours or less.` });
      }
      proposedDepartAt = departDate.toISOString();
      proposedReturnAt = returnDate.toISOString();
    }
  }

  const now = nowIso();
  const effectiveDepart = proposedDepartAt || request.proposed_depart_at || request.depart_at;
  const effectiveReturn = proposedReturnAt || request.proposed_return_at || request.return_at;
  db.prepare(`INSERT INTO approval_records
    (id, request_id, reviewer_id, stage, decision, comment, created_at,
     proposed_depart_at, proposed_return_at, date_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(newId(), request.id, reviewer.id, stage, decision, cleanComment || null, now,
      decision === 'approved' ? effectiveDepart : null,
      decision === 'approved' ? effectiveReturn : null,
      dateReason);

  const student = db.prepare('SELECT id, email, full_name FROM users WHERE id = ?').get(request.student_id);
  let status = request.status;
  let pass = null;

  if (decision === 'approved') {
    if (stage === 'housemaster' && request.requires_senior) {
      status = 'pending_senior';
      db.prepare('UPDATE exeat_requests SET proposed_depart_at = ?, proposed_return_at = ? WHERE id = ?')
        .run(effectiveDepart, effectiveReturn, request.id);
    } else {
      status = 'approved';
      db.prepare(`UPDATE exeat_requests SET decided_at = ?,
        proposed_depart_at = ?, proposed_return_at = ?,
        approved_depart_at = ?, approved_return_at = ? WHERE id = ?`)
        .run(now, effectiveDepart, effectiveReturn, effectiveDepart, effectiveReturn, request.id);
      pass = issuePass(request.id);
    }
  } else if (decision === 'rejected') {
    status = 'rejected';
    db.prepare("UPDATE exeat_requests SET decided_at = ? WHERE id = ?").run(now, request.id);
    revokePass(request.id, 'Request rejected', reviewer.id);
  } else {
    status = 'returned';
  }

  db.prepare('UPDATE exeat_requests SET status = ?, updated_at = ? WHERE id = ?').run(status, now, request.id);

  if (decision === 'approved' && status === 'pending_senior') {
    notifyReviewers(db, request, 'senior', request.urgent === 1);
  }

  notify({
    userId: student.id,
    emailTo: student.email,
    type: `request_${decision}`,
    title: decision === 'approved'
      ? (status === 'pending_senior' ? 'Housemaster approved — awaiting senior approval' : 'Your exeat request was approved')
      : decision === 'rejected' ? 'Your exeat request was rejected' : 'Your exeat request needs a correction',
    body: decision === 'approved'
      ? (status === 'pending_senior'
        ? `${request.reference} now needs the Senior Housemaster's approval.`
        : `${request.reference} is approved. Your digital pass is ready.`)
      : decision === 'rejected'
        ? `${request.reference} was rejected. ${cleanComment}`
        : `${request.reference} was returned for correction: ${cleanComment}`,
    link: `#/app/requests/${request.id}`,
  });

  return { request: serializeRequest(db.prepare('SELECT * FROM exeat_requests WHERE id = ?').get(request.id)), pass };
}

export function serializeRequest(row, extras = {}) {
  if (!row) return null;
  return {
    id: row.id,
    reference: row.reference,
    type: row.type,
    category: row.category,
    reason: row.reason,
    destination: row.destination,
    guardianName: extras.includeGuardian ? row.guardian_name : undefined,
    guardianPhone: extras.includeGuardian ? row.guardian_phone : undefined,
    departAt: row.depart_at,
    returnAt: row.return_at,
    proposedDepartAt: row.proposed_depart_at || null,
    proposedReturnAt: row.proposed_return_at || null,
    approvedDepartAt: row.approved_depart_at || null,
    approvedReturnAt: row.approved_return_at || null,
    urgent: !!row.urgent,
    requiresSenior: !!row.requires_senior,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status] || row.status,
    submittedAt: row.submitted_at,
    decidedAt: row.decided_at,
    cancelReason: row.cancel_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extras.public,
  };
}

export function timeline(requestId) {
  const db = getDb();
  const request = db.prepare('SELECT * FROM exeat_requests WHERE id = ?').get(requestId);
  if (!request) return [];
  const events = [];
  const staffName = (id) => db.prepare('SELECT full_name, role FROM users WHERE id = ?').get(id);

  events.push({ at: request.created_at, label: 'Request created', detail: null });
  if (request.submitted_at) events.push({ at: request.submitted_at, label: 'Submitted for approval', detail: null });

  const approvals = db.prepare('SELECT * FROM approval_records WHERE request_id = ? ORDER BY created_at ASC').all(requestId);
  for (const a of approvals) {
    const reviewer = staffName(a.reviewer_id);
    const verb = a.decision === 'approved' ? 'Approved' : a.decision === 'rejected' ? 'Rejected' : 'Returned for correction';
    events.push({
      at: a.created_at,
      label: `${verb} by ${reviewer?.full_name || 'staff'} (${a.stage === 'senior' ? 'Senior Housemaster' : 'Housemaster'})`,
      detail: a.comment || null,
    });
  }
  if (request.decided_at && !approvals.some((a) => a.decision === 'approved')) {
    events.push({ at: request.decided_at, label: 'Decision recorded', detail: null });
  }
  const movements = db.prepare('SELECT * FROM movement_events WHERE request_id = ? ORDER BY recorded_at ASC').all(requestId);
  for (const m of movements) {
    const officer = staffName(m.recorded_by);
    events.push({
      at: m.recorded_at,
      label: m.type === 'departure' ? 'Departed campus' : 'Returned to campus',
      detail: m.note || `Recorded by ${officer?.full_name || 'gate officer'}`,
    });
  }
  if (request.cancel_reason) {
    events.push({ at: request.updated_at, label: 'Cancelled by student', detail: request.cancel_reason });
  }
  return events.sort((a, b) => new Date(a.at) - new Date(b.at));
}

export { HOUSES };
