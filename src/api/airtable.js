/**
 * LEGACY FILENAME — this is NOT Airtable.
 *
 * CareStream is Aurora PostgreSQL only (AWS wellbound-api). Dev and prod both
 * use VITE_API_URL. There is no Airtable PAT, base, worker, or api.airtable.com
 * fallback. The filename and default export (`airtable`) are leftovers from the
 * old JSON wire shape ({ fields }, filterByFormula).
 *
 * If VITE_API_URL is missing, requests fail loud. Do not add Airtable back.
 */
const API_URL = import.meta.env.VITE_API_URL || '';

function auroraBaseUrl() {
  if (!API_URL) {
    throw new Error('VITE_API_URL is required. CareStream is Aurora-only (wellbound-api). There is no Airtable path.');
  }
  return API_URL;
}

// Clerk session JWT — the only auth wellbound-api accepts.
async function authHeader() {
  try {
    const token = typeof window !== 'undefined' && window.Clerk?.session
      ? await window.Clerk.session.getToken()
      : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function fetchWithRetry(url, options, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, options);
    if (res.status === 429 && attempt < retries) {
      const wait = Math.min(1000 * 2 ** attempt, 10000);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    return res;
  }
  throw new Error('wellbound-api rate limit exceeded after retries');
}

// ── Short-TTL read cache + in-flight de-duplication ──────────────────────────
const READ_CACHE_TTL_MS = 20_000;
const READ_CACHE_MAX = 300;
const readCache = new Map(); // key -> { at, promise }

function cacheGet(key) {
  const entry = readCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > READ_CACHE_TTL_MS) { readCache.delete(key); return null; }
  return entry.promise;
}

function cacheSet(key, promise) {
  if (readCache.size >= READ_CACHE_MAX) {
    const now = Date.now();
    for (const [k, v] of readCache) {
      if (now - v.at > READ_CACHE_TTL_MS) readCache.delete(k);
    }
    while (readCache.size >= READ_CACHE_MAX) {
      readCache.delete(readCache.keys().next().value);
    }
  }
  readCache.set(key, { at: Date.now(), promise });
  promise.catch(() => readCache.delete(key));
}

export function invalidateTable(tableName) {
  const prefix = `${tableName}|`;
  for (const k of readCache.keys()) {
    if (k.startsWith(prefix)) readCache.delete(k);
  }
}

async function fetchAll(tableName, params = {}) {
  const key = `${tableName}|all|${JSON.stringify(params)}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const promise = fetchAllUncached(tableName, params);
  cacheSet(key, promise);
  return promise;
}

async function fetchAllUncached(tableName, params = {}) {
  const records = [];
  let offset = null;
  const BASE_URL = auroraBaseUrl();

  do {
    const url = new URL(`${BASE_URL}/${encodeURIComponent(tableName)}`);
    if (offset) url.searchParams.set('offset', offset);
    if (params.filterByFormula) url.searchParams.set('filterByFormula', params.filterByFormula);
    if (params.maxRecords) url.searchParams.set('maxRecords', String(params.maxRecords));
    if (params.sort) {
      params.sort.forEach((s, i) => {
        url.searchParams.set(`sort[${i}][field]`, s.field);
        url.searchParams.set(`sort[${i}][direction]`, s.direction || 'asc');
      });
    }
    if (params.fields) {
      params.fields.forEach((f, i) => url.searchParams.set(`fields[${i}]`, f));
    }

    const res = await fetchWithRetry(url.toString(), { headers: await authHeader() });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `wellbound-api error ${res.status}`);
    }

    const data = await res.json();
    records.push(...data.records);
    offset = data.offset || null;
  } while (offset);

  return records;
}

async function fetchOne(tableName, recordId) {
  const key = `${tableName}|one|${recordId}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const promise = (async () => {
    const res = await fetch(
      `${auroraBaseUrl()}/${encodeURIComponent(tableName)}/${recordId}`,
      { headers: await authHeader() }
    );
    if (!res.ok) throw new Error(`Record not found: ${recordId}`);
    return res.json();
  })();
  cacheSet(key, promise);
  return promise;
}

async function create(tableName, fields, { silent = false } = {}) {
  const res = await fetch(`${auroraBaseUrl()}/${encodeURIComponent(tableName)}`, {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.error?.message || 'Create failed';
    if (!silent) {
      try {
        // eslint-disable-next-line no-console
        console.error('[aurora.create] failed', {
          table: tableName,
          status: res.status,
          auroraError: err?.error || err,
          fields,
        });
      } catch {}
    }
    const error = new Error(`[${tableName}] ${msg}`);
    error.aurora = err?.error || err;
    error.table = tableName;
    error.fields = fields;
    throw error;
  }
  invalidateTable(tableName);
  return res.json();
}

async function update(tableName, recordId, fields) {
  const res = await fetch(
    `${auroraBaseUrl()}/${encodeURIComponent(tableName)}/${recordId}`,
    {
      method: 'PATCH',
      headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.error?.message || 'Update failed';
    try {
      // eslint-disable-next-line no-console
      console.error('[aurora.update] failed', {
        table: tableName,
        recordId,
        status: res.status,
        auroraError: err?.error || err,
        fields,
      });
    } catch {}
    const error = new Error(`[${tableName}] ${msg}`);
    error.aurora = err?.error || err;
    error.table = tableName;
    error.recordId = recordId;
    error.fields = fields;
    throw error;
  }
  invalidateTable(tableName);
  return res.json();
}

async function remove(tableName, recordId) {
  const res = await fetch(
    `${auroraBaseUrl()}/${encodeURIComponent(tableName)}/${recordId}`,
    { method: 'DELETE', headers: await authHeader() }
  );
  if (!res.ok) throw new Error('Delete failed');
  invalidateTable(tableName);
  return res.json();
}

const BATCH_SIZE = 10;

async function createBatch(tableName, recordsFields) {
  const results = [];
  const BASE_URL = auroraBaseUrl();
  for (let i = 0; i < recordsFields.length; i += BATCH_SIZE) {
    const chunk = recordsFields.slice(i, i + BATCH_SIZE);
    const res = await fetchWithRetry(`${BASE_URL}/${encodeURIComponent(tableName)}`, {
      method: 'POST',
      headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: chunk.map((fields) => ({ fields })) }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || 'Batch create failed');
    }
    const data = await res.json();
    results.push(...data.records);
  }
  invalidateTable(tableName);
  return results;
}

async function updateBatch(tableName, recordUpdates) {
  const results = [];
  const BASE_URL = auroraBaseUrl();
  for (let i = 0; i < recordUpdates.length; i += BATCH_SIZE) {
    const chunk = recordUpdates.slice(i, i + BATCH_SIZE);
    const res = await fetchWithRetry(`${BASE_URL}/${encodeURIComponent(tableName)}`, {
      method: 'PATCH',
      headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: chunk.map(({ id, fields }) => ({ id, fields })) }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || 'Batch update failed');
    }
    const data = await res.json();
    results.push(...data.records);
  }
  invalidateTable(tableName);
  return results;
}

// LEGACY export name — same client. Prefer importing default as `api` in new files.
export const airtable = {
  fetchAll, fetchOne, create, update, remove,
  createBatch, updateBatch,
};
export default airtable;
