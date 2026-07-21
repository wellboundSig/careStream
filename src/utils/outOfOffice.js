/**
 * Out of Office helpers.
 *
 * Schema (users):
 *   ooo_active     boolean — user has OOO on (may be scheduled)
 *   ooo_starts_on  date    — inclusive start (null = from enable / now)
 *   ooo_ends_on    date    — inclusive end (null = open-ended)
 */

function todayYmd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function asYmd(value) {
  if (!value) return null;
  const s = String(value);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

/** True when the user is currently out of office (within the active window). */
export function isUserOoo(user, now = new Date()) {
  if (!user || !user.ooo_active) return false;
  const today = todayYmd(now instanceof Date ? now : new Date(now));
  const start = asYmd(user.ooo_starts_on);
  const end = asYmd(user.ooo_ends_on);
  if (start && today < start) return false;
  if (end && today > end) return false;
  return true;
}

/** True when OOO is on but the window has not started yet. */
export function isUserOooScheduled(user, now = new Date()) {
  if (!user || !user.ooo_active) return false;
  const today = todayYmd(now instanceof Date ? now : new Date(now));
  const start = asYmd(user.ooo_starts_on);
  return !!(start && today < start);
}

export function formatOooDate(value) {
  const ymd = asYmd(value);
  if (!ymd) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

/** Short suffix for <option> labels, e.g. " — Out of office". */
export function oooOptionSuffix(user) {
  if (isUserOoo(user)) return ' — Out of office';
  if (isUserOooScheduled(user)) {
    const when = formatOooDate(user.ooo_starts_on);
    return when ? ` — OOO from ${when}` : ' — OOO scheduled';
  }
  return '';
}

/** Human-readable window for tooltips / banners. */
export function oooWindowLabel(user) {
  if (!user?.ooo_active) return '';
  const start = formatOooDate(user.ooo_starts_on);
  const end = formatOooDate(user.ooo_ends_on);
  if (start && end) return `${start} – ${end}`;
  if (start && !end) return `From ${start} (no return date)`;
  if (!start && end) return `Until ${end}`;
  return 'Until turned off';
}
