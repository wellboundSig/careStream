/**
 * Property-based / model-based transition tests.
 *
 * Rather than enumerate journeys, we let fast-check generate thousands of
 * random move sequences and assert that INVARIANTS always hold — catching the
 * "move to X, back, sideways twice" bugs no human writes a test for. When a
 * failure is found, fast-check shrinks it to the minimal reproducing sequence.
 *
 * The model mirrors how the real doors move: when a transition lands on a stage
 * that requires data (clinical decision for post-clinical stages, SOC dates for
 * SOC stages), the model sets those fields too — exactly as the Clinical Confirm
 * / SOC panels do. So a clean random walk should never produce an error-level
 * invariant violation; if it does, the engine or rules are wrong.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import StageRules from '../../data/StageRules.json';
import { canMoveFromTo } from '../../utils/stageTransitions.js';
import { attemptTransition } from '../transitionEngine.js';
import { assertReferralInvariants } from '../invariants.js';

const ALL_STAGE_NAMES = Object.keys(StageRules.stages);
const POST_CLINICAL = new Set(['EMR Onboarding', 'Staffing Feasibility', 'Pre-SOC', 'SOC Scheduled', 'SOC Completed']);

// Mirror the data the real doors stamp when landing on a stage, so a legal
// walk keeps the referral's required fields populated.
function modelFieldsFor(stage) {
  const extra = {};
  if (POST_CLINICAL.has(stage)) extra.clinical_review_decision = 'accept';
  if (stage === 'SOC Scheduled') extra.soc_scheduled_date = '2026-07-01';
  if (stage === 'SOC Completed') extra.soc_completed_date = '2026-07-02';
  return extra;
}

function errorViolations(referral) {
  return assertReferralInvariants(referral, { conflicts: [] }).filter((v) => v.severity === 'error');
}

describe('property: engine allow-decision matches the edge rules', () => {
  it('attemptTransition.allowed === canMoveFromTo for every (from, to) pair', () => {
    fc.assert(fc.property(
      fc.constantFrom(...ALL_STAGE_NAMES),
      fc.constantFrom(...ALL_STAGE_NAMES),
      (fromStage, toStage) => {
        const referral = { _id: 'rec_x', id: 'ref_x', current_stage: fromStage };
        const result = attemptTransition({ referral, toStage });
        expect(result.allowed).toBe(canMoveFromTo(fromStage, toStage));
      },
    ), { numRuns: 400 });
  });
});

describe('property: any legal random walk preserves invariants', () => {
  it('never lands in an unknown stage and never violates an error-level invariant', () => {
    fc.assert(fc.property(
      fc.array(fc.constantFrom(...ALL_STAGE_NAMES), { minLength: 1, maxLength: 40 }),
      (sequence) => {
        let referral = { _id: 'rec_x', id: 'ref_x', current_stage: 'Lead Entry' };
        for (const toStage of sequence) {
          const result = attemptTransition({ referral, toStage, context: { note: 'n' } });
          if (!result.allowed) continue; // illegal moves are correctly refused — referral unchanged
          referral = { ...referral, ...result.fieldUpdates, ...modelFieldsFor(result.effectiveStage) };
          // Structural: always a known stage.
          expect(ALL_STAGE_NAMES).toContain(referral.current_stage);
          // No error-level invariant violations after a legal, data-complete move.
          expect(errorViolations(referral)).toEqual([]);
        }
      },
    ), { numRuns: 300 });
  });
});

describe('property: terminal stages are dead ends in any sequence', () => {
  it('once a referral reaches a terminal stage, no further move is allowed', () => {
    const terminals = ALL_STAGE_NAMES.filter((s) => StageRules.stages[s].terminal);
    fc.assert(fc.property(
      fc.constantFrom(...terminals),
      fc.array(fc.constantFrom(...ALL_STAGE_NAMES), { minLength: 1, maxLength: 20 }),
      (terminal, sequence) => {
        const referral = { _id: 'rec_x', id: 'ref_x', current_stage: terminal };
        for (const toStage of sequence) {
          expect(attemptTransition({ referral, toStage }).allowed).toBe(false);
        }
      },
    ), { numRuns: 200 });
  });
});
