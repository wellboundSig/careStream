/**
 * Date helpers.
 *
 * Calendar dates (YYYY-MM-DD, or ISO that starts with one) must NOT be parsed
 * with `new Date('YYYY-MM-DD')` + toLocaleDateString in US timezones — that
 * treats the value as UTC midnight and shows the previous local day.
 */

/** Parse a calendar date as local midnight. Returns null if unusable. */
export function parseCalendarDate(value) {
  if (!value) return null;
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/** YYYY-MM-DD for <input type="date"> without timezone shift. */
export function toCalendarDateInput(value) {
  if (!value) return '';
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}

/** Today's date as YYYY-MM-DD in local calendar time (not UTC). */
export function todayCalendarDate() {
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

/** Add N calendar days; returns YYYY-MM-DD. */
export function addCalendarDays(dateStr, n) {
  const d = parseCalendarDate(dateStr);
  if (!d) return '';
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

/** Whole days from local today to a calendar date (can be negative). */
export function daysUntilCalendarDate(value) {
  const d = parseCalendarDate(value);
  if (!d) return null;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - startOfToday.getTime()) / 86400000);
}

/** Display a calendar date without timezone shift. */
export function fmtCalendarDate(value, empty = '—') {
  const d = parseCalendarDate(value);
  if (!d) return empty;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
