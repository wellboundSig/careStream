import { useMemo } from 'react';
import { useCareStore } from '../store/careStore.js';
import { activeConflictCategoryOptions } from '../data/conflictCategories.js';

/**
 * Reactive list of active conflict-category options for pickers.
 * Falls back to the built-in defaults when none are configured.
 */
export function useConflictCategoryOptions() {
  const conflictCategories = useCareStore((s) => s.conflictCategories);
  return useMemo(
    () => activeConflictCategoryOptions({ conflictCategories }),
    [conflictCategories],
  );
}
