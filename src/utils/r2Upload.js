// Cloudflare R2 upload via Worker
// The Worker handles auth — no R2 credentials are needed in the browser.
//
// Worker endpoint: VITE_R2_WORKER_URL (set in .env)
//   PUT /upload/{patientId}/{filename}  → stores file, returns { r2Key, r2Url }
//
// Bucket:  wellbound
// Folder:  CareStream/files/{patientId}/{timestamp_filename}
// Public:  https://pub-d7fda00c74254211bfe47adcb51427b0.r2.dev/{key}

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
 * Build a public R2 URL for a stored file row.
 *
 * IMPORTANT: the `r2_url` column in Airtable is type `richText`, which means
 * Airtable serialises every write through a markdown round-trip. Underscores,
 * asterisks, and other markdown control chars get backslash-escaped on the
 * way back out (`foo_bar` → `foo\_bar`), which produces 404s when the URL is
 * fetched literally by the browser.
 *
 * The `r2_key` column is `multilineText`, so it stores cleanly. Prefer
 * reconstructing the public URL from the key; only fall back to `r2_url`
 * (with the escapes stripped) when the key is missing on legacy rows.
 */
export function fileToUrl(file) {
  if (!file) return '';
  const key = file.r2_key && String(file.r2_key).trim();
  if (key) return `${R2_PUBLIC_BASE}/${key}`;
  // Strip markdown backslash-escapes and any trailing whitespace/newline
  // from the legacy richText value.
  return (file.r2_url || '')
    .replace(/\\([\\_*[\](){}#+\-.!`])/g, '$1')
    .replace(/[<>\n\r]/g, '')
    .trim();
}
