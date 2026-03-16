// Cloudflare R2 upload via Worker
// The Worker handles auth — no R2 credentials are needed in the browser.
//
// Worker endpoint: VITE_R2_WORKER_URL (set in .env)
//   PUT /upload/{patientId}/{filename}  → stores file, returns { r2Key, r2Url }
//
// Bucket:  wellbound
// Folder:  CareStream/files/{patientId}/{timestamp_filename}
// Public:  https://pub-d7fda00c74254211bfe47adcb51427b0.r2.dev/{key}

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
