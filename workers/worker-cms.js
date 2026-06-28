/**
 * worker-cms
 *
 * CORS-safe read-only proxy for the two FREE, key-less CMS provider datasets
 * used by the physician verification feature. Neither upstream sends browser
 * CORS headers, so the SPA cannot call them directly in production.
 *
 * No secrets required — both upstreams are public.
 *
 * Routing (path prefix → upstream base):
 *   /npi/...   →  https://npiregistry.cms.hhs.gov/api/...      (NPPES NPI Registry)
 *   /data/...  →  https://data.cms.gov/data-api/v1/...         (Order & Referring dataset)
 *
 * Examples:
 *   GET /npi/?version=2.1&number=1234567890
 *       → https://npiregistry.cms.hhs.gov/api/?version=2.1&number=1234567890
 *   GET /data/dataset/c99b5865-1119-4436-bb80-c5af2773ea1f/data?filter[...]=...
 *       → https://data.cms.gov/data-api/v1/dataset/c99b5865-.../data?filter[...]=...
 *
 * How routing works in the app:
 *   In dev,  src/api/cms.js uses BASE = '/cms-proxy'        (Vite dev proxy)
 *   In prod, src/api/cms.js uses BASE = VITE_CMS_WORKER_URL (this worker URL)
 *
 * Deploy:  npx wrangler deploy workers/worker-cms.js
 */

const UPSTREAM = {
  '/npi': 'https://npiregistry.cms.hhs.gov/api',
  '/data': 'https://data.cms.gov/data-api/v1',
};

const ALLOWED_ORIGINS = [
  'https://wellboundcarestream.com',
  'https://www.wellboundcarestream.com',
  'https://agency-agreement.wellboundcarestream.com',
  'https://support.wellboundcarestream.com',
  'https://field-support.wellboundcarestream.com',
  'http://localhost:5173',
  'http://localhost:5174',
];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(status, body, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json(405, { error: 'Only GET is supported' }, origin);
    }

    const url = new URL(request.url);

    // Longest-prefix match so '/npi' and '/data' route to distinct upstreams.
    let base = null;
    let prefix = null;
    for (const p of Object.keys(UPSTREAM)) {
      if (url.pathname === p || url.pathname.startsWith(`${p}/`)) {
        base = UPSTREAM[p];
        prefix = p;
        break;
      }
    }
    if (!base) {
      return json(404, { error: 'Unknown CMS proxy path. Use /npi/... or /data/...' }, origin);
    }

    const rest = url.pathname.slice(prefix.length); // keeps leading '/'
    const targetUrl = `${base}${rest}${url.search}`;

    try {
      const res = await fetch(targetUrl, {
        method: 'GET',
        headers: { Accept: 'application/json', 'User-Agent': 'CareStream/1.0' },
      });
      const text = await res.text();
      return new Response(text, {
        status: res.status,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    } catch (err) {
      return json(502, { error: `Upstream fetch failed: ${err.message}` }, origin);
    }
  },
};
