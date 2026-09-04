/**
 * Visit completion — status-quo concurrent flow.
 *
 * Visits and paperwork run side by side for ALL cases. Marking the SOC/ROC
 * visit complete stamps the durable `soc_completed_date` and then:
 *
 *   paperwork done (clinical review completed) → 'Completed' (terminal)
 *   paperwork still open                       → the case keeps working in
 *                                                Intake (no special stage)
 *
 * The old deferred-docs machinery (documentation_deferred flag, 30-day
 * clock, 'Post Visit Intake' / 'Post Visit Clinical Review' stages) is
 * DEPRECATED in this UI: we never stamp or route into it anymore. Legacy
 * rows already carrying those flags/stages still render and finish through
 * their existing paths — nothing in the DB schema or old-UI behavior changes.
 */

import { attemptTransition, applyTransition } from '../engine/transitionEngine.js';
import { updateReferralOptimistic } from '../store/mutations.js';
import { recordActivity } from '../api/activityLog.js';
import { hasClinicalCompleted } from './documentationDeferred.js';

export const VISIT_COMPLETED_STAGE = 'SOC Completed';
export const COMPLETED_STAGE = 'Completed';
export const INTAKE_STAGE = 'Intake';

// Stages where post-visit paperwork already has a working surface — the case
// stays put and just gets the completion stamp.
const PAPERWORK_STAGES = new Set([
  'Intake',
  'F2F/MD Orders Pending',
  'Clinical Intake RN Review',
  'Eligibility Verification',
  'EMR Onboarding',
  'Conflict',
  'Hold',
]);

/**
 * Where a case goes right after its visit is marked complete.
 * @returns {'Completed'|'Intake'|null} null = stay in the current stage
 */
export function postVisitDestination(referral) {
  if (hasClinicalCompleted(referral)) return COMPLETED_STAGE;
  if (PAPERWORK_STAGES.has(referral?.current_stage)) return null;
  // Linear pipeline stages (Pre-SOC / SOC Scheduled / Staffing Feasibility /
  // legacy SOC Completed) make no sense once the visit happened — paperwork
  // continues in Intake.
  return INTAKE_STAGE;
}

/**
 * Mark the SOC/ROC visit complete and route the case onward.
 *
 * @param {object} args
 * @param {object} args.referral        Referral row (store-shaped, `_id` required).
 * @param {string} [args.appUserId]     Acting user's business id.
 * @param {string} [args.completedDate] Calendar date (YYYY-MM-DD) the visit
 *   happened. Backdatable — the visit may have already happened.
 * @param {object} [args.extraFields]   Extra fields for the write.
 * @returns {Promise<{ ok: boolean, destination: string|null, reason?: string }>}
 */
export async function completeVisit({ referral, appUserId, completedDate, extraFields = {} }) {
  if (!referral?._id) return { ok: false, reason: 'No referral selected.', destination: null };
  const date = completedDate || new Date().toISOString().slice(0, 10);

  const stampFields = {
    soc_completed_date: date,
    ...extraFields,
  };

  const destination = postVisitDestination(referral);

  if (destination === COMPLETED_STAGE) {
    // Paperwork already approved — pass through Visit Completed for stage
    // history, then finish.
    const first = attemptTransition({
      referral,
      toStage: VISIT_COMPLETED_STAGE,
      context: { system: true, actorUserId: appUserId, extraFields: stampFields },
    });
    if (!first.allowed) return { ok: false, reason: first.reason, destination: null };
    await applyTransition({ referral, result: first, context: { actorUserId: appUserId } });

    const afterFirst = { ...referral, ...first.fieldUpdates };
    const second = attemptTransition({
      referral: afterFirst,
      toStage: COMPLETED_STAGE,
      context: {
        system: true,
        actorUserId: appUserId,
        note: '[Visit completed — paperwork already approved → Completed]',
      },
    });
    if (second.allowed) {
      await applyTransition({ referral: afterFirst, result: second, context: { actorUserId: appUserId } });
    }
    return { ok: true, destination: second.allowed ? COMPLETED_STAGE : VISIT_COMPLETED_STAGE };
  }

  if (destination === INTAKE_STAGE) {
    // Case was parked in a linear pipeline stage — move it back to Intake so
    // the remaining paperwork has a working surface.
    const result = attemptTransition({
      referral,
      toStage: INTAKE_STAGE,
      context: {
        system: true,
        actorUserId: appUserId,
        extraFields: stampFields,
        note: '[Visit completed — paperwork continues in Intake]',
      },
    });
    if (!result.allowed) return { ok: false, reason: result.reason, destination: null };
    await applyTransition({ referral, result, context: { actorUserId: appUserId } });
    return { ok: true, destination: INTAKE_STAGE };
  }

  // Already on a paperwork surface (usually Intake) — stamp only, no stage
  // move, no stage-history noise. The SOC-done chip + post-visit tint pick
  // the case up from the durable stamp.
  await updateReferralOptimistic(referral._id, stampFields);
  recordActivity({
    actorUserId: appUserId,
    action: 'SOC/ROC Visit Completed',
    patientId: referral.patient_id,
    referralId: referral.id,
    detail: `Visit completed ${date} (paperwork continues in ${referral.current_stage})`,
  }).catch(() => {});
  return { ok: true, destination: null };
}
