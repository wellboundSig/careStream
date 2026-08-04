import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../engine/transitionEngine.js', () => ({
  attemptTransition: vi.fn(),
  applyTransition: vi.fn().mockResolvedValue({ ok: true }),
}));

import { attemptTransition, applyTransition } from '../../engine/transitionEngine.js';
import { discardReferral } from '../discardReferral.js';

describe('discardReferral', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses when already discarded', async () => {
    const result = await discardReferral({
      referral: { _id: 'r1', current_stage: 'Discarded Leads' },
      reason: 'Other',
      explanation: 'x',
    });
    expect(result.ok).toBe(false);
    expect(attemptTransition).not.toHaveBeenCalled();
  });

  it('uses system transition to Discarded Leads', async () => {
    attemptTransition.mockReturnValue({ allowed: true, fieldUpdates: {} });
    const referral = { _id: 'r1', id: 'ref_1', current_stage: 'Intake', patient_id: 'p1' };
    const result = await discardReferral({
      referral,
      reason: 'Duplicate',
      explanation: 'Already in system',
      actorUserId: 'u1',
    });
    expect(result.ok).toBe(true);
    expect(attemptTransition).toHaveBeenCalledWith(expect.objectContaining({
      toStage: 'Discarded Leads',
      context: expect.objectContaining({
        system: true,
        actorUserId: 'u1',
        extraFields: expect.objectContaining({
          discard_reason: 'Duplicate',
          discard_explanation: 'Already in system',
        }),
      }),
    }));
    expect(applyTransition).toHaveBeenCalled();
  });
});
