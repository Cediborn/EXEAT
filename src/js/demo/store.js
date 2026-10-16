/**
 * Demo-mode persistence.
 *
 * A small versioned database in localStorage that stands in for the real
 * SQLite backend when `demoMode` is enabled (hosted demo deployments). Each
 * browser gets its own isolated copy: seeded empty of requests so every
 * visitor experiences the real "first use" flow, with a few sample
 * announcements kept for context. Bumping VERSION resets visitors' data.
 */

const DB_KEY = 'entryout-demo-db';
const SESSION_KEY = 'entryout-demo-session';
const VERSION = 1;

const HOUSES = [
  'Balmer-Acquaah',
  'Pickard-Parker',
  'Lockhart-Schweitzer',
  'Sarbah-Picot',
  'Freeman-Aggrey',
  'Bartels-Sneath',
  'Brandful-Dontwi',
  'Abruquah-Monney',
];

export const DEMO_PASSWORD = 'Entryout!2026';
export const DEMO_ENROLLMENT_CODE = 'MFANTSIPIM-2026';

export function nowIso() {
  return new Date().toISOString();
}

export function newId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function seed() {
  const t = nowIso();
  return {
    version: VERSION,
    users: [
      {
        id: 'demo-student',
        username: 'MFS/26/0001',
        email: null,
        fullName: 'Kwabena Mensah (demo)',
        role: 'student',
        active: true,
        createdAt: t,
        password: DEMO_PASSWORD,
        profile: {
          indexNumber: 'MFS/26/0001',
          classYear: 'SHS 2',
          house: 'Balmer-Acquaah',
          guardianName: 'Ama Mensah',
          guardianPhone: '0241234567',
        },
        houses: [],
      },
      {
        id: 'demo-hm',
        username: 'HM-BALMER',
        email: null,
        fullName: 'Adwoa Balmer (demo)',
        role: 'housemaster',
        active: true,
        createdAt: t,
        password: DEMO_PASSWORD,
        profile: null,
        houses: ['Balmer-Acquaah'],
      },
      {
        id: 'demo-senior',
        username: 'SNR-HOUSE',
        email: null,
        fullName: 'Kwesi House (demo)',
        role: 'senior',
        active: true,
        createdAt: t,
        password: DEMO_PASSWORD,
        profile: null,
        houses: [],
      },
      {
        id: 'demo-gate',
        username: 'GATE01',
        email: null,
        fullName: 'Yaw Gate (demo)',
        role: 'gate',
        active: true,
        createdAt: t,
        password: DEMO_PASSWORD,
        profile: null,
        houses: [],
      },
      {
        id: 'demo-admin',
        username: 'ADMIN01',
        email: null,
        fullName: 'Aba Admin (demo)',
        role: 'admin',
        active: true,
        createdAt: t,
        password: DEMO_PASSWORD,
        profile: null,
        houses: [],
      },
    ],
    requests: [],
    approvals: [],
    passes: [],
    movements: [],
    notifications: [],
    announcements: [
      {
        id: 'demo-ann-1',
        title: 'Weekend exeat window',
        body: 'Internal exeats for the weekend close at 6:00 pm on Friday. Submit requests early so your housemaster has time to review.',
        level: 'policy',
        active: true,
        createdAt: t,
      },
      {
        id: 'demo-ann-2',
        title: 'Medical emergencies',
        body: 'For medical emergencies, call the school immediately as well as submitting an urgent request here. Do not rely on this form alone.',
        level: 'urgent',
        active: true,
        createdAt: t,
      },
      {
        id: 'demo-ann-3',
        title: 'Guardian notifications',
        body: 'Your parent or guardian is notified when an external exeat pass is approved. Make sure their contact number is up to date.',
        level: 'info',
        active: true,
        createdAt: t,
      },
    ],
    settings: {
      request_counter: '0',
      max_duration_hours: '72',
      external_min_notice_hours: '24',
      return_grace_minutes: '60',
      early_departure_minutes: '30',
      emergency_contact_phone: '030 222 1100',
    },
  };
}

export function loadDb() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const db = JSON.parse(raw);
      if (db && db.version === VERSION && Array.isArray(db.users)) return db;
    }
  } catch {
    // corrupt/unavailable storage → reseed below
  }
  const fresh = seed();
  saveDb(fresh);
  return fresh;
}

export function saveDb(db) {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch {
    // storage full or blocked — the in-memory db for this page still works
  }
}

export function resetDb() {
  const fresh = seed();
  saveDb(fresh);
  return fresh;
}

/* ------------------------------ session ------------------------------ */

export function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSession(session) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // ignore
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

export { HOUSES };
