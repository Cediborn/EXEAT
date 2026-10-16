import { CATEGORIES } from '../config.js';
import { getNumberSetting } from '../db.js';

const MAX_REASON = 1500;

export const CLASS_YEARS = ['SHS 1', 'SHS 2', 'SHS 3'];

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

export function cleanText(value, { max = 200 } = {}) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
}

export function isPhone(value) {
  const digits = String(value || '').replace(/[^\d+]/g, '');
  return /^\+?\d{9,15}$/.test(digits);
}

/**
 * Validate an exeat application body.
 * @param {object} body raw request body
 * @param {object} opts { now: Date, isUpdate?: boolean }
 * @returns {{ ok: true, value: object } | { ok: false, errors: Record<string,string> }}
 */
export function validateApplication(body, { now = new Date() } = {}) {
  const errors = {};
  const value = {};

  value.type = String(body.type || '').toLowerCase();
  if (!['internal', 'external'].includes(value.type)) errors.type = 'Choose internal or external exeat.';

  value.category = String(body.category || '');
  if (!CATEGORIES.some((c) => c.value === value.category)) errors.category = 'Choose a reason category.';

  value.reason = cleanText(body.reason, { max: MAX_REASON });
  if (value.reason.length < 10) errors.reason = 'Give a clear reason of at least 10 characters.';
  else if (value.reason.length > MAX_REASON) errors.reason = 'Reason is too long.';

  value.destination = cleanText(body.destination, { max: 120 });
  if (value.destination.length < 2) errors.destination = 'Enter where you are going.';
  else if (/^\d{7,}$/.test(value.destination)) errors.destination = 'Enter a place name, not a phone number.';

  value.guardianName = cleanText(body.guardianName, { max: 80 });
  value.guardianPhone = cleanText(body.guardianPhone, { max: 20 });

  value.departAt = parseDateTime(body.departDate, body.departTime, body.departAt);
  value.returnAt = parseDateTime(body.returnDate, body.returnTime, body.returnAt);

  if (!value.departAt) errors.departAt = 'Enter a valid departure date and time.';
  if (!value.returnAt) errors.returnAt = 'Enter a valid return date and time.';

  value.urgent = body.urgent === true || body.urgent === 'true' || body.urgent === 1;

  if (value.departAt && value.returnAt) {
    if (value.returnAt.getTime() <= value.departAt.getTime()) {
      errors.returnAt = 'Return time must be after departure time.';
    } else {
      const maxDuration = getNumberSetting('max_duration_hours', 72);
      const hours = (value.returnAt - value.departAt) / 3600000;
      if (hours > maxDuration) {
        errors.returnAt = `An exeat may not exceed ${maxDuration} hours. Plan a shorter visit or speak to your housemaster.`;
      }
    }
  }

  if (value.type === 'external' && value.departAt) {
    const minNotice = getNumberSetting('external_min_notice_hours', 24);
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

/** Accept either ISO strings or separate date (YYYY-MM-DD) + time (HH:MM) parts. */
export function parseDateTime(date, time, iso) {
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

export const CATEGORY_VALUES = CATEGORIES.map((c) => c.value);
