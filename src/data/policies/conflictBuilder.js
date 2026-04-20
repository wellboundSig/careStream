/**
 * Helpers that bridge the pure policy layer and the persistence layer for
 * Conflict creation. UI code calls `buildConflictRecord` and passes the
 * result to `createConflict` + `recordActivity` in a single transaction.
 *
 * These helpers do NOT perform I/O themselves — they return plain objects
 * that callers persist. This keeps them unit-testable.
 */

import { determineConflictReasons } from './eligibilityPolicies.js';
import {
  CONFLICT_SOURCE_MODULE,
  RESOLUTION_STATUS,
  CONFLICT_REASON,
  AUDIT_ACTION,
} from '../eligibilityEnums.js';

/**
 * Build a ConflictRecord-shaped payload for persistence.
 *
 * @param {object} input
 * @param {string} input.patientId
 * @param {string} [input.referralId]
 * @param {string} input.sourceModule One of CONFLICT_SOURCE_MODULE
 * @param {string[]} [input.reasons]       Structured reasons user selected
 * @param {object}   [input.legacyFlags]  Optional legacy boolean flags map
 * @param {boolean}  [input.authDenied]
 * @param {boolean}  [input.coverageNotActive]
 * @param {string}   [input.details]       Freeform
 * @param {string}   input.createdByUserId
 * @returns {{ record: object, audit: object }}
 */
export function buildConflictRecord(input) {
  const reasons = determineConflictReasons({
    explicitReasons: input.reasons,
    legacyFlags: input.legacyFlags,
    authDenied: input.authDenied,
    coverageNotActive: input.coverageNotActive,
  });

  if (reasons.length === 0) {
    throw new Error('Conflict requires at least one structured reason.');
  }

  const now = new Date().toISOString();

  const record = {
    patient_id:       input.patientId,
    referral_id:      input.referralId || null,
    source_module:    input.sourceModule || CONFLICT_SOURCE_MODULE.OTHER,
    conflict_reasons: reasons,
    details:          input.details || '',
    created_by_id:    input.createdByUserId,
    resolution_status: RESOLUTION_STATUS.OPEN,
    created_at:       now,
    updated_at:       now,
  };

  const audit = {
    actorUserId: input.createdByUserId,
    action:      input.sourceModule === CONFLICT_SOURCE_MODULE.AUTHORIZATION
                   ? AUDIT_ACTION.AUTH_DENIED
                   : AUDIT_ACTION.ELIGIBILITY_SENT_TO_CONFLICT,
    patientId:   input.patientId,
    referralId:  input.referralId || undefined,
    detail:      `Conflict created with reasons: ${reasons.join(', ')}`,
    metadata:    { reasons, sourceModule: input.sourceModule, details: input.details || null },
  };

  return { record, audit };
}

/**
 * Legacy adapter — given an InsuranceChecks row (old shape with boolean
 * flags), build a conflict record using structured reasons. Used by migration
 * code + tests.
 */
export function migrateLegacyInsuranceCheckToConflict(insuranceCheck, { createdByUserId, sourceModule } = {}) {
  if (!insuranceCheck) return null;
  const legacyFlags = {
    has_open_hh_episode:  insuranceCheck.has_open_hh_episode === true || insuranceCheck.has_open_hh_episode === 'true',
    hospice_overlap:      insuranceCheck.hospice_overlap === true || insuranceCheck.hospice_overlap === 'true',
    snf_present:          insuranceCheck.snf_present === true || insuranceCheck.snf_present === 'true',
    cdpap_active:         insuranceCheck.cdpap_active === true || insuranceCheck.cdpap_active === 'true',
    auth_required:        insuranceCheck.auth_required === true || insuranceCheck.auth_required === 'true',
    disenrollment_needed: insuranceCheck.disenrollment_needed === true || insuranceCheck.disenrollment_needed === 'true',
  };
  const reasons = determineConflictReasons({ legacyFlags });
  if (reasons.length === 0) return null;
  return buildConflictRecord({
    patientId: insuranceCheck.patient_id,
    referralId: insuranceCheck.referral_id,
    sourceModule: sourceModule || CONFLICT_SOURCE_MODULE.ELIGIBILITY,
    reasons,
    createdByUserId,
    details: 'Migrated from legacy InsuranceChecks boolean flags.',
  });
}

// Re-export so consumers only need one import
export { CONFLICT_REASON, CONFLICT_SOURCE_MODULE };
