import { mentionMentionsAccountManagerInfo } from './mentions.js';

/**
 * Mobile Pending Log is a follow-up report, not the Completed stage queue.
 *
 * A referral belongs when:
 *   1. A note mentioned @Account manager info (stored on the referral
 *      and/or still present on a note), OR
 *   2. Clinical sent the case back to Intake with a note (the “file +
 *      note from clinical” handoff).
 */

function isTruthyFlag(value) {
  return value === true || value === 'true' || value === 'TRUE';
}

export function hasAccountManagerInfo(referral) {
  return !!String(referral?.account_manager_info || '').trim();
}

export function hasClinicalIntakeSendBackNote(referral) {
  if (!isTruthyFlag(referral?.returned_from_clinical)) return false;
  return !!String(referral?.returned_from_clinical_note || '').trim();
}

export function isLeftPipelineForPendingLog(referral) {
  const stage = referral?.current_stage;
  return stage === 'NTUC' || stage === 'Discarded Leads';
}

/**
 * Build lookup sets from hydrated notes so AM-info mentions still count
 * even if the denormalized referral field lagged.
 * @param {Record<string, object>|object[]} notes
 */
export function pendingLogMentionIndex(notes) {
  const patientIds = new Set();
  const referralIds = new Set();
  const list = Array.isArray(notes) ? notes : Object.values(notes || {});
  for (const n of list) {
    if (!mentionMentionsAccountManagerInfo(n?.content)) continue;
    if (n.patient_id) patientIds.add(String(n.patient_id));
    if (n.referral_id) referralIds.add(String(n.referral_id));
  }
  return { patientIds, referralIds };
}

/**
 * @param {object|null|undefined} referral
 * @param {{ patientIds?: Set<string>, referralIds?: Set<string> }} [mentionIndex]
 */
export function isPendingLogReferral(referral, mentionIndex = null) {
  if (!referral || isLeftPipelineForPendingLog(referral)) return false;
  if (hasAccountManagerInfo(referral)) return true;
  if (hasClinicalIntakeSendBackNote(referral)) return true;
  if (mentionIndex) {
    if (referral.id && mentionIndex.referralIds?.has(String(referral.id))) return true;
    if (referral.patient_id && mentionIndex.patientIds?.has(String(referral.patient_id))) {
      return true;
    }
  }
  return false;
}
