/**
 * Shared Clerk session-JWT verification for CareStream Cloudflare Workers.
 *
 * The SPA attaches its Clerk session token (`Authorization: Bearer <jwt>`, or
 * `?token=` for EventSource). Workers verify the RS256 signature against Clerk's
 * public JWKS and check iss/exp before serving any PHI. This turns the data
 * proxy + file storage from open endpoints into authenticated ones.
 *
 * Required worker env:
 *   CLERK_ISSUER     e.g. https://clerk.wellboundcarestream.com  (default below)
 *   CLERK_JWKS_URL   optional override; defaults to {issuer}/.well-known/jwks.json
 *   REQUIRE_AUTH     "false" disables enforcement (rollout kill-switch). Default: ON.
 */

const DEFAULT_ISSUER = 'https://clerk.wellboundcarestream.com';
const JWKS_TTL_MS = 10 * 60 * 1000;

// Module-scoped JWKS cache (per worker isolate).
let jwksCache = { url: null, keys: null, fetchedAt: 0 };

function b64urlToBytes(s) {
  let str = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const pad = str.length % 4;
  if (pad) str += '='.repeat(4 - pad);
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToString(s) {
  return new TextDecoder().decode(b64urlToBytes(s));
}

export function issuerFromEnv(env) {
  return (env.CLERK_ISSUER || DEFAULT_ISSUER).replace(/\/$/, '');
}

/** Auth enforcement is ON unless explicitly disabled — fail closed. */
export function authRequired(env) {
  return env.REQUIRE_AUTH !== 'false';
}

export function bearerFromRequest(request) {
  const h = request.headers.get('Authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function getJwks(jwksUrl, { force = false } = {}) {
  const now = Date.now();
  if (!force && jwksCache.keys && jwksCache.url === jwksUrl && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const res = await fetch(jwksUrl, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`JWKS fetch failed (${res.status})`);
  const data = await res.json();
  jwksCache = { url: jwksUrl, keys: data.keys || [], fetchedAt: now };
  return jwksCache.keys;
}

/**
 * Verify a Clerk session JWT. Returns the decoded payload on success, else null.
 */
export async function verifyClerkJWT(token, env) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;

  let header, payload;
  try {
    header = JSON.parse(b64urlToString(h));
    payload = JSON.parse(b64urlToString(p));
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || !header.kid) return null;

  // Claim checks BEFORE the expensive crypto.
  const issuer = issuerFromEnv(env);
  if (payload.iss !== issuer) return null;
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && now > payload.exp) return null;
  if (typeof payload.nbf === 'number' && now < payload.nbf - 5) return null;

  const jwksUrl = env.CLERK_JWKS_URL || `${issuer}/.well-known/jwks.json`;
  let keys;
  try { keys = await getJwks(jwksUrl); } catch { return null; }

  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    // Key rotation — refresh once and retry.
    try { keys = await getJwks(jwksUrl, { force: true }); } catch { return null; }
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) return null;

  let key;
  try {
    key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
  } catch {
    return null;
  }

  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(sig),
    new TextEncoder().encode(`${h}.${p}`),
  );
  return ok ? payload : null;
}

/**
 * Convenience guard for request handlers. Returns null when the request is
 * authorized (or auth is disabled), or a 401 Response when it is not.
 */
export async function requireClerkAuth(request, env, corsHeaders, { token } = {}) {
  if (!authRequired(env)) return null;
  const jwt = token || bearerFromRequest(request);
  const payload = await verifyClerkJWT(jwt, env);
  if (!payload) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...(corsHeaders || {}) },
    });
  }
  return null;
}
