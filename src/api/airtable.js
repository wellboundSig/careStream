// Backend selection (migration cutover flag — see the Airtable→Aurora plan):
//   VITE_API_URL set   → wellbound-api on AWS (Airtable-wire-compatible, backed
//                        by Aurora PostgreSQL). Used in BOTH dev and prod — no
//                        Airtable PAT ever ships in any bundle.
//   VITE_API_URL unset → legacy path: dev hits Airtable directly with the .env
//                        PAT; prod routes through the Cloudflare worker.
// Rollback = unset VITE_API_URL and rebuild.
const API_URL = import.meta.env.VITE_API_URL || null;

const BASE_URL = API_URL
  || (import.meta.env.DEV
    ? `https://api.airtable.com/v0/${import.meta.env.VITE_AIRTABLE_BASE_ID}`
    : import.meta.env.VITE_AIRTABLE_WORKER_URL);

const DEV_TOKEN = !API_URL && import.meta.env.DEV ? import.meta.env.VITE_AIRTABLE_TOKEN : null;

// Both wellbound-api and the Cloudflare worker require a Clerk session JWT.
// `window.Clerk` is the global the Clerk React SDK installs.
async function authHeader() {
  if (DEV_TOKEN) return { Authorization: `Bearer ${DEV_TOKEN}` };
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
  throw new Error('Airtable rate limit exceeded after retries');
}

async function fetchAll(tableName, params = {}) {
  const records = [];
  let offset = null;

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
      throw new Error(err?.error?.message || `Airtable error ${res.status}`);
    }

    const data = await res.json();
    records.push(...data.records);
    offset = data.offset || null;
  } while (offset);

  return records;
}

async function fetchOne(tableName, recordId) {
  const res = await fetch(
    `${BASE_URL}/${encodeURIComponent(tableName)}/${recordId}`,
    { headers: await authHeader() }
  );
  if (!res.ok) throw new Error(`Record not found: ${recordId}`);
  return res.json();
}

async function create(tableName, fields, { silent = false } = {}) {
  const res = await fetch(`${BASE_URL}/${encodeURIComponent(tableName)}`, {
    method: 'POST',
    headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.error?.message || 'Create failed';
    // `silent` lets callers that expect-and-handle a failure (e.g. the audit
    // log retrying without select-locked fields) skip the scary console noise.
    if (!silent) {
      try {
        // eslint-disable-next-line no-console
        console.error('[airtable.create] failed', {
          table: tableName,
          status: res.status,
          airtableError: err?.error || err,
          fields,
        });
      } catch {}
    }
    const error = new Error(`[${tableName}] ${msg}`);
    error.airtable = err?.error || err;
    error.table = tableName;
    error.fields = fields;
    throw error;
  }
  return res.json();
}

async function update(tableName, recordId, fields) {
  const res = await fetch(
    `${BASE_URL}/${encodeURIComponent(tableName)}/${recordId}`,
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
      console.error('[airtable.update] failed', {
        table: tableName,
        recordId,
        status: res.status,
        airtableError: err?.error || err,
        fields,
      });
    } catch {}
    const error = new Error(`[${tableName}] ${msg}`);
    error.airtable = err?.error || err;
    error.table = tableName;
    error.recordId = recordId;
    error.fields = fields;
    throw error;
  }
  return res.json();
}

async function remove(tableName, recordId) {
  const res = await fetch(
    `${BASE_URL}/${encodeURIComponent(tableName)}/${recordId}`,
    { method: 'DELETE', headers: await authHeader() }
  );
  if (!res.ok) throw new Error('Delete failed');
  return res.json();
}

// ── Batch operations (up to 10 records per call) ────────────────────────────

const BATCH_SIZE = 10;

async function createBatch(tableName, recordsFields) {
  const results = [];
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
  return results;
}

async function updateBatch(tableName, recordUpdates) {
  const results = [];
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
  return results;
}

export const airtable = {
  fetchAll, fetchOne, create, update, remove,
  createBatch, updateBatch,
};
export default airtable;
