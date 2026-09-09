/**
 * Clinical Lead Pre-Check — first glance by Clinical before a lead is a
 * regular Lead Entry case. Concurrent in Leads and Clinical Review until
 * Mark Viable (or a supervisor moves it to Intake anyway).
 */

import { attemptTransition, applyTransition } from '../engine/transitionEngine.js';
import { recordActivity } from '../api/activityLog.js';
import { triggerDataRefresh } from '../hooks/useRefreshTrigger.js';
import { flagConflict, inferConflictSourceModuleFromStage } from './conflictFlagging.js';
import { CONFLICT_SOURCE_MODULE } from '../data/eligibilityEnums.js';
import {
  DEFAULT_CLINICAL_PRECHECK,
  resolveClinicalPreCheckRequirements,
  requiresClinicalPreCheck,
} from '../data/appSettings.js';
import { useCareStore } from '../store/careStore.js';

export const CLINICAL_LEAD_PRECHECK_STAGE = 'Clinical Lead Pre-Check';

export function getClinicalPreCheckRequirements() {
  try {
    return resolveClinicalPreCheckRequirements(useCareStore.getState().appSettings);
  } catch {
    return { ...DEFAULT_CLINICAL_PRECHECK };
  }
}

export function defaultLeadStage({ division, code_95, requirements } = {}) {
  if (division === 'Special Needs' && code_95 === 'no') return 'OPWDD Enrollment';
  const req = requirements || getClinicalPreCheckRequirements();
  return requiresClinicalPreCheck(division, req) ? CLINICAL_LEAD_PRECHECK_STAGE : 'Lead Entry';
}

export function isClinicalLeadPreCheck(referral) {
  return referral?.current_stage === CLINICAL_LEAD_PRECHECK_STAGE;
}

export function isClinicalLeadPreCheckApproved(referral) {
  const d = referral?.clinical_lead_precheck_approved_at;
  return d != null && d !== '' && d !== false;
}

/** Restore destination after Discarded: keep the clinical glance if it never happened. */
export function restoreLeadStage(referral, requirements) {
  if (isClinicalLeadPreCheckApproved(referral)) return 'Lead Entry';
  return defaultLeadStage({
    division: referral?.division,
    code_95: referral?.code_95,
    requirements,
  });
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

/**
 * Clinical glance: this lead is not viable. Same Conflict create + move as
 * Send to Conflict anywhere else, with a required note. The response is
 * posted as a patient note that @mentions Account manager info so every
 * Pending Log viewer is alerted.
 */
export async function markClinicalLeadNotViable({
  referral,
  appUserId,
  actorName,
  conflict,
  onLeftModule,
}) {
  if (!referral?._id) throw new Error('No referral selected.');
  if (!isClinicalLeadPreCheck(referral)) {
    throw new Error('This lead is not in Clinical Lead Pre-Check.');
  }
  const description = String(conflict?.description || '').trim();
  if (!conflict?.category || !conflict?.severity || !description) {
    throw new Error('Category, severity, and a note are required.');
  }
  const patientCustomId = referral?.patient?.id || referral?.patient_id;
  const referralCustomId = referral?.id;
  if (!patientCustomId || !referralCustomId || !appUserId) {
    throw new Error('Cannot send to Conflict — missing patient/referral/user linkage');
  }

  await flagConflict({
    referral,
    patientCustomId,
    referralCustomId,
    actorUserId: appUserId,
    actorName,
    sourceModule: inferConflictSourceModuleFromStage(referral.current_stage) || CONFLICT_SOURCE_MODULE.CLINICAL,
    category: conflict.category,
    severity: conflict.severity,
    description,
    origin: 'clinical_lead_not_viable',
    mentionAccountManagerInfo: true,
  });

  const result = attemptTransition({
    referral,
    toStage: 'Conflict',
    context: {
      actorUserId: appUserId,
      note: description,
    },
  });
  if (!result.allowed) throw new Error(result.reason || 'Could not send to Conflict.');

  onLeftModule?.();
  await applyTransition({ referral, result, context: { actorUserId: appUserId } });
  recordActivity({
    actorUserId: appUserId,
    action: 'Clinical Lead Pre-Check Not Viable',
    patientId: referral.patient_id,
    referralId: referral.id,
    detail: `Lead is not viable — sent to Conflict. ${description}`,
  }).catch(() => {});
  triggerDataRefresh();
  return { ok: true };
}
