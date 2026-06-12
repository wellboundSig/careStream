/**
 * Guard registry — named, pure precondition predicates for stage entry.
 *
 * Each guard is `(referral, ctx) => { ok: boolean, reason: string }`. They are
 * referenced BY NAME from StageRules.json (`entryGuards`) so the rules stay
 * declarative and every guard is independently unit-testable.
 *
 * IMPORTANT (migration policy): we are NOT tightening rules during the engine
 * migration. These guards exist and are tested, but StageRules currently wires
 * none of them as blocking `entryGuards` — behavior is preserved verbatim. The
 * "sign-off pass" (see the plan) is where leadership decides which guards
 * become blocking by adding them to `entryGuards` in StageRules.json.
 *
 * `ctx` may carry: { world } (store slices), and UI-supplied flags when a guard
 * needs in-progress state the referral doesn't yet hold.
 */

const VALID_CLINICAL_DECISIONS = new Set(['accept', 'conditional']);

export const GUARDS = {
  // Clinical RN decision recorded — gate into EMR Onboarding from Clinical.
  clinicalDecisionRecorded: (referral) => ({
    ok: VALID_CLINICAL_DECISIONS.has(referral?.clinical_review_decision),
    reason: 'A clinical review decision (Accept or Conditional) is required first.',
  }),

  // Eligibility completed — half of the LIFO gate into EMR Onboarding.
  eligibilityComplete: (referral) => ({
    ok: !!referral?.eligibility_completed_at,
    reason: 'Eligibility must be completed first.',
  }),

  // SOC date chosen — gate into SOC Scheduled.
  socDateSet: (referral) => ({
    ok: !!referral?.soc_scheduled_date,
    reason: 'A Start-of-Care date must be selected first.',
  }),

  // Intake owner assigned — gate out of Lead Entry into Intake.
  intakeOwnerAssigned: (referral) => ({
    ok: !!referral?.intake_owner_id,
    reason: 'An intake owner must be assigned.',
  }),
};

/**
 * Run a list of guard names against a referral. Returns the FIRST failure, or
 * { ok: true } if all pass. Unknown guard names are skipped (non-fatal) so a
 * typo in StageRules never hard-blocks a transition.
 *
 * @param {string[]} names
 * @param {object} referral
 * @param {object} [ctx]
 * @returns {{ ok: boolean, reason?: string, failed?: string }}
 */
export function runGuards(names = [], referral, ctx = {}) {
  for (const name of names) {
    const guard = GUARDS[name];
    if (!guard) continue;
    const result = guard(referral, ctx) || {};
    if (!result.ok) return { ok: false, reason: result.reason || `Guard "${name}" failed.`, failed: name };
  }
  return { ok: true };
}
