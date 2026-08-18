import { isSocCompletedReferral } from '../data/stageConfig.js';

/** Same exits as the executive "Active Referrals" KPI. */
export const INACTIVE_FOR_ACTIVE_KPI = new Set([
  'SOC Completed',
  'Conflict',
  'NTUC',
  'Admin Confirmation',
  'Hold',
  'Discarded Leads',
]);

export const OVERDUE_STAGE_DAYS = 14;

/** Days used by the dashboard Overdue KPI (clock: last stage/update timestamp). */
export function overdueDaysInStage(referral, now = Date.now()) {
  if (Number.isFinite(referral?._days_in_stage)) return referral._days_in_stage;
  if (!referral?.updated_at) return null;
  const days = Math.floor((now - new Date(referral.updated_at).getTime()) / 86400000);
  return Number.isFinite(days) ? Math.max(0, days) : null;
}

export function isExecutiveOverdue(referral, now = Date.now()) {
  if (!referral) return false;
  if (INACTIVE_FOR_ACTIVE_KPI.has(referral.current_stage)) return false;
  if (isSocCompletedReferral(referral)) return false;
  const days = overdueDaysInStage(referral, now);
  return days != null && days > OVERDUE_STAGE_DAYS;
}

export function isCaseloadOverdue(referral, now = Date.now()) {
  if (!referral || referral.current_stage === 'Hold') return false;
  const days = overdueDaysInStage(referral, now);
  return days != null && days > OVERDUE_STAGE_DAYS;
}

export function listOverdueReferrals(referrals, predicate, now = Date.now()) {
  return (referrals || [])
    .filter((r) => predicate(r, now))
    .sort((a, b) => (overdueDaysInStage(b, now) ?? 0) - (overdueDaysInStage(a, now) ?? 0));
}

export function formatDaysInStage(days) {
  if (days == null) return '—';
  if (days === 0) return 'Today';
  if (days === 1) return '1 day';
  return `${days} days`;
}
