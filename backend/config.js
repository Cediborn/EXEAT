import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

/**
 * Minimal .env loader (no dependency). Values already present in process.env
 * win, so real environment variables always take precedence.
 */
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv(path.join(ROOT, '.env'));

const num = (key, fallback) => {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
};

const list = (key, fallback = []) => {
  const raw = process.env[key];
  if (!raw) return fallback;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
};

const nodeEnv = process.env.NODE_ENV || 'development';

/**
 * Development-only dashboard bypass (temporary, reversible).
 * When enabled, POST /api/auth/dev-session issues a real session for a seeded
 * demo identity so the dashboards can be inspected without signing in.
 * HARD OFF in production (regardless of env vars), and DEV_BYPASS_AUTH=false
 * switches it off in any other environment. All authorization checks on the
 * rest of the API are untouched either way.
 */
const bypassKillSwitch = String(process.env.DEV_BYPASS_AUTH || '').toLowerCase();
export const config = {
  nodeEnv,
  isTest: nodeEnv === 'test',
  isProduction: nodeEnv === 'production',
  devBypassAuth: nodeEnv !== 'production' && !['false', '0', 'off', 'no'].includes(bypassKillSwitch),
  port: num('PORT', 8787),
  apiPublicUrl: (process.env.API_PUBLIC_URL || `http://localhost:${num('PORT', 8787)}`).replace(/\/$/, ''),
  allowedOrigins: list('ALLOWED_ORIGINS'),
  databasePath: process.env.DATABASE_PATH
    ? path.resolve(ROOT, process.env.DATABASE_PATH)
    : path.join(ROOT, 'data', 'entryout.sqlite'),
  sessionTtlHours: num('SESSION_TTL_HOURS', 12),
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  rateLimits: {
    loginPerIdentifier: num('LOGIN_RATE_LIMIT_MAX', 8),
    loginPerIp: num('LOGIN_RATE_LIMIT_IP_MAX', 30),
    apiPerMinute: num('RATE_LIMIT_API_MAX', 300),
  },
  studentEnrollmentCode: process.env.STUDENT_ENROLLMENT_CODE || '',
  policies: {
    externalMinNoticeHours: num('EXTERNAL_MIN_NOTICE_HOURS', 24),
    maxDurationHours: num('MAX_DURATION_HOURS', 72),
    returnGraceMinutes: num('RETURN_GRACE_MINUTES', 60),
    earlyDepartureMinutes: num('EARLY_DEPARTURE_MINUTES', 30),
    emergencyContactPhone: process.env.EMERGENCY_CONTACT_PHONE || '',
  },
  notify: {
    webhookUrl: process.env.NOTIFY_WEBHOOK_URL || '',
    webhookToken: process.env.NOTIFY_WEBHOOK_TOKEN || '',
    timeoutMs: num('NOTIFY_WEBHOOK_TIMEOUT_MS', 5000),
  },
};

/** Exeat categories shown to students (configurable via settings later). */
export const CATEGORIES = [
  { value: 'medical_appointment', label: 'Medical appointment', urgentAllowed: true },
  { value: 'illness', label: 'Illness or urgent medical attention', urgentAllowed: true },
  { value: 'family', label: 'Family outing or bereavement', urgentAllowed: false },
  { value: 'personal', label: 'Approved personal outing', urgentAllowed: false },
  { value: 'school_activity', label: 'School activity', urgentAllowed: false },
  { value: 'other', label: 'Other authorised reason', urgentAllowed: false },
];

export const HOUSES = [
  'Balmer-Acquaah',
  'Pickard-Parker',
  'Lockhart-Schweitzer',
  'Sarbah-Picot',
  'Freeman-Aggrey',
  'Bartels-Sneath',
  'Brandful-Dontwi',
  'Abruquah-Monney',
];

export const CLASS_YEARS = ['SHS 1', 'SHS 2', 'SHS 3'];

export const ROLES = ['student', 'housemaster', 'senior', 'gate', 'admin'];
