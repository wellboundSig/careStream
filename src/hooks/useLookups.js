import { useMemo } from 'react';
import { useCareStore } from '../store/careStore.js';

// ── Backward-compat exports (previously used by AppShell / other callers) ──
export function clearLookupsCache() { /* no-op — store is the cache */ }
export function prefetchLookups() { /* no-op — store hydration handles this */ }

// ── Hook ────────────────────────────────────────────────────────────────────
export function useLookups() {
  const entities       = useCareStore((s) => s.entities) || {};
  const marketers      = useCareStore((s) => s.marketers) || {};
  const users          = useCareStore((s) => s.users) || {};
  const referralSources = useCareStore((s) => s.referralSources) || {};
  const roles          = useCareStore((s) => s.roles) || {};
  const facilities     = useCareStore((s) => s.facilities) || {};
  // NetworkFacilities is a SECOND facilities table used by the ALF lead
  // picker. Referrals.facility_id can point to either table, so the
  // resolver must consult both. (Without this, ALF referrals show "—" in
  // the module page Facility column even though they were associated.)
  const networkFacilities = useCareStore((s) => s.networkFacilities) || {};
  const physicians     = useCareStore((s) => s.physicians) || {};
  const patients       = useCareStore((s) => s.patients) || {};
  const hydrated       = useCareStore((s) => s.hydrated);

  const entityMap = useMemo(() => {
    const map = {};
    Object.values(entities).forEach((e) => {
      const name =
        e?.name ||
        e?.entity_name ||
        e?.display_name ||
        e?.id ||
        e?._id;
      if (!name) return;
      if (e.id)  map[e.id]  = name;
      if (e._id) map[e._id] = name;
    });
    return map;
  }, [entities]);

  const marketerMap = useMemo(() => {
    const map = {};
    Object.values(marketers).forEach((m) => {
      if (m.id) map[m.id] = `${m.first_name || ''} ${m.last_name || ''}`.trim();
    });
    return map;
  }, [marketers]);

  const userMap = useMemo(() => {
    const map = {};
    Object.values(users).forEach((u) => {
      const name = `${u.first_name || ''} ${u.last_name || ''}`.trim();
      if (u.id) map[u.id] = name;
      if (u.clerk_user_id) map[u.clerk_user_id] = name;
    });
    return map;
  }, [users]);

  const sourceMap = useMemo(() => {
    const map = {};
    Object.values(referralSources).forEach((s) => {
      const name = s.name || s.id;
      if (s.id)  map[s.id]  = name;
      if (s._id) map[s._id] = name;
    });
    return map;
  }, [referralSources]);

  const roleMap = useMemo(() => {
    const map = {};
    Object.values(roles).forEach((r) => {
      if (r.id) map[r.id] = r.name || r.id;
    });
    return map;
  }, [roles]);

  const facilityMap = useMemo(() => {
    const map = {};
    // Order matters: load Facilities first, then NetworkFacilities. Either
    // table's ids may appear on a referral, and the resolver must hit both.
    Object.values(facilities).forEach((f) => {
      const name = f.name || f.id;
      if (f.id)  map[f.id]  = name;
      if (f._id) map[f._id] = name;
    });
    Object.values(networkFacilities).forEach((f) => {
      const name = f.name || f.id;
      if (f.id)  map[f.id]  = name;
      if (f._id) map[f._id] = name;
    });
    return map;
  }, [facilities, networkFacilities]);

  const physicianMap = useMemo(() => {
    const map = {};
    Object.values(physicians).forEach((p) => {
      const name = `${p.first_name || ''} ${p.last_name || ''}`.trim();
      if (p.id)  map[p.id]  = name;
      if (p._id) map[p._id] = name;
    });
    return map;
  }, [physicians]);

  const patientMap = useMemo(() => {
    const map = {};
    Object.values(patients).forEach((p) => {
      const name = `${p.first_name || ''} ${p.last_name || ''}`.trim();
      if (!name) return;
      if (p.id)  map[p.id]  = name;
      if (p._id) map[p._id] = name;
    });
    return map;
  }, [patients]);

  const resolveMarketer  = useMemo(() => (id) => (id && marketerMap[id])  || '—', [marketerMap]);
  const resolveEntity    = useMemo(() => (id) => (id && entityMap[id])    || '—', [entityMap]);
  const resolveUser      = useMemo(() => (id) => (id && userMap[id])      || '—', [userMap]);
  const resolveSource    = useMemo(() => (id) => (id && sourceMap[id])    || '—', [sourceMap]);
  const resolveRole      = useMemo(() => (id) => (id && roleMap[id])     || '—', [roleMap]);
  const resolveFacility  = useMemo(() => (id) => (id && facilityMap[id]) || '—', [facilityMap]);
  const resolvePhysician = useMemo(() => (id) => (id && physicianMap[id])|| '—', [physicianMap]);
  const resolvePatient   = useMemo(() => (id) => (id && patientMap[id])  || id || '—', [patientMap]);

  return {
    resolveEntity,
    resolveMarketer,
    resolveUser,
    resolveSource,
    resolveRole,
    resolveFacility,
    resolvePhysician,
    resolvePatient,
    roleMap,
    loading: !hydrated,
  };
}
