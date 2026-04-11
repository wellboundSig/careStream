import { describe, it, expect } from 'vitest';
import { normalizePhone, formatPhone, validateEmail, lookupZip } from '../validation.js';

describe('normalizePhone', () => {
  it('accepts a valid 10-digit number', () => {
    const r = normalizePhone('2125551234');
    expect(r.valid).toBe(true);
    expect(r.digits).toBe('2125551234');
    expect(r.formatted).toBe('(212) 555-1234');
    expect(r.error).toBeNull();
  });

  it('strips non-digit characters', () => {
    const r = normalizePhone('(212) 555-1234');
    expect(r.valid).toBe(true);
    expect(r.digits).toBe('2125551234');
  });

  it('drops leading 1 when 11 digits', () => {
    const r = normalizePhone('12125551234');
    expect(r.valid).toBe(true);
    expect(r.digits).toBe('2125551234');
  });

  it('drops leading 1 from formatted 11-digit', () => {
    const r = normalizePhone('1 (212) 555-1234');
    expect(r.valid).toBe(true);
    expect(r.digits).toBe('2125551234');
  });

  it('rejects too short', () => {
    const r = normalizePhone('21255512');
    expect(r.valid).toBe(false);
    expect(r.error).toBe('Must be exactly 10 digits');
  });

  it('rejects too long (12 digits)', () => {
    const r = normalizePhone('212555123456');
    expect(r.valid).toBe(false);
    expect(r.error).toBe('Must be exactly 10 digits');
  });

  it('rejects letters-only input', () => {
    const r = normalizePhone('abcdefghij');
    expect(r.valid).toBe(false);
  });

  it('rejects mixed letters + insufficient digits', () => {
    const r = normalizePhone('abc212def');
    expect(r.valid).toBe(false);
  });

  it('rejects empty string', () => {
    const r = normalizePhone('');
    expect(r.valid).toBe(false);
    expect(r.error).toBe('Phone number is required');
  });

  it('rejects null/undefined', () => {
    expect(normalizePhone(null).valid).toBe(false);
    expect(normalizePhone(undefined).valid).toBe(false);
  });

  it('handles spaces-only input', () => {
    expect(normalizePhone('   ').valid).toBe(false);
  });
});

describe('formatPhone', () => {
  it('formats 10 digits correctly', () => {
    expect(formatPhone('2125551234')).toBe('(212) 555-1234');
  });

  it('returns input for non-10-digit strings', () => {
    expect(formatPhone('12345')).toBe('12345');
    expect(formatPhone('')).toBe('');
    expect(formatPhone(null)).toBe('');
  });
});

describe('validateEmail', () => {
  it('accepts valid email', () => {
    const r = validateEmail('test@example.com');
    expect(r.valid).toBe(true);
    expect(r.error).toBeNull();
  });

  it('accepts email with subdomain', () => {
    expect(validateEmail('user@mail.example.com').valid).toBe(true);
  });

  it('accepts email with plus addressing', () => {
    expect(validateEmail('user+tag@example.com').valid).toBe(true);
  });

  it('rejects missing @', () => {
    expect(validateEmail('testexample.com').valid).toBe(false);
  });

  it('rejects missing domain', () => {
    expect(validateEmail('test@').valid).toBe(false);
  });

  it('rejects spaces', () => {
    expect(validateEmail('test @example.com').valid).toBe(false);
  });

  it('rejects empty string', () => {
    const r = validateEmail('');
    expect(r.valid).toBe(false);
    expect(r.error).toBe('Email is required');
  });

  it('rejects null/undefined', () => {
    expect(validateEmail(null).valid).toBe(false);
    expect(validateEmail(undefined).valid).toBe(false);
  });

  it('trims whitespace before validation', () => {
    expect(validateEmail('  test@example.com  ').valid).toBe(true);
  });
});

describe('lookupZip', () => {
  it('returns city and state for valid ZIP', () => {
    const r = lookupZip('10001');
    expect(r.valid).toBe(true);
    expect(r.city).toBeTruthy();
    expect(r.state).toBe('NY');
    expect(r.error).toBeNull();
  });

  it('returns valid result for Beverly Hills', () => {
    const r = lookupZip('90210');
    expect(r.valid).toBe(true);
    expect(r.city).toBe('Beverly Hills');
    expect(r.state).toBe('CA');
  });

  it('preserves leading zeros (NJ zip)', () => {
    const r = lookupZip('07001');
    expect(r.valid).toBe(true);
    expect(r.state).toBe('NJ');
  });

  it('rejects letters', () => {
    const r = lookupZip('1000A');
    expect(r.valid).toBe(false);
    expect(r.error).toBe('ZIP must be 5 digits');
  });

  it('rejects too short', () => {
    const r = lookupZip('1234');
    expect(r.valid).toBe(false);
    expect(r.error).toBe('ZIP must be 5 digits');
  });

  it('rejects too long', () => {
    const r = lookupZip('123456');
    expect(r.valid).toBe(false);
    expect(r.error).toBe('ZIP must be 5 digits');
  });

  it('rejects unknown ZIP', () => {
    const r = lookupZip('00000');
    expect(r.valid).toBe(false);
    expect(r.error).toBe('Unknown ZIP code');
  });

  it('rejects empty string', () => {
    const r = lookupZip('');
    expect(r.valid).toBe(false);
    expect(r.error).toBe('ZIP code is required');
  });

  it('rejects null/undefined', () => {
    expect(lookupZip(null).valid).toBe(false);
    expect(lookupZip(undefined).valid).toBe(false);
  });

  it('handles zip with spaces', () => {
    const r = lookupZip(' 10001 ');
    expect(r.valid).toBe(true);
  });
});
