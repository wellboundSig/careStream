// urgentCare — single source of truth for the urgent-care / pre-assessment
// indicator. Used by ModulePage's context menu, the PatientSnapshot toggle,
// and any future surface that wants to flip the flag. We:
//   1. Optimistically write to Referrals via the store mutation layer (rolls
//      back automatically on Airtable rejection).
//   2. Emit an ActivityLog entry tagged `Urgent Care Flagged` /
//      `Urgent Care Cleared` so a future Worker can subscribe to the audit
//      stream and notify clinical RNs by email.

import { updateReferralOptimistic } from '../store/mutations.js';
import { recordActivity } from '../api/activityLog.js';

/** @typedef {'wound'|'insulin'|'both'|''|null|undefined} UrgentCareType */

export const URGENT_CARE_TYPE_OPTIONS = [
  { value: 'wound', label: 'Wound care' },
  { value: 'insulin', label: 'Insulin' },
  { value: 'both', label: 'Both' },
];

const TYPE_LABELS = Object.fromEntries(
  URGENT_CARE_TYPE_OPTIONS.map((o) => [o.value, o.label]),
);

/**
 * @param {UrgentCareType} type
 * @returns {string}
 */
export function urgentCareTypeLabel(type) {
  if (!type) return '';
  return TYPE_LABELS[type] || String(type);
}

/**
 * @param {object|null|undefined} referral
 * @returns {'wound'|'insulin'|'both'|''}
 */
export function getUrgentCareType(referral) {
  const t = referral?.urgent_care_type;
  if (t === 'wound' || t === 'insulin' || t === 'both') return t;
  return '';
}

/**
 * Toggle `requires_urgent_care` on a referral.
 *
 * @param {object} args
 * @param {object} args.referral          Referral row (must include `_id`).
 * @param {boolean} args.next             Target state (true=mark, false=clear).
 * @param {string} args.actorUserId       usr_xxx — the current user.
 * @param {string} [args.note]            Optional context, persisted to
 *                                        `urgent_care_note` when setting.
 * @param {UrgentCareType} [args.type]    wound | insulin | both when marking.
 * @returns {Promise<void>}
 */
export async function setUrgentCare({ referral, next, actorUserId, note, type }) {
  if (!referral?._id) throw new Error('setUrgentCare: missing referral record id');
  const now = new Date().toISOString();

  const updates = {
    requires_urgent_care: !!next,
  };
  if (next) {
    updates.urgent_care_marked_at = now;
    if (actorUserId) updates.urgent_care_marked_by_id = actorUserId;
    if (note && note.trim()) updates.urgent_care_note = note.trim();
    if (type !== undefined) {
      updates.urgent_care_type = type || '';
    }
  } else {
    // Leave the audit columns intact so we keep history of who/when last
    // flagged the patient. Clear note + subtype so the next mark starts clean.
    updates.urgent_care_note = '';
    updates.urgent_care_type = '';
  }

  await updateReferralOptimistic(referral._id, updates);

  // Best-effort audit. The Worker / email subscription will read these
  // entries in a follow-up — for now the row is enough.
  // TODO: email RNs on the patient's care team when next=true (Worker hook).
  const typeLabel = type ? urgentCareTypeLabel(type) : '';
  recordActivity({
    actorUserId,
    action: next ? 'Urgent Care Flagged' : 'Urgent Care Cleared',
    patientId: referral.patient_id,
    referralId: referral.id,
    detail: next
      ? `Patient flagged urgent care${typeLabel ? ` (${typeLabel})` : ''}${note?.trim() ? ` — ${note.trim()}` : ''}`
      : 'Urgent care flag cleared',
    metadata: {
      fromStage: referral.current_stage || null,
      note: note?.trim() || null,
      urgentCareType: type || null,
    },
  }).catch(() => {});
}

/**
 * Set / clear the urgent-care subtype without requiring a full clear.
 * Selecting a type also turns the urgent flag on; blank clears the subtype only.
 *
 * @param {object} args
 * @param {object} args.referral
 * @param {UrgentCareType} args.type
 * @param {string} [args.actorUserId]
 * @returns {Promise<void>}
 */
export async function setUrgentCareType({ referral, type, actorUserId }) {
  if (!referral?._id) throw new Error('setUrgentCareType: missing referral record id');
  const nextType = type === 'wound' || type === 'insulin' || type === 'both' ? type : '';
  const updates = { urgent_care_type: nextType };

  if (nextType && !isUrgentCare(referral)) {
    const now = new Date().toISOString();
    updates.requires_urgent_care = true;
    updates.urgent_care_marked_at = now;
    if (actorUserId) updates.urgent_care_marked_by_id = actorUserId;
  }

  await updateReferralOptimistic(referral._id, updates);

  recordActivity({
    actorUserId,
    action: nextType ? 'Urgent Care Type Set' : 'Urgent Care Type Cleared',
    patientId: referral.patient_id,
    referralId: referral.id,
    detail: nextType
      ? `Urgent care type set to ${urgentCareTypeLabel(nextType)}`
      : 'Urgent care type cleared',
    metadata: { urgentCareType: nextType || null },
  }).catch(() => {});
}

export function isUrgentCare(referral) {
  return referral?.requires_urgent_care === true || referral?.requires_urgent_care === 'true';
}
