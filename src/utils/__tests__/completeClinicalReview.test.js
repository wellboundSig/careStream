import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../engine/transitionEngine.js', () => ({
  attemptTransition: vi.fn(),
  applyTransition: vi.fn(),
}));
vi.mock('../../store/mutations.js', () => ({
  updateReferralOptimistic: vi.fn(),
}));
vi.mock('../../hooks/useRefreshTrigger.js', () => ({
  triggerDataRefresh: vi.fn(),
}));
vi.mock('../documentationDeferred.js', async () => {
  const actual = await vi.importActual('../documentationDeferred.js');
  return { ...actual, maybeClearDocumentationDeferred: vi.fn() };
});

import { attemptTransition, applyTransition } from '../../engine/transitionEngine.js';
import { completeClinicalReview, resolveClinicalConfirmDecision } from '../completeClinicalReview.js';

describe('resolveClinicalConfirmDecision', () => {
  it('prefers the working decision and falls back to the referral stamp', () => {
    expect(resolveClinicalConfirmDecision('Accepted', {})).toBe('accept');
    expect(resolveClinicalConfirmDecision(null, { clinical_review_decision: 'conditional' })).toBe('conditional');
    expect(resolveClinicalConfirmDecision(null, {})).toBe(null);
  });
});

describe('completeClinicalReview', () => {
  beforeEach(() => {
    attemptTransition.mockReset();
    applyTransition.mockReset();
  });

  it('moves Clinical → Staffing even when the graph edge would normally block', async () => {
    attemptTransition.mockReturnValue({ allowed: true, fieldUpdates: {} });
    applyTransition.mockResolvedValue({ ok: true });
    const referral = { _id: 'rec_1', current_stage: 'F2F/MD Orders Pending' };
    await completeClinicalReview({
      referral,
      decision: 'accept',
      appUserId: 'usr_julia',
    });
    expect(attemptTransition).toHaveBeenCalledWith(expect.objectContaining({
      toStage: 'Staffing Feasibility',
      context: expect.objectContaining({ system: true }),
    }));
    expect(applyTransition).toHaveBeenCalled();
  });

  it('throws when Accept/Conditional was never chosen', async () => {
    await expect(completeClinicalReview({
      referral: { _id: 'rec_1', current_stage: 'Clinical Intake RN Review' },
      decision: null,
      appUserId: 'usr_a',
    })).rejects.toThrow(/Accept or Conditional/);
  });
});
