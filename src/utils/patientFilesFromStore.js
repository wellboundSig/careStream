/**
 * Files already in the hydrated store for a patient / referral.
 * The Files tab used to ignore this and only trust a silent API fetch, which
 * produced "No files uploaded yet" while a file was open beside the drawer.
 */

export function linkValues(value) {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) return value.flatMap(linkValues);
  return [String(value)];
}

/** Business id + rec_id, plus the other side looked up from the live store. */
export function collectIdentities(record, storeMap) {
  const ids = new Set();
  for (const v of [...linkValues(record?.id), ...linkValues(record?._id)]) ids.add(v);
  if (ids.size === 0) return ids;
  const rows = Array.isArray(storeMap) ? storeMap : Object.values(storeMap || {});
  for (const row of rows) {
    if (!row) continue;
    const rowIds = [...linkValues(row.id), ...linkValues(row._id)];
    if (rowIds.some((id) => ids.has(id))) rowIds.forEach((id) => ids.add(id));
  }
  return ids;
}

export function linkMatches(value, idSet) {
  return linkValues(value).some((id) => idSet.has(id));
}

export function normalizeFileRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const fields = raw.fields && typeof raw.fields === 'object' ? raw.fields : raw;
  const _id = raw._id || raw.rec_id || raw.id || fields.rec_id || fields.id || fields.r2_key;
  if (!_id && !fields.file_name && !fields.r2_key) return null;
  return { ...fields, _id: _id || fields.r2_key || fields.file_name };
}

export function filesForPatientFromStore(storeFiles, patient, referral, extras = {}) {
  const pids = collectIdentities(patient, extras.patients);
  const rids = collectIdentities(referral, extras.referrals);
  const list = Array.isArray(storeFiles) ? storeFiles : Object.values(storeFiles || {});
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const f = normalizeFileRecord(raw);
    if (!f) continue;
    const match = (f.patient_id && linkMatches(f.patient_id, pids))
      || (f.referral_id && linkMatches(f.referral_id, rids));
    if (!match) continue;
    const key = String(f._id || f.r2_key || f.file_name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  out.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  return out;
}

export function mergeFileLists(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const raw of list || []) {
      const f = normalizeFileRecord(raw);
      if (!f) continue;
      const key = String(f._id || f.r2_key || f.file_name);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(f);
    }
  }
  return out;
}

/** Live store row for a drawer snapshot (keyed by rec_id, looked up by either id). */
export function resolveStoreRecord(storeMap, snapshot) {
  if (!snapshot) return snapshot;
  const map = storeMap || {};
  if (snapshot._id && map[snapshot._id]) return map[snapshot._id];
  if (snapshot.id && map[snapshot.id]) return map[snapshot.id];
  return Object.values(map).find((row) => {
    if (!row) return false;
    const ids = new Set([...linkValues(row.id), ...linkValues(row._id)]);
    return linkValues(snapshot.id).some((id) => ids.has(id))
      || linkValues(snapshot._id).some((id) => ids.has(id));
  }) || snapshot;
}
