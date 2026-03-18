import { useMemo } from 'react';
import { useCareStore } from '../store/careStore.js';

export function usePatients() {
  const patients = useCareStore((s) => s.patients);
  const hydrated = useCareStore((s) => s.hydrated);

  const data = useMemo(() => Object.values(patients), [patients]);

  return { data, loading: !hydrated, error: null, refetch: () => {} };
}
