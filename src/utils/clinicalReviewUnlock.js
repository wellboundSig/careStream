/**
 * Unlock a clinical review so checklist / decision can be corrected.
 *
 * Clears ClinicalReview.decision in the database (so every user sees it
 * unlocked). If Confirm already stamped the referral, also clears those
 * stamps and returns the patient to Clinical Intake RN Review when needed.
 */

import { attemptTransition, applyTransition } from '../engine/transitionEngine.js';
import { updateReferralOptimistic, createNoteOptimistic } from '../store/mutations.js';
import { upsertClinicalReview, dbToUiFields } from '../api/clinicalReviews.js';
import { recordActivity } from '../api/activityLog.js';
import { useCareStore, mergeEntities } from '../store/careStore.js';
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

function findClinicalReviewRow(referralRecordId) {
  if (!referralRecordId) return null;
  const rows = useCareStore.getState().clinicalReviews || {};
  for (const row of Object.values(rows)) {
    const link = Array.isArray(row.referral_id) ? row.referral_id[0] : row.referral_id;
    if (link === referralRecordId) return row;
  }
  return null;
}

/**
 * Persist decision=null on the ClinicalReview row and mirror the store.
 * This is what makes Unlock stick for other users after refresh.
 */
async function clearWorkingDecisionInDb(referralRecordId) {
  const existing = findClinicalReviewRow(referralRecordId);
  const existingId = existing?._id && !String(existing._id).startsWith('_pending_')
    ? existing._id
    : undefined;

  const updated = await upsertClinicalReview({
    referralRecordId,
    checkedUiKeys: dbToUiFields(existing),
    decision: null,
    authRequired: existing?.auth_required === true,
    reviewedBy: existing?.reviewed_by || undefined,
    existingId,
  });

  if (updated?.id) {
    mergeEntities('clinicalReviews', {
      [updated.id]: {
        _id: updated.id,
        ...(existing || {}),
        ...updated.fields,
        decision: null,
        referral_id: [referralRecordId],
      },
    });
  } else if (existing?._id) {
    mergeEntities('clinicalReviews', {
      [existing._id]: { ...existing, decision: null },
    });
  }

  return updated;
}

/**
 * @param {object} opts
 * @param {object} opts.referral
 * @param {string|null} opts.appUserId
 * @param {() => void} [opts.clearWorkingDecision] local UI clear (optional)
 * @param {string} [opts.reason]
 * @param {(fields: object) => void} [opts.onReferralLocal]
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
  const isFinalized = !!referral.clinical_review_decision;
  const noteBody = reason.trim()
    ? `[Clinical review unlocked] ${reason.trim()}`
    : (isFinalized
      ? '[Clinical review unlocked: corrections needed]'
      : '[Clinical review unlocked: Accept cleared for corrections]');

  // 1) Clear Accept in the DB first (source of truth for all users).
  await clearWorkingDecisionInDb(referral._id);

  // 2) Clear local hook state so this screen unlocks immediately.
  try { clearWorkingDecision?.(); } catch { /* non-fatal */ }

  if (!isFinalized) {
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
        ? `Working Accept cleared: ${reason.trim()}`
        : 'Working Accept/Conditional cleared for corrections.',
      metadata: { mode: 'working', stage: referral.current_stage },
    }).catch(() => {});

    triggerDataRefresh();
    return { ok: true, mode: 'working', returnedToClinical: false };
  }

  const fields = clinicalUnlockFields();
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
      mode: 'finalized',
      fromStage: referral.current_stage,
      toStage: CLINICAL_RN_STAGE,
    },
  }).catch(() => {});

  triggerDataRefresh();
  return { ok: true, mode: 'finalized', returnedToClinical: !alreadyInClinical };
}
