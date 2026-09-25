/**
 * Marketer performance — single source of truth for the incentive-program
 * metrics shown in Reports, Data Tools, and the Marketers directory.
 *
 * Business rules (per the incentive program, Sept 2026):
 *
 *  ATTRIBUTION — credit belongs to the ORIGINALLY assigned marketer
 *    (referrals.original_marketer_id, stamped at creation, write-once).
 *    Reassignment moves the working responsibility (marketer_id) but never
 *    the credit. Rows not yet backfilled fall back to marketer_id.
 *
 *  CLOSE RATE — SOC ÷ (SOC + NTUC): resolved/closed referrals only.
 *    Open referrals sit outside the ratio entirely and are surfaced as a
 *    separate count. Nothing is counted as a loss while someone is still
 *    working it, and nothing recent drags the rate down for being recent.
 *
 *  OUTCOME DATING — each outcome is counted in the period it HAPPENED:
 *    SOC by soc_completed_date, NTUC by ntuc_date — regardless of when the
 *    referral came in. A quarter's number is final when the quarter ends.
 *    (ntuc_date falls back to updated_at until the 0040 backfill has run.)
 *
 *  DISCARDED LEADS — junk/duplicate leads; excluded from every count.
 *
 *  OPEN COUNT — current snapshot (not period-scoped): referrals credited to
 *    the marketer that are still being worked right now.
 */

import { isSocCompletedReferral } from '../data/stageConfig.js';
import { dateRangeBounds } from '../components/common/DateRangeFilter.jsx';

export const UNASSIGNED_KEY = '__unassigned__';

/** One-line methodology caption shown wherever the close rate appears. */
export const CLOSE_RATE_METHODOLOGY =
  'Close rate = SOC ÷ (SOC + NTUC), counted by outcome date. Open referrals are '
  + 'excluded from the rate and shown separately. Credit belongs to the originally '
  + 'assigned marketer; reassignments do not move credit. Discarded leads are excluded.';

/**
 * Companion note: the count columns measure different windows on purpose, so
 * they are not supposed to reconcile with each other. Shown wherever the
 * counts appear so nobody reads the mismatch as an error.
 */
export const COUNTS_NOTE =
  'Note: these columns measure different windows and are not meant to add up. '
  + 'Referrals Received counts by referral date, SOC and NTUC count by the date '
  + 'the outcome happened, and Open is a live snapshot that ignores the period. '
  + 'A marketer can show more SOCs than new referrals in a quarter when older '
  + 'referrals converted during that quarter. This is expected.';

/** Marketer who gets incentive credit for a referral. */
export function attributionMarketerId(r) {
  const orig = String(r?.original_marketer_id || '').trim();
  if (orig) return orig;
  return String(r?.marketer_id || '').trim();
}

export function isDiscardedReferral(r) {
  return r?.current_stage === 'Discarded Leads';
}

export function isNtucReferral(r) {
  return r?.current_stage === 'NTUC';
}

/** Still being worked: not SOC'd, not NTUC, not discarded. Hold counts as open. */
export function isOpenReferral(r) {
  if (!r) return false;
  return !isDiscardedReferral(r) && !isNtucReferral(r) && !isSocCompletedReferral(r);
}

/** Outcome date for an SOC win. */
export function socOutcomeDate(r) {
  return r?.soc_completed_date || r?.admitted_date || null;
}

/**
 * Outcome date for an NTUC loss. updated_at is a documented interim fallback
 * for rows created before ntuc_date existed and not yet backfilled.
 */
export function ntucOutcomeDate(r) {
  return r?.ntuc_date || r?.updated_at || null;
}

function toTs(value) {
  if (!value) return null;
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function inBounds(value, bounds) {
  if (!bounds) return true; // no active range = all time
  const ts = toTs(value);
  if (ts == null) return false; // undated outcomes can't be placed in a period
  if (bounds.fromTs != null && ts < bounds.fromTs) return false;
  if (bounds.toTs != null && ts > bounds.toTs) return false;
  return true;
}

function emptyStats() {
  return {
    received: 0,      // referrals received in period (by referral_date) — volume context
    soc: 0,           // SOC outcomes in period (by soc_completed_date)
    ntuc: 0,          // NTUC outcomes in period (by ntuc_date)
    closed: 0,        // soc + ntuc — the close-rate denominator
    closeRate: null,  // soc / closed, 0..1; null when nothing closed
    open: 0,          // still being worked RIGHT NOW (snapshot, not period-scoped)
    lastReferralDate: null,
  };
}

function finalize(s) {
  s.closed = s.soc + s.ntuc;
  s.closeRate = s.closed > 0 ? s.soc / s.closed : null;
  return s;
}

/**
 * Aggregate one marketer's already-attributed referrals for a period.
 * @param {Array} referrals — rows credited to this marketer
 * @param {object|null} range — DateRangeFilter range object (null = all time)
 */
export function summarizeMarketerReferrals(referrals, range = null) {
  const bounds = dateRangeBounds(range);
  const s = emptyStats();
  for (const r of referrals || []) {
    if (!r || isDiscardedReferral(r)) continue;
    if (inBounds(r.referral_date, bounds)) s.received += 1;
    if (isSocCompletedReferral(r) && inBounds(socOutcomeDate(r), bounds)) s.soc += 1;
    if (isNtucReferral(r) && inBounds(ntucOutcomeDate(r), bounds)) s.ntuc += 1;
    if (isOpenReferral(r)) s.open += 1;
    const ts = toTs(r.referral_date);
    if (ts != null && (s.lastReferralDate == null || ts > toTs(s.lastReferralDate))) {
      s.lastReferralDate = r.referral_date;
    }
  }
  return finalize(s);
}

/**
 * Group all referrals by credited marketer and aggregate each group.
 * @returns {Object<string, object>} keyed by marketer id (UNASSIGNED_KEY for none)
 */
export function computeMarketerPerformance(referrals, range = null) {
  const bounds = dateRangeBounds(range);
  const groups = {};
  for (const r of referrals || []) {
    if (!r || isDiscardedReferral(r)) continue;
    const mid = attributionMarketerId(r) || UNASSIGNED_KEY;
    const s = (groups[mid] ||= emptyStats());
    if (inBounds(r.referral_date, bounds)) s.received += 1;
    if (isSocCompletedReferral(r) && inBounds(socOutcomeDate(r), bounds)) s.soc += 1;
    if (isNtucReferral(r) && inBounds(ntucOutcomeDate(r), bounds)) s.ntuc += 1;
    if (isOpenReferral(r)) s.open += 1;
    const ts = toTs(r.referral_date);
    if (ts != null && (s.lastReferralDate == null || ts > toTs(s.lastReferralDate))) {
      s.lastReferralDate = r.referral_date;
    }
  }
  for (const s of Object.values(groups)) finalize(s);
  return groups;
}

/** "67%" or "N/A" when nothing has closed yet (never a misleading 0%). */
export function formatCloseRate(closeRate) {
  if (closeRate === null || closeRate === undefined) return 'N/A';
  return `${Math.round(closeRate * 100)}%`;
}
