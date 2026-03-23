// Dev:  calls Airtable directly (fast, uses token from .env)
// Prod: routes through Cloudflare Worker (no token exposed in browser)
const BASE_URL = import.meta.env.DEV
  ? `https://api.airtable.com/v0/${import.meta.env.VITE_AIRTABLE_BASE_ID}`
  : import.meta.env.VITE_AIRTABLE_WORKER_URL;

const TOKEN = import.meta.env.DEV ? import.meta.env.VITE_AIRTABLE_TOKEN : null;

function authHeader() {
  return TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
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

    const res = await fetchWithRetry(url.toString(), { headers: authHeader() });

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
    { headers: authHeader() }
  );
  if (!res.ok) throw new Error(`Record not found: ${recordId}`);
  return res.json();
}

async function create(tableName, fields) {
  const res = await fetch(`${BASE_URL}/${encodeURIComponent(tableName)}`, {
    method: 'POST',
    headers: { ...authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || 'Create failed');
  }
  return res.json();
}

async function update(tableName, recordId, fields) {
  const res = await fetch(
    `${BASE_URL}/${encodeURIComponent(tableName)}/${recordId}`,
    {
      method: 'PATCH',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || 'Update failed');
  }
  return res.json();
}

async function remove(tableName, recordId) {
  const res = await fetch(
    `${BASE_URL}/${encodeURIComponent(tableName)}/${recordId}`,
    { method: 'DELETE', headers: authHeader() }
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
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
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
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
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
