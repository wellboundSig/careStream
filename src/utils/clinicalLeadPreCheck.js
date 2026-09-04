/**
 * Clinical Lead Pre-Check — first glance by Clinical before a lead is a
 * regular Lead Entry case. Concurrent in Leads and Clinical Review until
 * Mark Viable (or a supervisor moves it to Intake anyway).
 */

import { attemptTransition, applyTransition } from '../engine/transitionEngine.js';
import { recordActivity } from '../api/activityLog.js';
import { triggerDataRefresh } from '../hooks/useRefreshTrigger.js';

export const CLINICAL_LEAD_PRECHECK_STAGE = 'Clinical Lead Pre-Check';

export function defaultLeadStage({ division, code_95 } = {}) {
  if (division === 'Special Needs' && code_95 === 'no') return 'OPWDD Enrollment';
  return CLINICAL_LEAD_PRECHECK_STAGE;
}

export function isClinicalLeadPreCheck(referral) {
  return referral?.current_stage === CLINICAL_LEAD_PRECHECK_STAGE;
}

export function isClinicalLeadPreCheckApproved(referral) {
  const d = referral?.clinical_lead_precheck_approved_at;
  return d != null && d !== '' && d !== false;
}

/** Restore destination after Discarded: keep the clinical glance if it never happened. */
export function restoreLeadStage(referral) {
  return isClinicalLeadPreCheckApproved(referral) ? 'Lead Entry' : CLINICAL_LEAD_PRECHECK_STAGE;
}

export function needsPreCheckIntakeWarning(referral) {
  return isClinicalLeadPreCheck(referral);
}

export function hoursToClinicalLeadPreCheck(referral) {
  const start = referral?.referral_date || referral?.created_at;
  const end = referral?.clinical_lead_precheck_approved_at;
  if (!start || !end) return null;
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.round((ms / 3600000) * 10) / 10;
}

export function clinicalLeadPreCheckStampFields({ appUserId, at } = {}) {
  const now = at || new Date().toISOString();
  return {
    clinical_lead_precheck_approved_at: now,
    clinical_lead_precheck_approved_by_id: appUserId || 'unknown',
  };
}

export async function markClinicalLeadViable({ referral, appUserId, onLeftModule }) {
  if (!referral?._id) throw new Error('No referral selected.');
  if (!isClinicalLeadPreCheck(referral)) {
    throw new Error('This lead is not in Clinical Lead Pre-Check.');
  }

  const stamp = clinicalLeadPreCheckStampFields({ appUserId });
  const result = attemptTransition({
    referral,
    toStage: 'Lead Entry',
    context: {
      system: true,
      actorUserId: appUserId,
      extraFields: stamp,
      note: '[Clinical lead pre-check: viable]',
    },
  });
  if (!result.allowed) throw new Error(result.reason || 'Could not mark viable.');

  onLeftModule?.();
  await applyTransition({ referral, result, context: { actorUserId: appUserId } });
  recordActivity({
    actorUserId: appUserId,
    action: 'Clinical Lead Pre-Check Approved',
    patientId: referral.patient_id,
    referralId: referral.id,
    detail: 'Marked viable. Lead continues in Lead Entry.',
  }).catch(() => {});
  triggerDataRefresh();
  return { ok: true, ...stamp };
}
