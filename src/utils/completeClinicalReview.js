/**
 * Finish Clinical RN review: stamp the decision and leave the Clinical queue.
 * Used by the module panel and the patient-drawer tab so Confirm always
 * writes — including when the referral is still on Intake / F2F / Eligibility.
 */
import { attemptTransition, applyTransition } from '../engine/transitionEngine.js';
import { updateReferralOptimistic } from '../store/mutations.js';
import { triggerDataRefresh } from '../hooks/useRefreshTrigger.js';
import { normalizeClinicalDecision } from '../data/clinicalChecklist.js';
import { postSocClinicalCompleteClearFields } from './requestPostSocClinicalReview.js';
import {
  maybeClearDocumentationDeferred,
  clinicalConfirmDestination,
  CLINICAL_CONFIRM_SOC_COMPLETED,
  CLINICAL_CONFIRM_EMR,
} from './documentationDeferred.js';

export function resolveClinicalConfirmDecision(workingDecision, referral) {
  return normalizeClinicalDecision(workingDecision)
    || normalizeClinicalDecision(referral?.clinical_review_decision);
}

export async function completeClinicalReview({
  referral,
  decision,
  appUserId,
  onLeftModule,
}) {
  if (!referral?._id) throw new Error('No referral selected.');
  const normalized = resolveClinicalConfirmDecision(decision, referral);
  if (!normalized) throw new Error('Choose Accept or Conditional, then confirm.');

  const now = new Date().toISOString();
  const clinicalFields = {
    clinical_review_decision: normalized,
    clinical_review_by: appUserId || 'unknown',
    clinical_review_at: now,
    clinical_review_completed_at: now,
    clinical_review_completed_by_id: appUserId || 'unknown',
    in_clinical_review: false,
    ...postSocClinicalCompleteClearFields(),
  };

  const destination = clinicalConfirmDestination(referral);

  if (destination === CLINICAL_CONFIRM_SOC_COMPLETED) {
    if (referral.current_stage !== 'SOC Completed') {
      const result = attemptTransition({
        referral,
        toStage: 'SOC Completed',
        context: {
          system: true,
          actorUserId: appUserId,
          extraFields: clinicalFields,
          note: '[Post-SOC clinical completed → SOC Completed]',
        },
      });
      if (result.allowed) {
        onLeftModule?.();
        await applyTransition({ referral, result, context: { actorUserId: appUserId } });
      } else {
        await updateReferralOptimistic(referral._id, {
          ...clinicalFields,
          current_stage: 'SOC Completed',
        });
        onLeftModule?.();
      }
    } else {
      await updateReferralOptimistic(referral._id, clinicalFields);
      onLeftModule?.();
    }
    await maybeClearDocumentationDeferred(
      { ...referral, ...clinicalFields },
      { actorUserId: appUserId, source: 'clinical_post_soc' },
    );
    triggerDataRefresh();
    return { ok: true, destination };
  }

  if (destination == null) {
    await updateReferralOptimistic(referral._id, clinicalFields);
    await maybeClearDocumentationDeferred(
      { ...referral, ...clinicalFields },
      { actorUserId: appUserId, source: 'clinical_post_soc' },
    );
    onLeftModule?.();
    triggerDataRefresh();
    return { ok: true, destination: null };
  }

  const toStage = destination === CLINICAL_CONFIRM_EMR ? 'EMR Onboarding' : destination;
  const result = attemptTransition({
    referral,
    toStage,
    context: {
      system: true,
      note: `[Clinical RN ${normalized === 'conditional' ? 'conditionally accepted' : 'accepted'} → EMR Onboarding]`,
      actorUserId: appUserId,
      extraFields: clinicalFields,
    },
  });
  if (!result.allowed) {
    throw new Error(result.reason || 'Cannot move this referral to EMR Onboarding.');
  }
  onLeftModule?.();
  await applyTransition({ referral, result, context: { actorUserId: appUserId } });
  triggerDataRefresh();
  return { ok: true, destination: toStage };
}
