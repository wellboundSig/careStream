/**
 * Post-SOC docs: when an F2F file lands, stamp a chart note and notify nurses.
 */

import { getStore } from '../store/careStore.js';
import { createNoteOptimistic } from '../store/mutations.js';
import { createNotification } from '../api/notifications.js';
import { isDocumentationDeferred } from './documentationDeferred.js';
import { fmtCalendarDate, todayCalendarDate } from './dateFormat.js';
import { listClinicalRnUsers } from './requestPostSocClinicalReview.js';

export const POST_SOC_F2F_UPLOAD_TYPE = 'post_soc_f2f_uploaded';

function noteId() {
  return `note_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function notifId() {
  return `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function postSocF2fUploadNoteText(actorName, uploadedOn) {
  const who = String(actorName || '').trim() || 'Someone';
  const when = fmtCalendarDate(uploadedOn, '') || fmtCalendarDate(todayCalendarDate(), '') || 'today';
  return `${who} uploaded a face to face file on ${when}.`;
}

/** Active Clinical / COC / Field Nurse staff (role name or COC-facility link). */
export function listNurseUsers(stores = getStore()) {
  const { users = {}, roles = {}, cocNurseFacilities = {} } = stores || {};
  const clinical = listClinicalRnUsers({ users, roles, cocNurseFacilities });
  const seen = new Set(clinical.map((u) => String(u.id)));
  const roleNameById = {};
  Object.values(roles || {}).forEach((r) => {
    if (r?.id) roleNameById[String(r.id).trim()] = String(r.name || '').toLowerCase();
  });
  const extra = Object.values(users || {}).filter((u) => {
    if (!u?.id || seen.has(String(u.id))) return false;
    if (u.status && u.status !== 'Active') return false;
    const role = roleNameById[String(u.role_id || '').trim()] || '';
    return role.includes('nurse');
  });
  return [...clinical, ...extra].sort((a, b) => (
    `${a.last_name || ''} ${a.first_name || ''}`.localeCompare(
      `${b.last_name || ''} ${b.first_name || ''}`,
    )
  ));
}

function patientLabelFrom(patient, referral) {
  const fromPatient = `${patient?.first_name || ''} ${patient?.last_name || ''}`.trim();
  return fromPatient || referral?.patientName || referral?.patient_id || 'Patient';
}

/**
 * After an F2F upload on a post-SOC docs case: write the chart note and
 * notify every nurse. Non-fatal — upload already succeeded.
 */
export async function notifyPostSocF2fUploaded({
  referral,
  patient,
  actorUserId,
  actorName,
  uploadedOn,
} = {}) {
  if (!isDocumentationDeferred(referral)) return { ok: false, reason: 'not_post_soc_docs' };

  const now = new Date().toISOString();
  const onDate = uploadedOn || todayCalendarDate();
  const content = postSocF2fUploadNoteText(actorName, onDate);
  const patientLabel = patientLabelFrom(patient, referral);
  const createdNoteId = noteId();

  try {
    await createNoteOptimistic({
      id: createdNoteId,
      patient_id: referral.patient_id || patient?.id || null,
      referral_id: referral.id || null,
      author_id: actorUserId || 'unknown',
      content,
      created_at: now,
      is_pinned: false,
    });
  } catch (err) {
    console.warn('[postSocF2fUpload] note failed:', err?.message || err);
  }

  const nurses = listNurseUsers(getStore());
  const recipients = nurses.filter((u) => u.id && u.id !== actorUserId);
  await Promise.all(recipients.map((u) =>
    createNotification({
      id: notifId(),
      recipient_user_id: u.id,
      actor_user_id: actorUserId || null,
      type: POST_SOC_F2F_UPLOAD_TYPE,
      entity_type: 'file',
      entity_id: referral.id || null,
      patient_id: referral.patient_id || patient?.id || null,
      referral_id: referral.id || null,
      title: content,
      body: patientLabel,
      is_read: false,
      created_at: now,
      updated_at: now,
    }).catch((err) => {
      console.warn('[postSocF2fUpload] notification failed:', err?.message || err);
      return null;
    }),
  ));

  return { ok: true, content, notified: recipients.length };
}
