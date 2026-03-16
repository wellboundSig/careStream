import { useState, useEffect } from 'react';
import { getPhysicians } from '../api/physicians.js';

// ── Session cache (sessionStorage) ───────────────────────────────────────────
// Survives page refreshes within the same browser session.
// Cleared automatically when the tab/window closes.
// Physicians rarely change, so one fetch per session is appropriate.

const SESSION_KEY = 'cs_physicians_v1';

function loadFromSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveToSession(data) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch {}
}

// ── Module-level shared state (one fetch, many consumers) ─────────────────────
let _cache    = null;   // physician array or null
let _loading  = false;
let _error    = null;
let _listeners = [];

function notify() { _listeners.forEach((fn) => fn()); }

async function doFetch() {
  if (_loading) return;
  _loading = true;
  _error   = null;
  notify();

  try {
    const recs = await getPhysicians();
    _cache = recs.map((r) => ({ _id: r.id, ...r.fields }));
    saveToSession(_cache);
  } catch (err) {
    _error = err.message;
  } finally {
    _loading = false;
    notify();
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Call from AppShell on mount to warm the cache immediately.
 * Uses sessionStorage if available — no network call needed.
 */
export function prefetchPhysicians() {
  if (_cache !== null) return;
  const stored = loadFromSession();
  if (stored) {
    _cache = stored;
    notify();
    return;
  }
  doFetch();
}

/**
 * Force a fresh fetch from Airtable.
 * Call after creating or editing a physician to keep the cache current.
 */
export function refreshPhysicians() {
  _cache = null;
  _error = null;
  sessionStorage.removeItem(SESSION_KEY);
  return doFetch();
}

/**
 * Patch a single physician in the in-memory and sessionStorage cache without
 * re-fetching all 3000+ records. Use after toggling PECOS/OPRA or any single-
 * field update so the list UI reflects the change immediately.
 */
export function updatePhysicianInCache(recordId, fields) {
  if (!_cache) return;
  _cache = _cache.map((p) => (p._id === recordId ? { ...p, ...fields } : p));
  saveToSession(_cache);
  notify();
}

/** Synchronous read — returns current cache or null. */
export function getPhysiciansCache() {
  return _cache;
}

/** Subscribe to cache updates — returns unsubscribe function. */
export function subscribeToPhysicians(fn) {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter((f) => f !== fn); };
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function usePhysicians() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const update = () => setTick((n) => n + 1);
    _listeners.push(update);

    if (_cache === null && !_loading) {
      const stored = loadFromSession();
      if (stored) {
        _cache = stored;
        update();
      } else {
        doFetch();
      }
    }

    return () => { _listeners = _listeners.filter((f) => f !== update); };
  }, []);

  return {
    physicians: _cache || [],
    loading:    _loading && _cache === null,
    error:      _error,
    refresh:    refreshPhysicians,
  };
}
