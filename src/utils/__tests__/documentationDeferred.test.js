import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../store/mutations.js', () => ({
  updateReferralOptimistic: vi.fn().mockResolvedValue({}),
}));
vi.mock('../../api/activityLog.js', () => ({
  recordActivity: vi.fn().mockResolvedValue({}),
}));

import { updateReferralOptimistic } from '../../store/mutations.js';
import {
  getDocumentationClearChecklist,
  clearDocumentationDeferred,
  isDocumentationDeferred,
} from '../documentationDeferred.js';

describe('documentationDeferred clear path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires both F2F and clinical before canClear', () => {
    const base = {
      _id: 'rec1',
      id: 'ref_1',
      documentation_deferred: true,
    };
    expect(getDocumentationClearChecklist(base).canClear).toBe(false);
    expect(getDocumentationClearChecklist({
      ...base,
      f2f_date: '2026-07-01',
    }).canClear).toBe(false);
    expect(getDocumentationClearChecklist({
      ...base,
      f2f_date: '2026-07-01',
      clinical_review_completed_at: '2026-07-02T12:00:00.000Z',
    }).canClear).toBe(true);
  });

  it('does not clear without both halves', async () => {
    const result = await clearDocumentationDeferred({
      _id: 'rec1',
      documentation_deferred: true,
      f2f_date: '2026-07-01',
    }, { actorUserId: 'u1', source: 'test' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('need_clinical');
    expect(updateReferralOptimistic).not.toHaveBeenCalled();
  });

  it('clears when both halves are present', async () => {
    const referral = {
      _id: 'rec1',
      id: 'ref_1',
      patient_id: 'pat_1',
      documentation_deferred: true,
      f2f_date: '2026-07-01',
      clinical_review_completed_at: '2026-07-02T12:00:00.000Z',
      documentation_due_date: '2026-08-01',
    };
    const result = await clearDocumentationDeferred(referral, {
      actorUserId: 'u1',
      source: 'pending_log',
    });
    expect(result.ok).toBe(true);
    expect(updateReferralOptimistic).toHaveBeenCalledWith(
      'rec1',
      expect.objectContaining({
        documentation_deferred: false,
        documentation_cleared_by_id: 'u1',
      }),
    );
    expect(isDocumentationDeferred({
      ...referral,
      documentation_deferred: false,
      documentation_cleared_at: '2026-07-03',
    })).toBe(false);
  });
});
