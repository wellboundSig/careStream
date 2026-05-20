import { parsePhoneNumber } from 'libphonenumber-js';
import isEmail from 'validator/lib/isEmail.js';
import zipcodes from 'zipcodes';

/**
 * Normalizes and validates a US phone number.
 * Strips non-digits, drops a leading "1" when 11 digits, rejects anything
 * that isn't exactly 10 digits after normalization.
 */
export function normalizePhone(raw) {
  if (!raw || !raw.trim()) return { valid: false, digits: '', formatted: '', error: 'Phone number is required' };

  let digits = raw.replace(/\D/g, '');

  if (digits.length === 11 && digits[0] === '1') {
    digits = digits.slice(1);
  }

  if (digits.length !== 10) {
    return { valid: false, digits, formatted: '', error: 'Must be exactly 10 digits' };
  }

  try {
    const parsed = parsePhoneNumber('+1' + digits, 'US');
    if (!parsed || !parsed.isValid()) {
      return { valid: false, digits, formatted: '', error: 'Not a valid US phone number' };
    }
  } catch {
    return { valid: false, digits, formatted: '', error: 'Not a valid US phone number' };
  }

  return {
    valid: true,
    digits,
    formatted: formatPhone(digits),
    error: null,
  };
}

/**
 * Formats a 10-digit string as (XXX) XXX-XXXX.
 */
export function formatPhone(digits) {
  if (!digits || digits.length !== 10) return digits || '';
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * Validates an email address using the validator library.
 */
export function validateEmail(raw) {
  if (!raw || !raw.trim()) return { valid: false, error: 'Email is required' };
  const trimmed = raw.trim();
  if (!isEmail(trimmed)) return { valid: false, error: 'Invalid email address' };
  return { valid: true, error: null };
}

// ── Age group / DOB constraints ─────────────────────────────────────────────
// Special-Needs referrals carry an `sn_age_group` of "Adult" or "Pediatric".
// The two are mutually exclusive with the patient's date of birth: a
// Pediatric referral implies age < 18, an Adult referral implies age ≥ 18.
// These helpers compute the date bounds and run validations so the lead
// referral form, demographics editor, and referral-info editor all stay in
// sync — see the cross-tab handling around `sn_age_group` for context.

export const PEDIATRIC_MAX_AGE = 18;

function toIsoDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Returns the date (YYYY-MM-DD) someone must have been born on or before
 * to be considered an adult today. The 18th-birthday boundary itself
 * counts as Adult.
 */
export function getAdultCutoffDate(today = new Date()) {
  const cutoff = new Date(today.getFullYear() - PEDIATRIC_MAX_AGE, today.getMonth(), today.getDate());
  return toIsoDate(cutoff);
}

/**
 * Returns the earliest DOB (YYYY-MM-DD) that still qualifies as Pediatric
 * today — one day after the adult cutoff.
 */
export function getPediatricMinDate(today = new Date()) {
  const cutoff = new Date(today.getFullYear() - PEDIATRIC_MAX_AGE, today.getMonth(), today.getDate() + 1);
  return toIsoDate(cutoff);
}

/**
 * Returns { min, max } strings (YYYY-MM-DD) appropriate for a
 * <input type="date"> when the referral's age group is known.
 * Returns nulls when no constraint applies.
 */
export function getDobBoundsForAgeGroup(ageGroup, today = new Date()) {
  const todayIso = toIsoDate(today);
  if (ageGroup === 'Pediatric') {
    return { min: getPediatricMinDate(today), max: todayIso };
  }
  if (ageGroup === 'Adult') {
    return { min: null, max: getAdultCutoffDate(today) };
  }
  return { min: null, max: todayIso };
}

/**
 * Returns the age group ('Adult' | 'Pediatric') implied by a DOB, or
 * null when DOB isn't parseable.
 */
export function inferAgeGroupFromDob(dob, today = new Date()) {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const cutoff = new Date(today.getFullYear() - PEDIATRIC_MAX_AGE, today.getMonth(), today.getDate());
  return d.getTime() <= cutoff.getTime() ? 'Adult' : 'Pediatric';
}

/**
 * Validates that a DOB matches the chosen age group. Returns
 * { valid: true } on success or { valid: false, error } otherwise.
 * Empty DOB is treated as valid (the DOB requiredness is a separate
 * concern); empty age group skips the check entirely.
 */
export function validateDobForAgeGroup(dob, ageGroup, today = new Date()) {
  if (!dob || !ageGroup) return { valid: true, error: null };
  const inferred = inferAgeGroupFromDob(dob, today);
  if (!inferred) return { valid: false, error: 'Invalid date of birth' };
  if (inferred !== ageGroup) {
    return {
      valid: false,
      error:
        ageGroup === 'Pediatric'
          ? `Pediatric referrals require a DOB under ${PEDIATRIC_MAX_AGE}. Switch the age group to Adult or pick a more recent DOB.`
          : `Adult referrals require a DOB of ${PEDIATRIC_MAX_AGE}+. Switch the age group to Pediatric or pick an earlier DOB.`,
    };
  }
  return { valid: true, error: null };
}

/**
 * Looks up a US ZIP code. Returns city, state, and validity.
 * Rejects non-5-digit strings and unknown ZIP codes.
 */
export function lookupZip(zip) {
  if (!zip || !zip.trim()) return { valid: false, city: '', state: '', error: 'ZIP code is required' };

  const cleaned = zip.trim().replace(/\D/g, '');
  if (cleaned.length !== 5) return { valid: false, city: '', state: '', error: 'ZIP must be 5 digits' };

  const result = zipcodes.lookup(cleaned);
  if (!result) return { valid: false, city: '', state: '', error: 'Unknown ZIP code' };

  return {
    valid: true,
    city: result.city || '',
    state: result.state || '',
    zip: cleaned,
    error: null,
  };
}
