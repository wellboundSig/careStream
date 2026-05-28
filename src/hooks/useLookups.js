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

  // Profile-image lookup, keyed identically to userMap so any caller that
  // already has a user business id (or clerk_user_id) can resolve the
  // avatar URL in one call. `clerk_image_url` is synced from Clerk into
  // Airtable via useCurrentAppUser — see that hook for the sync path.
  const userImageMap = useMemo(() => {
    const map = {};
    Object.values(users).forEach((u) => {
      const url = u.clerk_image_url || null;
      if (!url) return;
      if (u.id) map[u.id] = url;
      if (u.clerk_user_id) map[u.clerk_user_id] = url;
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
  // Returns the Clerk profile image URL for a user id (or null if none).
  // Distinct from `resolveUser` because callers usually want to render an
  // <img> with an initials fallback, so a null sentinel is more useful
  // than the "—" placeholder used by the name resolvers.
  const resolveUserImage = useMemo(() => (id) => (id ? (userImageMap[id] || null) : null), [userImageMap]);
  const resolveSource    = useMemo(() => (id) => (id && sourceMap[id])    || '—', [sourceMap]);
  const resolveRole      = useMemo(() => (id) => (id && roleMap[id])     || '—', [roleMap]);
  const resolveFacility  = useMemo(() => (id) => (id && facilityMap[id]) || '—', [facilityMap]);
  const resolvePhysician = useMemo(() => (id) => (id && physicianMap[id])|| '—', [physicianMap]);
  const resolvePatient   = useMemo(() => (id) => (id && patientMap[id])  || id || '—', [patientMap]);

  return {
    resolveEntity,
    resolveMarketer,
    resolveUser,
    resolveUserImage,
    resolveSource,
    resolveRole,
    resolveFacility,
    resolvePhysician,
    resolvePatient,
    roleMap,
    loading: !hydrated,
  };
}
