import { useMemo } from 'react';
import { useCareStore } from '../store/careStore.js';

export function useReferrals() {
  const referrals = useCareStore((s) => s.referrals);
  const hydrated = useCareStore((s) => s.hydrated);

  const data = useMemo(() => Object.values(referrals), [referrals]);

  return { data, loading: !hydrated, error: null, refetch: () => {} };
}
