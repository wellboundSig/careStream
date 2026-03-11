import { useState, useEffect } from 'react';
import { getEsperClinicians, getDeviceLocations } from '../api/esper.js';

let _cache = null;
let _loading = false;
let _listeners = [];

function notify() { _listeners.forEach((fn) => fn()); }

export function useEsperClinicians() {
  const [clinicians, setClinicians] = useState(_cache || []);
  const [loading, setLoading] = useState(!_cache);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (_cache) { setClinicians(_cache); setLoading(false); return; }
    if (_loading) {
      const update = () => { if (_cache) { setClinicians(_cache); setLoading(false); } };
      _listeners.push(update);
      return () => { _listeners = _listeners.filter((f) => f !== update); };
    }

    _loading = true;

    // Fetch devices and their locations in parallel
    Promise.all([getEsperClinicians(), getDeviceLocations()])
      .then(([devices, locationMap]) => {
        // Join location into each clinician record
        const enriched = devices.map((c) => ({
          ...c,
          location: locationMap[c.id] || null,
        }));
        _cache = enriched;
        setClinicians(enriched);
        setLoading(false);
        notify();
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
        notify();
      })
      .finally(() => { _loading = false; });
  }, []);

  return { clinicians, loading, error };
}
