/**
 * Lightweight record schemas + validators for the eligibility + authorization
 * domain. Pure JS (no Zod dependency). Each schema exposes:
 *   - shape:   expected field names and types
 *   - required:[] list of required fields
 *   - validate(record): returns { valid, errors: [{field,message}] }
 *
 * Validators here are intentionally STRUCTURAL. Business-rule validation
 * (e.g. "approved requires auth number") lives in the policy modules
 * (`authorizationPolicies.js`, `eligibilityPolicies.js`) so the same rule
 * does not appear in two places.
 */

import {
  INSURANCE_CATEGORY,
  ORDER_RANK,
  VERIFICATION_STATUS,
  VERIFICATION_SOURCE,
  NOTE_CATEGORY,
  BILLING_MODEL,
  AUTH_STATUS,
  AUTH_UNIT_TYPE,
  CONFLICT_REASON,
  CONFLICT_SOURCE_MODULE,
  RESOLUTION_STATUS,
  DISENROLLMENT_FLAG_TYPE,
  DISENROLLMENT_FLAG_STATUS,
  SCA_STATUS,
} from '../eligibilityEnums.js';

function isNonEmptyString(v) { return typeof v === 'string' && v.trim().length > 0; }
function oneOf(allowed) { return (v) => v == null || allowed.includes(v); }
function isArrayOf(allowed) {
  return (v) => v == null || (Array.isArray(v) && v.every((x) => allowed.includes(x)));
}
function isIso(v) {
  if (v == null) return true;
  const d = new Date(v);
  return !Number.isNaN(d.getTime());
}
function nonNegInt(v) { return v == null || (Number.isInteger(v) && v >= 0); }

function buildValidator(schema) {
  return function validate(record) {
    const errors = [];
    if (!record || typeof record !== 'object') {
      return { valid: false, errors: [{ field: '_root', message: 'record is required' }] };
    }
    for (const f of schema.required) {
      if (record[f] == null || record[f] === '') {
        errors.push({ field: f, message: `${f} is required` });
      }
    }
    for (const [field, check] of Object.entries(schema.checks || {})) {
      if (!check.fn(record[field])) {
        errors.push({ field, message: check.message });
      }
    }
    return { valid: errors.length === 0, errors };
  };
}

// ── PatientInsurance ─────────────────────────────────────────────────────────
export const PatientInsuranceSchema = {
  name: 'PatientInsurance',
  required: ['patientId', 'payerDisplayName', 'insuranceCategory'],
  checks: {
    insuranceCategory:     { fn: oneOf(Object.values(INSURANCE_CATEGORY)), message: 'invalid insuranceCategory' },
    orderRank:             { fn: oneOf(Object.values(ORDER_RANK)),         message: 'invalid orderRank' },
    effectiveDate:         { fn: isIso,                                      message: 'effectiveDate must be ISO date' },
    terminationDate:       { fn: isIso,                                      message: 'terminationDate must be ISO date' },
    memberId:              { fn: (v) => v == null || typeof v === 'string',  message: 'memberId must be string' },
  },
};
PatientInsuranceSchema.validate = buildValidator(PatientInsuranceSchema);

// ── EligibilityVerification ──────────────────────────────────────────────────
export const EligibilityVerificationSchema = {
  name: 'EligibilityVerification',
  required: ['patientId', 'insuranceId', 'verificationStatus'],
  checks: {
    verificationStatus:         { fn: oneOf(Object.values(VERIFICATION_STATUS)),    message: 'invalid verificationStatus' },
    staffConfirmedPayerType:    { fn: oneOf(Object.values(INSURANCE_CATEGORY)),     message: 'invalid staffConfirmedPayerType' },
    staffConfirmedOrderRank:    { fn: oneOf(Object.values(ORDER_RANK)),              message: 'invalid staffConfirmedOrderRank' },
    verificationSources:        { fn: isArrayOf(Object.values(VERIFICATION_SOURCE)), message: 'invalid verificationSources' },
    verificationDateTime:       { fn: isIso,                                          message: 'verificationDateTime must be ISO' },
    notesCategory:              { fn: oneOf(Object.values(NOTE_CATEGORY)),            message: 'invalid notesCategory' },
    suggestedBillingModel:      { fn: oneOf(Object.values(BILLING_MODEL)),            message: 'invalid suggestedBillingModel' },
    staffConfirmedBillingModel: { fn: oneOf(Object.values(BILLING_MODEL)),            message: 'invalid staffConfirmedBillingModel' },
  },
};
EligibilityVerificationSchema.validate = buildValidator(EligibilityVerificationSchema);

// Extra structural rule: contradictions
export function validateEligibilityVerificationStrict(record) {
  const { valid, errors } = EligibilityVerificationSchema.validate(record);
  const extra = [];
  if (record?.verificationStatus === VERIFICATION_STATUS.CONFIRMED_ACTIVE &&
      record?.staffConfirmedPayerType && record?.suggestedPayerType &&
      record.staffConfirmedPayerType !== record.suggestedPayerType) {
    extra.push({ field: 'staffConfirmedPayerType', message: 'Staff-confirmed payer type differs from suggestion — requires override note' });
  }
  // Contradictory statuses are prevented at the UI level, but block stray writes too.
  if (record?.verificationStatus === VERIFICATION_STATUS.CONFIRMED_ACTIVE &&
      record?.verificationStatus === VERIFICATION_STATUS.DENIED_NOT_FOUND) {
    extra.push({ field: 'verificationStatus', message: 'Cannot be both confirmed active and denied.' });
  }
  const allErrors = [...errors, ...extra];
  return { valid: valid && extra.length === 0, errors: allErrors };
}

// ── AuthorizationRecord ──────────────────────────────────────────────────────
export const AuthorizationRecordSchema = {
  name: 'AuthorizationRecord',
  required: ['patientId', 'payerInsuranceId', 'authStatus'],
  checks: {
    authStatus:     { fn: oneOf(Object.values(AUTH_STATUS)),    message: 'invalid authStatus' },
    authUnitType:   { fn: oneOf(Object.values(AUTH_UNIT_TYPE)), message: 'invalid authUnitType' },
    authStartDate:  { fn: isIso,                                 message: 'authStartDate must be ISO' },
    authEndDate:    { fn: isIso,                                 message: 'authEndDate must be ISO' },
    authVisitLimit: { fn: nonNegInt,                             message: 'authVisitLimit must be non-negative integer' },
    followUpDate:   { fn: isIso,                                 message: 'followUpDate must be ISO' },
    scaStatus:      { fn: oneOf(Object.values(SCA_STATUS)),     message: 'invalid scaStatus' },
  },
};
AuthorizationRecordSchema.validate = buildValidator(AuthorizationRecordSchema);

// ── ConflictRecord ───────────────────────────────────────────────────────────
export const ConflictRecordSchema = {
  name: 'ConflictRecord',
  required: ['patientId', 'sourceModule', 'conflictReasons'],
  checks: {
    sourceModule:      { fn: oneOf(Object.values(CONFLICT_SOURCE_MODULE)),                    message: 'invalid sourceModule' },
    conflictReasons:   { fn: (v) => Array.isArray(v) && v.length > 0 && v.every((r) => Object.values(CONFLICT_REASON).includes(r)),
                         message: 'conflictReasons must be a non-empty array of valid reason keys' },
    resolutionStatus:  { fn: oneOf(Object.values(RESOLUTION_STATUS)),                          message: 'invalid resolutionStatus' },
  },
};
ConflictRecordSchema.validate = buildValidator(ConflictRecordSchema);

// ── DisenrollmentAssistanceFlag ──────────────────────────────────────────────
export const DisenrollmentAssistanceFlagSchema = {
  name: 'DisenrollmentAssistanceFlag',
  required: ['patientId', 'flagType', 'note', 'followUpDate', 'followUpOwnerUserId'],
  checks: {
    flagType:     { fn: oneOf(Object.values(DISENROLLMENT_FLAG_TYPE)),   message: 'invalid flagType' },
    status:       { fn: oneOf(Object.values(DISENROLLMENT_FLAG_STATUS)), message: 'invalid status' },
    followUpDate: { fn: isIso,                                            message: 'followUpDate must be ISO' },
    note:         { fn: (v) => isNonEmptyString(v),                       message: 'note is required' },
  },
};
DisenrollmentAssistanceFlagSchema.validate = buildValidator(DisenrollmentAssistanceFlagSchema);
