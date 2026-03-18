// Global refresh signal — now backed by the store's background sync.
// triggerDataRefresh() still works everywhere it's called (after mutations,
// after creating a referral, etc.) — it just now triggers a real sync
// instead of making every hook re-fetch independently.

import { useState, useEffect } from 'react';

const listeners = new Set();
let version = 0;

export function triggerDataRefresh() {
  version++;
  listeners.forEach((fn) => fn(version));

  // Fire a background sync of hot tables so the store picks up
  // any server-side changes (e.g. records just created via the API).
  import('../store/sync.js').then((m) => m.syncHotTables()).catch(() => {});
}

export function useRefreshVersion() {
  const [v, setV] = useState(version);
  useEffect(() => {
    listeners.add(setV);
    return () => listeners.delete(setV);
  }, []);
  return v;
}
