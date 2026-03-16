import { useState, useEffect, useCallback, useRef } from 'react';
import { useRefreshVersion } from './useRefreshTrigger.js';

export function useAirtable(fetchFn, deps = []) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const refreshVersion = useRefreshVersion();
  const mountedRef = useRef(false); // true after the first successful load

  const load = useCallback(async (isUserTriggered = false) => {
    // Show a full spinner only on the very first load or an explicit user-triggered refetch.
    // Silent background refreshes (triggerDataRefresh) update data without blanking the UI.
    if (!mountedRef.current || isUserTriggered) setLoading(true);
    setError(null);
    try {
      const records = await fetchFn();
      setData(records.map((r) => ({ _id: r.id, ...r.fields })));
      mountedRef.current = true;
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-run whenever the fetch function changes (different params) — show spinner
  useEffect(() => {
    mountedRef.current = false; // new params = treat as fresh
    load(false);
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  // Silent background refresh triggered by triggerDataRefresh() — no spinner
  const prevVersion = useRef(refreshVersion);
  useEffect(() => {
    if (prevVersion.current === refreshVersion) return; // skip on initial mount
    prevVersion.current = refreshVersion;
    load(false);
  }, [refreshVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading, error, refetch: () => load(true) };
}
