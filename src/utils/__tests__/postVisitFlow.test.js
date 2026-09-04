/**
 * Post-visit flow — status-quo concurrency:
 *   completeVisit stamps soc_completed_date and routes paperwork-done cases
 *   to Completed; open-paperwork cases keep working in Intake (stamp-only
 *   when already on an Intake-side stage). The old deferred-docs machinery
 *   ('Post Visit Intake' / 'Post Visit Clinical Review') is deprecated for
 *   new actions but legacy rows still finish through their existing paths.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../engine/transitionEngine.js', () => ({
  attemptTransition: vi.fn(),
  applyTransition: vi.fn(),
}));
vi.mock('../../store/mutations.js', () => ({
  updateReferralOptimistic: vi.fn(),
  createNoteOptimistic: vi.fn(),
}));
vi.mock('../../api/activityLog.js', () => ({
  recordActivity: vi.fn().mockResolvedValue({}),
}));

import { attemptTransition, applyTransition } from '../../engine/transitionEngine.js';
import { updateReferralOptimistic } from '../../store/mutations.js';
import { completeVisit, postVisitDestination } from '../completeVisit.js';
import {
  markDocsCompleteAndSendToClinical,
  clearDocumentationDeferred,
} from '../documentationDeferred.js';
import StageRules from '../../data/StageRules.json';

beforeEach(() => {
  attemptTransition.mockReset();
  applyTransition.mockReset();
  updateReferralOptimistic.mockReset();
  attemptTransition.mockReturnValue({ allowed: true, fieldUpdates: {} });
  applyTransition.mockResolvedValue({ ok: true });
  updateReferralOptimistic.mockResolvedValue({});
});

describe('postVisitDestination', () => {
  it('routes a paperwork-done case (clinical approved) to Completed', () => {
    expect(postVisitDestination({
      current_stage: 'Pre-SOC',
      clinical_review_completed_at: '2026-07-01T00:00:00Z',
    })).toBe('Completed');
  });

  it('keeps an open-paperwork case already in Intake where it is (stamp only)', () => {
    expect(postVisitDestination({ current_stage: 'Intake' })).toBe(null);
  });

  it('returns an open-paperwork case parked in a linear stage to Intake', () => {
    expect(postVisitDestination({ current_stage: 'Pre-SOC' })).toBe('Intake');
    expect(postVisitDestination({ current_stage: 'Staffing Feasibility' })).toBe('Intake');
    expect(postVisitDestination({ current_stage: 'SOC Scheduled' })).toBe('Intake');
  });

  it('never stamps deferred-docs machinery — a deferred flag does not change routing', () => {
    expect(postVisitDestination({
      current_stage: 'Staffing Feasibility',
      documentation_deferred: true,
      clinical_review_completed_at: '2026-07-01T00:00:00Z',
    })).toBe('Completed');
  });
});

describe('completeVisit', () => {
  it('paperwork done: lands on SOC Completed then auto-routes to Completed', async () => {
    const referral = {
      _id: 'rec_1',
      id: 'ref_1',
      current_stage: 'Pre-SOC',
      clinical_review_completed_at: '2026-07-01T00:00:00Z',
    };
    const out = await completeVisit({ referral, appUserId: 'usr_a', completedDate: '2026-07-02' });

    expect(out).toEqual({ ok: true, destination: 'Completed' });
    expect(attemptTransition).toHaveBeenCalledTimes(2);
    expect(attemptTransition.mock.calls[0][0]).toMatchObject({
      toStage: 'SOC Completed',
      context: expect.objectContaining({
        system: true,
        extraFields: expect.objectContaining({ soc_completed_date: '2026-07-02' }),
      }),
    });
    expect(attemptTransition.mock.calls[1][0]).toMatchObject({ toStage: 'Completed' });
    expect(applyTransition).toHaveBeenCalledTimes(2);
  });

  it('open paperwork, case already in Intake: stamps the date only — no stage move, no deferred flags', async () => {
    const referral = { _id: 'rec_2', id: 'ref_2', current_stage: 'Intake' };
    const out = await completeVisit({ referral, appUserId: 'usr_a', completedDate: '2026-06-15' });

    expect(out).toEqual({ ok: true, destination: null });
    expect(attemptTransition).not.toHaveBeenCalled();
    expect(updateReferralOptimistic).toHaveBeenCalledWith('rec_2', expect.objectContaining({
      soc_completed_date: '2026-06-15',
    }));
    const written = updateReferralOptimistic.mock.calls[0][1];
    expect(written).not.toHaveProperty('documentation_deferred');
    expect(written).not.toHaveProperty('documentation_due_date');
  });

  it('open paperwork, rushed case in Staffing: returns to Intake (backdatable date)', async () => {
    const referral = { _id: 'rec_3', id: 'ref_3', current_stage: 'Staffing Feasibility' };
    const out = await completeVisit({ referral, appUserId: 'usr_a', completedDate: '2026-06-15' });

    expect(out).toEqual({ ok: true, destination: 'Intake' });
    expect(attemptTransition).toHaveBeenCalledTimes(1);
    expect(attemptTransition.mock.calls[0][0]).toMatchObject({
      toStage: 'Intake',
      context: expect.objectContaining({
        system: true,
        extraFields: expect.objectContaining({ soc_completed_date: '2026-06-15' }),
      }),
    });
  });

  it('refuses cleanly when the transition is blocked', async () => {
    attemptTransition.mockReturnValueOnce({ allowed: false, reason: 'nope' });
    const out = await completeVisit({ referral: { _id: 'rec_4', current_stage: 'Pre-SOC' } });
    expect(out.ok).toBe(false);
    expect(applyTransition).not.toHaveBeenCalled();
  });
});

describe('legacy post-visit rows keep finishing through their existing paths', () => {
  it('docs complete moves a legacy Post Visit Intake row → Post Visit Clinical Review', async () => {
    const referral = {
      _id: 'rec_5',
      id: 'ref_5',
      current_stage: 'Post Visit Intake',
      documentation_deferred: true,
      soc_completed_date: '2026-06-15',
    };
    const out = await markDocsCompleteAndSendToClinical(referral, { actorUserId: 'usr_a' });

    expect(out).toMatchObject({ ok: true, sentToClinical: true });
    expect(attemptTransition).toHaveBeenCalledWith(expect.objectContaining({
      toStage: 'Post Visit Clinical Review',
      context: expect.objectContaining({ system: true }),
    }));
    expect(applyTransition).toHaveBeenCalled();
  });

  it('legacy flag-based case (stage not Post Visit Intake) stays flag-only', async () => {
    const referral = {
      _id: 'rec_6',
      id: 'ref_6',
      current_stage: 'SOC Completed',
      documentation_deferred: true,
    };
    const out = await markDocsCompleteAndSendToClinical(referral, { actorUserId: 'usr_a' });

    expect(out).toMatchObject({ ok: true, sentToClinical: true });
    expect(attemptTransition).not.toHaveBeenCalled();
    expect(updateReferralOptimistic).toHaveBeenCalled();
  });

  it('clearing the docs hold finishes a Post Visit Intake case whose clinical is done', async () => {
    const referral = {
      _id: 'rec_7',
      id: 'ref_7',
      current_stage: 'Post Visit Intake',
      documentation_deferred: true,
      clinical_review_completed_at: '2026-07-01T00:00:00Z',
      soc_completed_date: '2026-06-15',
    };
    const out = await clearDocumentationDeferred(referral, { actorUserId: 'usr_a' });

    expect(out).toMatchObject({ ok: true, cleared: true });
    expect(attemptTransition).toHaveBeenCalledWith(expect.objectContaining({
      toStage: 'Completed',
    }));
  });
});

describe('stage rules retained for legacy rows', () => {
  it('keeps the legacy ping-pong edges so parked rows can finish', () => {
    expect(StageRules.stages['Post Visit Intake'].canMoveTo).toContain('Post Visit Clinical Review');
    expect(StageRules.stages['Post Visit Clinical Review'].canMoveTo).toContain('Post Visit Intake');
    expect(StageRules.stages['Post Visit Clinical Review'].canMoveTo).toContain('Completed');
  });

  it('keeps Completed terminal', () => {
    expect(StageRules.stages['Completed'].terminal).toBe(true);
    expect(StageRules.stages['Completed'].canMoveTo).toEqual([]);
  });
});
