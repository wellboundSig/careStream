/**
 * Authorization policies — pure, unit-testable rule functions.
 *
 * SAFETY / COMPLIANCE PRINCIPLES
 * - Auth denial NEVER auto-routes to NTUC. Routing to NTUC is an admin
 *   action governed by its own permission, not a byproduct of a denial.
 * - Approval cannot be persisted without minimally complete data.
 * - A NAR (No Auth Required) suggestion from payer mix is ALWAYS surfaced
 *   for human confirmation — the policy function only produces a
 *   suggestion + reason, never a finalised record.
 */

import {
  AUTH_STATUS,
  AUTH_SERVICE,
  ALL_AUTH_SERVICES,
  INSURANCE_CATEGORY,
  FACILITY_SETTING,
  DIVISION,
  ROUTING_ACTION,
} from '../eligibilityEnums.js';

// ── determineAllowedAuthorizationPaths ───────────────────────────────────────
/**
 * For a referral in Authorization Pending, what routing actions are currently
 * allowed?
 *
 * Rules:
 * - Denial never includes `advance_to_staffing` and never `route_to_ntuc`.
 * - Denial always includes `send_to_conflict` and `send_to_follow_up`.
 * - SPN denial additionally allows `request_sca`.
 * - Approved permits `advance_to_staffing`.
 * - NAR permits `advance_to_staffing` (no auth obtained).
 *
 * @param {object} input
 * @param {string} input.authStatus
 * @param {string} [input.division]   DIVISION.*
 * @returns {string[]} allowed ROUTING_ACTION keys
 */
export function determineAllowedAuthorizationPaths({ authStatus, division } = {}) {
  const out = [];
  if (authStatus === AUTH_STATUS.APPROVED) {
    out.push(ROUTING_ACTION.ADVANCE_TO_STAFFING);
    return out;
  }
  if (authStatus === AUTH_STATUS.NAR) {
    out.push(ROUTING_ACTION.ADVANCE_TO_STAFFING);
    return out;
  }
  if (authStatus === AUTH_STATUS.PENDING) {
    out.push(ROUTING_ACTION.SEND_TO_FOLLOW_UP);
    return out;
  }
  if (authStatus === AUTH_STATUS.FOLLOW_UP_NEEDED) {
    out.push(ROUTING_ACTION.SEND_TO_FOLLOW_UP);
    return out;
  }
  if (authStatus === AUTH_STATUS.DENIED) {
    out.push(ROUTING_ACTION.SEND_TO_CONFLICT);
    out.push(ROUTING_ACTION.SEND_TO_FOLLOW_UP);
    if (division === DIVISION.SPECIAL_NEEDS) {
      out.push(ROUTING_ACTION.REQUEST_SCA);
    }
    return out;
  }
  return out;
}

// ── validateAuthorizationRecord ──────────────────────────────────────────────
/**
 * Validate an AuthorizationRecord before persisting. Returns a list of
 * blocking errors. Empty errors means safe to save.
 *
 * @param {object} record
 * @returns {{ valid: boolean, errors: Array<{ field: string, message: string }> }}
 */
export function validateAuthorizationRecord(record) {
  const errors = [];
  if (!record || typeof record !== 'object') {
    return { valid: false, errors: [{ field: '_root', message: 'Record is required' }] };
  }
  if (!record.patientId) errors.push({ field: 'patientId', message: 'patientId is required' });
  if (!record.payerInsuranceId) {
    // Always required; auth must be tied to a specific insurance, never to
    // "whatever insurance the referral happens to have right now".
    errors.push({ field: 'payerInsuranceId', message: 'payerInsuranceId is required' });
  }
  if (!record.authStatus) {
    errors.push({ field: 'authStatus', message: 'authStatus is required' });
  } else if (!Object.values(AUTH_STATUS).includes(record.authStatus)) {
    errors.push({ field: 'authStatus', message: 'Invalid authStatus' });
  }

  if (record.authStatus === AUTH_STATUS.APPROVED) {
    if (!record.authNumber && !record.documentedException) {
      errors.push({ field: 'authNumber', message: 'Auth number is required for approved status (or document an exception)' });
    }
    if (!record.authStartDate && !record.authEndDate && !record.authVisitLimit) {
      errors.push({ field: 'authWindow', message: 'Approved auth must define a date window or a visit/unit limit' });
    }
    if (record.authStartDate && record.authEndDate) {
      const s = new Date(record.authStartDate);
      const e = new Date(record.authEndDate);
      if (!Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime()) && e < s) {
        errors.push({ field: 'authEndDate', message: 'Auth end date cannot be before start date' });
      }
    }
  }
  if (record.authStatus === AUTH_STATUS.DENIED) {
    if (!record.denialReason || !record.denialReason.trim()) {
      errors.push({ field: 'denialReason', message: 'Denial reason is required' });
    }
  }
  if (record.authStatus === AUTH_STATUS.FOLLOW_UP_NEEDED) {
    if (!record.followUpDate)        errors.push({ field: 'followUpDate',        message: 'Follow-up date is required' });
    if (!record.followUpOwnerUserId) errors.push({ field: 'followUpOwnerUserId', message: 'Follow-up owner is required' });
  }
  if (record.followUpDate && !record.followUpOwnerUserId) {
    errors.push({ field: 'followUpOwnerUserId', message: 'Follow-up owner is required when a follow-up date is set' });
  }
  return { valid: errors.length === 0, errors };
}

// ── suggestNar ───────────────────────────────────────────────────────────────
/**
 * If the patient has ONLY straight Medicare and straight Medicaid (no managed
 * plans, no commercial), business note says no auth may be needed. This
 * returns a SUGGESTION that the UI must present for staff confirmation.
 *
 * Never persist NAR solely from this function's output — pipe through the
 * staff confirmation step first.
 *
 * @param {object[]} verifiedInsurances An array of confirmed-active insurances
 *   with shape: { insuranceCategory }
 * @returns {{ suggestNar: boolean, rationale: string, requiresConfirmation: true }}
 */
export function suggestNar(verifiedInsurances = []) {
  if (!Array.isArray(verifiedInsurances) || verifiedInsurances.length === 0) {
    return { suggestNar: false, rationale: 'No confirmed insurances yet.', requiresConfirmation: true };
  }
  const cats = verifiedInsurances.map((i) => i.insuranceCategory);
  const onlyStraight =
    cats.every((c) => c === INSURANCE_CATEGORY.MEDICARE || c === INSURANCE_CATEGORY.MEDICAID) &&
    cats.includes(INSURANCE_CATEGORY.MEDICARE) &&
    cats.includes(INSURANCE_CATEGORY.MEDICAID);

  if (onlyStraight) {
    return {
      suggestNar: true,
      rationale: 'Only straight Medicare + Medicaid confirmed. Business note suggests no auth required — staff must confirm.',
      requiresConfirmation: true,
    };
  }
  return {
    suggestNar: false,
    rationale: 'Managed or additional payer present — auth requirements depend on plan.',
    requiresConfirmation: true,
  };
}

// ── determineRequiresFollowUp ────────────────────────────────────────────────
export function determineRequiresFollowUp(record) {
  if (!record) return false;
  if (record.authStatus === AUTH_STATUS.FOLLOW_UP_NEEDED) return true;
  if (record.authStatus === AUTH_STATUS.PENDING) return true;
  return false;
}

// ── validateFollowUp ─────────────────────────────────────────────────────────
export function validateFollowUp({ followUpDate, followUpOwnerUserId } = {}) {
  const errors = [];
  if (!followUpDate)        errors.push({ field: 'followUpDate',        message: 'Follow-up date is required' });
  if (!followUpOwnerUserId) errors.push({ field: 'followUpOwnerUserId', message: 'Follow-up owner is required' });
  if (followUpDate) {
    const d = new Date(followUpDate);
    if (Number.isNaN(d.getTime())) errors.push({ field: 'followUpDate', message: 'Invalid follow-up date' });
  }
  return { valid: errors.length === 0, errors };
}

// Re-export so callers only depend on this module
export { AUTH_SERVICE, ALL_AUTH_SERVICES, AUTH_STATUS, FACILITY_SETTING, DIVISION };
