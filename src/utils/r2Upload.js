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
// Contract:
//   GET  /sign?presign=1&ownerId=&filename=   → { r2Key, uploadUrl }  (files-api)
//   PUT  uploadUrl (S3, browser-direct)       → 200
//   PUT  /upload/{ownerId}/{filename}         → { r2Key, url }       (legacy / workers)
//   GET  /sign?key={r2Key}[&download=1]       → { url, expiresAt }

/** API Gateway / Lambda proxy uploads die around 6 MB (base64-inflated). */
export const LAMBDA_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
/** Single PUT to S3; large enough for scanned packets, small enough to keep UX sane. */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

function filesBase() {
  return (import.meta.env.VITE_FILES_API_URL || import.meta.env.VITE_R2_WORKER_URL || '').replace(/\/$/, '');
}

function usesFilesApi() {
  return !!import.meta.env.VITE_FILES_API_URL;
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

export function safeUploadFilename(name) {
  return String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase() || 'file';
}

export function resolveUploadOwnerId(patientOrId) {
  if (patientOrId == null) return '';
  if (typeof patientOrId === 'string' || typeof patientOrId === 'number') {
    return String(patientOrId).trim();
  }
  const raw = patientOrId.id ?? patientOrId.patient_id ?? patientOrId._id;
  if (Array.isArray(raw)) return String(raw[0] || '').trim();
  return String(raw || '').trim();
}

function networkUploadError(err, { large = false } = {}) {
  const msg = err?.message || 'Upload failed';
  if (!/failed to fetch|networkerror|load failed/i.test(msg)) return msg;
  return large
    ? 'Upload failed before the server responded. This usually means the file is too large for the upload path — try a smaller file or contact your administrator.'
    : 'Upload failed before the server responded (network or browser security). Check your connection and try again.';
}

async function readErrorMessage(response, fallback) {
  const err = await response.json().catch(() => ({}));
  return err.error || err.message || fallback;
}

async function requestPresignedUpload({ workerUrl, ownerId, safeName, contentType, token, scope }) {
  const params = [
    'presign=1',
    `ownerId=${encodeURIComponent(ownerId)}`,
    `filename=${encodeURIComponent(safeName)}`,
    `contentType=${encodeURIComponent(contentType)}`,
  ];
  if (scope === 'tickets') params.push('scope=tickets');
  let response;
  try {
    response = await fetch(`${workerUrl}/sign?${params.join('&')}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch (err) {
    throw new Error(networkUploadError(err));
  }
  if (!response.ok) return null;
  const data = await response.json().catch(() => ({}));
  if (!data.uploadUrl || !data.r2Key) return null;
  return data;
}

async function putToS3(uploadUrl, file, contentType) {
  let response;
  try {
    response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: file,
    });
  } catch (err) {
    throw new Error(networkUploadError(err));
  }
  if (!response.ok) {
    throw new Error(`Storage upload failed (${response.status})`);
  }
}

async function proxyUpload({ workerUrl, ownerId, safeName, file, contentType, token, ticket }) {
  const fileBuffer = await file.arrayBuffer();
  const path = ticket
    ? `/upload-tickets/${encodeURIComponent(ownerId)}/${encodeURIComponent(safeName)}`
    : `/upload/${encodeURIComponent(ownerId)}/${encodeURIComponent(safeName)}`;
  let response;
  try {
    response = await fetch(`${workerUrl}${path}`, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: fileBuffer,
    });
  } catch (err) {
    throw new Error(networkUploadError(err, { large: file.size > LAMBDA_UPLOAD_MAX_BYTES }));
  }

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, `Upload failed (${response.status})`));
  }

  return response.json(); // { r2Key, url }
}

/**
 * Upload a file for a patient (or other owner prefix such as issue-reports/…).
 * Returns `{ r2Key, url }` — `url` is a short-lived signed GET when available.
 */
export async function uploadToR2(file, patientId) {
  const workerUrl = filesBase();
  if (!workerUrl) {
    throw new Error('File storage URL is not configured.\nAdd VITE_FILES_API_URL (AWS) or VITE_R2_WORKER_URL to your .env file.');
  }

  const ownerId = resolveUploadOwnerId(patientId);
  if (!ownerId) {
    throw new Error('Cannot upload: this record is missing a patient id.');
  }
  if (!file) throw new Error('No file selected.');
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`"${file.name}" is larger than 100 MB. Compress it or split it into smaller files.`);
  }

  const safeName = safeUploadFilename(file.name);
  const contentType = file.type || 'application/octet-stream';
  const token = await clerkToken();

  if (usesFilesApi()) {
    const presigned = await requestPresignedUpload({
      workerUrl, ownerId, safeName, contentType, token,
    });
    if (presigned) {
      await putToS3(presigned.uploadUrl, file, contentType);
      const url = await getSignedFileUrl({ r2_key: presigned.r2Key }, { download: false });
      return { r2Key: presigned.r2Key, url, r2Url: url };
    }
    if (file.size > LAMBDA_UPLOAD_MAX_BYTES) {
      throw new Error(
        `"${file.name}" is too large to upload through the server path. Ask an administrator to enable direct storage uploads, or use a file under 5 MB.`,
      );
    }
  }

  const data = await proxyUpload({ workerUrl, ownerId, safeName, file, contentType, token });
  return { r2Key: data.r2Key, url: data.url || data.r2Url || '', r2Url: data.r2Url || data.url || '' };
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
