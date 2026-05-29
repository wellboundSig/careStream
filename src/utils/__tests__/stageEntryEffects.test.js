import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the side-effect APIs so the helper can run in isolation.
vi.mock('../../api/activityLog.js', () => ({ recordActivity: vi.fn(() => Promise.resolve(null)) }));
vi.mock('../../api/notes.js', () => ({ createNote: vi.fn(() => Promise.resolve({ id: 'note_x' })) }));

import { applyStageEntryEffects } from '../stageEntryEffects.js';
import { recordActivity } from '../../api/activityLog.js';
import { createNote } from '../../api/notes.js';

beforeEach(() => {
  recordActivity.mockClear();
  createNote.mockClear();
});

describe('applyStageEntryEffects', () => {
  it('returns no extra fields for unrelated stages', () => {
    const extra = applyStageEntryEffects({
      referral: { id: 'ref_1', patient_id: 'pat_1', current_stage: 'Intake' },
      fromStage: 'Intake',
      toStage: 'Staffing Feasibility',
      actorUserId: 'usr_1',
    });
    expect(extra).toEqual({});
    expect(recordActivity).not.toHaveBeenCalled();
    expect(createNote).not.toHaveBeenCalled();
  });

  it('clears prior eligibility completion and stamps a re-check on entering Eligibility Verification', () => {
    const extra = applyStageEntryEffects({
      referral: {
        id: 'ref_1',
        patient_id: 'pat_1',
        current_stage: 'Clinical Intake RN Review',
        eligibility_completed_at: '2026-05-29T14:46:29.634Z',
        eligibility_completed_by_id: 'usr_013',
      },
      fromStage: 'Clinical Intake RN Review',
      toStage: 'Eligibility Verification',
      actorUserId: 'usr_099',
      resolveUserName: (id) => (id === 'usr_013' ? 'Farzona Bekmamadova' : id),
    });

    expect(extra.eligibility_completed_at).toBe('');
    expect(extra.eligibility_completed_by_id).toBe('');
    expect(typeof extra.eligibility_recheck_requested_at).toBe('string');
    expect(extra.eligibility_recheck_requested_at).not.toBe('');
    expect(extra.eligibility_recheck_return_stage).toBe('Clinical Intake RN Review');
  });

  it('logs the prior completion to Timeline (Note) + Activity Log, preserving history', () => {
    applyStageEntryEffects({
      referral: {
        id: 'ref_1',
        patient_id: 'pat_1',
        current_stage: 'Staffing Feasibility',
        eligibility_completed_at: '2026-05-29T14:46:29.634Z',
        eligibility_completed_by_id: 'usr_013',
      },
      fromStage: 'Staffing Feasibility',
      toStage: 'Eligibility Verification',
      actorUserId: 'usr_099',
    });

    expect(createNote).toHaveBeenCalledTimes(1);
    const note = createNote.mock.calls[0][0];
    expect(note.patient_id).toBe('pat_1');
    expect(note.content).toContain('Eligibility Re-check');

    expect(recordActivity).toHaveBeenCalledTimes(1);
    const act = recordActivity.mock.calls[0][0];
    expect(act.action).toBe('Eligibility Re-check Requested');
    expect(act.metadata.priorCompletedAt).toBe('2026-05-29T14:46:29.634Z');
    expect(act.metadata.priorCompletedBy).toBe('usr_013');
  });

  it('does not write history rows when there was no prior completion', () => {
    const extra = applyStageEntryEffects({
      referral: { id: 'ref_1', patient_id: 'pat_1', current_stage: 'Intake' },
      fromStage: 'Intake',
      toStage: 'Eligibility Verification',
      actorUserId: 'usr_099',
    });
    // Re-check markers still set, but no history logged (nothing to preserve).
    expect(extra.eligibility_recheck_requested_at).not.toBe('');
    expect(createNote).not.toHaveBeenCalled();
    expect(recordActivity).not.toHaveBeenCalled();
  });
});
