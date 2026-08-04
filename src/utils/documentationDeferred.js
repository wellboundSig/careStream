/**
 * Post-SOC documentation deferral — cases advanced to scheduling without
 * F2F + clinical. Both are completed after SOC; a 30-day clock starts when
 * SOC is scheduled.
 */

import { updateReferralOptimistic } from '../store/mutations.js';
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
 * "waiting_docs" = deferred + missing F2F (may also need clinical)
 * "waiting_clinical" = deferred + has F2F + missing clinical
 * "overdue" = deferred + past due (takes priority for urgency filters)
 */
export function documentationFilterStatus(referral) {
  if (referral?.documentation_cleared_at) return 'cleared';
  if (!isDocumentationDeferred(referral)) return 'none';
  if (isDocumentationOverdue(referral)) return 'overdue';
  if (needsPostSocF2F(referral)) return 'waiting_docs';
  if (needsPostSocClinical(referral)) return 'waiting_clinical';
  // Both done but not cleared yet — treat as waiting_clinical until clear runs
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

/**
 * Checklist for closing post-SOC deferred documentation.
 * No waiver path — both halves are required.
 */
export function getDocumentationClearChecklist(referral) {
  const deferred = isDocumentationDeferred(referral);
  const f2f = hasF2FReceived(referral);
  const clinical = hasClinicalCompleted(referral);
  const missing = [];
  if (!f2f) missing.push('f2f');
  if (!clinical) missing.push('clinical');
  return {
    deferred,
    f2f,
    clinical,
    canClear: deferred && f2f && clinical,
    missing,
  };
}

/**
 * Explicit clear of deferred documentation (Pending Log / panel / drawer).
 * Hard-gated: still deferred + F2F + clinical. No exception path.
 *
 * @returns {{ ok: boolean, reason?: string, cleared?: boolean }}
 */
export async function clearDocumentationDeferred(referral, { actorUserId, source = 'unknown' } = {}) {
  if (!referral?._id) return { ok: false, reason: 'missing_referral' };
  if (!isDocumentationDeferred(referral)) {
    return { ok: false, reason: 'not_deferred' };
  }
  const checklist = getDocumentationClearChecklist(referral);
  if (!checklist.canClear) {
    return {
      ok: false,
      reason: checklist.missing.includes('f2f') && checklist.missing.includes('clinical')
        ? 'need_f2f_and_clinical'
        : checklist.missing.includes('f2f')
          ? 'need_f2f'
          : 'need_clinical',
      checklist,
    };
  }

  const now = new Date().toISOString();
  await updateReferralOptimistic(referral._id, {
    documentation_deferred: false,
    documentation_cleared_at: now,
    ...(actorUserId ? { documentation_cleared_by_id: actorUserId } : {}),
  });
  recordActivity({
    actorUserId,
    action: 'Post-SOC Documentation Cleared',
    patientId: referral.patient_id,
    referralId: referral.id,
    detail: 'F2F and clinical review completed — deferred-documentation flag cleared',
    metadata: {
      dueDate: referral.documentation_due_date || null,
      source,
    },
  }).catch(() => {});
  return { ok: true, cleared: true };
}

/**
 * If deferred and both F2F + clinical are done, clear the flag.
 * Safe to call after either side stamps; no-op when incomplete.
 */
export async function maybeClearDocumentationDeferred(referral, { actorUserId, source = 'auto' } = {}) {
  const result = await clearDocumentationDeferred(referral, { actorUserId, source });
  return !!(result.ok && result.cleared);
}
