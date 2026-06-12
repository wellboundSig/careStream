/**
 * Table-driven transition coverage.
 *
 * Instead of testing whole journeys (combinatorial explosion), we test every
 * EDGE of the graph once, derived directly from StageRules.json:
 *   - every declared edge is allowed by the engine
 *   - terminal stages allow no moves
 *   - every non-terminal active stage can move to Hold (global rule)
 *   - a representative invalid edge per stage is blocked with a reason
 *   - the guard registry + invariants behave per-rule
 *
 * If a transition bug is possible, it shows up here as a failing edge — no
 * 15-factorial journey enumeration required.
 */
import { describe, it, expect } from 'vitest';
import StageRules from '../../data/StageRules.json';
import { attemptTransition } from '../transitionEngine.js';
import { GUARDS, runGuards } from '../guards.js';
import { assertReferralInvariants } from '../invariants.js';

const STAGES = StageRules.stages;
const ALL_STAGE_NAMES = Object.keys(STAGES);

function refAt(stage) {
  return { _id: 'rec_x', id: 'ref_x', current_stage: stage };
}

describe('every declared edge is allowed by the engine', () => {
  for (const [fromStage, rule] of Object.entries(STAGES)) {
    if (rule.terminal) continue;
    for (const toStage of rule.canMoveTo || []) {
      it(`${fromStage} -> ${toStage}`, () => {
        const result = attemptTransition({ referral: refAt(fromStage), toStage });
        expect(result.allowed, result.reason || '').toBe(true);
        // NTUC requests for non-direct users intercept to Admin Confirmation.
        if (toStage === 'NTUC') {
          expect(result.effectiveStage).toBe('Admin Confirmation');
        } else {
          expect(result.fieldUpdates.current_stage).toBe(toStage);
        }
      });
    }
  }
});

describe('terminal stages allow no outbound moves', () => {
  for (const [stage, rule] of Object.entries(STAGES)) {
    if (!rule.terminal) continue;
    it(`${stage} (terminal) blocks every move`, () => {
      for (const toStage of ALL_STAGE_NAMES) {
        if (toStage === stage) continue;
        const result = attemptTransition({ referral: refAt(stage), toStage });
        expect(result.allowed, `${stage} -> ${toStage} should be blocked`).toBe(false);
      }
    });
  }
});

describe('global rule: any active stage can move to Hold', () => {
  for (const [stage, rule] of Object.entries(STAGES)) {
    if (rule.terminal || stage === 'Hold') continue;
    it(`${stage} -> Hold`, () => {
      const result = attemptTransition({ referral: refAt(stage), toStage: 'Hold', context: { note: 'pausing' } });
      expect(result.allowed).toBe(true);
      expect(result.fieldUpdates.hold_return_stage).toBe(stage);
    });
  }
});

describe('representative invalid edges are blocked', () => {
  for (const [fromStage, rule] of Object.entries(STAGES)) {
    if (rule.terminal) continue;
    const allowed = new Set([...(rule.canMoveTo || []), 'Hold', fromStage]);
    const invalidTarget = ALL_STAGE_NAMES.find((s) => !allowed.has(s));
    if (!invalidTarget) continue;
    it(`${fromStage} -> ${invalidTarget} (invalid) is blocked`, () => {
      const result = attemptTransition({ referral: refAt(fromStage), toStage: invalidTarget });
      expect(result.allowed).toBe(false);
      expect(result.reason).toMatch(/Cannot move/);
    });
  }
});

describe('system moves bypass the edge allowlist', () => {
  it('allows an otherwise-invalid edge when context.system is true', () => {
    // Pre-SOC -> SOC Scheduled is NOT a user edge, but is a sanctioned sub-state move.
    const asUser = attemptTransition({ referral: refAt('Pre-SOC'), toStage: 'SOC Scheduled' });
    const asSystem = attemptTransition({ referral: refAt('Pre-SOC'), toStage: 'SOC Scheduled', context: { system: true } });
    expect(asUser.allowed).toBe(false);
    expect(asSystem.allowed).toBe(true);
  });
});

describe('guard registry', () => {
  it('clinicalDecisionRecorded passes only with accept/conditional', () => {
    expect(GUARDS.clinicalDecisionRecorded({ clinical_review_decision: 'accept' }).ok).toBe(true);
    expect(GUARDS.clinicalDecisionRecorded({ clinical_review_decision: 'conditional' }).ok).toBe(true);
    expect(GUARDS.clinicalDecisionRecorded({}).ok).toBe(false);
  });

  it('eligibilityComplete passes only with a completion timestamp', () => {
    expect(GUARDS.eligibilityComplete({ eligibility_completed_at: 'x' }).ok).toBe(true);
    expect(GUARDS.eligibilityComplete({}).ok).toBe(false);
  });

  it('runGuards returns the first failure and skips unknown guard names', () => {
    expect(runGuards(['eligibilityComplete'], {}).ok).toBe(false);
    expect(runGuards(['totallyUnknownGuard'], {}).ok).toBe(true);
    expect(runGuards([], {}).ok).toBe(true);
  });
});

describe('invariants', () => {
  it('flags an EMR-Onboarding referral with no clinical decision', () => {
    const v = assertReferralInvariants(refAt('EMR Onboarding'), {});
    expect(v.some((x) => x.code === 'CLINICAL_DECISION_REQUIRED')).toBe(true);
  });

  it('flags an open conflict on a non-Conflict stage', () => {
    const world = { conflicts: [{ referral_id: 'ref_x', status: 'Open' }] };
    const v = assertReferralInvariants({ ...refAt('Intake') }, world);
    expect(v.some((x) => x.code === 'OPEN_CONFLICT_OFF_STAGE')).toBe(true);
  });

  it('passes a clean Lead Entry referral', () => {
    const v = assertReferralInvariants(refAt('Lead Entry'), { conflicts: [] });
    expect(v).toEqual([]);
  });
});
