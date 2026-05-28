// Cloudflare R2 upload via Worker
// The Worker handles auth — no R2 credentials are needed in the browser.
//
// Worker endpoint: VITE_R2_WORKER_URL (set in .env)
//   PUT /upload/{patientId}/{filename}  → stores file, returns { r2Key, r2Url }
//   GET /file/{r2Key…}                  → streams the stored file
//
// Bucket:  wellbound
// Folder:  CareStream/files/{patientId}/{timestamp_filename}
//
// Read URL: the worker now proxies reads through GET /file/{r2Key}. We no
// longer rely on the bucket being public, which means files keep working
// even if the bucket's anonymous read access is disabled.

const R2_PUBLIC_BASE = 'https://pub-d7fda00c74254211bfe47adcb51427b0.r2.dev';

export async function uploadToR2(file, patientId) {
  const workerUrl = import.meta.env.VITE_R2_WORKER_URL;

  if (!workerUrl) {
    throw new Error(
      'R2 Worker URL is not configured.\n' +
      'Add VITE_R2_WORKER_URL to your .env file.'
    );
  }

  const safeName   = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
  const fileBuffer = await file.arrayBuffer();
  const contentType = file.type || 'application/octet-stream';

  const response = await fetch(
    `${workerUrl}/upload/${patientId}/${safeName}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: fileBuffer,
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `R2 upload failed (${response.status})`);
  }

  return response.json(); // { r2Key, r2Url }
}

/**
 * Build a readable URL for a file row. Prefers the worker-proxied GET route
 * (works even when the bucket is private). Falls back to whatever `r2_url`
 * the legacy record carries when neither the worker base nor an r2_key is
 * available — this is mostly for tests / read-only mocks.
 *
 * @param {{ r2_key?: string, r2_url?: string }} file
 * @param {{ download?: boolean }} [opts]
 */
export function resolveFileUrl(file, opts = {}) {
  if (!file) return '';
  const workerBase = import.meta.env.VITE_R2_WORKER_URL;
  const r2Key = file.r2_key && String(file.r2_key).trim();
  if (workerBase && r2Key) {
    const encoded = r2Key
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    const suffix = opts.download ? '?download=1' : '';
    return `${workerBase.replace(/\/$/, '')}/file/${encoded}${suffix}`;
  }
  // Best-effort fallback: rewrite the legacy public R2 URL so the worker
  // still serves it when the bucket isn't public. Same idea, just inferred
  // from the historical URL when we don't have r2_key handy.
  const legacy = (file.r2_url || '').replace(/[<>\n]/g, '').trim();
  if (workerBase && legacy.startsWith(`${R2_PUBLIC_BASE}/`)) {
    const key = legacy.slice(R2_PUBLIC_BASE.length + 1);
    const encoded = key
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    const suffix = opts.download ? '?download=1' : '';
    return `${workerBase.replace(/\/$/, '')}/file/${encoded}${suffix}`;
  }
  return legacy;
}
