/**
 * Post-SOC / concurrent clinical handoff.
 * Marketer assigns a Clinical Intake RN → notify → case appears in Clinical
 * while remaining on SOC Completed (soc_completed_date).
 */

import { updateReferralOptimistic, createNoteOptimistic } from '../store/mutations.js';
import { recordActivity } from '../api/activityLog.js';
import { createNotification } from '../api/notifications.js';
import { isSocCompletedReferral } from '../data/stageConfig.js';
import { hasClinicalCompleted } from './documentationDeferred.js';

function noteId() {
  return `note_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function notifId() {
  return `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Active clinical staff: role name contains clinical/coc, or COC-facility link. */
export function listClinicalRnUsers({ users = {}, roles = {}, cocNurseFacilities = {} } = {}) {
  const roleNameById = {};
  Object.values(roles || {}).forEach((r) => {
    if (r?.id) roleNameById[String(r.id).trim()] = String(r.name || '').toLowerCase();
  });
  const cocIds = new Set(
    Object.values(cocNurseFacilities || {})
      .map((l) => String(l?.user_id || '').trim())
      .filter(Boolean),
  );

  return Object.values(users || {})
    .filter((u) => {
      if (!u?.id) return false;
      if (u.status && u.status !== 'Active') return false;
      if (cocIds.has(String(u.id).trim())) return true;
      const role = roleNameById[String(u.role_id || '').trim()] || '';
      return role.includes('clinical') || role.includes('coc');
    })
    .sort((a, b) => (
      `${a.last_name || ''} ${a.first_name || ''}`.localeCompare(
        `${b.last_name || ''} ${b.first_name || ''}`,
      )
    ));
}

export function canRequestPostSocClinical(referral) {
  if (!referral?._id) return false;
  if (!isSocCompletedReferral(referral)) return false;
  if (hasClinicalCompleted(referral)) return false;
  return true;
}

/**
 * @returns {Promise<{ fields: object }>}
 */
export async function requestPostSocClinicalReview({
  referral,
  assigneeUserId,
  actorUserId,
  actorName,
  assigneeName,
  patientLabel,
} = {}) {
  if (!referral?._id) throw new Error('Referral required');
  if (!assigneeUserId) throw new Error('Clinical RN required');
  if (!actorUserId) throw new Error('Actor required');
  if (!canRequestPostSocClinical(referral)) {
    throw new Error('Clinical review is already complete for this case');
  }

  const now = new Date().toISOString();
  const rnLabel = assigneeName || assigneeUserId;
  const patient = patientLabel || referral.patientName || referral.patient_id || 'Patient';

  const fields = {
    in_clinical_review: true,
    clinical_review_assigned_to_id: assigneeUserId,
    clinical_review_assigned_at: now,
    clinical_review_assigned_by_id: actorUserId,
    clinical_review_pushed_at: now,
    clinical_review_pushed_by_id: actorUserId,
    // Clear any stale send-back flag so Clinical owns the work signal.
    returned_from_clinical: false,
    updated_at: now,
  };

  await updateReferralOptimistic(referral._id, fields);

  const detail = `Post-SOC clinical review requested → ${rnLabel}`;
  try {
    await createNoteOptimistic({
      id: noteId(),
      patient_id: referral.patient_id || null,
      referral_id: referral.id || null,
      author_id: actorUserId,
      content: detail,
      created_at: now,
      is_pinned: false,
    });
  } catch (err) {
    console.warn('[requestPostSocClinicalReview] note failed:', err?.message || err);
  }

  try {
    await recordActivity({
      actorUserId,
      action: 'clinical_review_assigned',
      patientId: referral.patient_id || null,
      referralId: referral.id || null,
      detail,
      metadata: {
        assigneeUserId,
        assigneeName: rnLabel,
        source: 'post_soc',
      },
    });
  } catch (err) {
    console.warn('[requestPostSocClinicalReview] activity failed:', err?.message || err);
  }

  if (assigneeUserId !== actorUserId) {
    try {
      await createNotification({
        id: notifId(),
        recipient_user_id: assigneeUserId,
        actor_user_id: actorUserId,
        type: 'clinical_review_assigned',
        entity_type: 'referral',
        entity_id: referral.id || null,
        patient_id: referral.patient_id || null,
        referral_id: referral.id || null,
        title: 'Clinical review needed (post-SOC)',
        body: `${actorName || 'Someone'} assigned you clinical review for ${patient}. Case stays on SOC/ROC Completed.`,
        is_read: false,
        created_at: now,
        updated_at: now,
      });
    } catch (err) {
      console.warn('[requestPostSocClinicalReview] notification failed:', err?.message || err);
    }
  }

  return { fields, detail };
}

/** Fields to clear when post-SOC clinical is marked complete. */
export function postSocClinicalCompleteClearFields() {
  return {
    clinical_review_assigned_to_id: null,
    clinical_review_assigned_at: null,
    clinical_review_assigned_by_id: null,
  };
}
