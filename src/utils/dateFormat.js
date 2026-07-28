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

const MONTH_NAME = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

function isPlausibleBirthDate(y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  if (y < 1900 || y > 2100) return false;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return false;
  // DOB shouldn't be more than a day in the future (clock skew).
  const tomorrow = new Date();
  tomorrow.setHours(23, 59, 59, 999);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return dt.getTime() <= tomorrow.getTime();
}

function ymd(y, m, d) {
  if (!isPlausibleBirthDate(y, m, d)) return '';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Parse a pasted / typed birth date in common staff formats → YYYY-MM-DD.
 * US-first for numeric dates (MM/DD/YYYY). Returns '' if unusable.
 *
 * Examples: 3/5/1990, 03-05-1990, 1990-03-05, March 5 1990, 03051990, 19900305
 */
export function parseFlexibleBirthDate(raw) {
  if (raw == null) return '';
  let s = String(raw).trim();
  if (!s) return '';

  // Strip time / timezone crumbs from ISO-ish pastes
  s = s.replace(/T[\d:.]+.*$/, '').trim();
  s = s.replace(/\s+/g, ' ');

  // Already YYYY-MM-DD
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));

  // YYYY/MM/DD or YYYY.MM.DD
  m = s.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/);
  if (m) return ymd(Number(m[1]), Number(m[2]), Number(m[3]));

  // Compact 8-digit: try YYYYMMDD when the leading year is plausible, else MMDDYYYY
  if (/^\d{8}$/.test(s)) {
    const asYmd = ymd(Number(s.slice(0, 4)), Number(s.slice(4, 6)), Number(s.slice(6, 8)));
    if (asYmd) return asYmd;
    return ymd(Number(s.slice(4, 8)), Number(s.slice(0, 2)), Number(s.slice(2, 4)));
  }

  // MM/DD/YYYY (US) — also -, ., space separators
  m = s.match(/^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{4})$/);
  if (m) return ymd(Number(m[3]), Number(m[1]), Number(m[2]));

  // MM/DD/YY → assume 19xx if yy >= 30 else 20xx (DOB heuristic)
  m = s.match(/^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{2})$/);
  if (m) {
    const yy = Number(m[3]);
    const year = yy >= 30 ? 1900 + yy : 2000 + yy;
    return ymd(year, Number(m[1]), Number(m[2]));
  }

  // "March 5, 1990" / "Mar 5 1990" / "5 March 1990"
  m = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m) {
    const mo = MONTH_NAME[m[1].toLowerCase()];
    if (mo) return ymd(Number(m[3]), mo, Number(m[2]));
  }
  m = s.match(/^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/);
  if (m) {
    const mo = MONTH_NAME[m[2].toLowerCase()];
    if (mo) return ymd(Number(m[3]), mo, Number(m[1]));
  }

  // Last resort: Date.parse (local) — only accept if it round-trips cleanly
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    return ymd(parsed.getFullYear(), parsed.getMonth() + 1, parsed.getDate());
  }
  return '';
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
