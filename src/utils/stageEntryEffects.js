// stageEntryEffects — side effects applied when a referral ENTERS a stage.
//
// Returns the extra Referrals fields to merge into the stage-change update,
// and performs any audit/timeline logging the entry requires. Centralised here
// so every transition entry point (ModulePage.executeTransition, PipelineBoard,
// PatientList) behaves identically.
//
// Currently handles the Eligibility Verification RE-CHECK: moving a patient
// into Eligibility Verification is a deliberate request for a fresh insurance
// check, so we clear the prior completion (which re-locks the "Eligibility
// Complete" button until new checks are logged) and remember where to send the
// patient back once re-completed. History is preserved — EligibilityVerification
// rows are never deleted, and the prior completion is logged to the Timeline
// (Note) and the Activity Log.

import { recordActivity } from '../api/activityLog.js';
import { createNote } from '../api/notes.js';

/**
 * @param {object} args
 * @param {object} args.referral        Referral being moved (pre-move state)
 * @param {string} args.fromStage
 * @param {string} args.toStage
 * @param {string} [args.actorUserId]
 * @param {(userId: string) => string} [args.resolveUserName] optional display-name resolver for the audit note
 * @returns {object} extra fields to merge into the Referrals update
 */
export function applyStageEntryEffects({ referral, fromStage, toStage, actorUserId, resolveUserName }) {
  const extra = {};

  if (toStage === 'Eligibility Verification') {
    const priorAt = referral?.eligibility_completed_at || '';
    const priorBy = referral?.eligibility_completed_by_id || '';

    // Clear the prior completion + stamp the re-check so the Complete button
    // re-locks until fresh checks land. Remember the origin stage so we can
    // return the patient there once re-completed.
    extra.eligibility_completed_at = '';
    extra.eligibility_completed_by_id = '';
    extra.eligibility_recheck_requested_at = new Date().toISOString();
    extra.eligibility_recheck_return_stage = fromStage || '';

    // Preserve history of the prior completion (best-effort, never blocks).
    if (priorAt) {
      const who = (resolveUserName && resolveUserName(priorBy)) || priorBy || 'unknown';
      let when = priorAt;
      try { when = new Date(priorAt).toLocaleString(); } catch { /* keep raw */ }
      const detail = `Eligibility re-check requested — prior completion (${when} by ${who}) cleared; a fresh check is required.`;
      const now = new Date().toISOString();

      if (referral?.patient_id) {
        createNote({
          id:          `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          patient_id:  referral.patient_id,
          referral_id: referral.id || null,
          ...(actorUserId ? { author_id: actorUserId } : {}),
          content:     `[Eligibility Re-check]\n${detail}`,
          is_pinned:   false,
          created_at:  now,
          updated_at:  now,
        }).catch(() => { /* best-effort timeline note */ });
      }

      recordActivity({
        actorUserId,
        action:     'Eligibility Re-check Requested',
        patientId:  referral?.patient_id,
        referralId: referral?.id,
        detail,
        metadata:   { priorCompletedAt: priorAt, priorCompletedBy: priorBy, fromStage },
      });
    }
  }

  return extra;
}
