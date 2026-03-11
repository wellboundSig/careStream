import { useState, useEffect, useMemo } from 'react';
import airtable from '../api/airtable.js';

let _cache = null;

async function fetchLookups() {
  if (_cache) return _cache;

  const [marketers, users, sources, roles] = await Promise.all([
    airtable.fetchAll('Marketers'),
    airtable.fetchAll('Users'),
    airtable.fetchAll('ReferralSources'),
    airtable.fetchAll('Roles'),
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
    if (f.id) sourceMap[f.id] = f.name || f.id;
  });

  const roleMap = {};
  roles.forEach((r) => {
    const f = r.fields;
    if (f.id) roleMap[f.id] = f.name || f.id;
  });

  _cache = { marketerMap, userMap, sourceMap, roleMap };
  return _cache;
}

export function useLookups() {
  const [lookups, setLookups] = useState({ marketerMap: {}, userMap: {}, sourceMap: {}, roleMap: {} });
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

  return { resolveMarketer, resolveUser, resolveSource, resolveRole, loading };
}
