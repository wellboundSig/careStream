/**
 * Mentions inbox ordering and state helpers.
 *
 * Order: pinned first, then open (not Done), then Done — newest received
 * first within each group. Done rows render greyed (Outlook-style); no
 * separate sections or headers, the order and background carry the meaning.
 */

const truthy = (v) => v === true || v === 'true';

/** Attach the user's inbox state (done/pinned) to each mention item. */
export function attachMentionStates(mentions, mentionStates, userId) {
  const byNote = {};
  for (const s of Object.values(mentionStates || {})) {
    if (s.user_id === userId && s.note_id) byNote[s.note_id] = s;
  }
  return (mentions || []).map((m) => {
    const noteId = m.note?.id || m.note?._id;
    const state = noteId ? byNote[noteId] : null;
    return {
      ...m,
      noteId,
      isDone: truthy(state?.is_done),
      isPinned: truthy(state?.is_pinned),
    };
  });
}

/** Pinned → open → done; newest received first within each group. */
export function sortMentionInbox(items) {
  const rank = (m) => (m.isPinned ? 0 : m.isDone ? 2 : 1);
  return [...(items || [])].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return new Date(b.note?.created_at || 0) - new Date(a.note?.created_at || 0);
  });
}

export const MENTION_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'done', label: 'Done' },
  { id: 'pinned', label: 'Pinned' },
];

export function applyMentionFilter(items, filterId) {
  if (filterId === 'open') return items.filter((m) => !m.isDone);
  if (filterId === 'done') return items.filter((m) => m.isDone);
  if (filterId === 'pinned') return items.filter((m) => m.isPinned);
  return items;
}
