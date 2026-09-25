import { describe, it, expect } from 'vitest';
import { attachMentionStates, sortMentionInbox, applyMentionFilter } from '../mentionInbox.js';

const mention = (noteId, createdAt) => ({ note: { id: noteId, created_at: createdAt } });

const mentions = [
  mention('n1', '2026-09-20T10:00:00Z'),
  mention('n2', '2026-09-24T10:00:00Z'),
  mention('n3', '2026-09-22T10:00:00Z'),
  mention('n4', '2026-09-25T10:00:00Z'),
];

const states = {
  a: { _id: 'a', user_id: 'usr_1', note_id: 'n1', is_done: true },
  b: { _id: 'b', user_id: 'usr_1', note_id: 'n3', is_pinned: true },
  c: { _id: 'c', user_id: 'usr_2', note_id: 'n2', is_done: true }, // someone else's state
};

describe('mention inbox', () => {
  it('attaches only the signed-in user state', () => {
    const items = attachMentionStates(mentions, states, 'usr_1');
    const byId = Object.fromEntries(items.map((m) => [m.noteId, m]));
    expect(byId.n1.isDone).toBe(true);
    expect(byId.n3.isPinned).toBe(true);
    expect(byId.n2.isDone).toBe(false); // usr_2's state must not leak
  });

  it('orders pinned, then open newest-first, then done', () => {
    const items = sortMentionInbox(attachMentionStates(mentions, states, 'usr_1'));
    expect(items.map((m) => m.noteId)).toEqual(['n3', 'n4', 'n2', 'n1']);
  });

  it('filters open / done / pinned', () => {
    const items = attachMentionStates(mentions, states, 'usr_1');
    expect(applyMentionFilter(items, 'open').map((m) => m.noteId).sort()).toEqual(['n2', 'n3', 'n4']);
    expect(applyMentionFilter(items, 'done').map((m) => m.noteId)).toEqual(['n1']);
    expect(applyMentionFilter(items, 'pinned').map((m) => m.noteId)).toEqual(['n3']);
    expect(applyMentionFilter(items, 'all').length).toBe(4);
  });
});
