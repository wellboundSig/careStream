import { useMemo, useCallback } from 'react';
import { useCareStore } from '../store/careStore.js';
import { useCurrentAppUser } from './useCurrentAppUser.js';
import { usePermissions } from './usePermissions.js';
import { PERMISSION_KEYS } from '../data/permissionKeys.js';
import { resolveMyMarketerId, isReferralVisibleToUser } from '../utils/referralVisibility.js';

/**
 * Shared visibility context for pipeline / patient / search surfaces.
 */
export function useReferralVisibility() {
  const { appUserId } = useCurrentAppUser();
  const { can } = usePermissions();
  const marketers = useCareStore((s) => s.marketers);

  const canViewAll = can(PERMISSION_KEYS.REFERRAL_VIEW_ALL);
  const myMarketerId = useMemo(
    () => resolveMyMarketerId(marketers, appUserId),
    [marketers, appUserId],
  );

  const isVisible = useCallback(
    (referral) => isReferralVisibleToUser(referral, { canViewAll, myMarketerId, appUserId }),
    [canViewAll, myMarketerId, appUserId],
  );

  return { canViewAll, myMarketerId, appUserId, isVisible };
}
