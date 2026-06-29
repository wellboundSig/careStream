/**
 * worker-r2
 *
 * Private file storage for CareStream PHI documents (F2F, MD orders, auth
 * letters, etc.). The R2 bucket is PRIVATE — there are no public object URLs.
 *
 *   PUT /upload/{patientId}/{filename}          → store file (Clerk JWT required)
 *   PUT /upload-tickets/{ticketKey}/{filename}  → store ticket file (Clerk JWT required)
 *   GET /sign?key={r2Key}[&download=1]          → mint a short-lived signed URL (Clerk JWT required)
 *   GET /file/{r2Key}?exp={ms}&sig={hmac}       → stream the object (signature IS the capability)
 *   OPTIONS *                                   → CORS preflight
 *
 * Required Worker config (Settings → Variables and Secrets):
 *   R2_BUCKET          — R2 bucket binding ("wellbound")
 *   R2_SIGNING_SECRET  — secret used to HMAC-sign read URLs
 *   CLERK_ISSUER       — Clerk Frontend API origin (JWT verification)
 *   REQUIRE_AUTH       — "false" disables auth (rollout kill-switch); default ON
 *
 * Deploy:  npx wrangler deploy -c workers/wrangler-r2.toml
 * Also: disable the bucket's public r2.dev access in the Cloudflare dashboard.
 */

import { requireClerkAuth } from './clerkAuth.js';

const ALLOWED_ORIGINS = [
  'https://wellboundcarestream.com',
  'https://www.wellboundcarestream.com',
  'https://support.wellboundcarestream.com',
  'https://field-support.wellboundcarestream.com',
  'http://localhost:5173',
  'http://localhost:5174',
];

const SIGNED_URL_TTL_MS = 10 * 60 * 1000; // 10 minutes

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time-ish hex string comparison.
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    // ── GET /file/{key}?exp&sig — capability URL, no Clerk needed ──────────
    const fileMatch = url.pathname.match(/^\/file\/(.+)$/);
    if (fileMatch && request.method === 'GET') {
      if (!env.R2_SIGNING_SECRET) return json(500, { error: 'Signing not configured' }, origin);
      const key = decodeURIComponent(fileMatch[1]);
      const exp = url.searchParams.get('exp') || '';
      const sig = url.searchParams.get('sig') || '';
      const dl = url.searchParams.get('dl') === '1';

      if (!exp || !sig) return json(403, { error: 'Missing signature' }, origin);
      if (Date.now() > Number(exp)) return json(403, { error: 'Link expired' }, origin);
      const expected = await hmacHex(env.R2_SIGNING_SECRET, `${key}\n${exp}`);
      if (!safeEqual(sig, expected)) return json(403, { error: 'Bad signature' }, origin);

      const obj = await env.R2_BUCKET.get(key);
      if (!obj) return json(404, { error: 'Not found' }, origin);

      const filename = key.split('/').pop() || 'file';
      const headers = {
        'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
        'Cache-Control': 'private, max-age=300',
        'Content-Disposition': `${dl ? 'attachment' : 'inline'}; filename="${filename.replace(/"/g, '')}"`,
        ...corsHeaders(origin),
      };
      return new Response(obj.body, { status: 200, headers });
    }

    // ── GET /sign?key=...&download= — mint a signed URL (Clerk JWT required) ─
    if (url.pathname === '/sign' && request.method === 'GET') {
      const unauthorized = await requireClerkAuth(request, env, corsHeaders(origin));
      if (unauthorized) return unauthorized;
      if (!env.R2_SIGNING_SECRET) return json(500, { error: 'Signing not configured' }, origin);

      const key = url.searchParams.get('key');
      if (!key) return json(400, { error: 'key required' }, origin);
      const download = url.searchParams.get('download') === '1' || url.searchParams.get('download') === 'true';

      const exp = Date.now() + SIGNED_URL_TTL_MS;
      const sig = await hmacHex(env.R2_SIGNING_SECRET, `${key}\n${exp}`);
      const signedUrl = `${url.origin}/file/${encodeURIComponent(key)}?exp=${exp}&sig=${sig}${download ? '&dl=1' : ''}`;
      return json(200, { url: signedUrl, expiresAt: exp }, origin);
    }

    // ── PUT uploads — Clerk JWT required ──────────────────────────────────
    const ticketMatch = url.pathname.match(/^\/upload-tickets\/([^/]+)\/(.+)$/);
    const uploadMatch = url.pathname.match(/^\/upload\/([^/]+)\/(.+)$/);
    const match = ticketMatch || uploadMatch;

    if (match && request.method === 'PUT') {
      const unauthorized = await requireClerkAuth(request, env, corsHeaders(origin));
      if (unauthorized) return unauthorized;

      const id = match[1];
      const filename = match[2];
      const timestamp = Date.now();
      const prefix = ticketMatch ? `Tickets/${id}` : `CareStream/files/${id}`;
      // Add randomness so object keys aren't guessable/enumerable.
      const rand = Math.random().toString(36).slice(2, 8);
      const r2Key = `${prefix}/${timestamp}_${rand}_${filename}`;
      const contentType = request.headers.get('Content-Type') || 'application/octet-stream';

      await env.R2_BUCKET.put(r2Key, request.body, { httpMetadata: { contentType } });

      // Return a ready-to-use signed URL alongside the key (private bucket — no
      // public URL exists). Callers persist `r2Key` and fetch fresh signed URLs
      // on demand via /sign.
      let signedUrl = '';
      if (env.R2_SIGNING_SECRET) {
        const exp = Date.now() + SIGNED_URL_TTL_MS;
        const sig = await hmacHex(env.R2_SIGNING_SECRET, `${r2Key}\n${exp}`);
        signedUrl = `${url.origin}/file/${encodeURIComponent(r2Key)}?exp=${exp}&sig=${sig}`;
      }
      return json(200, { r2Key, url: signedUrl }, origin);
    }

    return json(404, { error: 'Not found' }, origin);
  },
};
