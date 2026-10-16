/**
 * Demo-mode API adapter.
 *
 * When the frontend runs with `demoMode: true` (hosted demonstration
 * deployments without a reachable backend), `api()` in api.js routes every
 * request here instead of fetching the network. Handlers mirror the real
 * backend's routes, response shapes and validation rules (workflow.js,
 * validate.js, passes.js, and the route modules) so the UI is exercised
 * end-to-end against realistic data, persisted per-browser in localStorage.
 */

import {
  loadDb, saveDb, loadSession, saveSession, clearSession,
  nowIso, newId, HOUSES, DEMO_PASSWORD, DEMO_ENROLLMENT_CODE,
} from './store.js';

const STATUS_LABELS = {
  pending: 'Pending housemaster approval',
  pending_senior: 'Pending senior housemaster approval',
  approved: 'Approved',
  rejected: 'Rejected',
  returned: 'Returned for correction',
  cancelled: 'Cancelled',
  completed: 'Completed',
};

const CATEGORIES = [
  { value: 'medical_appointment', label: 'Medical appointment', urgentAllowed: true },
  { value: 'illness', label: 'Illness or urgent medical attention', urgentAllowed: true },
  { value: 'family', label: 'Family outing or bereavement', urgentAllowed: false },
  { value: 'personal', label: 'Approved personal outing', urgentAllowed: false },
  { value: 'school_activity', label: 'School activity', urgentAllowed: false },
  { value: 'other', label: 'Other authorised reason', urgentAllowed: false },
];

const CLASS_YEARS = ['SHS 1', 'SHS 2', 'SHS 3'];
const ROLES = ['student', 'housemaster', 'senior', 'gate', 'admin'];
const PASS_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function demoError(status, message, errors) {
  const err = new Error(message);
  err.status = status;
  err.errors = errors || null;
  return err;
}

function cleanText(value, { max = 200 } = {}) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}

function isPhone(value) {
  const digits = String(value || '').replace(/[^\d+]/g, '');
  return /^\+?\d{9,15}$/.test(digits);
}

function numSetting(db, key, fallback) {
  const n = Number(db.settings[key]);
  return Number.isFinite(n) ? n : fallback;
}

function parseDateTime(date, time, iso) {
  if (iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (!date || !time) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return null;
  if (!/^\d{2}:\d{2}$/.test(String(time))) return null;
  const d = new Date(`${date}T${time}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function validateApplication(db, body, { now = new Date() } = {}) {
  const errors = {};
  const value = {};

  value.type = String(body.type || '').toLowerCase();
  if (!['internal', 'external'].includes(value.type)) errors.type = 'Choose internal or external exeat.';

  value.category = String(body.category || '');
  if (!CATEGORIES.some((c) => c.value === value.category)) errors.category = 'Choose a reason category.';

  value.reason = cleanText(body.reason, { max: 1500 });
  if (value.reason.length < 10) errors.reason = 'Give a clear reason of at least 10 characters.';
  else if (value.reason.length > 1500) errors.reason = 'Reason is too long.';

  value.destination = cleanText(body.destination, { max: 120 });
  if (value.destination.length < 2) errors.destination = 'Enter where you are going.';
  else if (/^\d{7,}$/.test(value.destination)) errors.destination = 'Enter a place name, not a phone number.';

  value.guardianName = cleanText(body.guardianName, { max: 80 });
  value.guardianPhone = cleanText(body.guardianPhone, { max: 20 });

  value.departAt = parseDateTime(body.departDate, body.departTime, body.departAt);
  value.returnAt = parseDateTime(body.returnDate, body.returnTime, body.returnAt);

  if (!value.departAt) errors.departAt = 'Enter a valid departure date and time.';
  if (!value.returnAt) errors.returnAt = 'Enter a valid return time.';

  value.urgent = body.urgent === true || body.urgent === 'true' || body.urgent === 1;

  if (value.departAt && value.returnAt) {
    if (value.returnAt.getTime() <= value.departAt.getTime()) {
      errors.returnAt = 'Return time must be after departure time.';
    } else {
      const maxDuration = numSetting(db, 'max_duration_hours', 72);
      const hours = (value.returnAt - value.departAt) / 3600000;
      if (hours > maxDuration) {
        errors.returnAt = `An exeat may not exceed ${maxDuration} hours. Plan a shorter visit or speak to your housemaster.`;
      }
    }
  }

  if (value.type === 'external' && value.departAt) {
    const minNotice = numSetting(db, 'external_min_notice_hours', 24);
    const hoursUntil = (value.departAt.getTime() - now.getTime()) / 3600000;
    if (hoursUntil < minNotice) {
      errors.departAt = `External exeats need at least ${minNotice} hours' notice before departure.`;
    }
    if (!value.guardianName || !value.guardianPhone) {
      errors.guardianPhone = 'External exeats need a parent or guardian contact number.';
    } else if (!isPhone(value.guardianPhone)) {
      errors.guardianPhone = 'Enter a valid phone number, e.g. 024 123 4567.';
    }
  }

  if (value.type === 'internal' && value.guardianPhone && !isPhone(value.guardianPhone)) {
    errors.guardianPhone = 'Enter a valid phone number, e.g. 024 123 4567.';
  }

  if (value.urgent && !CATEGORIES.find((c) => c.value === value.category)?.urgentAllowed) {
    errors.urgent = 'Only medical categories can be flagged as urgent.';
  }

  if (value.departAt && value.departAt.getTime() < now.getTime() - 5 * 60 * 1000) {
    errors.departAt = 'Departure time cannot be in the past.';
  }

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      type: value.type,
      category: value.category,
      reason: value.reason,
      destination: value.destination,
      guardianName: value.guardianName || null,
      guardianPhone: value.guardianPhone || null,
      departAt: value.departAt.toISOString(),
      returnAt: value.returnAt.toISOString(),
      urgent: value.urgent ? 1 : 0,
      requiresSenior: value.type === 'external' ? 1 : 0,
    },
  };
}

/* ---------------------------- presentation ---------------------------- */

function presentUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
  };
}

function presentProfile(user) {
  if (user.role !== 'student' || !user.profile) return null;
  const p = user.profile;
  return {
    index_number: p.indexNumber,
    class_year: p.classYear,
    house: p.house,
    guardian_name: p.guardianName,
    guardian_phone: p.guardianPhone,
  };
}

function presentAnnouncement(a, { full = false } = {}) {
  const out = { id: a.id, title: a.title, body: a.body, level: a.level, createdAt: a.createdAt };
  if (full) out.active = !!a.active;
  return out;
}

function serializeRequest(row, extras = {}) {
  if (!row) return null;
  return {
    id: row.id,
    reference: row.reference,
    type: row.type,
    category: row.category,
    reason: row.reason,
    destination: row.destination,
    guardianName: extras.includeGuardian ? row.guardianName : undefined,
    guardianPhone: extras.includeGuardian ? row.guardianPhone : undefined,
    departAt: row.departAt,
    returnAt: row.returnAt,
    urgent: !!row.urgent,
    requiresSenior: !!row.requiresSenior,
    status: row.status,
    statusLabel: STATUS_LABELS[row.status] || row.status,
    submittedAt: row.submittedAt,
    decidedAt: row.decidedAt,
    cancelReason: row.cancelReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/* ------------------------------- helpers ------------------------------ */

function nextReference(db) {
  const year = new Date().getFullYear();
  const next = Number(db.settings.request_counter || 0) + 1;
  db.settings.request_counter = String(next);
  return `EXE-${year}-${String(next).padStart(4, '0')}`;
}

function generatePassCode(length = 12) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i += 1) out += PASS_ALPHABET[bytes[i] % PASS_ALPHABET.length];
  return out;
}

function notify(db, { userId, type, title, body, link }) {
  db.notifications.push({
    id: newId(),
    userId,
    type,
    title,
    body,
    link: link || null,
    readAt: null,
    createdAt: nowIso(),
  });
}

function notifyReviewers(db, request, stage, urgent) {
  const student = db.users.find((u) => u.id === request.studentId);
  const house = student?.profile?.house;
  if (stage === 'senior') {
    for (const reviewer of db.users.filter((u) => u.role === 'senior' && u.active)) {
      notify(db, {
        userId: reviewer.id,
        type: urgent ? 'request_urgent' : 'request_submitted',
        title: urgent ? 'URGENT exeat request' : 'New exeat request',
        body: `${student?.profile?.classYear || 'A student'} · ${request.reference} is waiting for senior review.`,
        link: `#/staff/requests/${request.id}`,
      });
    }
    return;
  }
  for (const reviewer of db.users.filter((u) => u.role === 'housemaster' && u.active && u.houses.includes(house))) {
    notify(db, {
      userId: reviewer.id,
      type: urgent ? 'request_urgent' : 'request_submitted',
      title: urgent ? 'URGENT exeat request' : 'New exeat request',
      body: `${student?.profile?.classYear || 'A student'} · ${request.reference} is waiting for housemaster review.`,
      link: `#/staff/requests/${request.id}`,
    });
  }
  if (urgent) {
    for (const reviewer of db.users.filter((u) => (u.role === 'admin' || u.role === 'senior') && u.active)) {
      notify(db, {
        userId: reviewer.id,
        type: 'request_urgent',
        title: 'Urgent medical exeat submitted',
        body: `An urgent request (${request.reference}) needs immediate attention.`,
        link: `#/staff/requests/${request.id}`,
      });
    }
  }
}

function issuePass(db, requestId) {
  const request = db.requests.find((r) => r.id === requestId);
  if (!request) throw demoError(404, 'Request not found.');
  const existing = db.passes.find((p) => p.requestId === requestId);
  if (existing) return existing;

  const pass = {
    id: newId(),
    requestId,
    code: generatePassCode(),
    issuedAt: nowIso(),
    expiresAt: request.returnAt,
    status: 'active',
    departedAt: null,
    returnedAt: null,
    revokedAt: null,
    revokeReason: null,
  };
  db.passes.push(pass);

  notify(db, {
    userId: request.studentId,
    type: 'pass_issued',
    title: 'Your exeat pass is ready',
    body: `Your pass ${request.reference} is valid. Show it at the school gate when you leave.`,
    link: `#/app/requests/${request.id}`,
  });
  return pass;
}

function revokePass(db, requestId, reason) {
  const pass = db.passes.find((p) => p.requestId === requestId);
  if (!pass) return null;
  pass.status = 'revoked';
  pass.revokedAt = nowIso();
  pass.revokeReason = reason || null;
  return pass;
}

function passState(db, pass, request, now = new Date()) {
  const grace = numSetting(db, 'return_grace_minutes', 60) * 60 * 1000;
  if (pass.status === 'revoked') return { valid: false, state: 'revoked', message: 'This pass has been revoked.' };
  if (pass.status === 'completed' || pass.returnedAt) {
    return { valid: false, state: 'completed', message: 'This exeat has already been completed.' };
  }
  if (request.status === 'cancelled') return { valid: false, state: 'cancelled', message: 'This request was cancelled.' };
  if (request.status === 'rejected') return { valid: false, state: 'rejected', message: 'This request was rejected.' };
  if (!['approved', 'completed'].includes(request.status)) {
    return { valid: false, state: 'not_approved', message: 'This request has not completed approval.' };
  }
  if (now.getTime() > new Date(pass.expiresAt).getTime() + grace) {
    return { valid: false, state: 'expired', message: 'This pass expired and the return is overdue.' };
  }
  if (pass.departedAt && !pass.returnedAt) {
    return { valid: true, state: 'departed', message: 'Student has left campus; return not yet recorded.' };
  }
  if (now.getTime() > new Date(pass.expiresAt).getTime()) {
    return { valid: false, state: 'expired', message: 'The authorised return time has passed.' };
  }
  const earlyMinutes = numSetting(db, 'early_departure_minutes', 30) * 60 * 1000;
  if (now.getTime() < new Date(request.departAt).getTime() - earlyMinutes) {
    return { valid: false, state: 'too_early', message: 'Departure window has not started yet.' };
  }
  return { valid: true, state: 'active', message: 'Pass is valid.' };
}

function timeline(db, requestId) {
  const request = db.requests.find((r) => r.id === requestId);
  if (!request) return [];
  const events = [];
  const staffName = (id) => db.users.find((u) => u.id === id);

  events.push({ at: request.createdAt, label: 'Request created', detail: null });
  if (request.submittedAt) events.push({ at: request.submittedAt, label: 'Submitted for approval', detail: null });

  const approvals = db.approvals.filter((a) => a.requestId === requestId)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  for (const a of approvals) {
    const reviewer = staffName(a.reviewerId);
    const verb = a.decision === 'approved' ? 'Approved' : a.decision === 'rejected' ? 'Rejected' : 'Returned for correction';
    events.push({
      at: a.createdAt,
      label: `${verb} by ${reviewer?.fullName || 'staff'} (${a.stage === 'senior' ? 'Senior Housemaster' : 'Housemaster'})`,
      detail: a.comment || null,
    });
  }
  const movements = db.movements.filter((m) => m.requestId === requestId)
    .sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));
  for (const m of movements) {
    const officer = staffName(m.recordedBy);
    events.push({
      at: m.recordedAt,
      label: m.type === 'departure' ? 'Departed campus' : 'Returned to campus',
      detail: m.note || `Recorded by ${officer?.fullName || 'gate officer'}`,
    });
  }
  if (request.cancelReason) {
    events.push({ at: request.updatedAt, label: 'Cancelled by student', detail: request.cancelReason });
  }
  return events.sort((a, b) => new Date(a.at) - new Date(b.at));
}

/* ------------------------------ auth layer ---------------------------- */

function currentUser(db) {
  const s = loadSession();
  if (!s) return null;
  const user = db.users.find((u) => u.id === s.userId && u.active);
  return user || null;
}

function requireUser(db) {
  const user = currentUser(db);
  if (!user) throw demoError(401, 'Sign in required.');
  return user;
}

function requireRole(db, ...roles) {
  const user = requireUser(db);
  if (!roles.includes(user.role)) throw demoError(403, 'Your account cannot access that.');
  return user;
}

function authPayload(user) {
  return {
    user: presentUser(user),
    profile: presentProfile(user),
    houses: user.houses || [],
    csrfToken: 'demo-csrf',
  };
}

function startSession(user) {
  saveSession({ userId: user.id, csrf: 'demo-csrf' });
}

/* --------------------------- request workflow ------------------------- */

function createRequest(db, user, body, idempotencyKey) {
  const profile = user.profile;
  if (!profile) throw demoError(400, 'Your student profile is incomplete.');

  if (idempotencyKey) {
    const existing = db.requests.find((r) => r.idempotencyKey === idempotencyKey);
    if (existing) return serializeRequest(existing);
  }

  const result = validateApplication(db, body);
  if (!result.ok) throw demoError(400, 'Please fix the highlighted fields.', result.errors);

  const now = nowIso();
  const data = result.value;
  const row = {
    id: newId(),
    reference: nextReference(db),
    studentId: user.id,
    type: data.type,
    category: data.category,
    reason: data.reason,
    destination: data.destination,
    guardianName: data.guardianName || profile.guardianName,
    guardianPhone: data.guardianPhone || profile.guardianPhone,
    departAt: data.departAt,
    returnAt: data.returnAt,
    urgent: data.urgent,
    requiresSenior: data.requiresSenior,
    status: 'pending',
    idempotencyKey: idempotencyKey || null,
    submittedAt: now,
    decidedAt: null,
    cancelReason: null,
    createdAt: now,
    updatedAt: now,
  };
  db.requests.push(row);
  notifyReviewers(db, row, 'housemaster', data.urgent === 1);
  return serializeRequest(row);
}

function resubmitRequest(db, user, requestId, body) {
  const request = db.requests.find((r) => r.id === requestId && r.studentId === user.id);
  if (!request) throw demoError(404, 'Request not found.');
  if (request.status !== 'returned') throw demoError(409, 'Only requests returned for correction can be edited.');

  const result = validateApplication(db, body);
  if (!result.ok) throw demoError(400, 'Please fix the highlighted fields.', result.errors);
  const data = result.value;

  Object.assign(request, {
    type: data.type,
    category: data.category,
    reason: data.reason,
    destination: data.destination,
    guardianName: data.guardianName,
    guardianPhone: data.guardianPhone,
    departAt: data.departAt,
    returnAt: data.returnAt,
    urgent: data.urgent,
    requiresSenior: data.requiresSenior,
    status: 'pending',
    updatedAt: nowIso(),
  });
  notifyReviewers(db, request, 'housemaster', data.urgent === 1);
  return serializeRequest(request);
}

function cancelRequest(db, user, requestId, reason) {
  const request = db.requests.find((r) => r.id === requestId && r.studentId === user.id);
  if (!request) throw demoError(404, 'Request not found.');
  if (!['pending', 'pending_senior', 'approved', 'returned'].includes(request.status)) {
    throw demoError(409, 'This request can no longer be cancelled.');
  }
  const cleanReason = String(reason || '').trim().slice(0, 300);
  if (!cleanReason) throw demoError(400, 'Tell us why you are cancelling.');
  request.status = 'cancelled';
  request.cancelReason = cleanReason;
  request.updatedAt = nowIso();
  revokePass(db, requestId, `Cancelled by student: ${cleanReason}`);
  for (const staff of db.users.filter((u) => ['housemaster', 'senior', 'admin'].includes(u.role) && u.active)) {
    notify(db, {
      userId: staff.id,
      type: 'request_cancelled',
      title: 'Exeat request cancelled',
      body: `${request.reference} was cancelled by the student.`,
      link: `#/staff/requests/${request.id}`,
    });
  }
  return serializeRequest(request);
}

function decide(db, reviewer, requestId, decision, comment) {
  const request = db.requests.find((r) => r.id === requestId);
  if (!request) throw demoError(404, 'Request not found.');
  if (reviewer.id === request.studentId) throw demoError(403, 'You cannot make a decision on your own request.');

  const cleanComment = String(comment || '').trim().slice(0, 500);
  if (['rejected', 'returned'].includes(decision) && cleanComment.length < 5) {
    throw demoError(400, 'Give the student a clear reason (at least 5 characters).', { comment: 'A reason is required.' });
  }
  if (!['approved', 'rejected', 'returned'].includes(decision)) throw demoError(400, 'Unknown decision.');

  const stage = request.status === 'pending' ? 'housemaster'
    : request.status === 'pending_senior' ? 'senior' : null;
  if (!stage) throw demoError(409, 'This request is not awaiting a decision.');

  const student = db.users.find((u) => u.id === request.studentId);
  if (reviewer.role === 'housemaster') {
    if (stage !== 'housemaster') throw demoError(403, 'This request has moved past the housemaster stage.');
    if (!reviewer.houses.includes(student?.profile?.house)) throw demoError(403, 'You are not the housemaster for this student.');
  } else if (reviewer.role === 'senior') {
    if (stage !== 'senior') throw demoError(403, 'This request is not waiting for senior approval.');
  } else {
    throw demoError(403, 'Your role cannot make approval decisions.');
  }

  const now = nowIso();
  db.approvals.push({
    id: newId(),
    requestId: request.id,
    reviewerId: reviewer.id,
    stage,
    decision,
    comment: cleanComment || null,
    createdAt: now,
  });

  let pass = null;
  if (decision === 'approved') {
    if (stage === 'housemaster' && request.requiresSenior) {
      request.status = 'pending_senior';
    } else {
      request.status = 'approved';
      request.decidedAt = now;
      pass = issuePass(db, request.id);
    }
  } else if (decision === 'rejected') {
    request.status = 'rejected';
    request.decidedAt = now;
    revokePass(db, request.id, 'Request rejected');
  } else {
    request.status = 'returned';
  }
  request.updatedAt = now;

  if (decision === 'approved' && request.status === 'pending_senior') {
    notifyReviewers(db, request, 'senior', request.urgent === 1);
  }

  notify(db, {
    userId: student.id,
    type: `request_${decision}`,
    title: decision === 'approved'
      ? (request.status === 'pending_senior' ? 'Housemaster approved — awaiting senior approval' : 'Your exeat request was approved')
      : decision === 'rejected' ? 'Your exeat request was rejected' : 'Your exeat request needs a correction',
    body: decision === 'approved'
      ? (request.status === 'pending_senior'
        ? `${request.reference} now needs the Senior Housemaster's approval.`
        : `${request.reference} is approved. Your digital pass is ready.`)
      : decision === 'rejected'
        ? `${request.reference} was rejected. ${cleanComment}`
        : `${request.reference} was returned for correction: ${cleanComment}`,
    link: `#/app/requests/${request.id}`,
  });

  return {
    request: serializeRequest(request),
    pass: pass ? { code: pass.code } : null,
  };
}

/* ------------------------------ gate layer ---------------------------- */

function lookupPass(db, rawCode) {
  const clean = String(rawCode || '').toUpperCase().replace(/[\s-]/g, '');
  if (!/^[0-9A-HJKMNP-TV-Z]{8,16}$/.test(clean)) return { ok: false, reason: 'invalid_format' };
  const pass = db.passes.find((p) => p.code === clean);
  if (!pass) return { ok: false, reason: 'not_found' };
  const request = db.requests.find((r) => r.id === pass.requestId);
  const student = db.users.find((u) => u.id === request?.studentId);
  return { ok: true, pass, request, student };
}

function gatePresent(db, lookup) {
  const { pass, request, student } = lookup;
  const state = passState(db, pass, request);
  return {
    valid: state.valid,
    state: state.state,
    message: state.message,
    pass: {
      code: pass.code,
      status: pass.status,
      expiresAt: pass.expiresAt,
      departedAt: pass.departedAt,
      returnedAt: pass.returnedAt,
    },
    request: {
      reference: request.reference,
      type: request.type,
      destination: request.destination,
      departAt: request.departAt,
      returnAt: request.returnAt,
      status: request.status,
      urgent: !!request.urgent,
    },
    student: student ? {
      fullName: student.fullName,
      indexNumber: student.profile?.indexNumber,
      classYear: student.profile?.classYear,
      house: student.profile?.house,
    } : null,
  };
}

/* ------------------------------- routing ------------------------------ */

export async function demoHandle(method, path, { body, query, headers } = {}) {
  const db = loadDb();
  const m = method.toUpperCase();
  const url = path.split('?')[0];
  const result = route(db, m, url, body || {}, query || {}, headers || {});
  saveDb(db);
  return result;
}

function route(db, m, url, body, query, headers) {
  /* public */
  if (m === 'GET' && url === '/api/health') return { ok: true, service: 'entryout-demo', demo: true, time: nowIso() };
  if (m === 'GET' && url === '/api/config') {
    return { app: 'Entryout', categories: CATEGORIES, registrationEnabled: true, demo: true };
  }
  if (m === 'GET' && url === '/api/announcements') {
    const rows = db.announcements.filter((a) => a.active).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return { announcements: rows.map((a) => presentAnnouncement(a)) };
  }
  if (m === 'GET' && url === '/api/policies') {
    return { emergencyContactPhone: db.settings.emergency_contact_phone || null };
  }

  /* auth */
  if (m === 'POST' && url === '/api/auth/login') {
    const identifier = cleanText(body.identifier, { max: 120 }).toLowerCase();
    const password = String(body.password || '');
    const user = db.users.find((u) => u.active
      && (u.username.toLowerCase() === identifier || (u.email || '').toLowerCase() === identifier));
    if (!user || password !== (user.password || DEMO_PASSWORD)) {
      throw demoError(401, 'Those details do not match an active account.');
    }
    startSession(user);
    return authPayload(user);
  }
  if (m === 'POST' && url === '/api/auth/logout') {
    clearSession();
    return { ok: true };
  }
  if (m === 'GET' && url === '/api/auth/me') {
    return authPayload(requireUser(db));
  }
  if (m === 'POST' && url === '/api/auth/demo-session') {
    const role = cleanText(body.role, { max: 20 });
    const user = db.users.find((u) => u.role === role && u.active);
    if (!user || !ROLES.includes(role)) throw demoError(400, 'Choose a valid demo role.');
    startSession(user);
    return authPayload(user);
  }
  if (m === 'POST' && url === '/api/auth/register') {
    if (cleanText(body.enrollmentCode, { max: 64 }) !== DEMO_ENROLLMENT_CODE) {
      throw demoError(400, 'That enrolment code is not valid. Check the code given to you by the school.');
    }
    const username = cleanText(body.username, { max: 40 }).toUpperCase();
    const fullName = cleanText(body.fullName, { max: 80 });
    const email = cleanText(body.email, { max: 120 }).toLowerCase();
    const indexNumber = cleanText(body.indexNumber, { max: 30 }).toUpperCase();
    const classYear = cleanText(body.classYear);
    const house = cleanText(body.house);
    const guardianName = cleanText(body.guardianName, { max: 80 });
    const guardianPhone = cleanText(body.guardianPhone, { max: 20 });
    const password = String(body.password || '');

    const errors = {};
    if (!/^[A-Z0-9/-]{4,40}$/.test(username)) errors.username = 'Use your student ID, e.g. MFS/24/0123.';
    if (fullName.length < 3) errors.fullName = 'Enter your full name.';
    if (!CLASS_YEARS.includes(classYear)) errors.classYear = 'Choose your year group.';
    if (!HOUSES.includes(house)) errors.house = 'Choose your house.';
    if (!/^[A-Z0-9/ -]{4,30}$/.test(indexNumber)) errors.indexNumber = 'Enter your index number.';
    if (email && !isEmail(email)) errors.email = 'Enter a valid email address or leave it blank.';
    if (!guardianName) errors.guardianName = "Enter your parent or guardian's name.";
    if (!isPhone(guardianPhone)) errors.guardianPhone = 'Enter a valid phone number, e.g. 024 123 4567.';
    if (password.length < 8) errors.password = 'Use at least 8 characters.';
    if (Object.keys(errors).length) throw demoError(400, 'Please fix the highlighted fields.', errors);
    if (db.users.some((u) => u.username === username)) {
      throw demoError(400, 'An account with that student ID already exists.', { username: 'Already registered.' });
    }

    const user = {
      id: newId(),
      username,
      email: email || null,
      fullName,
      role: 'student',
      active: true,
      createdAt: nowIso(),
      password,
      profile: { indexNumber, classYear, house, guardianName, guardianPhone },
      houses: [],
    };
    db.users.push(user);
    startSession(user);
    return authPayload(user);
  }

  /* student requests */
  if (url.startsWith('/api/requests')) {
    const student = requireRole(db, 'student');

    if (m === 'GET' && url === '/api/requests/mine') {
      const rows = db.requests.filter((r) => r.studentId === student.id)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return {
        requests: rows.map((row) => {
          const pass = db.passes.find((p) => p.requestId === row.id);
          return {
            ...serializeRequest(row, { includeGuardian: true }),
            pass: pass ? {
              code: pass.code,
              status: pass.status,
              departedAt: pass.departedAt,
              returnedAt: pass.returnedAt,
              expiresAt: pass.expiresAt,
              hasPass: true,
            } : null,
          };
        }),
      };
    }
    if (m === 'POST' && url === '/api/requests') {
      const key = cleanIdempotencyKey(headers['idempotency-key'] || body.idempotencyKey);
      return { request: createRequest(db, student, body, key) };
    }

    const idMatch = url.match(/^\/api\/requests\/([^/]+)(.*)$/);
    if (idMatch) {
      const [, id, rest] = idMatch;
      const request = db.requests.find((r) => r.id === id && r.studentId === student.id);
      if (!request) throw demoError(404, 'Request not found.');

      if (m === 'GET' && rest === '') {
        const pass = db.passes.find((p) => p.requestId === id);
        return {
          request: serializeRequest(request, { includeGuardian: true }),
          student: {
            fullName: student.fullName,
            indexNumber: student.profile?.indexNumber,
            classYear: student.profile?.classYear,
            house: student.profile?.house,
          },
          timeline: timeline(db, id),
          pass: pass ? presentPass(pass) : null,
        };
      }
      if (m === 'PATCH' && rest === '') return { request: resubmitRequest(db, student, id, body) };
      if (m === 'POST' && rest === '/cancel') return { request: cancelRequest(db, student, id, body.reason) };
      if (m === 'GET' && rest === '/pass') {
        const pass = db.passes.find((p) => p.requestId === id);
        if (!pass) throw demoError(404, 'No pass has been issued for this request.');
        const state = passState(db, pass, request);
        return {
          pass: {
            code: pass.code,
            status: pass.status,
            issuedAt: pass.issuedAt,
            expiresAt: pass.expiresAt,
            departedAt: pass.departedAt,
            returnedAt: pass.returnedAt,
            valid: state.valid,
            state: state.state,
            message: state.message,
          },
        };
      }
      if (m === 'GET' && rest === '/pass/qr.svg') {
        // The demo adapter serves no binary assets; passCard falls back to the
        // typed verification code, which is enough to complete the gate flow.
        throw demoError(404, 'QR codes are unavailable in demo mode.');
      }
    }
  }

  /* staff queue + decisions */
  if (url.startsWith('/api/staff/requests')) {
    const user = requireRole(db, 'housemaster', 'senior', 'admin');

    if (m === 'GET' && url === '/api/staff/requests') {
      return staffList(db, user, query);
    }

    const idMatch = url.match(/^\/api\/staff\/requests\/([^/]+)(.*)$/);
    if (idMatch) {
      const [, id, rest] = idMatch;
      const request = db.requests.find((r) => r.id === id);
      if (!request) throw demoError(404, 'Request not found.');
      const student = db.users.find((u) => u.id === request.studentId);

      if (user.role === 'housemaster' && !user.houses.includes(student?.profile?.house)) {
        throw demoError(403, 'You can only view students in your house.');
      }
      if (user.role === 'senior' && !request.requiresSenior) {
        throw demoError(403, 'That request does not require senior approval.');
      }

      if (m === 'GET' && rest === '') {
        const approvals = db.approvals.filter((a) => a.requestId === id)
          .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        const pass = db.passes.find((p) => p.requestId === id);
        const stage = request.status === 'pending' ? 'housemaster' : request.status === 'pending_senior' ? 'senior' : null;
        const canDecide = !!stage && user.role !== 'admin'
          && (user.role === 'senior' ? stage === 'senior' : user.houses.includes(student?.profile?.house));
        return {
          request: serializeRequest(request, { includeGuardian: true }),
          student: {
            fullName: student?.fullName,
            username: student?.username,
            indexNumber: student?.profile?.indexNumber,
            classYear: student?.profile?.classYear,
            house: student?.profile?.house,
            guardianName: request.guardianName,
            guardianPhone: request.guardianPhone,
          },
          approvals: approvals.map((a) => ({
            stage: a.stage,
            decision: a.decision,
            comment: a.comment,
            reviewerName: db.users.find((u) => u.id === a.reviewerId)?.fullName || 'staff',
            at: a.createdAt,
          })),
          timeline: timeline(db, id),
          pass: pass ? presentPass(pass) : null,
          canDecide,
          nextStage: stage,
        };
      }
      if (m === 'POST' && rest === '/decision') {
        return decide(db, user, id, body.decision, body.comment);
      }
    }
  }

  /* gate */
  if (url.startsWith('/api/gate')) {
    requireRole(db, 'gate', 'admin', 'senior', 'housemaster');

    if (m === 'POST' && url === '/api/gate/verify') {
      const lookup = lookupPass(db, body.code);
      if (!lookup.ok) {
        throw demoError(404, lookup.reason === 'not_found'
          ? 'No pass matches that code. Check the code and try again.'
          : 'Enter the pass code exactly as printed on the pass.', { valid: false, state: lookup.reason });
      }
      return gatePresent(db, lookup);
    }
    if (m === 'POST' && (url === '/api/gate/depart' || url === '/api/gate/return')) {
      const isDepart = url.endsWith('/depart');
      const lookup = lookupPass(db, body.code);
      if (!lookup.ok) throw demoError(400, 'No pass matches that code.');
      const { pass, request } = lookup;
      if (isDepart) {
        if (pass.departedAt) throw demoError(409, 'This student has already been recorded as departed.');
        const state = passState(db, pass, request);
        if (!state.valid) throw demoError(409, state.message);
        pass.departedAt = nowIso();
        db.movements.push({
          id: newId(),
          requestId: request.id,
          type: 'departure',
          recordedAt: pass.departedAt,
          recordedBy: requireUser(db).id,
          note: body.note ? String(body.note).slice(0, 200) : null,
        });
        notify(db, {
          userId: request.studentId,
          type: 'departure_recorded',
          title: 'Departure recorded',
          body: `${request.reference}: you are checked out. Remember to return by the authorised time.`,
        });
      } else {
        if (pass.returnedAt) throw demoError(409, 'This student has already been recorded as returned.');
        if (!pass.departedAt) throw demoError(409, 'Record the departure before recording a return.');
        pass.returnedAt = nowIso();
        pass.status = 'completed';
        request.status = 'completed';
        request.updatedAt = pass.returnedAt;
        db.movements.push({
          id: newId(),
          requestId: request.id,
          type: 'return',
          recordedAt: pass.returnedAt,
          recordedBy: requireUser(db).id,
          note: body.note ? String(body.note).slice(0, 200) : null,
        });
        notify(db, {
          userId: request.studentId,
          type: 'return_recorded',
          title: 'Return recorded',
          body: `${request.reference}: your return has been recorded. Welcome back.`,
        });
      }
      const fresh = lookupPass(db, body.code);
      return gatePresent(db, fresh);
    }
    if (m === 'GET' && url === '/api/gate/movements') {
      const rows = db.movements.sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt)).slice(0, 50);
      return {
        movements: rows.map((mv) => {
          const request = db.requests.find((r) => r.id === mv.requestId);
          const student = db.users.find((u) => u.id === request?.studentId);
          return {
            id: mv.id,
            type: mv.type,
            reference: request?.reference,
            studentName: student?.fullName,
            house: student?.profile?.house,
            classYear: student?.profile?.classYear,
            recordedAt: mv.recordedAt,
          };
        }),
      };
    }
  }

  /* notifications */
  if (url.startsWith('/api/notifications')) {
    const user = requireUser(db);
    if (m === 'GET' && url === '/api/notifications') {
      const rows = db.notifications.filter((n) => n.userId === user.id)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 50);
      return {
        unread: rows.filter((n) => !n.readAt).length,
        notifications: rows.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          body: n.body,
          link: n.link,
          readAt: n.readAt,
          createdAt: n.createdAt,
        })),
      };
    }
    if (m === 'POST' && url === '/api/notifications/read-all') {
      const now = nowIso();
      for (const n of db.notifications) {
        if (n.userId === user.id && !n.readAt) n.readAt = now;
      }
      return { ok: true };
    }
  }

  /* admin */
  if (url.startsWith('/api/admin')) {
    requireRole(db, 'admin');

    if (m === 'GET' && url === '/api/admin/stats') {
      const byStatus = {};
      for (const r of db.requests) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      const students = db.users.filter((u) => u.role === 'student' && u.active).length;
      const staff = {};
      for (const u of db.users.filter((u) => u.active && u.role !== 'student')) {
        staff[u.role] = (staff[u.role] || 0) + 1;
      }
      return { byStatus, students, staff, deliveries: {} };
    }
    if (m === 'GET' && url === '/api/admin/users') {
      return {
        users: db.users.map((u) => ({
          id: u.id,
          username: u.username,
          email: u.email,
          fullName: u.fullName,
          role: u.role,
          active: !!u.active,
          createdAt: u.createdAt,
          classYear: u.profile?.classYear || null,
          house: u.profile?.house || null,
          indexNumber: u.profile?.indexNumber || null,
          houses: u.houses || [],
        })),
        options: { roles: ROLES, houses: HOUSES, classYears: CLASS_YEARS },
      };
    }
    if (m === 'POST' && url === '/api/admin/users') {
      const role = cleanText(body.role);
      const username = cleanText(body.username, { max: 40 }).toUpperCase();
      const fullName = cleanText(body.fullName, { max: 80 });
      const email = cleanText(body.email, { max: 120 }).toLowerCase() || null;
      const password = String(body.password || '');
      const houses = Array.isArray(body.houses) ? body.houses.filter((x) => HOUSES.includes(x)) : [];

      const errors = {};
      if (!ROLES.includes(role)) errors.role = 'Choose a role.';
      if (!/^[A-Z0-9._-]{3,40}$/.test(username)) errors.username = 'Use 3-40 letters, digits, dots or dashes.';
      if (fullName.length < 3) errors.fullName = 'Enter the full name.';
      if (email && !isEmail(email)) errors.email = 'Enter a valid email address.';
      if (password.length < 8) errors.password = 'Use at least 8 characters.';
      if (role === 'student') {
        if (!/^[A-Z0-9/ -]{4,30}$/.test(cleanText(body.indexNumber, { max: 30 }).toUpperCase())) {
          errors.indexNumber = 'Enter the index number.';
        }
        if (!CLASS_YEARS.includes(cleanText(body.classYear))) errors.classYear = 'Choose a year group.';
        if (!HOUSES.includes(cleanText(body.house))) errors.house = 'Choose a house.';
      }
      if (role === 'housemaster' && houses.length === 0) errors.houses = 'Assign at least one house.';
      if (Object.keys(errors).length) throw demoError(400, 'Please fix the highlighted fields.', errors);
      if (db.users.some((u) => u.username === username)) {
        throw demoError(409, 'That username is already taken.', { username: 'Already taken.' });
      }

      const user = {
        id: newId(),
        username,
        email,
        fullName,
        role,
        active: true,
        createdAt: nowIso(),
        password,
        profile: role === 'student'
          ? {
              indexNumber: cleanText(body.indexNumber, { max: 30 }).toUpperCase(),
              classYear: cleanText(body.classYear),
              house: cleanText(body.house),
              guardianName: cleanText(body.guardianName, { max: 80 }) || null,
              guardianPhone: isPhone(body.guardianPhone) ? cleanText(body.guardianPhone, { max: 20 }) : null,
            }
          : null,
        houses: role === 'housemaster' ? houses : [],
      };
      db.users.push(user);
      return { user: { id: user.id, username: user.username, fullName: user.fullName, role: user.role } };
    }
    const userMatch = url.match(/^\/api\/admin\/users\/([^/]+)(\/password)?$/);
    if (userMatch && m === 'PATCH') {
      const user = db.users.find((u) => u.id === userMatch[1]);
      if (!user) throw demoError(404, 'User not found.');
      if (body.active === true || body.active === false) user.active = body.active;
      if (body.email !== undefined) {
        const email = cleanText(body.email, { max: 120 }).toLowerCase() || null;
        if (email && !isEmail(email)) throw demoError(400, 'Enter a valid email address.', { email: 'Invalid email.' });
        user.email = email;
      }
      return { ok: true };
    }
    if (userMatch && userMatch[2] && m === 'POST') {
      const user = db.users.find((u) => u.id === userMatch[1]);
      if (!user) throw demoError(404, 'User not found.');
      const password = String(body.password || '');
      if (password.length < 8) throw demoError(400, 'Use at least 8 characters.', { password: 'Too short.' });
      user.password = password;
      return { ok: true };
    }

    if (m === 'GET' && url === '/api/admin/announcements') {
      return {
        announcements: db.announcements
          .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .map((a) => presentAnnouncement(a, { full: true })),
      };
    }
    if (m === 'POST' && url === '/api/admin/announcements') {
      const title = cleanText(body.title, { max: 120 });
      const msgBody = cleanText(body.body, { max: 1000 });
      const level = ['info', 'policy', 'urgent'].includes(body.level) ? body.level : 'info';
      if (!title || !msgBody) throw demoError(400, 'Title and message are required.');
      const ann = { id: newId(), title, body: msgBody, level, active: true, createdAt: nowIso() };
      db.announcements.push(ann);
      return { announcement: presentAnnouncement(ann) };
    }
    const annMatch = url.match(/^\/api\/admin\/announcements\/([^/]+)$/);
    if (annMatch && m === 'PATCH') {
      const ann = db.announcements.find((a) => a.id === annMatch[1]);
      if (!ann) throw demoError(404, 'Announcement not found.');
      if (body.active === true || body.active === false) ann.active = body.active;
      return { ok: true };
    }

    if (m === 'GET' && url === '/api/admin/settings') {
      return {
        settings: Object.entries(db.settings).map(([key, value]) => ({ key, value, updatedAt: nowIso() })),
      };
    }
    if (m === 'PUT' && url === '/api/admin/settings') {
      const EDITABLE = new Set([
        'external_min_notice_hours', 'max_duration_hours', 'return_grace_minutes',
        'early_departure_minutes', 'emergency_contact_phone',
      ]);
      const updated = [];
      for (const [key, value] of Object.entries(body)) {
        if (!EDITABLE.has(key)) continue;
        const clean = cleanText(value, { max: 200 });
        if (['external_min_notice_hours', 'max_duration_hours', 'return_grace_minutes', 'early_departure_minutes'].includes(key)) {
          const n = Number(clean);
          if (!Number.isFinite(n) || n < 0 || n > 720) throw demoError(400, `Invalid value for ${key}.`);
        }
        db.settings[key] = clean;
        updated.push(key);
      }
      return { ok: true, updated };
    }
  }

  throw demoError(404, `Demo mode has no handler for ${m} ${url}.`);
}

function presentPass(pass) {
  return {
    code: pass.code,
    status: pass.status,
    issuedAt: pass.issuedAt,
    expiresAt: pass.expiresAt,
    departedAt: pass.departedAt,
    returnedAt: pass.returnedAt,
    revokedAt: pass.revokedAt,
    revokeReason: pass.revokeReason,
  };
}

function cleanIdempotencyKey(raw) {
  if (!raw) return null;
  const value = String(raw).slice(0, 64);
  return /^[A-Za-z0-9-]{8,64}$/.test(value) ? value : null;
}

function staffList(db, user, query) {
  let rows = db.requests.slice();

  if (user.role === 'housemaster') {
    rows = rows.filter((r) => {
      const student = db.users.find((u) => u.id === r.studentId);
      return user.houses.includes(student?.profile?.house);
    });
  } else if (user.role === 'senior') {
    rows = rows.filter((r) => r.requiresSenior);
  }

  if (query.status) {
    rows = rows.filter((r) => r.status === query.status);
  }
  if (query.type && ['internal', 'external'].includes(query.type)) {
    rows = rows.filter((r) => r.type === query.type);
  }
  if (query.house && (user.role !== 'housemaster' || user.houses.includes(query.house))) {
    rows = rows.filter((r) => {
      const student = db.users.find((u) => u.id === r.studentId);
      return student?.profile?.house === query.house;
    });
  }
  if (query.urgent === 'true') rows = rows.filter((r) => r.urgent);
  if (query.from) rows = rows.filter((r) => r.departAt >= query.from);
  if (query.to) rows = rows.filter((r) => r.departAt <= query.to);
  const q = String(query.q || '').trim();
  if (q) {
    const like = q.toLowerCase();
    rows = rows.filter((r) => {
      const student = db.users.find((u) => u.id === r.studentId);
      return [student?.fullName, student?.profile?.indexNumber, r.reference, r.destination]
        .some((v) => String(v || '').toLowerCase().includes(like));
    });
  }

  const statusOrder = { pending: 0, pending_senior: 1, returned: 2 };
  rows.sort((a, b) => (b.urgent ? 1 : 0) - (a.urgent ? 1 : 0)
    || (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3)
    || new Date(a.departAt) - new Date(b.departAt));
  rows = rows.slice(0, 200);

  const summary = {};
  for (const r of db.requests) {
    // summary reflects the scoped set before status filter, like the backend
    let scoped = true;
    if (user.role === 'housemaster') {
      const student = db.users.find((u) => u.id === r.studentId);
      scoped = user.houses.includes(student?.profile?.house);
    } else if (user.role === 'senior') {
      scoped = r.requiresSenior;
    }
    if (scoped) summary[r.status] = (summary[r.status] || 0) + 1;
  }

  return {
    requests: rows.map((r) => {
      const student = db.users.find((u) => u.id === r.studentId);
      return {
        ...serializeRequest(r),
        student: {
          fullName: student?.fullName,
          indexNumber: student?.profile?.indexNumber,
          classYear: student?.profile?.classYear,
          house: student?.profile?.house,
        },
        decisionCount: db.approvals.filter((a) => a.requestId === r.id).length,
        passCode: user.role === 'gate' ? null : db.passes.find((p) => p.requestId === r.id)?.code || null,
      };
    }),
    summary,
    statusLabels: STATUS_LABELS,
  };
}
