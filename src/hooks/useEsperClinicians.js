import { useState, useEffect } from 'react';
import { getEsperClinicians, getDeviceLocations } from '../api/esper.js';

// ── Persistent cache (localStorage) ──────────────────────────────────────────
// Key: cs_clinicians_v1  →  { data: [...], cachedAt: <timestamp ms> }
// Cache is considered valid for the rest of the calendar day it was fetched.
// At midnight (new calendar date) the next fetch will hit the API.

const CACHE_KEY = 'cs_clinicians_v1';

function isCacheValid(stored) {
  if (!stored?.data?.length || !stored?.cachedAt) return false;
  return new Date(stored.cachedAt).toDateString() === new Date().toDateString();
}

function loadFromStorage() {
  try {
    const stored = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    return isCacheValid(stored) ? stored : null;
  } catch { return null; }
}

function saveToStorage(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data, cachedAt: Date.now() }));
  } catch {}
}

// ── Module-level shared state (one fetch for the whole app) ───────────────────
let _cache     = null;   // enriched clinician array, or null if not yet loaded
let _cachedAt  = null;   // ms timestamp of last successful fetch
let _loading   = false;
let _error     = null;
let _listeners = [];

function notify() { _listeners.forEach((fn) => fn()); }

async function doFetch() {
  if (_loading) return;
  _loading = true;
  _error   = null;
  notify(); // broadcast "loading started"

  try {
    const [devices, locationMap] = await Promise.all([
      getEsperClinicians(),
      getDeviceLocations(),
    ]);
    const enriched = devices.map((c) => ({
      ...c,
      location: locationMap[c.id] || null,
    }));
    _cache    = enriched;
    _cachedAt = Date.now();
    saveToStorage(enriched);
  } catch (err) {
    _error = err.message;
  } finally {
    _loading = false;
    notify();
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Call this from AppShell on mount to warm the cache immediately.
 * If a valid same-day cache exists in localStorage it is loaded instantly
 * (no network request). Otherwise a background fetch begins.
 */
export function prefetchClinicians() {
  if (_cache !== null) return; // already in memory for this session

  const stored = loadFromStorage();
  if (stored) {
    _cache    = stored.data;
    _cachedAt = stored.cachedAt;
    notify();
    return; // cache is fresh — no API call needed
  }

  doFetch();
}

/**
 * Force a fresh fetch from Esper, bypassing the cache.
 * Returns a promise that resolves when the fetch is complete.
 */
export function refreshClinicians() {
  _cache    = null;
  _cachedAt = null;
  _error    = null;
  localStorage.removeItem(CACHE_KEY);
  return doFetch();
}

/** Returns the cached-at timestamp (ms), or null. */
export function getCliniciansLastFetched() {
  return _cachedAt;
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useEsperClinicians() {
  const [tick, setTick] = useState(0); // just used to trigger re-renders

  useEffect(() => {
    const update = () => setTick((n) => n + 1);
    _listeners.push(update);

    // If nothing in memory yet, check localStorage then API
    if (_cache === null && !_loading) {
      const stored = loadFromStorage();
      if (stored) {
        _cache    = stored.data;
        _cachedAt = stored.cachedAt;
        update();
      } else {
        doFetch();
      }
    }

    return () => { _listeners = _listeners.filter((f) => f !== update); };
  }, []);

  return {
    clinicians: _cache || [],
    loading:    _loading,
    error:      _error,
    cachedAt:   _cachedAt,
    refresh:    refreshClinicians,
  };
}
