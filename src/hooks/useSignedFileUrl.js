import { useEffect, useState } from 'react';
import { getSignedFileUrl } from '../utils/r2Upload.js';

/**
 * Resolve a short-lived signed URL for a private R2 file row. Use for inline
 * rendering (<img>/<iframe>) where a URL is needed before paint.
 *
 * @param {object|null} file  Files row ({ r2_key, ... })
 * @param {{ download?: boolean }} [opts]
 * @returns {{ url: string, loading: boolean }}
 */
export function useSignedFileUrl(file, { download = false } = {}) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const key = file?.r2_key || file?._id || null;

  useEffect(() => {
    let cancelled = false;
    if (!file) { setUrl(''); return undefined; }
    setLoading(true);
    getSignedFileUrl(file, { download })
      .then((u) => { if (!cancelled) { setUrl(u); setLoading(false); } })
      .catch(() => { if (!cancelled) { setUrl(''); setLoading(false); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, download]);

  return { url, loading };
}
