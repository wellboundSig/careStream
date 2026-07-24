/**
 * Shared "clinical review in progress" resolver for list rows.
 *
 * A review is IN PROGRESS for a referral when a ClinicalReview row exists
 * (created the moment a nurse checks off even one checklist item) with a
 * `started_by` stamp, and the referral has no final
 * `clinical_review_decision` yet.
 *
 * The byline only shows when the starter is clinical staff — role name
 * containing "Clinical" or "COC" (e.g. Clinical RN), or a user assigned as
 * a COC nurse via CocNurseFacilities. All data is already bulk-hydrated
 * into the store, so rows resolve with zero extra fetches.
 *
 * Returns a stable `getReviewInProgress(referral)` → `{ starterName }` | null.
 */

import { useMemo } from 'react';
import { useCareStore } from '../store/careStore.js';

// Ids in Aurora occasionally carry trailing newlines — always trim before matching.
const clean = (v) => String(v || '').trim();

export function useClinicalReviewInProgress() {
  const clinicalReviews = useCareStore((s) => s.clinicalReviews);
  const users = useCareStore((s) => s.users);
  const roles = useCareStore((s) => s.roles);
  const cocNurseFacilities = useCareStore((s) => s.cocNurseFacilities);

  return useMemo(() => {
    const roleNameById = {};
    Object.values(roles || {}).forEach((r) => {
      if (r.id) roleNameById[clean(r.id)] = clean(r.name).toLowerCase();
    });

    const cocUserIds = new Set(
      Object.values(cocNurseFacilities || {})
        .map((link) => clean(link.user_id))
        .filter(Boolean),
    );

    const userById = {};
    Object.values(users || {}).forEach((u) => {
      if (u.id) userById[clean(u.id)] = u;
    });

    function starterQualifies(userId) {
      if (cocUserIds.has(userId)) return true;
      const u = userById[userId];
      if (!u) return false;
      const role = roleNameById[clean(u.role_id)] || '';
      return role.includes('clinical') || role.includes('coc');
    }

    // referral link (rec id or business id) → starter display name
    const starterByReferralKey = {};
    Object.values(clinicalReviews || {}).forEach((row) => {
      const starter = clean(row.started_by);
      if (!starter || !starterQualifies(starter)) return;
      const u = userById[starter];
      const name = u ? `${u.first_name || ''} ${u.last_name || ''}`.trim() : '';
      if (!name) return;
      const link = Array.isArray(row.referral_id) ? row.referral_id[0] : row.referral_id;
      if (link) starterByReferralKey[clean(link)] = name;
    });

    return function getReviewInProgress(referral) {
      if (!referral) return null;
      // Finalized reviews (Confirm pressed) stamp the referral — stop showing.
      if (referral.clinical_review_decision) return null;
      const name = starterByReferralKey[clean(referral._id)]
        || starterByReferralKey[clean(referral.id)];
      return name ? { starterName: name } : null;
    };
  }, [clinicalReviews, users, roles, cocNurseFacilities]);
}
