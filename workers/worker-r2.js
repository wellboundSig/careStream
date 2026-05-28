/**
 * worker-r2
 *
 * Handles file uploads to (and reads from) Cloudflare R2 from the browser so
 * no R2 credentials are ever exposed client-side.
 *
 * Required R2 Bucket Binding (Cloudflare dashboard → worker → Settings → Bindings):
 *   Variable name: R2_BUCKET
 *   R2 Bucket:     wellbound
 *
 * Routes handled (mirrors what src/utils/r2Upload.js sends in production):
 *   PUT  /upload/{patientId}/{filename}  → stores file, returns { r2Key, r2Url }
 *   GET  /file/{r2Key…}                  → streams the stored file (proxy
 *                                           that works even when the R2
 *                                           bucket isn't configured for
 *                                           public reads)
 *   OPTIONS *                            → CORS preflight
 *
 * Files are stored at: CareStream/files/{patientId}/{timestamp}_{filename}
 * Read URL returned to the app: https://<worker>/file/{r2Key}
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
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function guessContentType(name) {
  const ext = (name || '').split('.').pop().toLowerCase();
  switch (ext) {
    case 'pdf':  return 'application/pdf';
    case 'png':  return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif':  return 'image/gif';
    case 'webp': return 'image/webp';
    case 'svg':  return 'image/svg+xml';
    case 'csv':  return 'text/csv';
    case 'txt':  return 'text/plain';
    case 'json': return 'application/json';
    case 'doc':
    case 'docx': return 'application/msword';
    case 'xls':
    case 'xlsx': return 'application/vnd.ms-excel';
    default:     return 'application/octet-stream';
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);

    // ── GET /file/<r2Key…> — proxy the file from R2 ────────────────────────
    // We accept either the canonical key with leading "CareStream/files/" or
    // a relative key (the worker prepends it). This lets the app store a
    // short, predictable URL while keeping the bucket fully private.
    const readMatch = url.pathname.match(/^\/file\/(.+)$/);
    if (readMatch && request.method === 'GET') {
      const r2Key = decodeURIComponent(readMatch[1]);
      const object = await env.R2_BUCKET.get(r2Key);
      if (!object || !object.body) {
        return new Response(JSON.stringify({ error: 'File not found' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
        });
      }
      const filename = r2Key.split('/').pop() || 'file';
      const contentType = object.httpMetadata?.contentType || guessContentType(filename);
      const headers = {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=300',
        ...corsHeaders(origin),
      };
      if (object.size) headers['Content-Length'] = String(object.size);
      // Honour ?download=1 to force a download (matches the Download button
      // in FilesTab / FilePreviewModal which sets `download={file_name}`).
      if (url.searchParams.get('download')) {
        headers['Content-Disposition'] = `attachment; filename="${filename}"`;
      }
      return new Response(object.body, { status: 200, headers });
    }

    // ── PUT /upload/{patientId}/{filename} — store the file ────────────────
    const uploadMatch = url.pathname.match(/^\/upload\/([^/]+)\/(.+)$/);

    if (!uploadMatch || request.method !== 'PUT') {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
      });
    }

    const patientId   = uploadMatch[1];
    const filename    = uploadMatch[2];
    const timestamp   = Date.now();
    const r2Key       = `CareStream/files/${patientId}/${timestamp}_${filename}`;
    const contentType = request.headers.get('Content-Type') || guessContentType(filename);

    await env.R2_BUCKET.put(r2Key, request.body, {
      httpMetadata: { contentType },
    });

    // Return a worker-proxied read URL so the file is always reachable even
    // when the R2 bucket is private. The worker base is determined by the
    // request so this works for local dev, staging, and production without
    // hardcoding a hostname.
    const workerBase = `${url.protocol}//${url.host}`;
    const r2Url = `${workerBase}/file/${r2Key}`;

    return new Response(JSON.stringify({ r2Key, r2Url }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    });
  },
};
