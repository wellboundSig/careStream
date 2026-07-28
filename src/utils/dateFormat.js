/**
 * Date helpers.
 *
 * Calendar dates (YYYY-MM-DD, or ISO that starts with one) must NOT be parsed
 * with `new Date('YYYY-MM-DD')` + toLocaleDateString in US timezones — that
 * treats the value as UTC midnight and shows the previous local day.
 *
 * Prefer these helpers for any date-only field (dob, referral_date,
 * soc_scheduled_date, f2f_date, follow_up_date, document_date, etc.).
 * True timestamps (*_at with time) may still use `new Date` / fmtDateTime.
 */

/** Parse a calendar date as local midnight. Returns null if unusable. */
export function parseCalendarDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** YYYY-MM-DD for <input type="date"> without timezone shift. */
export function toCalendarDateInput(value) {
  if (!value) return '';
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

/** Format a Date / calendar value as YYYY-MM-DD in local calendar time. */
export function toCalendarDateString(value) {
  const d = value instanceof Date ? value : parseCalendarDate(value);
  if (!d || Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

/** Today's date as YYYY-MM-DD in local calendar time (not UTC). */
export function todayCalendarDate() {
  return toCalendarDateString(new Date());
}

/** Add N calendar days; returns YYYY-MM-DD. */
export function addCalendarDays(dateStr, n) {
  const d = parseCalendarDate(dateStr);
  if (!d) return '';
  d.setDate(d.getDate() + n);
  return toCalendarDateString(d);
}

/** Whole days from local today to a calendar date (can be negative). */
export function daysUntilCalendarDate(value) {
  const d = parseCalendarDate(value);
  if (!d) return null;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - startOfToday.getTime()) / 86400000);
}

/** Whole days since a calendar date (from local today). */
export function daysSinceCalendarDate(value) {
  const until = daysUntilCalendarDate(value);
  return until == null ? null : -until;
}

/**
 * Age in whole years from a calendar DOB (timezone-safe).
 * @returns {number|null}
 */
export function ageFromDob(dob, today = new Date()) {
  const d = parseCalendarDate(dob);
  if (!d) return null;
  const now = today instanceof Date ? today : parseCalendarDate(today) || new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age;
}

/** Display a calendar date without timezone shift. */
export function fmtCalendarDate(value, empty = '—') {
  const d = parseCalendarDate(value);
  if (!d) return empty;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Short calendar date: "Mar 5" (no year). */
export function fmtCalendarDateShort(value, empty = '—') {
  const d = parseCalendarDate(value);
  if (!d) return empty;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Long calendar date: "March 5, 2026". */
export function fmtCalendarDateLong(value, empty = '—') {
  const d = parseCalendarDate(value);
  if (!d) return empty;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/** Alias used across the app — timezone-safe for date-only values. */
export function fmtDate(d) {
  return fmtCalendarDate(d, '—');
}

export function fmtDateTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  }) + ' at ' + d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  });
}

export function daysInStage(updatedAt) {
  if (!updatedAt) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86400000));
}

export function relativeTime(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 2) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
