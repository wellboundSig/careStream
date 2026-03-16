import { useState, useEffect, useMemo } from 'react';
import airtable from '../api/airtable.js';
import { getPhysiciansCache, subscribeToPhysicians } from './usePhysicians.js';

// ── Empty sentinel ─────────────────────────────────────────────────────────────
const EMPTY = {
  marketerMap:  {},
  userMap:      {},
  sourceMap:    {},
  roleMap:      {},
  facilityMap:  {},
  physicianMap: {},
};

// ── Module-level cache ─────────────────────────────────────────────────────────
// Persists for the lifetime of the JS module (i.e. the browser session).
// All hook instances share one cache object — never re-fetched unless explicitly cleared.
let _cache    = null;
let _inflight = null; // coalesces concurrent callers into one network request

export function clearLookupsCache() { _cache = null; _inflight = null; }

// ── Cache update helpers ───────────────────────────────────────────────────────
// Called by useLookups instances so they re-render when physicians load after lookups
let _subscribers = [];
function notifySubscribers() { _subscribers.forEach((fn) => fn()); }

function buildPhysicianMap() {
  const physicians = getPhysiciansCache();
  if (!physicians?.length) return {};
  const map = {};
  physicians.forEach((phy) => {
    const name = `${phy.first_name || ''} ${phy.last_name || ''}`.trim();
    if (phy.id)  map[phy.id]  = name; // custom id (e.g. phy_001)
    if (phy._id) map[phy._id] = name; // Airtable record id (rec...)
  });
  return map;
}

// ── Core fetch ─────────────────────────────────────────────────────────────────
async function fetchLookups() {
  if (_cache) return _cache;
  if (_inflight) return _inflight; // concurrent callers share the same promise

  _inflight = (async () => {
    // For Physicians: reuse the usePhysicians cache if it's already populated
    // (AppShell calls prefetchPhysicians() before prefetchLookups(), so this
    //  is usually a free in-memory lookup — no extra network call).
    const physiciansCached = getPhysiciansCache();

    const [marketers, users, sources, roles, facilities, physiciansRaw] = await Promise.all([
      airtable.fetchAll('Marketers'),
      airtable.fetchAll('Users'),
      airtable.fetchAll('ReferralSources'),
      airtable.fetchAll('Roles'),
      airtable.fetchAll('Facilities'),
      // Skip network call if physicians are already in memory
      physiciansCached ? Promise.resolve(null) : airtable.fetchAll('Physicians'),
    ]);

    const marketerMap = {};
    marketers.forEach((r) => {
      const f = r.fields;
      if (f.id) marketerMap[f.id] = `${f.first_name || ''} ${f.last_name || ''}`.trim();
    });

    const userMap = {};
    users.forEach((r) => {
      const f = r.fields;
      if (f.id)           userMap[f.id]           = `${f.first_name || ''} ${f.last_name || ''}`.trim();
      if (f.clerk_user_id) userMap[f.clerk_user_id] = `${f.first_name || ''} ${f.last_name || ''}`.trim();
    });

    const sourceMap = {};
    sources.forEach((r) => {
      const f = r.fields;
      const name = f.name || f.id;
      if (f.id)  sourceMap[f.id]  = name;
      sourceMap[r.id] = name;
    });

    const roleMap = {};
    roles.forEach((r) => {
      const f = r.fields;
      if (f.id) roleMap[f.id] = f.name || f.id;
    });

    const facilityMap = {};
    facilities.forEach((r) => {
      const f = r.fields;
      const name = f.name || f.id;
      if (f.id)  facilityMap[f.id]  = name;
      facilityMap[r.id] = name;
    });

    // Build physicianMap — from in-memory cache or from fresh network fetch
    const physicianMap = {};
    if (physiciansCached) {
      physiciansCached.forEach((phy) => {
        const name = `${phy.first_name || ''} ${phy.last_name || ''}`.trim();
        if (phy.id)  physicianMap[phy.id]  = name;
        if (phy._id) physicianMap[phy._id] = name;
      });
    } else if (physiciansRaw) {
      physiciansRaw.forEach((r) => {
        const f = r.fields;
        const name = `${f.first_name || ''} ${f.last_name || ''}`.trim() || f.id;
        if (f.id)  physicianMap[f.id]  = name;
        physicianMap[r.id] = name;
      });
    }

    _cache = { marketerMap, userMap, sourceMap, roleMap, facilityMap, physicianMap };
    _inflight = null;

    // Always subscribe to physician cache changes so the physicianMap in our
    // lookup cache stays in sync after toggles, adds, or a full refresh.
    // This covers two cases:
    //  a) physicians loaded AFTER lookups — fills an initially empty map
    //  b) a single physician was patched via updatePhysicianInCache
    subscribeToPhysicians(() => {
      const fresh = buildPhysicianMap();
      if (_cache && Object.keys(fresh).length) {
        _cache = { ..._cache, physicianMap: fresh };
        notifySubscribers();
      }
    });

    return _cache;
  })();

  return _inflight;
}

// ── Public pre-fetch ───────────────────────────────────────────────────────────
/**
 * Call from AppShell on mount so lookups are warm before any patient drawer opens.
 * Re-entrant safe — subsequent calls while in-flight share the same promise.
 */
export function prefetchLookups() {
  return fetchLookups().catch(() => {});
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function useLookups() {
  // Lazy initializer: if _cache is already populated (prefetch completed before
  // this component mounted), React reads it synchronously — zero re-render flash.
  const [lookups, setLookups] = useState(() => _cache || EMPTY);
  const [loading, setLoading] = useState(!_cache);

  useEffect(() => {
    // Subscribe to physician-map updates (handles the case where physicians
    // loaded after the main lookup fetch completed with an empty physician map)
    const update = () => {
      if (_cache) setLookups({ ..._cache });
    };
    _subscribers.push(update);

    if (_cache) {
      setLoading(false);
    } else {
      fetchLookups()
        .then((data) => setLookups(data))
        .catch(() => {})
        .finally(() => setLoading(false));
    }

    return () => { _subscribers = _subscribers.filter((f) => f !== update); };
  }, []);

  const resolveMarketer  = useMemo(() => (id) => (id && lookups.marketerMap[id])  || '—', [lookups]);
  const resolveUser      = useMemo(() => (id) => (id && lookups.userMap[id])       || '—', [lookups]);
  const resolveSource    = useMemo(() => (id) => (id && lookups.sourceMap[id])     || '—', [lookups]);
  const resolveRole      = useMemo(() => (id) => (id && lookups.roleMap[id])       || '—', [lookups]);
  const resolveFacility  = useMemo(() => (id) => (id && lookups.facilityMap[id])   || '—', [lookups]);
  const resolvePhysician = useMemo(() => (id) => (id && lookups.physicianMap[id])  || '—', [lookups]);

  return { resolveMarketer, resolveUser, resolveSource, resolveRole, resolveFacility, resolvePhysician, loading };
}
