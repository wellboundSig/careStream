/**
 * Client → wellbound-api HCHB SOC/ROC visit check.
 * Pepper + bridge token stay on the Lambda. Response is match flags plus
 * visit date / kind / service code. No names from HCHB.
 */

const API_URL = import.meta.env.VITE_API_URL || '';

async function authHeader() {
  try {
    const token = typeof window !== 'undefined' && window.Clerk?.session
      ? await window.Clerk.session.getToken()
      : null;
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    // Local pk_test JWTs have no email claim; the API uses this only for the
    // Clerk test issuer to map the session onto Users.email.
    const email = typeof window !== 'undefined'
      ? window.Clerk?.user?.primaryEmailAddress?.emailAddress
      : '';
    if (email) headers['X-User-Email'] = email;
    return headers;
  } catch {
    return {};
  }
}

/**
 * @param {{ candidates: Array<{ token: string, first_name: string, last_name: string, dob?: string, visit_kind: string, scheduled_date: string }> }} body
 */
export async function runHchbVisitCheck(body) {
  if (!API_URL) throw new Error('VITE_API_URL is not configured');
  const headers = {
    'Content-Type': 'application/json',
    ...(await authHeader()),
  };
  const res = await fetch(`${API_URL}/hchb-visit/check`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && !data?.results) {
    throw new Error(data?.error?.message || data?.error || `HCHB visit check failed (${res.status})`);
  }
  return data;
}
