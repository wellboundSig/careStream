/**
 * Note @mention tokens: @[Display Name](user_id)
 * Stable for storage, parseable for pills + notification fan-out.
 *
 * Special (non-user) targets use ids under `special:` — e.g. Account manager
 * info, which routes the note body into the Pending Log column.
 */

export const MENTION_TOKEN_RE = /@\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Synthetic mention target — routes note text to referral.account_manager_info. */
export const ACCOUNT_MANAGER_INFO_MENTION_ID = 'special:account_manager_info';

export const ACCOUNT_MANAGER_INFO_MENTION = {
  id: ACCOUNT_MANAGER_INFO_MENTION_ID,
  first_name: 'Account manager',
  last_name: 'info',
  status: 'Active',
  isSpecial: true,
};

export function isSpecialMentionId(id) {
  return typeof id === 'string' && id.startsWith('special:');
}

export function userDisplayName(user) {
  if (!user) return 'Unknown';
  if (user.id === ACCOUNT_MANAGER_INFO_MENTION_ID) return 'Account manager info';
  const name = `${user.first_name || ''} ${user.last_name || ''}`.trim();
  return name || user.email || user.id || 'Unknown';
}

export function serializeMention(user) {
  const id = user?.id;
  if (!id) return '';
  const label = userDisplayName(user).replace(/[\[\]]/g, '');
  return `@[${label}](${id})`;
}

/** Unique mention target ids in content (users + specials; order preserved). */
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

/** User ids only — excludes special: targets (for notification fan-out). */
export function extractUserMentionIds(content) {
  return extractMentionUserIds(content).filter((id) => !isSpecialMentionId(id));
}

export function mentionMentionsAccountManagerInfo(content) {
  return extractMentionUserIds(content).includes(ACCOUNT_MANAGER_INFO_MENTION_ID);
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

/**
 * Mention picker candidates: optional special targets first, then Active staff.
 * @param {object} usersMap
 * @param {{ excludeId?: string|null, includeAccountManagerInfo?: boolean }} [opts]
 */
export function listMentionCandidates(usersMap, {
  excludeId = null,
  includeAccountManagerInfo = false,
} = {}) {
  const users = listMentionableUsers(usersMap, { excludeId });
  if (!includeAccountManagerInfo) return users;
  return [ACCOUNT_MANAGER_INFO_MENTION, ...users];
}

export function filterUsersByQuery(users, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return users.slice(0, 8);

  const matches = (u) => {
    const full = userDisplayName(u).toLowerCase();
    const email = (u.email || '').toLowerCase();
    if (u.id === ACCOUNT_MANAGER_INFO_MENTION_ID) {
      // Searchable like a person, but it's a thing — match common shorthand.
      const hay = [
        full,
        'account manager info',
        'account manager',
        'account',
        'manager',
        'info',
        'am',
        'ami',
      ];
      return hay.some((h) => h.includes(q) || q.includes(h));
    }
    return full.includes(q) || email.includes(q) || (u.id || '').toLowerCase().includes(q);
  };

  // Keep special targets pinned at the top of filtered results.
  const specials = users.filter((u) => u.isSpecial && matches(u));
  const people = users.filter((u) => !u.isSpecial && matches(u));
  return [...specials, ...people].slice(0, 8);
}
