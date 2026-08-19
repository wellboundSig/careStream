/**
 * Referrals that belong on a User Management / Team overview card.
 *
 * Intake staff are linked via intake_owner_id (Users.id).
 * Marketers are linked via Referrals.marketer_id → Marketers.id, and the
 * Marketers row points back at Users via user_id. Some older rows store the
 * user id on marketer_id directly.
 */

export function marketerIdsForUser(user, marketers = {}) {
  if (!user?.id && !user?._id) return [];
  const userIds = new Set([user.id, user._id].filter(Boolean).map(String));
  const ids = new Set();
  for (const m of Object.values(marketers || {})) {
    if (!m) continue;
    const linked = m.user_id != null && userIds.has(String(m.user_id));
    const sameId = m.id != null && userIds.has(String(m.id));
    if (linked || sameId) {
      if (m.id) ids.add(String(m.id).trim());
    }
  }
  return [...ids];
}

export function referralsForUser(user, { referrals = {}, marketers = {} } = {}) {
  const userId = user?.id;
  if (!userId) return [];
  const marketerIds = new Set(marketerIdsForUser(user, marketers));
  const list = Array.isArray(referrals) ? referrals : Object.values(referrals || {});
  const seen = new Set();
  const out = [];
  for (const r of list) {
    if (!r) continue;
    const key = r.id || r._id;
    if (key && seen.has(key)) continue;
    const mid = String(r.marketer_id || '').trim();
    const owned = r.intake_owner_id === userId
      || (mid && (mid === userId || marketerIds.has(mid)));
    if (!owned) continue;
    if (key) seen.add(key);
    out.push(r);
  }
  return out;
}
