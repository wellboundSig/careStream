/**
 * Unlock a finalized Clinical RN review so checklist / decision can be
 * corrected and Accept → Confirm can be run again.
 *
 * Clears referral confirmation stamps, clears the working clinical_review
 * decision (via caller), and returns the patient to Clinical Intake RN Review
 * when they have already left that stage (e.g. EMR Onboarding).
 */

import { attemptTransition, applyTransition } from '../engine/transitionEngine.js';
import { updateReferralOptimistic, createNoteOptimistic } from '../store/mutations.js';
import { recordActivity } from '../api/activityLog.js';
import { triggerDataRefresh } from '../hooks/useRefreshTrigger.js';

export const CLINICAL_RN_STAGE = 'Clinical Intake RN Review';

/** Referral fields cleared/restored when unlocking a finalized review. */
export function clinicalUnlockFields() {
  return {
    clinical_review_decision: null,
    clinical_review_completed_at: null,
    clinical_review_completed_by_id: null,
    clinical_review_at: null,
    clinical_review_by: null,
    in_clinical_review: true,
    returned_from_clinical: false,
    returned_from_clinical_note: '',
    returned_from_clinical_at: null,
    returned_from_clinical_by: null,
  };
}

/**
 * @param {object} opts
 * @param {object} opts.referral — store referral (needs _id, id, current_stage)
 * @param {string|null} opts.appUserId
 * @param {() => void} [opts.clearWorkingDecision] — e.g. setDecision(null)
 * @param {string} [opts.reason]
 * @param {(fields: object) => void} [opts.onReferralLocal] — drawer local patch
 */
export async function unlockClinicalReview({
  referral,
  appUserId,
  clearWorkingDecision,
  reason = '',
  onReferralLocal,
} = {}) {
  if (!referral?._id) throw new Error('No referral selected');

  const now = new Date().toISOString();
  const noteBody = reason.trim()
    ? `[Clinical review unlocked] ${reason.trim()}`
    : '[Clinical review unlocked — corrections needed]';
  const fields = clinicalUnlockFields();

  // Clear working Accept/Conditional on the ClinicalReview row first.
  try { clearWorkingDecision?.(); } catch { /* non-fatal */ }

  const alreadyInClinical = referral.current_stage === CLINICAL_RN_STAGE;

  if (alreadyInClinical) {
    await updateReferralOptimistic(referral._id, { ...fields, updated_at: now });
    onReferralLocal?.(fields);
  } else {
    const result = attemptTransition({
      referral,
      toStage: CLINICAL_RN_STAGE,
      context: {
        system: true,
        note: noteBody,
        actorUserId: appUserId,
        extraFields: fields,
      },
    });
    if (!result.allowed) {
      throw new Error(result.reason || 'Cannot return patient to Clinical RN Review');
    }
    await applyTransition({
      referral,
      result,
      context: { actorUserId: appUserId },
    });
    onReferralLocal?.({ ...fields, current_stage: CLINICAL_RN_STAGE });
  }

  if (referral.patient_id || referral.patient?.id) {
    const patientId = referral.patient_id || referral.patient?.id;
    createNoteOptimistic({
      id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      patient_id: patientId,
      author_id: appUserId,
      content: noteBody,
      created_at: now,
      updated_at: now,
      ...(referral.id ? { referral_id: referral.id } : {}),
    }).catch(() => {});
  }

  await recordActivity({
    actorUserId: appUserId,
    action: 'Clinical Review Unlocked',
    patientId: referral.patient_id || referral.patient?.id,
    referralId: referral.id,
    detail: reason.trim()
      ? `Clinical review unlocked: ${reason.trim()}`
      : 'Clinical review unlocked for corrections.',
    metadata: {
      fromStage: referral.current_stage,
      toStage: CLINICAL_RN_STAGE,
    },
  }).catch(() => {});

  triggerDataRefresh();
  return { ok: true, returnedToClinical: !alreadyInClinical };
}
