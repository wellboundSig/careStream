/**
 * worker-airtable
 *
 * Proxies all Airtable REST API calls from the browser through this worker
 * so the Airtable PAT is never exposed in the client bundle.
 *
 * Required Worker Secrets (set in Cloudflare dashboard → worker → Settings → Variables):
 *   AIRTABLE_TOKEN   — Airtable Personal Access Token (pat...)
 *   AIRTABLE_BASE_ID — Airtable Base ID (appr7CZdBQ966kwvL)
 *
 * Routes handled (mirrors what src/api/airtable.js sends in production):
 *   GET    /{table}              → list records (with query params forwarded)
 *   GET    /{table}/{recordId}   → fetch one record
 *   POST   /{table}              → create record
 *   PATCH  /{table}/{recordId}   → update record
 *   DELETE /{table}/{recordId}   → delete record
 *   OPTIONS *                    → CORS preflight
 */

const ALLOWED_ORIGINS = [
  'https://wellboundcarestream.com',
  'https://www.wellboundcarestream.com',
  'http://localhost:5173',
];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);
    const parts = url.pathname.replace(/^\//, '').split('/').filter(Boolean);

    if (!parts.length) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    const tableName = decodeURIComponent(parts[0]);
    const recordId  = parts[1] ? decodeURIComponent(parts[1]) : null;

    let airtableUrl = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${encodeURIComponent(tableName)}`;
    if (recordId) airtableUrl += `/${recordId}`;

    // Forward all query params (filterByFormula, sort, fields, offset, maxRecords, etc.)
    if (request.method === 'GET') {
      const qs = url.searchParams.toString();
      if (qs) airtableUrl += `?${qs}`;
    }

    const hasBody = ['POST', 'PATCH', 'PUT'].includes(request.method);

    const res = await fetch(airtableUrl, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: hasBody ? request.body : undefined,
    });

    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
  },
};
