/**
 * Change a referral's facility (gated by referral.change_facility).
 *
 * Applies the facility id plus only the assignment fields the actor chose
 * to update. Address changes write to the patient record.
 *
 * Side effects (best-effort; referral update is the critical path):
 *  - writes a timeline Note
 *  - records ActivityLog
 *  - notifies a newly assigned marketer / COC nurse (skipped if actor === that user)
 *
 * Does NOT touch lead_created_by_id or intake_owner_id.
 */

import { updateReferralOptimistic, updatePatientOptimistic, createNoteOptimistic } from '../store/mutations.js';
import { recordActivity } from '../api/activityLog.js';
import { createNotification } from '../api/notifications.js';
import { applyReconciliationDecisions, idsEqual } from './facilityReconciliation.js';

function noteId() {
  return `note_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function notifId() {
  return `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * @param {object} opts
 * @param {object} opts.referral
 * @param {object} [opts.patient]
 * @param {object} opts.preview — from buildFacilityReconciliation
 * @param {object} opts.decisions
 * @param {string} opts.actorUserId
 * @param {string} [opts.actorName]
 * @param {string} [opts.previousFacilityName]
 * @param {string} [opts.newFacilityName]
 * @param {string} [opts.newMarketerUserId]
 * @param {string} [opts.newCocNurseUserId]
 * @param {string} [opts.patientLabel]
 */
export async function changeFacility({
  referral,
  patient,
  preview,
  decisions,
  actorUserId,
  actorName,
  previousFacilityName,
  newFacilityName,
  newMarketerUserId,
  newCocNurseUserId,
  patientLabel,
}) {
  if (!referral?._id) throw new Error('Referral record id required');
  if (!actorUserId) throw new Error('Actor required');
  if (!preview?.newFacilityId) throw new Error('New facility required');
  if (preview.sameFacility) throw new Error('That facility is already assigned');

  const now = new Date().toISOString();
  const { referralFields, patientFields, summary } = applyReconciliationDecisions(preview, decisions);

  const prevFac = previousFacilityName || preview.currentFacilityId || 'Unassigned';
  const nextFac = newFacilityName || preview.newFacilityName || preview.newFacilityId;
  const header = `Facility changed: ${prevFac} → ${nextFac}`;
  const reconLines = (summary || []).filter((line) => !/^Address: kept/i.test(line) && !/: kept /i.test(line));
  const detail = reconLines.length
    ? `${header}\n${reconLines.join('\n')}`
    : `${header} (assignments kept)`;

  const fields = {
    ...referralFields,
    updated_at: now,
  };

  await updateReferralOptimistic(referral._id, fields);

  if (patientFields && (patient?._id || patient?.id)) {
    try {
      await updatePatientOptimistic(patient._id || patient.id, {
        ...patientFields,
        updated_at: now,
      });
    } catch (err) {
      console.warn('[changeFacility] patient address update failed (non-fatal):', err?.message || err);
    }
  }

  try {
    await createNoteOptimistic({
      id: noteId(),
      patient_id: referral.patient_id || patient?.id || null,
      referral_id: referral.id || null,
      author_id: actorUserId,
      content: detail,
      created_at: now,
      is_pinned: false,
    });
  } catch (err) {
    console.warn('[changeFacility] note failed (non-fatal):', err?.message || err);
  }

  try {
    await recordActivity({
      actorUserId,
      action: 'facility_changed',
      patientId: referral.patient_id || patient?.id || null,
      referralId: referral.id || null,
      detail,
      metadata: {
        previousFacilityId: preview.currentFacilityId || null,
        newFacilityId: preview.newFacilityId,
        previousFacilityName: prevFac,
        newFacilityName: nextFac,
        decisions,
        referralFields,
        patientFields,
      },
    });
  } catch (err) {
    console.warn('[changeFacility] activity log failed (non-fatal):', err?.message || err);
  }

  const nextMarketerId = fields.marketer_id;
  if (
    nextMarketerId
    && !idsEqual(nextMarketerId, referral.marketer_id)
    && newMarketerUserId
    && newMarketerUserId !== actorUserId
  ) {
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
          ? `${actorName || 'Someone'} assigned you as marketer for ${patientLabel} after a facility change.`
          : `${actorName || 'Someone'} assigned you as marketer after a facility change.`,
        is_read: false,
        created_at: now,
        updated_at: now,
      });
    } catch (err) {
      console.warn('[changeFacility] marketer notification failed (non-fatal):', err?.message || err);
    }
  }

  const nextCocId = fields.coc_nurse_id;
  if (
    nextCocId
    && !idsEqual(nextCocId, referral.coc_nurse_id)
    && newCocNurseUserId
    && newCocNurseUserId !== actorUserId
  ) {
    try {
      await createNotification({
        id: notifId(),
        recipient_user_id: newCocNurseUserId,
        actor_user_id: actorUserId,
        type: 'coc_nurse_assigned',
        entity_type: 'referral',
        entity_id: referral.id || null,
        patient_id: referral.patient_id || null,
        referral_id: referral.id || null,
        title: 'You were assigned as COC nurse',
        body: patientLabel
          ? `${actorName || 'Someone'} assigned you as COC nurse for ${patientLabel} after a facility change.`
          : `${actorName || 'Someone'} assigned you as COC nurse after a facility change.`,
        is_read: false,
        created_at: now,
        updated_at: now,
      });
    } catch (err) {
      console.warn('[changeFacility] COC nurse notification failed (non-fatal):', err?.message || err);
    }
  }

  return { fields, patientFields, detail };
}
