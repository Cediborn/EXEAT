import crypto from 'node:crypto';
import { getDb, getNumberSetting, newId, nowIso } from '../db.js';
import { notify } from './notifications.js';

// Crockford-style alphabet without I, L, O, U (easy to read at the gate).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generatePassCode(length = 12) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** Issue a pass for an approved request. Called only after final approval. */
export function issuePass(requestId) {
  const db = getDb();
  const request = db.prepare('SELECT * FROM exeat_requests WHERE id = ?').get(requestId);
  if (!request) throw new Error('Request not found');
  const existing = db.prepare('SELECT * FROM passes WHERE request_id = ?').get(requestId);
  if (existing) return existing;

  const pass = {
    id: newId(),
    request_id: requestId,
    code: generatePassCode(),
    issued_at: nowIso(),
    expires_at: request.return_at,
    status: 'active',
  };
  db.prepare(`INSERT INTO passes (id, request_id, code, issued_at, expires_at, status)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(pass.id, pass.request_id, pass.code, pass.issued_at, pass.expires_at, pass.status);

  const student = db.prepare('SELECT u.id, u.full_name FROM users u WHERE u.id = ?').get(request.student_id);
  notify({
    userId: student.id,
    type: 'pass_issued',
    title: 'Your exeat pass is ready',
    body: `Your pass ${request.reference} is valid. Show it at the school gate when you leave.`,
    link: `#/app/requests/${request.id}`,
  });

  const guardianPhone = db.prepare('SELECT guardian_phone FROM students WHERE user_id = ?').get(request.student_id)?.guardian_phone;
  if (guardianPhone) {
    notify({
      userId: student.id,
      type: 'guardian_sms',
      title: 'Parent notification',
      body: `Exeat pass ${request.reference} for ${student.full_name} has been approved.`,
      smsTo: guardianPhone,
    });
  }
  return pass;
}

export function revokePass(requestId, reason, actorId) {
  const db = getDb();
  const pass = db.prepare('SELECT * FROM passes WHERE request_id = ?').get(requestId);
  if (!pass) return null;
  db.prepare('UPDATE passes SET status = ?, revoked_at = ?, revoke_reason = ? WHERE id = ?')
    .run('revoked', nowIso(), reason || null, pass.id);
  return db.prepare('SELECT * FROM passes WHERE id = ?').get(pass.id);
}

/**
 * Look up a pass by its verification code.
 * @returns {{ ok: boolean, reason?: string, pass?: object, request?: object, student?: object }}
 */
export function lookupPass(code) {
  const db = getDb();
  const clean = String(code || '').toUpperCase().replace(/[\s-]/g, '');
  if (!/^[0-9A-HJKMNP-TV-Z]{8,16}$/.test(clean)) {
    return { ok: false, reason: 'invalid_format' };
  }
  const pass = db.prepare('SELECT * FROM passes WHERE code = ?').get(clean);
  if (!pass) return { ok: false, reason: 'not_found' };

  const request = db.prepare('SELECT * FROM exeat_requests WHERE id = ?').get(pass.request_id);
  const student = db.prepare(`SELECT u.id, u.full_name, s.index_number, s.class_year, s.house
    FROM users u JOIN students s ON s.user_id = u.id WHERE u.id = ?`).get(request.student_id);
  return { ok: true, pass, request, student };
}

/** Classify whether a pass can be used right now, with a machine-readable reason. */
export function passState(pass, request, now = new Date()) {
  const grace = getNumberSetting('return_grace_minutes', 60) * 60 * 1000;
  if (pass.status === 'revoked') return { valid: false, state: 'revoked', message: 'This pass has been revoked.' };
  if (pass.status === 'completed' || pass.returned_at) {
    return { valid: false, state: 'completed', message: 'This exeat has already been completed.' };
  }
  if (request.status === 'cancelled') return { valid: false, state: 'cancelled', message: 'This request was cancelled.' };
  if (request.status === 'rejected') return { valid: false, state: 'rejected', message: 'This request was rejected.' };
  if (!['approved', 'completed'].includes(request.status)) {
    return { valid: false, state: 'not_approved', message: 'This request has not completed approval.' };
  }
  if (now.getTime() > new Date(pass.expires_at).getTime() + grace) {
    return { valid: false, state: 'expired', message: 'This pass expired and the return is overdue.' };
  }
  if (pass.departed_at && !pass.returned_at) return { valid: true, state: 'departed', message: 'Student has left campus; return not yet recorded.' };
  if (now.getTime() > new Date(pass.expires_at).getTime()) {
    return { valid: false, state: 'expired', message: 'The authorised return time has passed.' };
  }
  const earlyMinutes = getNumberSetting('early_departure_minutes', 30) * 60 * 1000;
  if (now.getTime() < new Date(request.depart_at).getTime() - earlyMinutes) {
    return { valid: false, state: 'too_early', message: 'Departure window has not started yet.' };
  }
  return { valid: true, state: 'active', message: 'Pass is valid.' };
}
