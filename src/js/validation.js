/**
 * Client-side validation for the exeat application form.
 * Mirrors the server rules in backend/services/validate.js so users get
 * instant feedback; the server always re-validates independently.
 */

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

export const POLICIES = {
  externalMinNoticeHours: 24,
};

export function isPhone(value) {
  const digits = String(value || '').replace(/[^\d+]/g, '');
  return /^\+?\d{9,15}$/.test(digits);
}

export function localDateTime(date, time) {
  if (!date || !time) return null;
  const value = new Date(`${date}T${time}:00`);
  return Number.isNaN(value.getTime()) ? null : value;
}

/**
 * @returns {{ ok: true, value: object } | { ok: false, errors: Record<string,string> }}
 */
export function validateApplicationForm(values, { now = new Date(), policies = POLICIES } = {}) {
  const errors = {};
  const type = String(values.type || '');
  const category = String(values.category || '');
  const reason = String(values.reason || '').trim().replace(/\s+/g, ' ');
  const destination = String(values.destination || '').trim().replace(/\s+/g, ' ');

  if (!['internal', 'external'].includes(type)) errors.type = 'Choose internal or external exeat.';
  if (!CATEGORIES.some((c) => c.value === category)) errors.category = 'Choose a reason category.';

  if (reason.length < 10) errors.reason = 'Give a clear reason of at least 10 characters.';
  else if (reason.length > 1500) errors.reason = 'Please shorten your reason (1500 characters maximum).';

  if (destination.length < 2) errors.destination = 'Enter where you are going.';

  const departAt = localDateTime(values.departDate, values.departTime);
  const returnAt = localDateTime(values.returnDate, values.returnTime);
  if (!departAt) errors.departAt = 'Enter a valid departure date and time.';
  if (!returnAt) errors.returnAt = 'Enter a valid return date and time.';

  if (departAt && returnAt && returnAt <= departAt) {
    errors.returnAt = 'Return time must be after departure time.';
  }
  // No universal duration cap — staff review long requests in context.

  if (departAt && departAt.getTime() < now.getTime() - 60 * 1000) {
    errors.departAt = 'Departure time cannot be in the past.';
  }

  const guardianName = String(values.guardianName || '').trim();
  const guardianPhone = String(values.guardianPhone || '').trim();

  if (type === 'external') {
    if (departAt) {
      const hoursUntil = (departAt.getTime() - now.getTime()) / 3600000;
      if (hoursUntil < policies.externalMinNoticeHours) {
        errors.departAt = `External exeats need at least ${policies.externalMinNoticeHours} hours’ notice.`;
      }
    }
    if (!guardianName) errors.guardianName = "Enter your parent or guardian's name.";
    if (!guardianPhone) errors.guardianPhone = 'Enter a contact number for your parent or guardian.';
    else if (!isPhone(guardianPhone)) errors.guardianPhone = 'Enter a valid phone number, e.g. 024 123 4567.';
  } else if (guardianPhone && !isPhone(guardianPhone)) {
    errors.guardianPhone = 'Enter a valid phone number, e.g. 024 123 4567.';
  }

  const urgent = !!values.urgent;
  if (urgent && !CATEGORIES.find((c) => c.value === category)?.urgentAllowed) {
    errors.urgent = 'Only medical categories can be flagged as urgent.';
  }

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      type,
      category,
      reason,
      destination,
      guardianName: guardianName || null,
      guardianPhone: guardianPhone || null,
      departDate: values.departDate,
      departTime: values.departTime,
      returnDate: values.returnDate,
      returnTime: values.returnTime,
      urgent,
    },
  };
}

export function categoryLabel(value) {
  return CATEGORIES.find((c) => c.value === value)?.label || value;
}
