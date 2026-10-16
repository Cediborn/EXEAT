import { Router } from 'express';
import { getDb, newId, nowIso } from '../db.js';
import { CLASS_YEARS, HOUSES, ROLES } from '../config.js';
import { asyncHandler, badRequest, conflict, notFound } from '../middleware/errors.js';
import { requireAuth, requireRole, audit } from '../middleware/auth.js';
import { hashPassword } from '../services/auth.js';
import { isEmail, isPhone, cleanText } from '../services/validate.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin'));

adminRouter.get('/stats', (req, res) => {
  const db = getDb();
  const byStatus = db.prepare('SELECT status, COUNT(*) AS n FROM exeat_requests GROUP BY status').all();
  const students = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'student' AND active = 1").get().n;
  const staff = db.prepare("SELECT role, COUNT(*) AS n FROM users WHERE active = 1 AND role != 'student' GROUP BY role").all();
  const pendingDeliveries = db.prepare("SELECT status, COUNT(*) AS n FROM notification_deliveries GROUP BY status").all();
  res.json({
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
    students,
    staff: Object.fromEntries(staff.map((r) => [r.role, r.n])),
    deliveries: Object.fromEntries(pendingDeliveries.map((r) => [r.status, r.n])),
  });
});

adminRouter.get('/users', (req, res) => {
  const rows = getDb().prepare(`SELECT u.id, u.username, u.email, u.full_name, u.role, u.active, u.created_at,
    s.class_year, s.house, s.index_number
    FROM users u LEFT JOIN students s ON s.user_id = u.id
    ORDER BY u.role, u.full_name`).all();
  const assignments = getDb().prepare('SELECT user_id, house FROM staff_assignments').all();
  const byUser = new Map();
  for (const a of assignments) {
    if (!byUser.has(a.user_id)) byUser.set(a.user_id, []);
    byUser.get(a.user_id).push(a.house);
  }
  res.json({
    users: rows.map((u) => ({
      id: u.id,
      username: u.username,
      email: u.email,
      fullName: u.full_name,
      role: u.role,
      active: !!u.active,
      createdAt: u.created_at,
      classYear: u.class_year || null,
      house: u.house || null,
      indexNumber: u.index_number || null,
      houses: byUser.get(u.id) || [],
    })),
    options: { roles: ROLES, houses: HOUSES, classYears: CLASS_YEARS },
  });
});

adminRouter.post('/users', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const role = cleanText(body.role);
  const username = cleanText(body.username, { max: 40 }).toUpperCase();
  const fullName = cleanText(body.fullName, { max: 80 });
  const email = cleanText(body.email, { max: 120 }).toLowerCase();
  const password = String(body.password || '');
  const houses = Array.isArray(body.houses) ? body.houses.filter((h) => HOUSES.includes(h)) : [];

  const errors = {};
  if (!ROLES.includes(role)) errors.role = 'Choose a role.';
  if (!/^[A-Z0-9._-]{3,40}$/.test(username)) errors.username = 'Use 3-40 letters, digits, dots or dashes.';
  if (fullName.length < 3) errors.fullName = 'Enter the full name.';
  if (email && !isEmail(email)) errors.email = 'Enter a valid email address.';
  if (password.length < 8) errors.password = 'Use at least 8 characters.';

  if (role === 'student') {
    if (!/^[A-Z0-9/ -]{4,30}$/.test(cleanText(body.indexNumber, { max: 30 }).toUpperCase())) errors.indexNumber = 'Enter the index number.';
    if (!CLASS_YEARS.includes(cleanText(body.classYear))) errors.classYear = 'Choose a year group.';
    if (!HOUSES.includes(cleanText(body.house))) errors.house = 'Choose a house.';
  }
  if (role === 'housemaster' && houses.length === 0) errors.houses = 'Assign at least one house.';
  if (Object.keys(errors).length) throw badRequest('Please fix the highlighted fields.', errors);

  const db = getDb();
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    throw conflict('That username is already taken.', { username: 'Already taken.' });
  }

  const id = newId();
  const now = nowIso();
  const hash = await hashPassword(password);
  db.exec('BEGIN');
  try {
    db.prepare(`INSERT INTO users (id, username, email, password_hash, full_name, role, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(id, username, email || null, hash, fullName, role, now, now);
    if (role === 'student') {
      db.prepare('INSERT INTO students (user_id, index_number, class_year, house, guardian_name, guardian_phone) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, cleanText(body.indexNumber, { max: 30 }).toUpperCase(), cleanText(body.classYear), cleanText(body.house),
          cleanText(body.guardianName, { max: 80 }) || null, isPhone(body.guardianPhone) ? cleanText(body.guardianPhone, { max: 20 }) : null);
    } else {
      for (const house of houses) {
        db.prepare('INSERT INTO staff_assignments (user_id, house) VALUES (?, ?)').run(id, house);
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  audit(req.user.id, 'user_created', 'users', id, { role, username });
  res.status(201).json({ user: { id, username, fullName, role } });
}));

adminRouter.patch('/users/:id', asyncHandler(async (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) throw notFound('User not found.');
  const active = req.body?.active === true || req.body?.active === false ? (req.body.active ? 1 : 0) : user.active;
  const email = req.body?.email !== undefined ? cleanText(req.body.email, { max: 120 }).toLowerCase() || null : user.email;
  if (email && !isEmail(email)) throw badRequest('Enter a valid email address.', { email: 'Invalid email.' });
  db.prepare('UPDATE users SET active = ?, email = ?, updated_at = ? WHERE id = ?').run(active, email, nowIso(), user.id);
  if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  audit(req.user.id, 'user_updated', 'users', user.id, { active, email });
  res.json({ ok: true });
}));

adminRouter.post('/users/:id/password', asyncHandler(async (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) throw notFound('User not found.');
  const password = String(req.body?.password || '');
  if (password.length < 8) throw badRequest('Use at least 8 characters.', { password: 'Too short.' });
  const hash = await hashPassword(password);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hash, nowIso(), user.id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
  audit(req.user.id, 'password_reset', 'users', user.id, null);
  res.json({ ok: true });
}));

adminRouter.get('/announcements', (req, res) => {
  const rows = getDb().prepare('SELECT * FROM announcements ORDER BY created_at DESC').all();
  res.json({ announcements: rows.map((r) => ({ id: r.id, title: r.title, body: r.body, level: r.level, active: !!r.active, createdAt: r.created_at })) });
});

adminRouter.post('/announcements', (req, res) => {
  const title = cleanText(req.body?.title, { max: 120 });
  const body = cleanText(req.body?.body, { max: 1000 });
  const level = ['info', 'policy', 'urgent'].includes(req.body?.level) ? req.body.level : 'info';
  if (!title || !body) throw badRequest('Title and message are required.');
  const id = newId();
  getDb().prepare('INSERT INTO announcements (id, title, body, level, active, created_by, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)')
    .run(id, title, body, level, req.user.id, nowIso());
  audit(req.user.id, 'announcement_created', 'announcements', id, null);
  res.status(201).json({ announcement: { id, title, body, level, active: true } });
});

adminRouter.patch('/announcements/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(req.params.id);
  if (!row) throw notFound('Announcement not found.');
  const active = req.body?.active === false ? 0 : req.body?.active === true ? 1 : row.active;
  db.prepare('UPDATE announcements SET active = ? WHERE id = ?').run(active, row.id);
  audit(req.user.id, 'announcement_updated', 'announcements', row.id, { active });
  res.json({ ok: true });
});

adminRouter.get('/settings', (req, res) => {
  const rows = getDb().prepare('SELECT key, value, updated_at FROM settings').all();
  res.json({ settings: rows.map((r) => ({ key: r.key, value: r.value, updatedAt: r.updated_at })) });
});

const EDITABLE_SETTINGS = new Set([
  'external_min_notice_hours', 'max_duration_hours', 'return_grace_minutes',
  'early_departure_minutes', 'emergency_contact_phone',
]);

adminRouter.put('/settings', (req, res) => {
  const body = req.body || {};
  const db = getDb();
  const updated = [];
  for (const [key, value] of Object.entries(body)) {
    if (!EDITABLE_SETTINGS.has(key)) continue;
    const clean = cleanText(value, { max: 200 });
    if (['external_min_notice_hours', 'max_duration_hours', 'return_grace_minutes', 'early_departure_minutes'].includes(key)) {
      const n = Number(clean);
      if (!Number.isFinite(n) || n < 0 || n > 720) throw badRequest(`Invalid value for ${key}.`);
    }
    db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .run(key, clean, nowIso());
    updated.push(key);
  }
  audit(req.user.id, 'settings_updated', 'settings', null, { updated });
  res.json({ ok: true, updated });
});
