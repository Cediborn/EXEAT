import crypto from 'node:crypto';
import { getDb, newId, nowIso } from '../db.js';
import { config } from '../config.js';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_COOKIE = 'entryout_sid';
const CSRF_COOKIE = 'entryout_csrf';

export { SESSION_COOKIE, CSRF_COOKIE };

function scryptAsync(password, salt, params) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, params.keylen, { N: params.N, r: params.r, p: params.p }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    const err = new Error('Password must be at least 8 characters.');
    err.statusCode = 400;
    throw err;
  }
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, keyB64] = parts;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scryptAsync(password, salt, { N: Number(N), r: Number(r), p: Number(p), keylen: expected.length });
  return crypto.timingSafeEqual(actual, expected);
}

export function createSession(userId, meta = {}) {
  const db = getDb();
  const id = crypto.randomBytes(32).toString('hex');
  const csrf = crypto.randomBytes(24).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + config.sessionTtlHours * 3600 * 1000);
  db.prepare(`INSERT INTO sessions (id, user_id, csrf_token, created_at, expires_at, ip, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, userId, csrf, now.toISOString(), expires.toISOString(), meta.ip || null, (meta.userAgent || '').slice(0, 200));
  return { id, csrf, expiresAt: expires };
}

export function getSession(sessionId) {
  if (!sessionId || typeof sessionId !== 'string' || !/^[a-f0-9]{64}$/.test(sessionId)) return null;
  const row = getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    getDb().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    return null;
  }
  return row;
}

export function destroySession(sessionId) {
  if (sessionId) getDb().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function destroyAllSessionsForUser(userId) {
  getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function purgeExpiredSessions() {
  getDb().prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowIso());
}

export function setSessionCookies(res, session) {
  const secure = config.cookieSecure;
  const maxAge = config.sessionTtlHours * 3600 * 1000;
  res.append('Set-Cookie', `${SESSION_COOKIE}=${session.id}; HttpOnly; Path=/; Max-Age=${maxAge / 1000}; SameSite=${secure ? 'None' : 'Lax'}${secure ? '; Secure' : ''}`);
  res.append('Set-Cookie', `${CSRF_COOKIE}=${session.csrf}; Path=/; Max-Age=${maxAge / 1000}; SameSite=${secure ? 'None' : 'Lax'}; ${secure ? 'Secure' : ''}`);
}

export function clearSessionCookies(res) {
  const secure = config.cookieSecure;
  res.append('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=${secure ? 'None' : 'Lax'}${secure ? '; Secure' : ''}`);
  res.append('Set-Cookie', `${CSRF_COOKIE}=; Path=/; Max-Age=0; SameSite=${secure ? 'None' : 'Lax'}${secure ? '; Secure' : ''}`);
}

export function readCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}
