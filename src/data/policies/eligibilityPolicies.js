/**
 * Eligibility policies — pure, unit-testable rule functions.
 *
 * SAFETY / COMPLIANCE PRINCIPLES
 * - These functions produce SUGGESTIONS and VALIDATIONS.
 * - They never auto-finalise anything that affects billing, payer order,
 *   managed-care classification, or conflict disposition.
 * - Any consequential decision must be surfaced to a human reviewer via
 *   `requiresHumanReview: true`.
 *
 * These functions do not import React, I/O, Airtable, or stores. They take
 * plain-object input and return plain-object output, so they are safe to
 * unit-test with no mocking.
 */

import {
  INSURANCE_CATEGORY,
  VERIFICATION_STATUS,
  VERIFICATION_SOURCE,
  CONFLICT_REASON,
  LEGACY_FLAG_TO_CONFLICT_REASON,
  ORDER_RANK,
  BILLING_MODEL,
} from '../eligibilityEnums.js';

// ── normalizeInsuranceCategory ───────────────────────────────────────────────
/**
 * Classify a free-text insurance label (or legacy shorthand) into a canonical
 * INSURANCE_CATEGORY. Ambiguous values map to UNKNOWN and the caller is told
 * to require human review.
 *
 * @param {object} input
 * @param {string} [input.rawLabel]     Free-text label from demographics
 * @param {string} [input.medicareType] Legacy ('' | 'none' | 'ffs' | 'advantage')
 * @param {string} [input.medicaidType] Legacy ('' | 'none' | 'ffs' | 'mco')
 * @returns {{ category: string, requiresHumanReview: boolean, reason: string|null }}
 */
export function normalizeInsuranceCategory({ rawLabel, medicareType, medicaidType } = {}) {
  // Legacy shorthand takes priority — these came from validated inputs.
  if (medicareType === 'ffs')       return ok(INSURANCE_CATEGORY.MEDICARE);
  if (medicareType === 'advantage') return ok(INSURANCE_CATEGORY.MEDICARE_MANAGED);
  if (medicaidType === 'ffs')       return ok(INSURANCE_CATEGORY.MEDICAID);
  if (medicaidType === 'mco')       return ok(INSURANCE_CATEGORY.MEDICAID_MANAGED);

  if (!rawLabel || typeof rawLabel !== 'string') {
    return review('Missing or empty insurance label');
  }

  const label = rawLabel.trim().toLowerCase();

  // Explicit "managed" signals win over bare "medicare"/"medicaid".
  const hasMedicare  = /\bmedicare\b/.test(label);
  const hasMedicaid  = /\bmedicaid\b/.test(label);
  const hasManaged   = /\b(managed|advantage|hmo|ppo|mco|mltc|mlt?c)\b/.test(label);
  const hasCommercial = /\b(aetna|cigna|united|uhc|anthem|blue cross|bcbs|emblem|oscar|humana|healthfirst|molina|fidelis|metroplus|wellcare|oxford|excellus)\b/.test(label);

  if (hasMedicare && hasMedicaid) {
    return review('Label references both Medicare and Medicaid — unable to classify');
  }
  if (hasMedicare) {
    return ok(hasManaged ? INSURANCE_CATEGORY.MEDICARE_MANAGED : INSURANCE_CATEGORY.MEDICARE);
  }
  if (hasMedicaid) {
    return ok(hasManaged ? INSURANCE_CATEGORY.MEDICAID_MANAGED : INSURANCE_CATEGORY.MEDICAID);
  }
  if (hasCommercial) return ok(INSURANCE_CATEGORY.COMMERCIAL);
  if (/\b(third[- ]?party|ltc|workers comp|private pay|auto|no[- ]?fault)\b/.test(label)) {
    return ok(INSURANCE_CATEGORY.THIRD_PARTY);
  }

  return review('Unable to classify insurance label — please select manually');

  function ok(category) { return { category, requiresHumanReview: false, reason: null }; }
  function review(reason) {
    return { category: INSURANCE_CATEGORY.UNKNOWN, requiresHumanReview: true, reason };
  }
}

// ── deriveSuggestedBillingModel ──────────────────────────────────────────────
/**
 * Suggest a billing model. Never finalises — always surface the suggestion in
 * UI with a "staff must confirm" flag for anything that could affect audit
 * exposure.
 *
 * Business note captured in spec:
 *   "Medicaid 18+ gets episodes otherwise FFS per business note, but DO NOT
 *    silently finalize from DOB alone. Compute a suggestion from DOB and
 *    require user confirmation because policy nuance may exist."
 *
 * @param {object} input
 * @param {string} input.category      One of INSURANCE_CATEGORY
 * @param {string|Date|null} input.dob Patient DOB
 * @param {object} [input.config]      Optional overrides (defaults conservative)
 * @returns {{ suggestedBillingModel: string, requiresHumanReview: boolean, rationale: string }}
 */
export function deriveSuggestedBillingModel({ category, dob, config } = {}) {
  const cfg = {
    medicaidAdultBillingModel: BILLING_MODEL.NEEDS_REVIEW,
    medicaidPediatricBillingModel: BILLING_MODEL.NEEDS_REVIEW,
    enableMedicaidDobHeuristic: false,
    ...(config || {}),
  };

  if (!category || category === INSURANCE_CATEGORY.UNKNOWN) {
    return r(BILLING_MODEL.NEEDS_REVIEW, true, 'Category unknown — staff must classify');
  }

  if (category === INSURANCE_CATEGORY.MEDICARE) {
    return r(BILLING_MODEL.EPISODIC, true,
      'Medicare is billed episodically (30-day / PDGM) — confirm episode setup');
  }
  if (category === INSURANCE_CATEGORY.MEDICARE_MANAGED) {
    return r(BILLING_MODEL.MANAGED_CARE, true,
      'Medicare Advantage is managed — confirm plan-specific billing rules');
  }
  if (category === INSURANCE_CATEGORY.MEDICAID_MANAGED) {
    return r(BILLING_MODEL.MANAGED_CARE, true,
      'Managed Medicaid — confirm MCO billing rules and auth requirements');
  }
  if (category === INSURANCE_CATEGORY.MEDICAID) {
    if (!cfg.enableMedicaidDobHeuristic) {
      return r(BILLING_MODEL.NEEDS_REVIEW, true,
        'Medicaid billing model depends on age / policy — staff must confirm');
    }
    const age = computeAge(dob);
    if (age == null) {
      return r(BILLING_MODEL.NEEDS_REVIEW, true,
        'DOB missing or invalid — cannot suggest Medicaid billing model');
    }
    if (age >= 18) {
      return r(cfg.medicaidAdultBillingModel, true,
        `Patient age ${age} — business rule suggests ${cfg.medicaidAdultBillingModel}; staff must confirm`);
    }
    return r(cfg.medicaidPediatricBillingModel, true,
      `Patient age ${age} — business rule suggests ${cfg.medicaidPediatricBillingModel}; staff must confirm`);
  }
  if (category === INSURANCE_CATEGORY.COMMERCIAL || category === INSURANCE_CATEGORY.THIRD_PARTY) {
    return r(BILLING_MODEL.NEEDS_REVIEW, true,
      'Commercial / third-party billing terms vary — staff must confirm');
  }
  return r(BILLING_MODEL.NEEDS_REVIEW, true, 'Unhandled category — defer to staff');

  function r(suggestedBillingModel, requiresHumanReview, rationale) {
    return { suggestedBillingModel, requiresHumanReview, rationale };
  }
}

export function computeAge(dob) {
  if (!dob) return null;
  const d = dob instanceof Date ? dob : new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

// ── validateInsuranceEntry ───────────────────────────────────────────────────
/**
 * Shallow schema check for a PatientInsurance entry. Returns a list of
 * errors; empty list means valid.
 *
 * @param {object} entry
 * @returns {{ valid: boolean, errors: Array<{ field: string, message: string }> }}
 */
export function validateInsuranceEntry(entry) {
  const errors = [];
  if (!entry || typeof entry !== 'object') {
    return { valid: false, errors: [{ field: '_root', message: 'Entry is required' }] };
  }
  if (!entry.patientId)            errors.push({ field: 'patientId',         message: 'patientId is required' });
  if (!entry.payerDisplayName)     errors.push({ field: 'payerDisplayName',  message: 'Payer name is required' });
  if (!entry.insuranceCategory)    errors.push({ field: 'insuranceCategory', message: 'Insurance category is required' });
  else if (!Object.values(INSURANCE_CATEGORY).includes(entry.insuranceCategory)) {
    errors.push({ field: 'insuranceCategory', message: 'Invalid insurance category' });
  }
  if (entry.orderRank && !Object.values(ORDER_RANK).includes(entry.orderRank)) {
    errors.push({ field: 'orderRank', message: 'Invalid order rank' });
  }
  if (entry.effectiveDate && entry.terminationDate) {
    const start = new Date(entry.effectiveDate);
    const end = new Date(entry.terminationDate);
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end < start) {
      errors.push({ field: 'terminationDate', message: 'Termination date is before effective date' });
    }
  }
  return { valid: errors.length === 0, errors };
}

// ── determineConflictReasons ─────────────────────────────────────────────────
/**
 * Convert legacy boolean blocker flags into a deduplicated list of structured
 * conflict reasons. Accepts either a `legacyFlags` map or explicit reasons.
 *
 * @param {object} input
 * @param {object} [input.legacyFlags] e.g. { has_open_hh_episode: true, cdpap_active: true }
 * @param {string[]} [input.explicitReasons] Directly selected reasons
 * @param {boolean} [input.authDenied]
 * @param {boolean} [input.coverageNotActive]
 * @returns {string[]} unique conflict reason keys
 */
export function determineConflictReasons({ legacyFlags, explicitReasons, authDenied, coverageNotActive } = {}) {
  const reasons = new Set();
  if (legacyFlags && typeof legacyFlags === 'object') {
    for (const [flag, value] of Object.entries(legacyFlags)) {
      if (value === true || value === 'true') {
        const mapped = LEGACY_FLAG_TO_CONFLICT_REASON[flag];
        if (mapped) reasons.add(mapped);
      }
    }
  }
  if (Array.isArray(explicitReasons)) {
    for (const r of explicitReasons) {
      if (Object.values(CONFLICT_REASON).includes(r)) reasons.add(r);
    }
  }
  if (authDenied)         reasons.add(CONFLICT_REASON.AUTH_DENIED);
  if (coverageNotActive)  reasons.add(CONFLICT_REASON.COVERAGE_NOT_ACTIVE);
  return Array.from(reasons);
}

// ── determineEligibilityWarnings ─────────────────────────────────────────────
/**
 * Given a set of eligibility verifications, return human-facing warnings.
 * Non-blocking — these surface to staff; they do NOT prevent save on their own.
 *
 * @param {object[]} verifications
 * @returns {Array<{ code: string, message: string, insuranceId?: string }>}
 */
export function determineEligibilityWarnings(verifications = []) {
  const warnings = [];
  const active = verifications.filter((v) => v.verificationStatus === VERIFICATION_STATUS.CONFIRMED_ACTIVE);

  if (active.length === 0 && verifications.length > 0) {
    warnings.push({ code: 'no_active_coverage', message: 'No insurance has been confirmed active.' });
  }

  const primaries = active.filter((v) => v.staffConfirmedOrderRank === ORDER_RANK.PRIMARY);
  if (primaries.length > 1) {
    warnings.push({ code: 'multiple_primaries', message: 'More than one insurance is marked Primary.' });
  }

  const unreviewed = verifications.filter((v) => v.verificationStatus === VERIFICATION_STATUS.UNREVIEWED);
  if (unreviewed.length > 0) {
    warnings.push({
      code: 'unreviewed_insurance',
      message: `${unreviewed.length} insurance entr${unreviewed.length === 1 ? 'y is' : 'ies are'} unreviewed.`,
    });
  }

  for (const v of verifications) {
    if (v.verificationStatus === VERIFICATION_STATUS.CONFIRMED_ACTIVE) {
      if (!Array.isArray(v.verificationSources) || v.verificationSources.length === 0) {
        warnings.push({
          code: 'missing_source',
          insuranceId: v.insuranceId,
          message: 'Confirmed active without any verification source documented.',
        });
      }
    }
  }
  return warnings;
}

// ── shouldRequireHumanReview ─────────────────────────────────────────────────
/**
 * Returns { required: true, reasons: [...] } when a given eligibility payload
 * has any condition that policy says a human must confirm before the record
 * advances. Keep this conservative — prefer false positives over silent flow.
 *
 * @param {object} payload
 * @param {string} payload.verificationStatus
 * @param {string} [payload.category]
 * @param {string[]} [payload.verificationSources]
 * @param {string} [payload.staffConfirmedOrderRank]
 * @param {string} [payload.suggestedOrderRank]
 * @param {string} [payload.staffConfirmedPayerType]
 * @param {string} [payload.suggestedPayerType]
 * @param {string} [payload.suggestedBillingModel]
 * @param {string} [payload.staffConfirmedBillingModel]
 * @param {boolean} [payload.dobDerivedSuggestion]
 * @returns {{ required: boolean, reasons: string[] }}
 */
export function shouldRequireHumanReview(payload = {}) {
  const reasons = [];

  if (!payload.staffConfirmedOrderRank || payload.staffConfirmedOrderRank === ORDER_RANK.UNKNOWN) {
    reasons.push('Payer order is not confirmed by staff.');
  } else if (payload.suggestedOrderRank && payload.staffConfirmedOrderRank !== payload.suggestedOrderRank) {
    // Not a blocker, but surface that staff overrode the suggestion
    reasons.push('Staff-confirmed order rank differs from computed suggestion.');
  }

  if (payload.category === INSURANCE_CATEGORY.UNKNOWN) {
    reasons.push('Insurance category is unclassified.');
  }

  // Conflicting managed / straight signals
  if (payload.suggestedPayerType && payload.staffConfirmedPayerType &&
      payload.suggestedPayerType !== payload.staffConfirmedPayerType) {
    const pair = new Set([payload.suggestedPayerType, payload.staffConfirmedPayerType]);
    if (pair.has(INSURANCE_CATEGORY.MEDICARE) && pair.has(INSURANCE_CATEGORY.MEDICARE_MANAGED)) {
      reasons.push('Conflicting Medicare straight/managed signals.');
    }
    if (pair.has(INSURANCE_CATEGORY.MEDICAID) && pair.has(INSURANCE_CATEGORY.MEDICAID_MANAGED)) {
      reasons.push('Conflicting Medicaid straight/managed signals.');
    }
  }

  // Confirmed active without any source
  if (payload.verificationStatus === VERIFICATION_STATUS.CONFIRMED_ACTIVE) {
    const sources = Array.isArray(payload.verificationSources) ? payload.verificationSources : [];
    if (sources.length === 0) {
      reasons.push('Confirmed active but no verification source recorded.');
    }
  }

  // DOB-derived billing model suggestion requires confirmation
  if (payload.dobDerivedSuggestion && !payload.staffConfirmedBillingModel) {
    reasons.push('DOB-derived billing model suggestion requires staff confirmation.');
  }

  return { required: reasons.length > 0, reasons };
}

// ── suggestSourceForCategory ─────────────────────────────────────────────────
/**
 * Suggest which verification source is typically authoritative for a given
 * category. Returned list is suggestions only — user may select additional
 * sources. Never restricts input.
 */
export function suggestSourceForCategory(category) {
  switch (category) {
    case INSURANCE_CATEGORY.MEDICARE:         return [VERIFICATION_SOURCE.WAYSTAR];
    case INSURANCE_CATEGORY.MEDICARE_MANAGED: return [VERIFICATION_SOURCE.AVAILITY, VERIFICATION_SOURCE.COMMERCIAL_PORTAL];
    case INSURANCE_CATEGORY.MEDICAID:         return [VERIFICATION_SOURCE.EPACES, VERIFICATION_SOURCE.EMEDNY];
    case INSURANCE_CATEGORY.MEDICAID_MANAGED: return [VERIFICATION_SOURCE.EPACES, VERIFICATION_SOURCE.COMMERCIAL_PORTAL];
    case INSURANCE_CATEGORY.COMMERCIAL:       return [VERIFICATION_SOURCE.AVAILITY, VERIFICATION_SOURCE.COMMERCIAL_PORTAL];
    case INSURANCE_CATEGORY.THIRD_PARTY:      return [VERIFICATION_SOURCE.PHONE, VERIFICATION_SOURCE.FAX];
    default:                                  return [];
  }
}

// ── canFinalizeEligibility ───────────────────────────────────────────────────
/**
 * Returns { canFinalize: boolean, blockers: [...] }. Used by the UI to lock
 * "complete" buttons. Combines per-insurance reviews across the referral.
 */
export function canFinalizeEligibility(verifications = []) {
  const blockers = [];
  if (!verifications.length) {
    blockers.push('No insurance entries to verify.');
    return { canFinalize: false, blockers };
  }

  let hasActive = false;
  for (const v of verifications) {
    if (v.verificationStatus === VERIFICATION_STATUS.UNREVIEWED) {
      blockers.push(`Insurance ${v.insuranceId || ''} is unreviewed.`);
    }
    if (v.verificationStatus === VERIFICATION_STATUS.CONFIRMED_ACTIVE) {
      hasActive = true;
      if (!v.verifiedByUserId) blockers.push(`Missing verifier on ${v.insuranceId || 'insurance'}.`);
      if (!v.verificationDateTime) blockers.push(`Missing verification time on ${v.insuranceId || 'insurance'}.`);
      if (!Array.isArray(v.verificationSources) || v.verificationSources.length === 0) {
        blockers.push(`Missing source on ${v.insuranceId || 'insurance'}.`);
      }
      if (!v.staffConfirmedOrderRank || v.staffConfirmedOrderRank === ORDER_RANK.UNKNOWN) {
        blockers.push(`Payer order not confirmed on ${v.insuranceId || 'insurance'}.`);
      }
    }
  }
  if (!hasActive) blockers.push('At least one insurance must be confirmed active (or routed to conflict).');
  return { canFinalize: blockers.length === 0, blockers };
}
