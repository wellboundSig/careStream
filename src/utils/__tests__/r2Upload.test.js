import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LAMBDA_UPLOAD_MAX_BYTES,
  resolveUploadOwnerId,
  safeUploadFilename,
  uploadToR2,
} from '../r2Upload.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('safeUploadFilename', () => {
  it('strips spaces and punctuation', () => {
    expect(safeUploadFilename('Hari Achary F2F.pdf')).toBe('hari_achary_f2f.pdf');
  });
});

describe('resolveUploadOwnerId', () => {
  it('accepts a bare id string', () => {
    expect(resolveUploadOwnerId(' pat_123 ')).toBe('pat_123');
  });

  it('reads patient.id and falls back to linked / record ids', () => {
    expect(resolveUploadOwnerId({ id: 'pat_1' })).toBe('pat_1');
    expect(resolveUploadOwnerId({ patient_id: ['pat_2'] })).toBe('pat_2');
    expect(resolveUploadOwnerId({})).toBe('');
  });
});

describe('uploadToR2', () => {
  const file = new File(['hello-pdf'], 'Hari Chart.pdf', { type: 'application/pdf' });

  beforeEach(() => {
    vi.stubEnv('VITE_FILES_API_URL', 'https://files.test/files');
    vi.stubEnv('VITE_R2_WORKER_URL', '');
    vi.stubGlobal('fetch', vi.fn());
    vi.stubGlobal('Clerk', { session: { getToken: vi.fn(async () => 'tok') } });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('presigns then PUTs the file to S3 with an encoded owner id', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({
        r2Key: 'CareStream/files/Hari Achary/1_abc_hari_chart.pdf',
        uploadUrl: 'https://s3.test/put',
      }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(jsonResponse({ url: 'https://s3.test/get' }));

    const result = await uploadToR2(file, 'Hari Achary');

    const presignUrl = String(fetch.mock.calls[0][0]);
    expect(presignUrl).toContain('/sign?');
    expect(presignUrl).toContain('ownerId=Hari%20Achary');
    expect(fetch.mock.calls[1][0]).toBe('https://s3.test/put');
    expect(fetch.mock.calls[1][1].method).toBe('PUT');
    expect(fetch.mock.calls[1][1].body).toBe(file);
    expect(result.r2Key).toContain('Hari Achary');
    expect(result.url).toBe('https://s3.test/get');
  });

  it('falls back to an encoded proxy PUT when presign is not available', async () => {
    fetch
      .mockResolvedValueOnce(jsonResponse({ error: 'key required' }, 400))
      .mockResolvedValueOnce(jsonResponse({ r2Key: 'CareStream/files/Hari%20Achary/x', url: 'https://signed' }));

    const small = new File(['x'], 'note.pdf', { type: 'application/pdf' });
    const result = await uploadToR2(small, 'Hari Achary');

    const proxyUrl = fetch.mock.calls[1][0];
    expect(proxyUrl).toBe('https://files.test/files/upload/Hari%20Achary/note.pdf');
    expect(result.r2Key).toBeTruthy();
  });

  it('rejects files over 100 MB before calling the network', async () => {
    const huge = { name: 'scan.pdf', size: 101 * 1024 * 1024, type: 'application/pdf' };
    await expect(uploadToR2(huge, 'pat_1')).rejects.toThrow(/100 MB/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not proxy a large file when presign is missing', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ error: 'key required' }, 400));
    const big = { name: 'scan.pdf', size: LAMBDA_UPLOAD_MAX_BYTES + 1, type: 'application/pdf' };
    await expect(uploadToR2(big, 'pat_1')).rejects.toThrow(/too large/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('maps a browser Failed to fetch on the proxy path', async () => {
    vi.stubEnv('VITE_FILES_API_URL', '');
    vi.stubEnv('VITE_R2_WORKER_URL', 'https://r2.worker.test');
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(uploadToR2(file, 'pat_1')).rejects.toThrow(/before the server responded/);
  });

  it('requires an owner id', async () => {
    await expect(uploadToR2(file, { name: 'Hari Achary' })).rejects.toThrow(/missing a patient id/);
    expect(fetch).not.toHaveBeenCalled();
  });
});
