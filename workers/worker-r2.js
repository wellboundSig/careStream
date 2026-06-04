/**
 * worker-r2
 *
 * Handles file uploads to Cloudflare R2 from the browser so no R2 credentials
 * are ever exposed client-side.
 *
 * Required R2 Bucket Binding (Cloudflare dashboard → worker → Settings → Bindings):
 *   Variable name: R2_BUCKET
 *   R2 Bucket:     wellbound
 *
 * Routes handled (mirrors what src/utils/r2Upload.js sends in production):
 *   PUT  /upload/{patientId}/{filename}          → CareStream/files/{patientId}/{ts}_{file}
 *   PUT  /upload-tickets/{ticketKey}/{filename}  → Tickets/{ticketKey}/{ts}_{file}  (support app)
 *   OPTIONS *                                    → CORS preflight
 * Both return { r2Key, r2Url }.
 *
 * Public read URL: https://pub-d7fda00c74254211bfe47adcb51427b0.r2.dev/{r2Key}
 */

const ALLOWED_ORIGINS = [
  'https://wellboundcarestream.com',
  'https://www.wellboundcarestream.com',
  'https://support.wellboundcarestream.com',
  'http://localhost:5173',
];

const R2_PUBLIC_BASE = 'https://pub-d7fda00c74254211bfe47adcb51427b0.r2.dev';

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'PUT, OPTIONS',
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

    // CareStream files: /upload/{patientId}/{filename}
    // Support tickets:  /upload-tickets/{ticketKey}/{filename}
    const ticketMatch = url.pathname.match(/^\/upload-tickets\/([^/]+)\/(.+)$/);
    const fileMatch   = url.pathname.match(/^\/upload\/([^/]+)\/(.+)$/);
    const match       = ticketMatch || fileMatch;

    if (!match || request.method !== 'PUT') {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    const id          = match[1];
    const filename    = match[2];
    const timestamp   = Date.now();
    const prefix      = ticketMatch ? `Tickets/${id}` : `CareStream/files/${id}`;
    const r2Key       = `${prefix}/${timestamp}_${filename}`;
    const contentType = request.headers.get('Content-Type') || 'application/octet-stream';

    await env.R2_BUCKET.put(r2Key, request.body, {
      httpMetadata: { contentType },
    });

    const r2Url = `${R2_PUBLIC_BASE}/${r2Key}`;

    return new Response(JSON.stringify({ r2Key, r2Url }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
  },
};
