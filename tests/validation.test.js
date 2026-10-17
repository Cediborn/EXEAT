import test from 'node:test';
import assert from 'node:assert/strict';
import './setup-env.js';

// validateApplication reads policy settings from the database, so the module
// graph is imported dynamically after environment setup.
const { validateApplication, parseDateTime, isPhone, isEmail } = await import('../backend/services/validate.js');
const { getDb } = await import('../backend/db.js');

const NOW = new Date('2026-03-10T08:00:00Z');

function payload(overrides = {}) {
  return {
    type: 'internal',
    category: 'family',
    reason: 'Visiting my grandmother in Accra with my family.',
    destination: 'Accra — Dansoman',
    departDate: '2026-03-12',
    departTime: '08:00',
    returnDate: '2026-03-12',
    returnTime: '18:00',
    ...overrides,
  };
}

test('a complete internal application validates', () => {
  const result = validateApplication(payload(), { now: NOW });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.value.requiresSenior, 0);
  assert.ok(Number.isNaN(Date.parse(result.value.departAt)) === false);
});

test('missing fields produce field keyed errors', () => {
  const result = validateApplication({ type: '', category: '', reason: 'short', destination: '' }, { now: NOW });
  assert.equal(result.ok, false);
  for (const key of ['type', 'category', 'reason', 'destination', 'departAt', 'returnAt']) {
    assert.ok(result.errors[key], `expected an error for ${key}`);
  }
});

test('return time must be after departure', () => {
  const result = validateApplication(payload({ returnDate: '2026-03-12', returnTime: '07:00' }), { now: NOW });
  assert.equal(result.ok, false);
  assert.match(result.errors.returnAt, /after departure/i);
});

test('departure in the past is rejected', () => {
  const result = validateApplication(payload({ departDate: '2026-03-09', departTime: '08:00', returnDate: '2026-03-09', returnTime: '18:00' }), { now: NOW });
  assert.equal(result.ok, false);
  assert.match(result.errors.departAt, /past/i);
});

test('external requests need 24 hours notice (school policy)', () => {
  const result = validateApplication(payload({
    type: 'external',
    departDate: '2026-03-10',
    departTime: '18:00',
    returnDate: '2026-03-11',
    returnTime: '18:00',
    guardianName: 'Parent Person',
    guardianPhone: '0241234567',
  }), { now: NOW });
  assert.equal(result.ok, false);
  assert.match(result.errors.departAt, /24 hours/);
});

test('external requests need a guardian contact', () => {
  const result = validateApplication(payload({
    type: 'external',
    departDate: '2026-03-13',
    departTime: '08:00',
    returnDate: '2026-03-13',
    returnTime: '18:00',
  }), { now: NOW });
  assert.equal(result.ok, false);
  assert.ok(result.errors.guardianPhone);
});

test('long trips are accepted — duration is reviewed by staff, never auto-capped', () => {
  // Ten days: previously rejected by the universal 72-hour cap. Duration is
  // now a staff-review judgement (with advisory guidance), not a hard limit.
  const result = validateApplication(payload({ returnDate: '2026-03-20' }), { now: NOW });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const depart = new Date(result.value.departAt);
  const back = new Date(result.value.returnAt);
  assert.ok((back - depart) / 3600000 > 72, 'the trip really does exceed 72 hours');
});

test('urgent flag is limited to medical categories', () => {
  const bad = validateApplication(payload({ urgent: true }), { now: NOW });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.urgent);

  const good = validateApplication(payload({
    category: 'illness',
    urgent: true,
    departDate: '2026-03-12',
    departTime: '09:00',
    returnDate: '2026-03-12',
    returnTime: '17:00',
  }), { now: NOW });
  assert.equal(good.ok, true, JSON.stringify(good.errors));
  assert.equal(good.value.urgent, 1);
});

test('reason and destination are trimmed and length limited', () => {
  const result = validateApplication(payload({
    reason: '   lots    of   spaces   and a long reason that keeps going on and on to test trimming behaviour here   ',
    destination: '   Cape Coast   ',
  }), { now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.value.destination, 'Cape Coast');
  assert.ok(!/\s{2,}/.test(result.value.reason));
});

test('parseDateTime accepts ISO or date+time parts', () => {
  assert.ok(parseDateTime(null, null, '2026-03-12T08:00:00Z') instanceof Date);
  assert.equal(parseDateTime('2026-03-12', '08:30', null).toISOString().slice(0, 16), '2026-03-12T08:30');
  assert.equal(parseDateTime('12/03/2026', '08:30', null), null);
  assert.equal(parseDateTime('2026-03-12', '25:99', null), null);
});

test('phone and email helpers', () => {
  assert.equal(isPhone('024 123 4567'), true);
  assert.equal(isPhone('+233241234567'), true);
  assert.equal(isPhone('abc'), false);
  assert.equal(isEmail('a@b.com'), true);
  assert.equal(isEmail('a@b'), false);
});

test('schema defaults exist for policies used by validation', () => {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'external_min_notice_hours'").get();
  assert.ok(row, 'policy settings are seeded on first use');
});
