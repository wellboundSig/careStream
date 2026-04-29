/**
 * OPWDD case orchestration helpers — compound workflows that span multiple
 * tables and must stay consistent.
 *
 * These are the ONLY places that should know about the full sequence of
 * writes required to open, submit, or close an OPWDD case. Components
 * should call these helpers instead of doing the individual writes directly,
 * so the workflow stays auditable and idempotent.
 */

import { createOpwddCase, findActiveCaseByReferral, updateOpwddCase } from '../api/opwddCases.js';
import { seedChecklistForCase, getChecklistItemsByCase, updateChecklistItem } from '../api/opwddChecklistItems.js';
import { updateReferral } from '../api/referrals.js';
import { recordActivity } from '../api/activityLog.js';
import { useCareStore } from './careStore.js';
import { triggerDataRefresh } from '../hooks/useRefreshTrigger.js';
import {
  OPWDD_AUDIT_ACTION,
  OPWDD_CASE_STATUS,
  OPWDD_CHECKLIST_STATUS,
  OPWDD_EVAL_VALIDITY_YEARS,
  OPWDD_HANDOFF_STATUS,
  OPWDD_CODE95_WINDOW_DAYS,
  OPWDD_REQUIREMENT_KEY,
} from '../data/opwddEnums.js';

// ── ID generation (matches the app-wide `prefix_NNN` convention) ────────────

export function getNextOpwddCaseId() {
  const cases = useCareStore.getState().opwddCases || {};
  let max = 0;
  for (const c of Object.values(cases)) {
    const match = (c.id || '').match(/^opwddc_(\d+)$/);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return `opwddc_${String(max + 1).padStart(3, '0')}`;
}

// ── openCaseForReferral ─────────────────────────────────────────────────────

/**
 * Opens (or resumes) the OPWDD eligibility case for a referral.
 * - If an active case already exists for the referral, returns that case
 *   without creating a duplicate.
 * - Otherwise creates the case row, seeds the 15-item checklist, stamps
 *   `Referrals.active_opwdd_case_id` / `opwdd_route_started_*` /
 *   `opwdd_handoff_status`, and writes an activity log entry.
 *
 * @param {object} params
 * @param {object} params.referral    the referral record (`.id`, `._id`)
 * @param {string} params.patientId   patient business id
 * @param {string} [params.actorUserId]
 * @param {string} [params.assignedSpecialistId]
 * @param {string[]} [params.interestedServices]
 * @param {object} [params.pcg]       initial PCG contact fields
 * @returns {Promise<{case: object, checklistItems: object[], alreadyOpen: boolean}>}
 */
export async function openCaseForReferral({
  referral,
  patientId,
  actorUserId,
  assignedSpecialistId,
  interestedServices,
  pcg,
}) {
  if (!referral?.id) throw new Error('openCaseForReferral: referral.id required');
  if (!patientId)    throw new Error('openCaseForReferral: patientId required');

  const existing = await findActiveCaseByReferral(referral.id).catch(() => null);
  if (existing) {
    const items = await getChecklistItemsByCase(existing.fields?.id || existing.id).catch(() => []);
    return {
      case: { _id: existing.id, ...existing.fields },
      checklistItems: items.map((r) => ({ _id: r.id, ...r.fields })),
      alreadyOpen: true,
    };
  }

  const now = new Date().toISOString();
  const caseId = getNextOpwddCaseId();

  const caseFields = {
    id: caseId,
    patient_id:  patientId,
    referral_id: referral.id,
    status: OPWDD_CASE_STATUS.OUTREACH_IN_PROGRESS,
    opened_at: now,
    psychological_eval_required: true,
    psychosocial_required: true,
    eligibility_determination: 'pending',
    ...(assignedSpecialistId ? { assigned_enrollment_specialist_id: assignedSpecialistId } : {}),
    ...(Array.isArray(interestedServices) && interestedServices.length > 0
      ? { interested_services: interestedServices }
      : {}),
    ...(pcg?.contactName  ? { pcg_contact_name: pcg.contactName } : {}),
    ...(pcg?.contactPhone ? { pcg_contact_phone: pcg.contactPhone } : {}),
    ...(pcg?.contactEmail ? { pcg_contact_email: pcg.contactEmail } : {}),
    ...(pcg?.relationship ? { pcg_relationship_to_patient: pcg.relationship } : {}),
    created_at: now,
    updated_at: now,
  };

  const created = await createOpwddCase(caseFields);
  const createdCase = { _id: created.id, ...created.fields };

  // Seed the 15-item checklist. If this fails, we DON'T roll back the case
  // because the checklist can be re-seeded manually later — better to keep
  // the case row than lose the open work entirely.
  let checklistItems = [];
  try {
    const items = await seedChecklistForCase({
      caseId,
      patientId,
      referralId: referral.id,
    });
    checklistItems = items.map((r) => ({ _id: r.id, ...r.fields }));
  } catch (err) {
    console.warn('openCaseForReferral: checklist seed failed', err);
  }

  // Stamp the referral so the UI can quick-jump back to the active case.
  if (referral._id) {
    try {
      await updateReferral(referral._id, {
        active_opwdd_case_id: caseId,
        opwdd_route_started_at: now,
        ...(actorUserId ? { opwdd_route_started_by_id: actorUserId } : {}),
        opwdd_handoff_status: OPWDD_HANDOFF_STATUS.IN_PROGRESS,
      });
    } catch (err) {
      console.warn('openCaseForReferral: referral stamp failed', err);
    }
  }

  await recordActivity({
    actorUserId,
    action: OPWDD_AUDIT_ACTION.CASE_OPENED,
    patientId,
    referralId: referral.id,
    detail: 'OPWDD eligibility case opened.',
    metadata: {
      caseId,
      assignedSpecialistId: assignedSpecialistId || null,
      interestedServices: interestedServices || null,
    },
  }).catch(() => {});

  triggerDataRefresh();

  return { case: createdCase, checklistItems, alreadyOpen: false };
}

// ── Checklist item state transitions ────────────────────────────────────────

/**
 * Marks a checklist item as received (document landed, awaiting review).
 * Also writes an activity log entry.
 */
export async function markChecklistItemReceived({
  item,
  receivedByUserId,
  satisfyingFileId,
  actorUserId,
}) {
  if (!item?._id) throw new Error('markChecklistItemReceived: item._id required');
  const now = new Date().toISOString();

  // Evaluation items drive `valid_through` from the received date.
  const template = item.requirement_key;
  const validityYears = (() => {
    if (template === OPWDD_REQUIREMENT_KEY.UPDATED_PSYCHOLOGICAL_EVALUATION) return OPWDD_EVAL_VALIDITY_YEARS.psychological;
    if (template === OPWDD_REQUIREMENT_KEY.UPDATED_PSYCHOSOCIAL_EVALUATION)  return OPWDD_EVAL_VALIDITY_YEARS.psychosocial;
    return 0;
  })();
  const expiresAt = validityYears > 0
    ? new Date(new Date(now).setFullYear(new Date(now).getFullYear() + validityYears)).toISOString()
    : undefined;

  await updateChecklistItem(item._id, {
    status: OPWDD_CHECKLIST_STATUS.RECEIVED,
    received_at: now,
    received_by_id: receivedByUserId,
    ...(satisfyingFileId ? { satisfying_file_id: satisfyingFileId } : {}),
    ...(expiresAt ? { expires_at: expiresAt, is_current: true } : {}),
  });

  await recordActivity({
    actorUserId,
    action: OPWDD_AUDIT_ACTION.CHECKLIST_ITEM_RECEIVED,
    patientId:  item.patient_id,
    referralId: item.referral_id,
    detail: `Received: ${item.requirement_label || item.requirement_key}.`,
    metadata: {
      caseId: item.opwdd_case_id,
      requirementKey: item.requirement_key,
      satisfyingFileId: satisfyingFileId || null,
    },
  }).catch(() => {});
}

/**
 * Marks a checklist item accepted (passed review — satisfies the requirement).
 */
export async function markChecklistItemAccepted({ item, reviewedByUserId, actorUserId }) {
  if (!item?._id) throw new Error('markChecklistItemAccepted: item._id required');
  const now = new Date().toISOString();
  await updateChecklistItem(item._id, {
    status: OPWDD_CHECKLIST_STATUS.ACCEPTED,
    reviewed_at: now,
    reviewed_by_id: reviewedByUserId,
  });
  await recordActivity({
    actorUserId,
    action: OPWDD_AUDIT_ACTION.CHECKLIST_ITEM_ACCEPTED,
    patientId:  item.patient_id,
    referralId: item.referral_id,
    detail: `Accepted: ${item.requirement_label || item.requirement_key}.`,
    metadata: { caseId: item.opwdd_case_id, requirementKey: item.requirement_key },
  }).catch(() => {});
}

// ── Case state transitions ──────────────────────────────────────────────────

export async function recordPacketSubmitted({ opwddCase, actorUserId, method, confirmationNumber, ccoName }) {
  const now = new Date().toISOString();
  await updateOpwddCase(opwddCase._id, {
    status: OPWDD_CASE_STATUS.SUBMITTED_TO_CCO,
    submission_sent_at: now,
    submission_sent_by_id: actorUserId,
    submission_method: method,
    ...(confirmationNumber ? { submission_confirmation_number: confirmationNumber } : {}),
    ...(ccoName ? { cco_name_snapshot: ccoName } : {}),
  });
  await recordActivity({
    actorUserId,
    action: OPWDD_AUDIT_ACTION.PACKET_SUBMITTED,
    patientId:  opwddCase.patient_id,
    referralId: opwddCase.referral_id,
    detail: `OPWDD packet submitted to ${ccoName || 'CCO'} via ${method}.`,
    metadata: { caseId: opwddCase.id, method, confirmationNumber: confirmationNumber || null, ccoName: ccoName || null },
  }).catch(() => {});
}

export async function recordNoticeReceived({ opwddCase, actorUserId, noticeDate, method, determination }) {
  const now = new Date().toISOString();
  const noticeIso = noticeDate ? new Date(noticeDate).toISOString() : now;

  // Compute the expected Code 95 monitoring window (notice + 30 → +60 days).
  const windowStart = new Date(noticeIso);
  windowStart.setDate(windowStart.getDate() + OPWDD_CODE95_WINDOW_DAYS.start);
  const windowEnd = new Date(noticeIso);
  windowEnd.setDate(windowEnd.getDate() + OPWDD_CODE95_WINDOW_DAYS.end);

  await updateOpwddCase(opwddCase._id, {
    status: OPWDD_CASE_STATUS.MONITORING_CODE_95,
    notice_received_at: noticeIso,
    notice_received_method: method,
    eligibility_determined_at: noticeIso,
    eligibility_determination: determination,
    code_95_monitoring_started_at: now,
    expected_code_95_window_start: windowStart.toISOString(),
    expected_code_95_window_end:   windowEnd.toISOString(),
  });
  await recordActivity({
    actorUserId,
    action: OPWDD_AUDIT_ACTION.NOTICE_RECEIVED,
    patientId:  opwddCase.patient_id,
    referralId: opwddCase.referral_id,
    detail: `OPWDD notice received (${determination}).`,
    metadata: {
      caseId: opwddCase.id,
      method,
      determination,
      expectedCode95Start: windowStart.toISOString(),
      expectedCode95End:   windowEnd.toISOString(),
    },
  }).catch(() => {});
}

export async function recordCode95Received({ opwddCase, referral, actorUserId }) {
  const now = new Date().toISOString();
  await updateOpwddCase(opwddCase._id, {
    status: OPWDD_CASE_STATUS.CODE_95_RECEIVED,
    code_95_received_at: now,
  });
  if (referral?._id) {
    await updateReferral(referral._id, {
      code_95: 'yes',
      opwdd_conversion_ready: true,
      opwdd_handoff_status: OPWDD_HANDOFF_STATUS.READY_FOR_INTAKE,
    }).catch(() => {});
  }
  await recordActivity({
    actorUserId,
    action: OPWDD_AUDIT_ACTION.CODE95_RECEIVED,
    patientId:  opwddCase.patient_id,
    referralId: opwddCase.referral_id,
    detail: 'Code 95 received. Referral ready for CHHA intake.',
    metadata: { caseId: opwddCase.id },
  }).catch(() => {});
}

export async function convertCaseToIntake({ opwddCase, referral, actorUserId, handoffNote }) {
  const now = new Date().toISOString();
  await updateOpwddCase(opwddCase._id, {
    status: OPWDD_CASE_STATUS.CONVERTED_TO_INTAKE,
    converted_to_intake_at: now,
    converted_by_id: actorUserId,
    closed_at: now,
    closed_reason: 'converted_to_intake',
    ...(handoffNote ? { intake_handoff_note: handoffNote } : {}),
  });
  if (referral?._id) {
    await updateReferral(referral._id, {
      opwdd_handoff_status: OPWDD_HANDOFF_STATUS.HANDED_OFF,
      current_stage: 'Intake',
    }).catch(() => {});
  }
  await recordActivity({
    actorUserId,
    action: OPWDD_AUDIT_ACTION.CONVERTED_TO_INTAKE,
    patientId:  opwddCase.patient_id,
    referralId: opwddCase.referral_id,
    detail: 'OPWDD case converted to intake. Referral handed off.',
    metadata: { caseId: opwddCase.id, handoffNote: handoffNote || null },
  }).catch(() => {});
}

export async function closeCase({ opwddCase, actorUserId, reason, note }) {
  const now = new Date().toISOString();
  await updateOpwddCase(opwddCase._id, {
    status: OPWDD_CASE_STATUS.CLOSED,
    closed_at: now,
    closed_reason: reason,
    ...(note ? { intake_handoff_note: note } : {}),
  });
  await recordActivity({
    actorUserId,
    action: OPWDD_AUDIT_ACTION.CASE_CLOSED,
    patientId:  opwddCase.patient_id,
    referralId: opwddCase.referral_id,
    detail: `OPWDD case closed: ${reason}.`,
    metadata: { caseId: opwddCase.id, reason, note: note || null },
  }).catch(() => {});
}
