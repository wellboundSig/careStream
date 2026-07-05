// Private file storage access (uploads + short-lived signed read URLs).
//
// Backend selection (migration cutover flag):
//   VITE_FILES_API_URL set   → files-api on AWS (S3 presigned URLs; same
//                              wire contract as worker-r2). Preferred.
//   VITE_FILES_API_URL unset → legacy Cloudflare worker-r2 (VITE_R2_WORKER_URL).
//
// Either way the store is PRIVATE — no public object URLs. Uploads require a
// Clerk session JWT; reads go through short-lived signed URLs minted by /sign
// (also JWT-gated). Signed URLs work in <img>/<iframe>/window.open unheadered.
//
// Contract (identical on both backends):
//   PUT /upload/{patientId}/{filename}   → { r2Key, url }
//   GET /sign?key={r2Key}[&download=1]   → { url, expiresAt }

function filesBase() {
  return import.meta.env.VITE_FILES_API_URL || import.meta.env.VITE_R2_WORKER_URL;
}

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
  const workerUrl = filesBase();
  if (!workerUrl) {
    throw new Error('File storage URL is not configured.\nAdd VITE_FILES_API_URL (AWS) or VITE_R2_WORKER_URL to your .env file.');
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
  const workerUrl = filesBase();
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
