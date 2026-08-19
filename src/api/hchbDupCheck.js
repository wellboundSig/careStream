/**
 * Client → wellbound-api HCHB duplicate check.
 * Pepper + bridge token stay on the Lambda. Response is match flags plus
 * latest-episode case facts (status + dates). No names/SSN/MRN from HCHB.
 */

const API_URL = import.meta.env.VITE_API_URL || '';

async function authHeader() {
  try {
    const token = typeof window !== 'undefined' && window.Clerk?.session
      ? await window.Clerk.session.getToken()
      : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

/**
 * @param {{ first_name: string, last_name: string, dob?: string }} body
 */
export async function runHchbDupCheck(body) {
  if (!API_URL) throw new Error('VITE_API_URL is not configured');
  const headers = {
    'Content-Type': 'application/json',
    ...(await authHeader()),
  };
  const res = await fetch(`${API_URL}/hchb-dup/check`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !data?.confidence && data?.possible_match == null) {
    throw new Error(data?.error?.message || data?.error || `HCHB check failed (${res.status})`);
  }
  return data;
}
