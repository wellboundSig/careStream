/**
 * worker-esper
 *
 * Proxies Esper MDM API calls from the browser so the Esper API key is never
 * exposed client-side.
 *
 * Required Worker Secret (Cloudflare dashboard → worker → Settings → Variables):
 *   ESPER_API_KEY — Esper Bearer token
 *
 * How routing works:
 *   In dev,  src/api/esper.js uses BASE = '/esper-proxy/api'
 *   In prod, src/api/esper.js uses BASE = VITE_ESPER_BASE (this worker URL)
 *
 *   The worker receives the path as-is and prepends the Esper base URL + /api:
 *     GET /v1/enterprise/{EID}/report/location/  →  https://ricct-api.esper.cloud/api/v1/enterprise/{EID}/report/location/
 *     GET /enterprise/{EID}/device/              →  https://ricct-api.esper.cloud/api/enterprise/{EID}/device/
 *
 *   POST requests are also supported — body and Content-Type are forwarded.
 *     POST /v0/enterprise/{EID}/command/         →  https://ricct-api.esper.cloud/api/v0/enterprise/{EID}/command/
 *
 * Consumers (origins) currently allowed:
 *   - https://wellboundcarestream.com               (CareStream CRM)
 *   - https://www.wellboundcarestream.com           (CareStream CRM www)
 *   - https://agency-agreement.wellboundcarestream.com  (Agency Agreement app)
 *   - http://localhost:5173                         (local Vite dev)
 */

const ESPER_API_BASE = 'https://ricct-api.esper.cloud/api';

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
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const url       = new URL(request.url);
    const targetUrl = ESPER_API_BASE + url.pathname + url.search;

    const init = {
      method: request.method,
      headers: {
        Authorization: `Bearer ${env.ESPER_API_KEY}`,
        'Content-Type': 'application/json',
      },
    };

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = await request.text();
    }

    const res = await fetch(targetUrl, init);

    const text = await res.text();
    return new Response(text, {
      status: res.status,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
  },
};
