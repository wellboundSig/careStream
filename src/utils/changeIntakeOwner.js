/**
 * Reassign a referral's intake owner (gated by leads.change_intake_owner).
 *
 * Side effects (best-effort; referral update is the critical path):
 *  - stamps intake_owner_changed_at / intake_owner_changed_by_id
 *  - writes a timeline Note
 *  - records ActivityLog
 *  - notifies the new owner (skipped if actor === new owner)
 *
 * Does NOT touch lead_created_by_id (immutable).
 */

import { updateReferralOptimistic, createNoteOptimistic } from '../store/mutations.js';
import { recordActivity } from '../api/activityLog.js';
import { createNotification } from '../api/notifications.js';

function noteId() {
  return `note_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function notifId() {
  return `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * @param {object} opts
 * @param {object} opts.referral — store referral (needs _id, id, patient_id, intake_owner_id)
 * @param {string} opts.newOwnerId — usr_### business id
 * @param {string} opts.actorUserId
 * @param {string} [opts.actorName]
 * @param {string} [opts.previousOwnerName]
 * @param {string} [opts.newOwnerName]
 * @param {string} [opts.patientLabel]
 * @returns {Promise<{ fields: object }>}
 */
export async function changeIntakeOwner({
  referral,
  newOwnerId,
  actorUserId,
  actorName,
  previousOwnerName,
  newOwnerName,
  patientLabel,
}) {
  if (!referral?._id) throw new Error('Referral record id required');
  if (!newOwnerId) throw new Error('New owner required');
  if (!actorUserId) throw new Error('Actor required');

  const prevId = referral.intake_owner_id || null;
  if (prevId && prevId === newOwnerId) {
    throw new Error('That user is already the intake owner');
  }

  const now = new Date().toISOString();
  const prevLabel = previousOwnerName || prevId || 'Unassigned';
  const nextLabel = newOwnerName || newOwnerId;
  const detail = `Intake owner changed: ${prevLabel} → ${nextLabel}`;

  const fields = {
    intake_owner_id: newOwnerId,
    intake_owner_changed_at: now,
    intake_owner_changed_by_id: actorUserId,
    updated_at: now,
  };

  await updateReferralOptimistic(referral._id, fields);

  const nid = noteId();
  try {
    await createNoteOptimistic({
      id: nid,
      patient_id: referral.patient_id || null,
      referral_id: referral.id || null,
      author_id: actorUserId,
      content: detail,
      created_at: now,
      is_pinned: false,
    });
  } catch (err) {
    console.warn('[changeIntakeOwner] note failed (non-fatal):', err?.message || err);
  }

  try {
    await recordActivity({
      actorUserId,
      action: 'intake_owner_changed',
      patientId: referral.patient_id || null,
      referralId: referral.id || null,
      detail,
      metadata: {
        previousOwnerId: prevId,
        newOwnerId,
        previousOwnerName: prevLabel,
        newOwnerName: nextLabel,
      },
    });
  } catch (err) {
    console.warn('[changeIntakeOwner] activity log failed (non-fatal):', err?.message || err);
  }

  if (newOwnerId !== actorUserId) {
    try {
      await createNotification({
        id: notifId(),
        recipient_user_id: newOwnerId,
        actor_user_id: actorUserId,
        type: 'intake_owner_assigned',
        entity_type: 'referral',
        entity_id: referral.id || null,
        patient_id: referral.patient_id || null,
        referral_id: referral.id || null,
        title: 'You were assigned as intake owner',
        body: patientLabel
          ? `${actorName || 'Someone'} assigned you as intake owner for ${patientLabel}.`
          : `${actorName || 'Someone'} assigned you as intake owner.`,
        is_read: false,
        created_at: now,
        updated_at: now,
      });
    } catch (err) {
      console.warn('[changeIntakeOwner] notification failed (non-fatal):', err?.message || err);
    }
  }

  return { fields, detail };
}
