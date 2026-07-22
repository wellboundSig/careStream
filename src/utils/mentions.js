/**
 * Note @mention tokens: @[Display Name](user_id)
 * Stable for storage, parseable for pills + notification fan-out.
 */

export const MENTION_TOKEN_RE = /@\[([^\]]+)\]\(([^)\s]+)\)/g;

export function userDisplayName(user) {
  if (!user) return 'Unknown';
  const name = `${user.first_name || ''} ${user.last_name || ''}`.trim();
  return name || user.email || user.id || 'Unknown';
}

export function serializeMention(user) {
  const id = user?.id;
  if (!id) return '';
  const label = userDisplayName(user).replace(/[\[\]]/g, '');
  return `@[${label}](${id})`;
}

/** Unique user ids mentioned in content (order preserved). */
export function extractMentionUserIds(content) {
  if (!content) return [];
  const ids = [];
  const seen = new Set();
  const re = new RegExp(MENTION_TOKEN_RE.source, 'g');
  let m;
  while ((m = re.exec(content)) !== null) {
    const id = m[2];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * Split content into text / mention segments for rendering.
 * @returns {{ type: 'text'|'mention', value?: string, userId?: string, label?: string }[]}
 */
export function parseMentionSegments(content) {
  if (!content) return [];
  const segments = [];
  const re = new RegExp(MENTION_TOKEN_RE.source, 'g');
  let last = 0;
  let m;
  while ((m = re.exec(content)) !== null) {
    if (m.index > last) {
      segments.push({ type: 'text', value: content.slice(last, m.index) });
    }
    segments.push({ type: 'mention', label: m[1], userId: m[2] });
    last = m.index + m[0].length;
  }
  if (last < content.length) {
    segments.push({ type: 'text', value: content.slice(last) });
  }
  return segments;
}

/** Plain preview for notifications / search (tokens → @Name). */
export function mentionPlainPreview(content, maxLen = 140) {
  if (!content) return '';
  const plain = content.replace(MENTION_TOKEN_RE, '@$1').replace(/\s+/g, ' ').trim();
  if (plain.length <= maxLen) return plain;
  return `${plain.slice(0, maxLen - 1)}…`;
}

/** Active staff sorted for mention suggestions. */
export function listMentionableUsers(usersMap, { excludeId = null } = {}) {
  return Object.values(usersMap || {})
    .filter((u) => u?.id && u.status === 'Active' && u.id !== excludeId)
    .sort((a, b) => {
      const ln = (a.last_name || '').localeCompare(b.last_name || '');
      if (ln !== 0) return ln;
      return (a.first_name || '').localeCompare(b.first_name || '');
    });
}

export function filterUsersByQuery(users, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return users.slice(0, 8);
  return users
    .filter((u) => {
      const full = userDisplayName(u).toLowerCase();
      const email = (u.email || '').toLowerCase();
      return full.includes(q) || email.includes(q) || (u.id || '').toLowerCase().includes(q);
    })
    .slice(0, 8);
}
