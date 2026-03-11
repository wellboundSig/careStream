// Lightweight global refresh signal — no external state library needed.
// Any hook that calls useRefreshVersion() will re-run its fetch when
// triggerDataRefresh() is called from anywhere in the app (e.g. after saving a patient).

const listeners = new Set();
let version = 0;

export function triggerDataRefresh() {
  version++;
  listeners.forEach((fn) => fn(version));
}

import { useState, useEffect } from 'react';

export function useRefreshVersion() {
  const [v, setV] = useState(version);
  useEffect(() => {
    listeners.add(setV);
    return () => listeners.delete(setV);
  }, []);
  return v;
}
