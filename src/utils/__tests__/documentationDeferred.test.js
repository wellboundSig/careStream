import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../store/mutations.js', () => ({
  updateReferralOptimistic: vi.fn().mockResolvedValue({}),
  createNoteOptimistic: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../api/activityLog.js', () => ({
  recordActivity: vi.fn().mockResolvedValue({}),
}));

import { updateReferralOptimistic, createNoteOptimistic } from '../../store/mutations.js';
import {
  getDocumentationClearChecklist,
  clearDocumentationDeferred,
  markDocsCompleteAndSendToClinical,
  maybeClearDocumentationDeferred,
  isDocumentationDeferred,
} from '../documentationDeferred.js';

describe('documentationDeferred clear path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lets intake clear docs without clinical review', () => {
    const base = {
      _id: 'rec1',
      id: 'ref_1',
      documentation_deferred: true,
    };
    const open = getDocumentationClearChecklist(base);
    expect(open.canClear).toBe(true);
    expect(open.shouldSendToClinical).toBe(true);
    expect(getDocumentationClearChecklist({
      ...base,
      f2f_date: '2026-07-01',
    }).canClear).toBe(true);
    expect(getDocumentationClearChecklist({
      ...base,
      in_clinical_review: true,
    }).shouldSendToClinical).toBe(false);
    expect(getDocumentationClearChecklist({
      ...base,
      clinical_review_completed_at: '2026-07-02T12:00:00.000Z',
    }).shouldSendToClinical).toBe(false);
  });

  it('clears the hold without waiting on clinical', async () => {
    const result = await clearDocumentationDeferred({
      _id: 'rec1',
      documentation_deferred: true,
      f2f_date: '2026-07-01',
    }, { actorUserId: 'u1', source: 'test' });
    expect(result.ok).toBe(true);
    expect(updateReferralOptimistic).toHaveBeenCalledWith(
      'rec1',
      expect.objectContaining({ documentation_deferred: false }),
    );
  });

  it('mark docs complete also sends to clinical when review is not open', async () => {
    const referral = {
      _id: 'rec1',
      id: 'ref_1',
      patient_id: 'pat_1',
      documentation_deferred: true,
      documentation_due_date: '2026-08-01',
    };
    const result = await markDocsCompleteAndSendToClinical(referral, {
      actorUserId: 'u1',
      source: 'intake_panel',
    });
    expect(result.ok).toBe(true);
    expect(result.sentToClinical).toBe(true);
    expect(updateReferralOptimistic).toHaveBeenCalledWith(
      'rec1',
      expect.objectContaining({
        documentation_deferred: false,
        documentation_cleared_by_id: 'u1',
        in_clinical_review: true,
        clinical_review_pushed_by_id: 'u1',
      }),
    );
    expect(createNoteOptimistic).toHaveBeenCalled();
    expect(isDocumentationDeferred({
      ...referral,
      documentation_deferred: false,
      documentation_cleared_at: '2026-07-03',
    })).toBe(false);
  });

  it('does not re-send when clinical is already in progress', async () => {
    const result = await markDocsCompleteAndSendToClinical({
      _id: 'rec1',
      id: 'ref_1',
      patient_id: 'pat_1',
      documentation_deferred: true,
      in_clinical_review: true,
    }, { actorUserId: 'u1', source: 'clinical_post_soc_panel' });
    expect(result.sentToClinical).toBe(false);
    expect(updateReferralOptimistic).toHaveBeenCalledWith(
      'rec1',
      expect.objectContaining({ documentation_deferred: false }),
    );
    expect(updateReferralOptimistic.mock.calls[0][1].in_clinical_review).toBeUndefined();
    expect(createNoteOptimistic).not.toHaveBeenCalled();
  });

  it('auto-clear still waits for both F2F and clinical', async () => {
    const skipped = await maybeClearDocumentationDeferred({
      _id: 'rec1',
      documentation_deferred: true,
      f2f_date: '2026-07-01',
    }, { actorUserId: 'u1' });
    expect(skipped).toBe(false);
    expect(updateReferralOptimistic).not.toHaveBeenCalled();

    const cleared = await maybeClearDocumentationDeferred({
      _id: 'rec1',
      documentation_deferred: true,
      f2f_date: '2026-07-01',
      clinical_review_completed_at: '2026-07-02T12:00:00.000Z',
    }, { actorUserId: 'u1' });
    expect(cleared).toBe(true);
    expect(updateReferralOptimistic).toHaveBeenCalled();
  });
});
