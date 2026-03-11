// Cloudflare R2 upload via S3-compatible API
// Uses WebCrypto (built into all modern browsers — no external dependencies)
//
// Bucket:  wellbound
// Folder:  CareStream/files/{patientId}/{timestamp_filename}
// Endpoint: https://1e5002695c128115aa85aa46e7c87d5c.r2.cloudflarestorage.com/wellbound/{key}
// Public:   https://pub-d7fda00c74254211bfe47adcb51427b0.r2.dev/{key}
//
// Required .env vars:
//   VITE_R2_ACCOUNT_ID      — 1e5002695c128115aa85aa46e7c87d5c
//   VITE_R2_BUCKET_NAME     — wellbound
//   VITE_R2_FOLDER          — CareStream
//   VITE_R2_ACCESS_KEY_ID   — from Cloudflare R2 → Manage API Tokens
//   VITE_R2_SECRET_ACCESS_KEY

// ── WebCrypto helpers ─────────────────────────────────────────────────────────

async function sha256Hex(data) {
  const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(key, data) {
  const keyMaterial = key instanceof ArrayBuffer || ArrayBuffer.isView(key)
    ? key
    : new TextEncoder().encode(key);
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyMaterial, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function deriveSigningKey(secretKey, datestamp, region, service) {
  const k1 = await hmac(`AWS4${secretKey}`, datestamp);
  const k2 = await hmac(k1, region);
  const k3 = await hmac(k2, service);
  return hmac(k3, 'aws4_request');
}

// ── Main upload function ──────────────────────────────────────────────────────

export async function uploadToR2(file, patientId) {
  const accountId  = import.meta.env.VITE_R2_ACCOUNT_ID;
  const bucket     = import.meta.env.VITE_R2_BUCKET_NAME  || 'wellbound';
  const folder     = import.meta.env.VITE_R2_FOLDER       || 'CareStream';
  const accessKeyId = import.meta.env.VITE_R2_ACCESS_KEY_ID;
  const secretKey   = import.meta.env.VITE_R2_SECRET_ACCESS_KEY;
  const publicBase  = import.meta.env.VITE_R2_PUBLIC_URL;

  if (!accountId || !accessKeyId || !secretKey) {
    throw new Error(
      'R2 upload credentials are not configured.\n' +
      'Add VITE_R2_ACCESS_KEY_ID and VITE_R2_SECRET_ACCESS_KEY to your .env file.\n' +
      'Generate them in Cloudflare Dashboard → R2 → Manage API Tokens.'
    );
  }

  // ── Build the R2 object key ──────────────────────────────────────────────
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
  const r2Key    = `${folder}/files/${patientId}/${Date.now()}_${safeName}`;
  const host     = `${accountId}.r2.cloudflarestorage.com`;
  const endpoint = `https://${host}/${bucket}/${r2Key}`;
  const publicUrl = `${publicBase}/${r2Key}`;

  // ── Prepare payload ──────────────────────────────────────────────────────
  const fileBuffer  = await file.arrayBuffer();
  const contentType = file.type || 'application/octet-stream';
  const payloadHash = await sha256Hex(fileBuffer);

  // ── Timestamps ───────────────────────────────────────────────────────────
  const now      = new Date();
  const datestamp = now.toISOString().slice(0, 10).replace(/-/g, '');          // 20260310
  const amzdate   = now.toISOString().replace(/[:-]/g, '').replace(/\.\d+Z/, 'Z'); // 20260310T120000Z

  // ── SigV4 canonical request ──────────────────────────────────────────────
  const region  = 'auto';
  const service = 's3';

  const canonicalUri     = `/${bucket}/${r2Key}`;
  const canonicalQuery   = '';
  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzdate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [
    'PUT',
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  // ── String to sign ───────────────────────────────────────────────────────
  const credentialScope  = `${datestamp}/${region}/${service}/aws4_request`;
  const canonicalReqHash = await sha256Hex(canonicalRequest);
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzdate,
    credentialScope,
    canonicalReqHash,
  ].join('\n');

  // ── Signature ────────────────────────────────────────────────────────────
  const signingKey  = await deriveSigningKey(secretKey, datestamp, region, service);
  const signature   = toHex(await hmac(signingKey, stringToSign));
  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  // ── Upload ───────────────────────────────────────────────────────────────
  const response = await fetch(endpoint, {
    method: 'PUT',
    headers: {
      'Authorization':          authorization,
      'Content-Type':           contentType,
      'x-amz-content-sha256':  payloadHash,
      'x-amz-date':             amzdate,
    },
    body: fileBuffer,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => response.statusText);
    if (response.status === 403) {
      throw new Error(
        'R2 upload denied (403 Forbidden). Check that your API token has Object Write ' +
        `permission on the "${bucket}" bucket, and that CORS allows PUT from this origin.`
      );
    }
    throw new Error(`R2 upload failed (${response.status}): ${text}`);
  }

  return { r2Key, r2Url: publicUrl };
}

// ── CORS reminder (for Cloudflare dashboard) ─────────────────────────────────
// In Cloudflare R2 → wellbound → Settings → CORS Policy, add:
// [
//   {
//     "AllowedOrigins": ["http://localhost:5173", "https://your-production-domain.com"],
//     "AllowedMethods": ["PUT", "GET"],
//     "AllowedHeaders": ["*"],
//     "ExposeHeaders": ["ETag"],
//     "MaxAgeSeconds": 3600
//   }
// ]
