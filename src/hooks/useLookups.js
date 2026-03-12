import { useState, useEffect, useMemo } from 'react';
import airtable from '../api/airtable.js';

let _cache = null;
export function clearLookupsCache() { _cache = null; }

async function fetchLookups() {
  if (_cache) return _cache;

  const [marketers, users, sources, roles, facilities, physicians] = await Promise.all([
    airtable.fetchAll('Marketers'),
    airtable.fetchAll('Users'),
    airtable.fetchAll('ReferralSources'),
    airtable.fetchAll('Roles'),
    airtable.fetchAll('Facilities'),
    airtable.fetchAll('Physicians'),
  ]);

  const marketerMap = {};
  marketers.forEach((r) => {
    const f = r.fields;
    if (f.id) marketerMap[f.id] = `${f.first_name || ''} ${f.last_name || ''}`.trim();
  });

  const userMap = {};
  users.forEach((r) => {
    const f = r.fields;
    if (f.id) userMap[f.id] = `${f.first_name || ''} ${f.last_name || ''}`.trim();
    if (f.clerk_user_id) userMap[f.clerk_user_id] = `${f.first_name || ''} ${f.last_name || ''}`.trim();
  });

  const sourceMap = {};
  sources.forEach((r) => {
    const f = r.fields;
    const name = f.name || f.id;
    if (f.id) sourceMap[f.id] = name;
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
    if (f.id) facilityMap[f.id] = name;
    facilityMap[r.id] = name;
  });

  const physicianMap = {};
  physicians.forEach((r) => {
    const f = r.fields;
    const name = `${f.first_name || ''} ${f.last_name || ''}`.trim() || f.id;
    if (f.id) physicianMap[f.id] = name;
    physicianMap[r.id] = name;
  });

  _cache = { marketerMap, userMap, sourceMap, roleMap, facilityMap, physicianMap };
  return _cache;
}

export function useLookups() {
  const [lookups, setLookups] = useState({ marketerMap: {}, userMap: {}, sourceMap: {}, roleMap: {}, facilityMap: {}, physicianMap: {} });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchLookups()
      .then(setLookups)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const resolveMarketer = useMemo(
    () => (id) => lookups.marketerMap[id] || id || '—',
    [lookups]
  );

  const resolveUser = useMemo(
    () => (id) => lookups.userMap[id] || id || '—',
    [lookups]
  );

  const resolveSource = useMemo(
    () => (id) => lookups.sourceMap[id] || id || '—',
    [lookups]
  );

  const resolveRole = useMemo(
    () => (id) => lookups.roleMap[id] || id || '—',
    [lookups]
  );

  const resolveFacility = useMemo(
    () => (id) => lookups.facilityMap[id] || id || '—',
    [lookups]
  );

  const resolvePhysician = useMemo(
    () => (id) => lookups.physicianMap[id] || id || '—',
    [lookups]
  );

  return { resolveMarketer, resolveUser, resolveSource, resolveRole, resolveFacility, resolvePhysician, loading };
}
