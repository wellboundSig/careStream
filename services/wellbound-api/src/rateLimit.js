/**
 * Best-effort per-actor rate limits (in-memory per warm Lambda container).
 * Not a global WAF — pairs with API Gateway stage throttling as a backstop.
 * Returns true if the request is allowed.
 */

const buckets = new Map(); // key -> { count, resetAt }

// Prevent unbounded growth in long-lived containers.
const MAX_KEYS = 5000;

export function allowRequest(key, limit, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    if (buckets.size > MAX_KEYS) {
      // Drop expired entries first.
      for (const [k, v] of buckets) {
        if (now >= v.resetAt) buckets.delete(k);
      }
      if (buckets.size > MAX_KEYS) buckets.clear();
    }
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  return b.count <= limit;
}

/** Hydrate is expensive — allow enough for localhost HMR / multi-tab without locking out. */
export function allowHydrate(actorSub) {
  return allowRequest(`hydrate:${actorSub || 'anon'}`, 30, 60_000);
}

/** General API traffic per actor. */
export function allowGeneral(actorSub) {
  return allowRequest(`api:${actorSub || 'anon'}`, 180, 60_000);
}
