import { useEffect } from 'react';
import { useCurrentAppUser } from './useCurrentAppUser.js';
import { useCareStore } from '../store/careStore.js';
import { dispatchDueTaskReminders } from '../utils/dispatchTaskReminders.js';

const POLL_MS = 60_000;

/**
 * While CareStream is open, deliver due task reminders into the bell inbox.
 */
export function useTaskReminderWatch() {
  const { appUserId } = useCurrentAppUser();
  const hydrated = useCareStore((s) => s.hydrated);

  useEffect(() => {
    if (!hydrated || !appUserId) return undefined;
    let cancelled = false;

    function run() {
      if (cancelled) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      dispatchDueTaskReminders({ appUserId }).catch(() => {});
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
