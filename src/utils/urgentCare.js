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

/**
 * Toggle `requires_urgent_care` on a referral.
 *
 * @param {object} args
 * @param {object} args.referral          Referral row (must include `_id`).
 * @param {boolean} args.next             Target state (true=mark, false=clear).
 * @param {string} args.actorUserId       usr_xxx — the current user.
 * @param {string} [args.note]            Optional context, persisted to
 *                                        `urgent_care_note` when setting.
 * @returns {Promise<void>}
 */
export async function setUrgentCare({ referral, next, actorUserId, note }) {
  if (!referral?._id) throw new Error('setUrgentCare: missing referral record id');
  const now = new Date().toISOString();

  const updates = {
    requires_urgent_care: !!next,
  };
  if (next) {
    updates.urgent_care_marked_at = now;
    if (actorUserId) updates.urgent_care_marked_by_id = actorUserId;
    if (note && note.trim()) updates.urgent_care_note = note.trim();
  } else {
    // Leave the audit columns intact so we keep history of who/when last
    // flagged the patient. Just clear the note so the next mark starts clean.
    updates.urgent_care_note = '';
  }

  await updateReferralOptimistic(referral._id, updates);

  // Best-effort audit. The Worker / email subscription will read these
  // entries in a follow-up — for now the row is enough.
  // TODO: email RNs on the patient's care team when next=true (Worker hook).
  recordActivity({
    actorUserId,
    action: next ? 'Urgent Care Flagged' : 'Urgent Care Cleared',
    patientId: referral.patient_id,
    referralId: referral.id,
    detail: next
      ? `Patient flagged urgent care${note?.trim() ? ` — ${note.trim()}` : ''}`
      : 'Urgent care flag cleared',
    metadata: {
      fromStage: referral.current_stage || null,
      note: note?.trim() || null,
    },
  }).catch(() => {});
}

export function isUrgentCare(referral) {
  return referral?.requires_urgent_care === true || referral?.requires_urgent_care === 'true';
}
