/**
 * Shared HCHB identifier hashing (HMAC-SHA256).
 * Pepper stays on the Lambda. Only hex digests leave this process.
 */

import { createHmac } from 'node:crypto';

export function normalizeName(value) {
  if (!value) return '';
  return String(value)
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function firstToken(value) {
  const n = normalizeName(value);
  if (!n) return '';
  return n.split(' ')[0];
}

export function normalizeDob(value) {
  if (!value) return '';
  const s = String(value).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) {
    const mm = String(m2[1]).padStart(2, '0');
    const dd = String(m2[2]).padStart(2, '0');
    return `${m2[3]}-${mm}-${dd}`;
  }
  const digits = s.replace(/\D+/g, '');
  if (digits.length >= 8) {
    const d = digits.slice(0, 8);
    return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  }
  return '';
}

export function hmacHex(pepper, material) {
  return createHmac('sha256', pepper).update(material, 'utf8').digest('hex');
}

export function hashName(pepper, last, first) {
  const l = normalizeName(last);
  const f = normalizeName(first);
  if (!l || !f) return '';
  return hmacHex(pepper, `NAME|${l}|${f}`);
}

export function hashNameDob(pepper, last, first, dob) {
  const l = normalizeName(last);
  const f = normalizeName(first);
  const d = normalizeDob(dob);
  if (!l || !f || !d) return '';
  return hmacHex(pepper, `NAMEDOB|${l}|${f}|${d}`);
}

/** Visit-check identity: first token of first name so "John Michael" matches HCHB "SMITH, JOHN". */
export function hashVisitName(pepper, last, first) {
  return hashName(pepper, last, firstToken(first));
}

export function hashVisitNameDob(pepper, last, first, dob) {
  return hashNameDob(pepper, last, firstToken(first), dob);
}
