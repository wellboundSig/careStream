import { useMemo } from 'react';
import { useCareStore } from '../store/careStore.js';

export function useMarketers() {
  const marketers = useCareStore((s) => s.marketers);
  const hydrated = useCareStore((s) => s.hydrated);

  const data = useMemo(() => Object.values(marketers), [marketers]);

  return { data, loading: !hydrated, error: null, refetch: () => {} };
}
