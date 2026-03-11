import { useState, useEffect, useCallback } from 'react';
import { useRefreshVersion } from './useRefreshTrigger.js';

export function useAirtable(fetchFn, deps = []) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const refreshVersion = useRefreshVersion();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const records = await fetchFn();
      setData(records.map((r) => ({ _id: r.id, ...r.fields })));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load, refreshVersion]); // re-runs whenever triggerDataRefresh() is called

  return { data, loading, error, refetch: load };
}
