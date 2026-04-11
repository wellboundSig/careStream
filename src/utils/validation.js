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
