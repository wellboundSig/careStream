import { useEffect } from 'react';
import { useCurrentAppUser } from './useCurrentAppUser.js';
import { useCareStore } from '../store/careStore.js';
import { promoteDueScheduledLeads } from '../utils/promoteScheduledLeads.js';

const POLL_MS = 30_000;

/**
 * While CareStream is open, promote scheduled leads whose go-live time has passed.
 */
export function useScheduledLeadWatch() {
  const { appUserId } = useCurrentAppUser();
  const hydrated = useCareStore((s) => s.hydrated);

  useEffect(() => {
    if (!hydrated || !appUserId) return undefined;
    let cancelled = false;
    let running = false;

    function run() {
      if (cancelled || running) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      running = true;
      promoteDueScheduledLeads()
        .catch(() => {})
        .finally(() => { running = false; });
    }

    run();
    const id = setInterval(run, POLL_MS);
    function onVis() {
      if (document.visibilityState === 'visible') run();
    }
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [hydrated, appUserId]);
}
