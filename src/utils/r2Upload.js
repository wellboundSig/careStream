// Cloudflare R2 access via the (private) worker.
//
// The bucket is PRIVATE — there are no public object URLs. Uploads require a
// Clerk session JWT, and reads go through short-lived HMAC-signed URLs minted
// by the worker's /sign endpoint (which also requires a Clerk JWT). The signed
// URL works in <img>/<iframe>/window.open without any header.
//
// Worker endpoint: VITE_R2_WORKER_URL
//   PUT /upload/{patientId}/{filename}   → { r2Key, url }
//   GET /sign?key={r2Key}[&download=1]   → { url, expiresAt }

async function clerkToken() {
  try {
    return (typeof window !== 'undefined' && window.Clerk?.session)
      ? await window.Clerk.session.getToken()
      : null;
  } catch {
    return null;
  }
}

export async function uploadToR2(file, patientId) {
  const workerUrl = import.meta.env.VITE_R2_WORKER_URL;
  if (!workerUrl) {
    throw new Error('R2 Worker URL is not configured.\nAdd VITE_R2_WORKER_URL to your .env file.');
  }

  const safeName    = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
  const fileBuffer  = await file.arrayBuffer();
  const contentType = file.type || 'application/octet-stream';
  const token       = await clerkToken();

  const response = await fetch(
    `${workerUrl}/upload/${patientId}/${safeName}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: fileBuffer,
    },
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `R2 upload failed (${response.status})`);
  }

  return response.json(); // { r2Key, url }
}

/**
 * Mint a short-lived signed URL for a stored file row. Returns '' when there's
 * no `r2_key` (legacy rows that only have the dead public `r2_url` can't be
 * signed and must be re-uploaded).
 *
 * @param {object} file  a Files row ({ r2_key, file_name, ... })
 * @param {{ download?: boolean }} [opts]  download=true → Content-Disposition attachment
 */
export async function getSignedFileUrl(file, { download = false } = {}) {
  const key = file?.r2_key && String(file.r2_key).trim();
  if (!key) return '';
  const workerUrl = import.meta.env.VITE_R2_WORKER_URL;
  if (!workerUrl) return '';

  const token = await clerkToken();
  const res = await fetch(
    `${workerUrl}/sign?key=${encodeURIComponent(key)}${download ? '&download=1' : ''}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
  if (!res.ok) return '';
  const data = await res.json().catch(() => ({}));
  return data.url || '';
}

/** Fetch a signed URL and open/download it (for click handlers). */
export async function openSignedFile(file, { download = false } = {}) {
  const url = await getSignedFileUrl(file, { download });
  if (url) window.open(url, '_blank', 'noopener');
  return url;
}
