/**
 * Referral invariants — the rules that must ALWAYS hold for a referral,
 * independent of how it got into its current state.
 *
 * `assertReferralInvariants(referral, world)` returns an array of violations
 * (empty = healthy). It is intentionally pure and dependency-light so it can
 * be reused in three places:
 *   1. As a dev-only post-write sanity check inside the transition executor.
 *   2. As the oracle for property-based tests (src/engine/__tests__).
 *   3. As a nightly production scan (scripts/check-invariants.js).
 *
 * Severities:
 *   - 'error': a state that should be impossible; investigate immediately.
 *   - 'warn':  a state that's suspicious or indicates incomplete data; may be
 *              legitimate for legacy rows.
 */

// Import attribute (`with { type: 'json' }`) keeps this module runnable under
// plain Node (scripts/check-invariants.js) as well as Vite/vitest. The rest of
// the app imports StageRules.json bare via Vite, which is also fine.
import StageRules from '../data/StageRules.json' with { type: 'json' };

const STAGES = StageRules.stages;

// Stages at or after EMR Onboarding — by this point the Clinical RN decision
// must already be recorded (it's the gate into EMR Onboarding).
const POST_CLINICAL_STAGES = new Set([
  'EMR Onboarding',
  'Staffing Feasibility',
  'Pre-SOC',
  'SOC Scheduled',
  'SOC Completed',
]);

const OPEN_CONFLICT_STATUSES = new Set(['Open', 'Unaddressed', 'In Progress']);
const VALID_CLINICAL_DECISIONS = new Set(['accept', 'conditional']);

function asArray(slice) {
  if (!slice) return [];
  return Array.isArray(slice) ? slice : Object.values(slice);
}

function linkMatches(value, id) {
  if (value == null) return false;
  return Array.isArray(value) ? value.includes(id) : value === id;
}

/**
 * @param {object} referral  A referral record (store-shaped: `_id`, `id`, `current_stage`, ...).
 * @param {object} [world]   Optional related data: `{ conflicts, stageHistory }`
 *                           as arrays or id-keyed maps (the zustand store shape).
 * @returns {Array<{ code: string, severity: 'error'|'warn', message: string }>}
 */
export function assertReferralInvariants(referral, world = {}) {
  const violations = [];
  if (!referral) return violations;

  const stage = referral.current_stage;
  const label = referral.id || referral._id || 'unknown referral';

  // 1. Stage must be present and known.
  if (!stage) {
    violations.push({ code: 'MISSING_STAGE', severity: 'error', message: `${label} has no current_stage.` });
    return violations; // nothing else is meaningful without a stage
  }
  if (!STAGES[stage]) {
    violations.push({ code: 'UNKNOWN_STAGE', severity: 'error', message: `${label} is in unknown stage "${stage}".` });
    return violations;
  }

  // 2. No OPEN conflicts unless the referral is actually sitting in Conflict.
  //    (This is exactly the data-hygiene rule the auto-resolve-on-exit fix
  //    enforces; a violation means a conflict was left open after routing out.)
  if (stage !== 'Conflict') {
    const openConflicts = asArray(world.conflicts).filter((c) =>
      linkMatches(c.referral_id, referral.id) && OPEN_CONFLICT_STATUSES.has(c.status));
    if (openConflicts.length > 0) {
      violations.push({
        code: 'OPEN_CONFLICT_OFF_STAGE',
        severity: 'error',
        message: `${label} is in "${stage}" but has ${openConflicts.length} open conflict(s).`,
      });
    }
  }

  // 3. Anything at/after EMR Onboarding must carry a clinical review decision.
  if (POST_CLINICAL_STAGES.has(stage) && !VALID_CLINICAL_DECISIONS.has(referral.clinical_review_decision)) {
    violations.push({
      code: 'CLINICAL_DECISION_REQUIRED',
      severity: 'error',
      message: `${label} reached "${stage}" without a clinical_review_decision.`,
    });
  }

  // 4. SOC stages must carry their dates.
  if ((stage === 'SOC Scheduled') && !referral.soc_scheduled_date) {
    violations.push({ code: 'SOC_DATE_REQUIRED', severity: 'error', message: `${label} is "SOC Scheduled" with no soc_scheduled_date.` });
  }
  if ((stage === 'SOC Completed') && !referral.soc_completed_date) {
    violations.push({ code: 'SOC_DATE_REQUIRED', severity: 'warn', message: `${label} is "SOC Completed" with no soc_completed_date.` });
  }

  // 5. Eligibility re-check consistency: a pending re-check should have cleared
  //    the prior completion (the re-check gate re-locks Eligibility Complete).
  if (referral.eligibility_recheck_requested_at && referral.eligibility_completed_at) {
    violations.push({
      code: 'RECHECK_INCONSISTENT',
      severity: 'warn',
      message: `${label} has both a pending eligibility re-check and a completion timestamp.`,
    });
  }

  // 6. Hold must remember where to return.
  if (stage === 'Hold' && !referral.hold_return_stage) {
    violations.push({ code: 'HOLD_NO_RETURN', severity: 'warn', message: `${label} is on Hold with no hold_return_stage to release back to.` });
  }

  // 7. Audit trail: a referral past the first stage should have at least one
  //    StageHistory row (only checked when history is supplied).
  if (world.stageHistory !== undefined && stage !== 'Lead Entry' && stage !== 'OPWDD Enrollment') {
    const hasHistory = asArray(world.stageHistory).some((h) => linkMatches(h.referral_id, referral.id));
    if (!hasHistory) {
      violations.push({ code: 'MISSING_AUDIT', severity: 'warn', message: `${label} is in "${stage}" with no StageHistory rows.` });
    }
  }

  return violations;
}

/**
 * Scan an entire world (store-shaped) and return every referral with at least
 * one violation. Used by the property tests and the production scan.
 *
 * @param {object} world  `{ referrals, conflicts, stageHistory }` (maps or arrays).
 * @param {{ minSeverity?: 'warn'|'error' }} [opts]
 * @returns {Array<{ referral: object, violations: Array }>}
 */
export function findInvariantViolations(world = {}, { minSeverity = 'warn' } = {}) {
  const referrals = asArray(world.referrals);
  const out = [];
  for (const referral of referrals) {
    let violations = assertReferralInvariants(referral, world);
    if (minSeverity === 'error') violations = violations.filter((v) => v.severity === 'error');
    if (violations.length > 0) out.push({ referral, violations });
  }
  return out;
}
