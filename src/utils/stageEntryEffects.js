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

  // Conflict is exclusive. Clear the concurrent Clinical Review handoff so
  // the case leaves that queue the moment current_stage becomes Conflict.
  if (toStage === 'Conflict') {
    extra.in_clinical_review = false;
  }

  // NTUC outcome date — marketer performance credits NTUC to the period it
  // was RESOLVED in (same as soc_completed_date for SOC), not when the
  // referral came in. Stamp on entry; clear when a case is re-opened out of
  // NTUC so a rescued referral never counts as a loss. Re-NTUC restamps.
  if (toStage === 'NTUC' && fromStage !== 'NTUC') {
    extra.ntuc_date = new Date().toISOString();
  } else if (fromStage === 'NTUC' && toStage !== 'NTUC') {
    // null (NOT '') — the API's timestamp validation 422s on empty strings.
    extra.ntuc_date = null;
  }

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
