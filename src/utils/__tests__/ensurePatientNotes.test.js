import { describe, it, expect, vi, beforeEach } from 'vitest';

const mergeEntities = vi.fn();
const getNotesByPatient = vi.fn(async () => []);
const getNoteByBusinessId = vi.fn(async () => []);

vi.mock('../../store/careStore.js', () => ({
  mergeEntities: (...args) => mergeEntities(...args),
}));

vi.mock('../../api/notes.js', () => ({
  getNotesByPatient: (...args) => getNotesByPatient(...args),
  getNoteByBusinessId: (...args) => getNoteByBusinessId(...args),
}));

const { ensurePatientNotes } = await import('../ensurePatientNotes.js');

describe('ensurePatientNotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('merges patient notes and the mentioned note into the store', async () => {
    getNotesByPatient.mockResolvedValue([
      { id: 'rec_old', fields: { id: 'note_old', patient_id: 'pat_1', content: 'older' } },
    ]);
    getNoteByBusinessId.mockResolvedValue([
      { id: 'rec_new', fields: { id: 'note_new', patient_id: 'pat_1', content: '@Vanessa look' } },
    ]);

    const mapped = await ensurePatientNotes({ id: 'pat_1', _id: 'rec_p1' }, { noteId: 'note_new' });

    expect(getNotesByPatient).toHaveBeenCalledWith('pat_1');
    expect(getNotesByPatient).toHaveBeenCalledWith('rec_p1');
    expect(getNoteByBusinessId).toHaveBeenCalledWith('note_new');
    expect(mapped.rec_new.content).toBe('@Vanessa look');
    expect(mergeEntities).toHaveBeenCalledWith('notes', expect.objectContaining({
      rec_new: expect.objectContaining({ _id: 'rec_new', content: '@Vanessa look' }),
    }));
  });
});
