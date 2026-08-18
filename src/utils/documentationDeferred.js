/**
 * Post-SOC documentation deferral — cases advanced to scheduling without
 * F2F + clinical. Intake obtains paperwork after SOC, then sends the case
 * to Clinical Review. Those are separate staff jobs.
 */

import { updateReferralOptimistic, createNoteOptimistic } from '../store/mutations.js';
import { recordActivity } from '../api/activityLog.js';

export const DOCUMENTATION_CLOCK_DAYS = 30;

export function isDocumentationDeferred(referral) {
  if (!referral) return false;
  if (referral.documentation_cleared_at) return false;
  return referral.documentation_deferred === true || referral.documentation_deferred === 'true';
}

export function hasF2FReceived(referral) {
  return !!String(referral?.f2f_date || '').trim();
}

export function hasClinicalCompleted(referral) {
  return !!String(referral?.clinical_review_completed_at || '').trim();
}

export function needsPostSocF2F(referral) {
  return isDocumentationDeferred(referral) && !hasF2FReceived(referral);
}

export function needsPostSocClinical(referral) {
  return isDocumentationDeferred(referral) && !hasClinicalCompleted(referral);
}

/** Calendar date YYYY-MM-DD = socDate + 30 days. */
export function documentationDueDateFromSoc(socDate) {
  const raw = String(socDate || '').trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + DOCUMENTATION_CLOCK_DAYS);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function daysUntilDocumentationDue(referral, { today = new Date() } = {}) {
  const due = String(referral?.documentation_due_date || '').slice(0, 10);
  if (!due || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return null;
  const [y, m, d] = due.split('-').map(Number);
  const dueUtc = Date.UTC(y, m - 1, d);
  const t = today instanceof Date ? today : new Date();
  const todayUtc = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate());
  return Math.round((dueUtc - todayUtc) / 86400000);
}

export function isDocumentationOverdue(referral) {
  if (!isDocumentationDeferred(referral)) return false;
  if (!referral?.documentation_due_date) return false;
  const days = daysUntilDocumentationDue(referral);
  return days != null && days < 0;
}

/**
 * Filter bucket for UI:
 *   none | waiting_docs | waiting_clinical | overdue | cleared
 * "waiting_docs" = deferred + missing F2F
 * "waiting_clinical" = deferred + F2F in (ready for intake to send to Clinical)
 * "overdue" = deferred + past due (takes priority for urgency filters)
 */
export function documentationFilterStatus(referral) {
  if (referral?.documentation_cleared_at) return 'cleared';
  if (!isDocumentationDeferred(referral)) return 'none';
  if (isDocumentationOverdue(referral)) return 'overdue';
  if (needsPostSocF2F(referral)) return 'waiting_docs';
  return 'waiting_clinical';
}

export function documentationDueFieldsForSocDate(socDate) {
  const due = documentationDueDateFromSoc(socDate);
  return due ? { documentation_due_date: due } : {};
}

/** Fields stamped when Intake fast-tracks without F2F/clinical. */
export function documentationDeferredStartFields(actorUserId) {
  const now = new Date().toISOString();
  return {
    documentation_deferred: true,
    documentation_deferred_at: now,
    ...(actorUserId ? { documentation_deferred_by_id: actorUserId } : {}),
    documentation_cleared_at: null,
    documentation_cleared_by_id: null,
  };
}

function isInClinicalReview(referral) {
  return referral?.in_clinical_review === true || referral?.in_clinical_review === 'true';
}

/**
 * Checklist for closing post-SOC deferred documentation.
 * Intake can clear the docs hold without waiting on Clinical Review.
 */
export function getDocumentationClearChecklist(referral) {
  const deferred = isDocumentationDeferred(referral);
  const f2f = hasF2FReceived(referral);
  const clinical = hasClinicalCompleted(referral);
  const inReview = isInClinicalReview(referral);
  const missing = [];
  if (!f2f) missing.push('f2f');
  return {
    deferred,
    f2f,
    clinical,
    inReview,
    canClear: deferred,
    shouldSendToClinical: deferred && !clinical && !inReview,
    missing,
  };
}

function docsClearFields(now, actorUserId) {
  return {
    documentation_deferred: false,
    documentation_cleared_at: now,
    ...(actorUserId ? { documentation_cleared_by_id: actorUserId } : {}),
  };
}

function clinicalHandoffFields(now, actorUserId) {
  return {
    in_clinical_review: true,
    clinical_review_pushed_at: now,
    ...(actorUserId ? { clinical_review_pushed_by_id: actorUserId } : {}),
    returned_from_clinical: false,
  };
}

/**
 * Explicit clear of the deferred-docs hold. Does not wait on Clinical Review.
 *
 * @returns {{ ok: boolean, reason?: string, cleared?: boolean }}
 */
export async function clearDocumentationDeferred(referral, {
  actorUserId,
  source = 'unknown',
} = {}) {
  if (!referral?._id) return { ok: false, reason: 'missing_referral' };
  if (!isDocumentationDeferred(referral)) {
    return { ok: false, reason: 'not_deferred' };
  }

  const now = new Date().toISOString();
  await updateReferralOptimistic(referral._id, docsClearFields(now, actorUserId));
  recordActivity({
    actorUserId,
    action: 'Post-SOC Documentation Cleared',
    patientId: referral.patient_id,
    referralId: referral.id,
    detail: 'Deferred-documentation hold cleared',
    metadata: {
      dueDate: referral.documentation_due_date || null,
      source,
    },
  }).catch(() => {});
  return { ok: true, cleared: true };
}

/**
 * Intake action: drop the docs hold and hand the case to Clinical Review.
 * Clinical completion is a separate RN step and is not required here.
 */
export async function markDocsCompleteAndSendToClinical(referral, {
  actorUserId,
  source = 'unknown',
} = {}) {
  if (!referral?._id) return { ok: false, reason: 'missing_referral' };
  if (!isDocumentationDeferred(referral)) {
    return { ok: false, reason: 'not_deferred' };
  }

  const checklist = getDocumentationClearChecklist(referral);
  const now = new Date().toISOString();
  const send = checklist.shouldSendToClinical;
  const fields = {
    ...docsClearFields(now, actorUserId),
    ...(send ? clinicalHandoffFields(now, actorUserId) : {}),
  };

  await updateReferralOptimistic(referral._id, fields);

  const detail = send
    ? 'Docs marked complete and sent to Clinical Review'
    : 'Deferred-documentation hold cleared';
  recordActivity({
    actorUserId,
    action: send
      ? 'Post-SOC Docs Complete → Clinical Review'
      : 'Post-SOC Documentation Cleared',
    patientId: referral.patient_id,
    referralId: referral.id,
    detail,
    metadata: {
      dueDate: referral.documentation_due_date || null,
      source,
      sentToClinical: send,
    },
  }).catch(() => {});

  if (send) {
    try {
      await createNoteOptimistic({
        id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        patient_id: referral.patient_id || null,
        referral_id: referral.id || null,
        author_id: actorUserId || 'unknown',
        content: 'Post-SOC paperwork marked complete. Sent to Clinical Review.',
        created_at: now,
        is_pinned: false,
      });
    } catch (err) {
      console.warn('[markDocsCompleteAndSendToClinical] note failed:', err?.message || err);
    }
  }

  return { ok: true, cleared: true, sentToClinical: send };
}

/**
 * Safety net after F2F or clinical stamps: only auto-clear when both
 * halves are already done and intake never clicked the handoff button.
 */
export async function maybeClearDocumentationDeferred(referral, { actorUserId, source = 'auto' } = {}) {
  if (!isDocumentationDeferred(referral)) return false;
  if (!hasF2FReceived(referral) || !hasClinicalCompleted(referral)) return false;
  const result = await clearDocumentationDeferred(referral, { actorUserId, source });
  return !!(result.ok && result.cleared);
}
