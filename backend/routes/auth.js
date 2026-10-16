import { Router } from 'express';
import crypto from 'node:crypto';
import { getDb, newId, nowIso } from '../db.js';
import { config, HOUSES, CLASS_YEARS } from '../config.js';
import { asyncHandler, badRequest, unauthorized, forbidden } from '../middleware/errors.js';
import { requireAuth } from '../middleware/auth.js';
import { loginRateLimit } from '../middleware/rateLimit.js';
import {
  hashPassword, verifyPassword, createSession, destroySession, setSessionCookies, clearSessionCookies,
} from '../services/auth.js';
import { isEmail, isPhone, cleanText } from '../services/validate.js';
import { audit } from '../middleware/auth.js';

export const authRouter = Router();

function publicUser(user) {
  return { id: user.id, username: user.username, email: user.email, fullName: user.full_name, role: user.role };
}

function profileFor(user) {
  if (user.role !== 'student') return null;
  return getDb().prepare('SELECT index_number, class_year, house, guardian_name, guardian_phone FROM students WHERE user_id = ?').get(user.id) || null;
}

authRouter.post('/login', loginRateLimit({ max: config.rateLimits.loginPerIdentifier }), asyncHandler(async (req, res) => {
  const identifier = cleanText(req.body?.identifier, { max: 120 }).toLowerCase();
  const password = String(req.body?.password || '');
  if (!identifier || !password) throw badRequest('Enter your username and password.');

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE lower(username) = ? OR lower(COALESCE(email, \'\')) = ?')
    .get(identifier, identifier);

  // Constant-ish work even when the user does not exist, to avoid user-enumeration timing.
  const ok = user
    ? await verifyPassword(password, user.password_hash)
    : await verifyPassword(password, 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');

  if (!user || !ok || !user.active) {
    audit(null, 'login_failed', 'user', user?.id || identifier, { identifier });
    throw unauthorized('Those details do not match an active account.');
  }

  const session = createSession(user.id, { ip: req.ip, userAgent: req.get('user-agent') });
  setSessionCookies(res, session);
  audit(user.id, 'login', 'user', user.id, null);
  res.json({ user: publicUser(user), profile: profileFor(user), csrfToken: session.csrf });
}));

authRouter.post('/logout', asyncHandler(async (req, res) => {
  if (req.session) destroySession(req.session.id);
  clearSessionCookies(res);
  res.json({ ok: true });
}));

authRouter.get('/me', requireAuth, asyncHandler(async (req, res) => {
  res.json({ user: publicUser(req.user), profile: profileFor(req.user), houses: req.houses });
}));

authRouter.post('/register', loginRateLimit({ max: Math.max(config.rateLimits.loginPerIdentifier, 10) }), asyncHandler(async (req, res) => {
  if (!config.studentEnrollmentCode) {
    throw forbidden('Self-registration is disabled. Ask the school office to create your account.');
  }
  const code = cleanText(req.body?.enrollmentCode, { max: 64 });
  if (code !== config.studentEnrollmentCode) {
    throw badRequest('That enrolment code is not valid. Check the code given to you by the school.');
  }

  const username = cleanText(req.body?.username, { max: 40 }).toUpperCase();
  const fullName = cleanText(req.body?.fullName, { max: 80 });
  const email = cleanText(req.body?.email, { max: 120 }).toLowerCase();
  const indexNumber = cleanText(req.body?.indexNumber, { max: 30 }).toUpperCase();
  const classYear = cleanText(req.body?.classYear);
  const house = cleanText(req.body?.house);
  const guardianName = cleanText(req.body?.guardianName, { max: 80 });
  const guardianPhone = cleanText(req.body?.guardianPhone, { max: 20 });
  const password = String(req.body?.password || '');

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
  if (Object.keys(errors).length) throw badRequest('Please fix the highlighted fields.', errors);

  const db = getDb();
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    throw badRequest('An account with that student ID already exists.', { username: 'Already registered.' });
  }
  if (indexNumber && db.prepare('SELECT 1 FROM students WHERE index_number = ?').get(indexNumber)) {
    throw badRequest('An account with that index number already exists.', { indexNumber: 'Already registered.' });
  }

  const id = newId();
  const now = nowIso();
  const hash = await hashPassword(password);
  db.exec('BEGIN');
  try {
    db.prepare(`INSERT INTO users (id, username, email, password_hash, full_name, role, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'student', 1, ?, ?)`).run(id, username, email || null, hash, fullName, now, now);
    db.prepare(`INSERT INTO students (user_id, index_number, class_year, house, guardian_name, guardian_phone)
      VALUES (?, ?, ?, ?, ?, ?)`).run(id, indexNumber, classYear, house, guardianName, guardianPhone);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const session = createSession(id, { ip: req.ip, userAgent: req.get('user-agent') });
  setSessionCookies(res, session);
  audit(id, 'register', 'user', id, null);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  res.status(201).json({ user: publicUser(user), profile: profileFor(user), csrfToken: session.csrf });
}));
