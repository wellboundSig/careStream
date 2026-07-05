/**
 * clerkJwt.js — Clerk session-JWT verification for Lambda (RS256 via JWKS).
 *
 * Ported from workers/clerkAuth.js. Verifies in-Lambda because Clerk session
 * tokens carry no `aud` claim (rules out APIGW's built-in JWT authorizer).
 *
 * Multi-issuer: CLERK_ISSUER is a comma-separated allowlist. Production uses
 * the live instance; local dev uses the test instance — both must verify or
 * `npm run dev` gets a wall of 401s (found the hard way at cutover).
 * JWKS is fetched from the TOKEN's own issuer (only if allowlisted) and
 * cached per issuer.
 *
 * Env: CLERK_ISSUER (default: prod + dev instances below)
 */

import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

const DEFAULT_ISSUERS = [
  'https://clerk.wellboundcarestream.com',            // production instance
  'https://upright-platypus-97.clerk.accounts.dev',   // dev/test instance
];
const JWKS_TTL_MS = 10 * 60 * 1000;

// Per-issuer JWKS cache (persists across warm invocations).
const jwksCache = new Map(); // url -> { keys, fetchedAt }

const b64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function allowedIssuers() {
  const raw = process.env.CLERK_ISSUER || '';
  const list = raw.split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
  return list.length ? list : DEFAULT_ISSUERS;
}

async function getJwks(jwksUrl, { force = false } = {}) {
  const now = Date.now();
  const cached = jwksCache.get(jwksUrl);
  if (!force && cached && now - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;
  const res = await fetch(jwksUrl, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`JWKS fetch failed (${res.status})`);
  const data = await res.json();
  jwksCache.set(jwksUrl, { keys: data.keys || [], fetchedAt: now });
  return data.keys || [];
}

const reject = (reason, extra = '') => {
  console.log(`[auth] reject: ${reason}${extra ? ` (${extra})` : ''}`);
  return null;
};

/** Verify a Clerk session JWT. Returns the payload or null (reason logged). */
export async function verifyClerkJWT(token) {
  if (!token || typeof token !== 'string') return reject('missing token');
  const parts = token.split('.');
  if (parts.length !== 3) return reject('malformed token');
  const [h, p, sig] = parts;

  let header, payload;
  try {
    header = JSON.parse(b64url(h).toString('utf8'));
    payload = JSON.parse(b64url(p).toString('utf8'));
  } catch {
    return reject('undecodable token');
  }
  if (header.alg !== 'RS256' || !header.kid) return reject('bad alg/kid', header.alg);

  const iss = String(payload.iss || '').replace(/\/$/, '');
  if (!allowedIssuers().includes(iss)) return reject('issuer not allowed', iss);

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && now > payload.exp) return reject('expired', `exp=${payload.exp}`);
  if (typeof payload.nbf === 'number' && now < payload.nbf - 5) return reject('not yet valid');

  const jwksUrl = `${iss}/.well-known/jwks.json`;
  let keys;
  try { keys = await getJwks(jwksUrl); } catch (err) { return reject('jwks fetch failed', err.message); }
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    try { keys = await getJwks(jwksUrl, { force: true }); } catch (err) { return reject('jwks refetch failed', err.message); }
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) return reject('kid not in jwks', header.kid);

  try {
    const key = createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' });
    const ok = cryptoVerify('RSA-SHA256', Buffer.from(`${h}.${p}`), key, b64url(sig));
    return ok ? payload : reject('bad signature');
  } catch (err) {
    return reject('verify error', err.message);
  }
}

/** Extract + verify the caller. Returns claims or null. */
export async function authenticate(event) {
  const fromAuthorizer = event.requestContext?.authorizer?.jwt?.claims;
  if (fromAuthorizer?.sub) return fromAuthorizer;
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return reject('no bearer header');
  return verifyClerkJWT(m[1]);
}
