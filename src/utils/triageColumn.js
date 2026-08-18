/**
 * Shared triage-status column helpers for patient lists and module queues.
 *
 * Special Needs rows: Done (a triage record exists) or Needed.
 * Other divisions: N/A.
 */

export const TRIAGE_COLUMN_LABELS = {
  DONE: 'Done',
  NEEDED: 'Needed',
  NA: 'N/A',
};

export const TRIAGE_FILTER_OPTIONS = [
  TRIAGE_COLUMN_LABELS.DONE,
  TRIAGE_COLUMN_LABELS.NEEDED,
  TRIAGE_COLUMN_LABELS.NA,
];

const TRIAGE_ALIASES = {
  [TRIAGE_COLUMN_LABELS.DONE]: ['done', 'complete', 'completed', 'yes', 'y', 'true'],
  [TRIAGE_COLUMN_LABELS.NEEDED]: ['needed', 'incomplete', 'missing', 'pending', 'no', 'n', 'false'],
  [TRIAGE_COLUMN_LABELS.NA]: ['n/a', 'na', 'n.a.', 'not applicable'],
};

export function referralHasTriageRecord(referralId, adultStore, pedStore) {
  if (!referralId) return false;
  for (const t of Object.values(adultStore || {})) {
    if (t?.referral_id === referralId) return true;
  }
  for (const t of Object.values(pedStore || {})) {
    if (t?.referral_id === referralId) return true;
  }
  return false;
}

/** referral business id → true when an adult or pediatric triage row exists */
export function buildTriagePresenceMap(adultStore, pedStore) {
  const status = {};
  for (const t of Object.values(adultStore || {})) {
    if (t?.referral_id) status[t.referral_id] = true;
  }
  for (const t of Object.values(pedStore || {})) {
    if (t?.referral_id) status[t.referral_id] = true;
  }
  return status;
}

export function triageColumnLabel(referral, hasRecord) {
  if (referral?.division !== 'Special Needs') return TRIAGE_COLUMN_LABELS.NA;
  return hasRecord ? TRIAGE_COLUMN_LABELS.DONE : TRIAGE_COLUMN_LABELS.NEEDED;
}

export function matchesTriageFilter(label, query) {
  const queries = Array.isArray(query)
    ? query.map((v) => String(v || '').trim().toLowerCase()).filter(Boolean)
    : [String(query || '').trim().toLowerCase()].filter(Boolean);
  if (!queries.length) return true;
  const normalized = String(label || '');
  return queries.some((q) => {
    if (normalized.toLowerCase().includes(q)) return true;
    return (TRIAGE_ALIASES[normalized] || []).some((alias) => alias === q);
  });
}
