/**
 * Reassign a referral's marketer (gated by referral.change_marketer).
 *
 * Side effects (best-effort; referral update is the critical path):
 *  - writes a timeline Note
 *  - records ActivityLog
 *  - notifies the new marketer's linked user (skipped if no user_id or actor === that user)
 *
 * Does NOT touch lead_created_by_id or intake_owner_id.
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
 * @param {object} opts.referral — store referral (needs _id, id, patient_id, marketer_id)
 * @param {string} opts.newMarketerId — mkt_### business id
 * @param {string} opts.actorUserId
 * @param {string} [opts.actorName]
 * @param {string} [opts.previousMarketerName]
 * @param {string} [opts.newMarketerName]
 * @param {string} [opts.newMarketerUserId] — Users.id linked to the new marketer, if any
 * @param {string} [opts.patientLabel]
 * @returns {Promise<{ fields: object }>}
 */
export async function changeMarketer({
  referral,
  newMarketerId,
  actorUserId,
  actorName,
  previousMarketerName,
  newMarketerName,
  newMarketerUserId,
  patientLabel,
}) {
  if (!referral?._id) throw new Error('Referral record id required');
  if (!newMarketerId) throw new Error('New marketer required');
  if (!actorUserId) throw new Error('Actor required');

  const prevId = String(referral.marketer_id || '').trim() || null;
  const nextId = String(newMarketerId).trim();
  if (prevId && prevId === nextId) {
    throw new Error('That marketer is already assigned');
  }

  const now = new Date().toISOString();
  const prevLabel = previousMarketerName || prevId || 'Unassigned';
  const nextLabel = newMarketerName || nextId;
  const detail = `Marketer changed: ${prevLabel} → ${nextLabel}`;

  const fields = {
    marketer_id: nextId,
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
    console.warn('[changeMarketer] note failed (non-fatal):', err?.message || err);
  }

  try {
    await recordActivity({
      actorUserId,
      action: 'marketer_changed',
      patientId: referral.patient_id || null,
      referralId: referral.id || null,
      detail,
      metadata: {
        previousMarketerId: prevId,
        newMarketerId: nextId,
        previousMarketerName: prevLabel,
        newMarketerName: nextLabel,
      },
    });
  } catch (err) {
    console.warn('[changeMarketer] activity log failed (non-fatal):', err?.message || err);
  }

  if (newMarketerUserId && newMarketerUserId !== actorUserId) {
    try {
      await createNotification({
        id: notifId(),
        recipient_user_id: newMarketerUserId,
        actor_user_id: actorUserId,
        type: 'marketer_assigned',
        entity_type: 'referral',
        entity_id: referral.id || null,
        patient_id: referral.patient_id || null,
        referral_id: referral.id || null,
        title: 'A referral was assigned to you',
        body: patientLabel
          ? `${actorName || 'Someone'} assigned you as marketer for ${patientLabel}.`
          : `${actorName || 'Someone'} assigned you as marketer on a referral.`,
        is_read: false,
        created_at: now,
        updated_at: now,
      });
    } catch (err) {
      console.warn('[changeMarketer] notification failed (non-fatal):', err?.message || err);
    }
  }

  return { fields, detail };
}
