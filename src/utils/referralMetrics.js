/**
 * Referral time metrics — single source of truth for "days in stage" and
 * "days in pipeline" everywhere the UI surfaces them.
 *
 * IMPORTANT: there is NO `stage_entered_at` column on the Referrals table
 * in Airtable. Using `Referrals.updated_at` as a proxy is wrong — that
 * timestamp ticks on ANY field change (notes, tasks, files, etc.) so it
 * never resets when a stage changes. We therefore derive the stage entry
 * timestamp from `StageHistory`, which we already hydrate into the store
 * and write on every transition (`recordTransition`).
 *
 * Two distinct metrics exposed:
 *   - daysInPipeline  → days since the referral first entered (referral_date,
 *                       falling back to created_at). NEVER resets.
 *   - daysInStage     → days since the most recent StageHistory row whose
 *                       to_stage matches the current stage. RESETS on every
 *                       stage change.
 */

const MS_PER_DAY = 86400000;

export function daysBetween(from, to = Date.now()) {
  if (!from) return null;
  const fromMs = new Date(from).getTime();
  if (!Number.isFinite(fromMs)) return null;
  const toMs = typeof to === 'number' ? to : new Date(to).getTime();
  return Math.max(0, Math.floor((toMs - fromMs) / MS_PER_DAY));
}

/**
 * Find the timestamp of the latest StageHistory row where `to_stage` equals
 * the referral's current stage. Returns ISO string, or null if no match.
 */
export function findStageEnteredAt(referral, stageHistoryList) {
  if (!referral?.id || !referral.current_stage) return null;
  if (!Array.isArray(stageHistoryList) || stageHistoryList.length === 0) return null;

  let bestMs = -Infinity;
  for (const h of stageHistoryList) {
    if (h?.referral_id !== referral.id) continue;
    if (h?.to_stage   !== referral.current_stage) continue;
    const ms = new Date(h?.timestamp || 0).getTime();
    if (Number.isFinite(ms) && ms > bestMs) bestMs = ms;
  }
  return bestMs > 0 ? new Date(bestMs).toISOString() : null;
}

/**
 * Resolve the canonical "stage entered at" timestamp for a referral.
 * Falls back to referral_date / created_at when no StageHistory row exists
 * (e.g. a brand new referral that has only ever been in its initial stage).
 */
export function resolveStageEnteredAt(referral, stageHistoryList) {
  return (
    findStageEnteredAt(referral, stageHistoryList) ||
    referral?.referral_date ||
    referral?.created_at ||
    null
  );
}

export function daysInStage(referral, stageHistoryList) {
  return daysBetween(resolveStageEnteredAt(referral, stageHistoryList));
}

export function daysInPipeline(referral) {
  return daysBetween(referral?.referral_date || referral?.created_at);
}

/** "Today" / "1d" / "12d" / "—" */
export function formatDaysShort(n) {
  if (n === null || n === undefined) return '—';
  if (n <= 0) return 'Today';
  return `${n}d`;
}

/**
 * Enrich a referral object with computed time metrics. Returns a new object
 * with `_stage_entered_at`, `_days_in_stage`, and `_days_in_pipeline` set.
 * Underscores prevent collisions with future Airtable columns of the same name.
 */
export function enrichReferralWithMetrics(referral, stageHistoryList) {
  const stageEnteredAt = resolveStageEnteredAt(referral, stageHistoryList);
  return {
    ...referral,
    _stage_entered_at: stageEnteredAt,
    _days_in_stage:    daysBetween(stageEnteredAt),
    _days_in_pipeline: daysInPipeline(referral),
  };
}
