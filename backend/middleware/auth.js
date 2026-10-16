import crypto from 'node:crypto';
import { getDb, newId, nowIso } from '../db.js';
import { getSession, readCookies, SESSION_COOKIE, CSRF_COOKIE } from '../services/auth.js';
import { unauthorized, forbidden } from './errors.js';

/** Attaches req.user / req.session when a valid session cookie is present. */
export function sessionMiddleware(req, res, next) {
  const cookies = readCookies(req);
  const session = getSession(cookies[SESSION_COOKIE]);
  if (session) {
    const user = getDb().prepare('SELECT id, username, email, full_name, role, active FROM users WHERE id = ?').get(session.user_id);
    if (user && user.active) {
      req.session = session;
      req.user = user;
      req.houses = getDb().prepare('SELECT house FROM staff_assignments WHERE user_id = ?').all(user.id).map((r) => r.house);
    } else if (session) {
      getDb().prepare('DELETE FROM sessions WHERE id = ?').run(session.id);
    }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for cookie-based sessions: mutating requests must echo the
 * session's CSRF token in the X-CSRF-Token header (double-submit against the
 * readable cookie the frontend receives).
 */
export function csrfMiddleware(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (!req.session) return next(); // unauthenticated POSTs (login/register) are rate limited instead
  const header = req.get('x-csrf-token') || '';
  const cookies = readCookies(req);
  const cookieToken = cookies[CSRF_COOKIE] || '';
  const ok = safeEqual(header, req.session.csrf_token) && safeEqual(header, cookieToken);
  if (!ok) return next(forbidden('Invalid or missing security token. Refresh the page and try again.'));
  next();
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** Append an entry to the audit trail. */
export function audit(actorId, action, entity, entityId, meta) {
  getDb().prepare('INSERT INTO audit_log (id, actor_id, action, entity, entity_id, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(newId(), actorId || null, action, entity || null, entityId || null, meta ? JSON.stringify(meta) : null, nowIso());
}
