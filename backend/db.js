import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { config, ROOT } from './config.js';

let db = null;

export function getDb() {
  if (db) return db;
  const dir = path.dirname(config.databasePath);
  fs.mkdirSync(dir, { recursive: true });
  db = new DatabaseSync(config.databasePath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db);
  seedSettings(db);
  return db;
}

export function closeDb() {
  if (db) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    db = null;
  }
}

function runMigrations(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);
  const dir = path.join(ROOT, 'database', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set(database.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    database.exec('BEGIN');
    try {
      database.exec(sql);
      database.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)')
        .run(file, new Date().toISOString());
      database.exec('COMMIT');
    } catch (err) {
      database.exec('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${err.message}`);
    }
  }
}

/** Default policy/settings rows, overridable from environment or the admin UI. */
function seedSettings(database) {
  const now = new Date().toISOString();
  const defaults = [
    ['external_min_notice_hours', String(config.policies.externalMinNoticeHours)],
    ['max_duration_hours', String(config.policies.maxDurationHours)],
    ['return_grace_minutes', String(config.policies.returnGraceMinutes)],
    ['early_departure_minutes', String(config.policies.earlyDepartureMinutes)],
    ['emergency_contact_phone', config.policies.emergencyContactPhone],
    ['request_counter', '0'],
  ];
  const stmt = database.prepare('INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)');
  for (const [key, value] of defaults) stmt.run(key, value, now);
}

/** Read a policy value (falls back to defaults from config). */
export function getSetting(key, fallback = '') {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  const now = new Date().toISOString();
  getDb().prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(key, String(value), now);
}

/** Numeric policy helper. */
export function getNumberSetting(key, fallback) {
  const raw = getSetting(key, '');
  const value = Number(raw);
  return raw !== '' && Number.isFinite(value) ? value : fallback;
}

export const newId = () => crypto.randomUUID();

export function nowIso() {
  return new Date().toISOString();
}
