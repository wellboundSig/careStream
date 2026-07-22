/**
 * files-api — patient-document storage on S3, mirroring worker-r2's contract.
 *
 * Routes (behind the same API Gateway as wellbound-api):
 *   PUT  /upload/{ownerId}/{filename}          store under CareStream/files/{ownerId}/…   (JWT)
 *   PUT  /upload-tickets/{ticketKey}/{filename} store under Tickets/{ticketKey}/…          (JWT or internal key)
 *   GET  /sign?key={s3Key}[&download=1]        mint short-lived presigned GET               (JWT)
 *   Response shapes identical to worker-r2: { r2Key, url } / { url, expiresAt }
 *
 * Key strings are preserved verbatim from R2 (rclone copy keeps keys), so the
 * `Files.r2_key` column needs no data rewrite. The bucket is private
 * (SSE-KMS, public access blocked); reads are presigned-only. There is no
 * /file streaming route — S3 presigned URLs serve bytes directly over TLS,
 * which also removes Lambda from the download path (faster).
 *
 * Env: WB_BUCKET (wellbound-prod-store), INTERNAL_API_KEY (ticket uploads from
 * the field-support worker), SIGN_TTL_SECONDS (default 600).
 */

import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { authenticate } from './clerkJwt.js';

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-2' });
const BUCKET = process.env.WB_BUCKET || 'wellbound-prod-store';
const TTL = parseInt(process.env.SIGN_TTL_SECONDS || '600', 10);

const ALLOWED_ORIGINS = new Set([
  'https://wellboundcarestream.com',
  'https://www.wellboundcarestream.com',
  'https://support.wellboundcarestream.com',
  'https://field-support.wellboundcarestream.com',
  'http://localhost:5173',
  'http://localhost:5174',
]);

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : 'https://wellboundcarestream.com';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Internal-Key',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(statusCode, body, origin) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
    body: JSON.stringify(body),
  };
}

async function isAuthorized(event) {
  const key = event.headers?.['x-internal-key'] || event.headers?.['X-Internal-Key'];
  if (process.env.INTERNAL_API_KEY && key === process.env.INTERNAL_API_KEY) return true;
  return !!(await authenticate(event));
}

export async function handler(event) {
  // EventBridge warmer ping — keeps a container (and its JWKS cache) hot.
  if (event?.warmer) return { statusCode: 200, body: 'warm' };

  const origin = event.headers?.origin || event.headers?.Origin || '';
  const method = event.requestContext?.http?.method || 'GET';
  const rawPath = (event.rawPath || '/').replace(/^\/files/, ''); // optional mount prefix

  if (method === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(origin) };
  if (!(await isAuthorized(event))) return json(401, { error: 'Unauthorized' }, origin);

  // ── GET /sign?key=…[&download=1] ─────────────────────────────────────────
  if (method === 'GET' && rawPath === '/sign') {
    const key = event.queryStringParameters?.key;
    if (!key) return json(400, { error: 'key required' }, origin);
    // Fail fast if the object is missing — otherwise clients get a signed URL
    // that downloads S3/XML or worker JSON error bodies as "files".
    try {
      await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    } catch (err) {
      const code = err?.name || err?.Code || '';
      const status = err?.$metadata?.httpStatusCode;
      if (status === 404 || code === 'NotFound' || code === 'NoSuchKey') {
        return json(404, { error: 'Not found' }, origin);
      }
      throw err;
    }
    const download = ['1', 'true'].includes(event.queryStringParameters?.download || '');
    const filename = (key.split('/').pop() || 'file').replace(/"/g, '');
    const cmd = new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ResponseContentDisposition: `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
    });
    const url = await getSignedUrl(s3, cmd, { expiresIn: TTL });
    return json(200, { url, expiresAt: Date.now() + TTL * 1000 }, origin);
  }

  // ── PUT /upload/{id}/{filename} | /upload-tickets/{key}/{filename} ───────
  const ticketMatch = rawPath.match(/^\/upload-tickets\/([^/]+)\/(.+)$/);
  const fileMatch = rawPath.match(/^\/upload\/([^/]+)\/(.+)$/);
  const match = ticketMatch || fileMatch;

  if (match && method === 'PUT') {
    const id = decodeURIComponent(match[1]);
    const filename = decodeURIComponent(match[2]);
    const prefix = ticketMatch ? `Tickets/${id}` : `CareStream/files/${id}`;
    const rand = Math.random().toString(36).slice(2, 8);
    const key = `${prefix}/${Date.now()}_${rand}_${filename}`;
    const contentType = event.headers?.['content-type'] || 'application/octet-stream';
    const body = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64')
      : Buffer.from(event.body || '', 'utf8');

    await s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: key, Body: body, ContentType: contentType,
    }));

    // Mirror worker-r2's response: r2Key (the client persists this in the
    // Files table) + a ready-to-use signed URL.
    const url = await getSignedUrl(
      s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: TTL },
    );
    return json(200, { r2Key: key, url }, origin);
  }

  return json(404, { error: 'Not found' }, origin);
}
