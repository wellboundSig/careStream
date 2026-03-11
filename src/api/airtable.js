const BASE_URL = `https://api.airtable.com/v0/${import.meta.env.VITE_AIRTABLE_BASE_ID}`;
const TOKEN = import.meta.env.VITE_AIRTABLE_TOKEN;

function headers() {
  return { Authorization: `Bearer ${TOKEN}` };
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

    const res = await fetch(url.toString(), { headers: headers() });

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
    { headers: headers() }
  );
  if (!res.ok) throw new Error(`Record not found: ${recordId}`);
  return res.json();
}

async function create(tableName, fields) {
  const res = await fetch(`${BASE_URL}/${encodeURIComponent(tableName)}`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
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
      headers: { ...headers(), 'Content-Type': 'application/json' },
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
    { method: 'DELETE', headers: headers() }
  );
  if (!res.ok) throw new Error('Delete failed');
  return res.json();
}

export const airtable = { fetchAll, fetchOne, create, update, remove };
export default airtable;
