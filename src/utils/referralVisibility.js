/**
 * Caseload visibility for marketers who lack referral.view_all.
 *
 * With the permission (default / current setup): see every referral your
 * division perms allow.
 * Without it: only referrals where you are the marketer, OR you entered the
 * original lead (lead_created_by_id).
 */

function trimId(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export function resolveMyMarketerId(marketers, appUserId) {
  const uid = trimId(appUserId);
  if (!uid) return null;
  const row = Object.values(marketers || {}).find((m) => trimId(m.user_id) === uid);
  return trimId(row?.id);
}

/**
 * @param {object} referral
 * @param {{ canViewAll: boolean, myMarketerId: string|null, appUserId: string|null }} ctx
 */
export function isReferralVisibleToUser(referral, { canViewAll, myMarketerId, appUserId }) {
  if (canViewAll) return true;
  if (!referral) return false;
  const mkt = trimId(myMarketerId);
  const uid = trimId(appUserId);
  if (mkt && trimId(referral.marketer_id) === mkt) return true;
  if (uid && trimId(referral.lead_created_by_id) === uid) return true;
  return false;
}
