import { describe, it, expect } from 'vitest';
import {
  PatientInsuranceSchema,
  EligibilityVerificationSchema,
  AuthorizationRecordSchema,
  ConflictRecordSchema,
  DisenrollmentAssistanceFlagSchema,
  validateEligibilityVerificationStrict,
} from '../schemas.js';
import {
  INSURANCE_CATEGORY,
  ORDER_RANK,
  VERIFICATION_STATUS,
  VERIFICATION_SOURCE,
  AUTH_STATUS,
  CONFLICT_REASON,
  CONFLICT_SOURCE_MODULE,
  DISENROLLMENT_FLAG_TYPE,
} from '../../eligibilityEnums.js';

describe('PatientInsuranceSchema', () => {
  it('requires patientId, payerDisplayName, insuranceCategory', () => {
    const r = PatientInsuranceSchema.validate({});
    expect(r.valid).toBe(false);
    expect(r.errors.map((e) => e.field)).toEqual(expect.arrayContaining([
      'patientId', 'payerDisplayName', 'insuranceCategory',
    ]));
  });

  it('accepts a valid entry', () => {
    const r = PatientInsuranceSchema.validate({
      patientId: 'p1',
      payerDisplayName: 'Fidelis',
      insuranceCategory: INSURANCE_CATEGORY.MEDICAID_MANAGED,
      orderRank: ORDER_RANK.PRIMARY,
    });
    expect(r.valid).toBe(true);
  });
});

describe('EligibilityVerificationSchema', () => {
  it('requires patientId, insuranceId, verificationStatus', () => {
    const r = EligibilityVerificationSchema.validate({});
    expect(r.valid).toBe(false);
  });

  it('rejects invalid verification source list', () => {
    const r = EligibilityVerificationSchema.validate({
      patientId: 'p1', insuranceId: 'i1',
      verificationStatus: VERIFICATION_STATUS.CONFIRMED_ACTIVE,
      verificationSources: ['not_a_source'],
    });
    expect(r.valid).toBe(false);
  });

  it('accepts with valid source list', () => {
    const r = EligibilityVerificationSchema.validate({
      patientId: 'p1', insuranceId: 'i1',
      verificationStatus: VERIFICATION_STATUS.CONFIRMED_ACTIVE,
      verificationSources: [VERIFICATION_SOURCE.WAYSTAR, VERIFICATION_SOURCE.PHONE],
    });
    expect(r.valid).toBe(true);
  });

  it('strict: flags staff type differing from suggestion', () => {
    const r = validateEligibilityVerificationStrict({
      patientId: 'p1', insuranceId: 'i1',
      verificationStatus: VERIFICATION_STATUS.CONFIRMED_ACTIVE,
      staffConfirmedPayerType: INSURANCE_CATEGORY.MEDICARE_MANAGED,
      suggestedPayerType: INSURANCE_CATEGORY.MEDICARE,
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === 'staffConfirmedPayerType')).toBe(true);
  });
});

describe('AuthorizationRecordSchema', () => {
  it('rejects missing payerInsuranceId', () => {
    const r = AuthorizationRecordSchema.validate({ patientId: 'p1', authStatus: AUTH_STATUS.APPROVED });
    expect(r.valid).toBe(false);
  });

  it('rejects invalid authStatus', () => {
    const r = AuthorizationRecordSchema.validate({
      patientId: 'p1', payerInsuranceId: 'i1', authStatus: 'mystery',
    });
    expect(r.valid).toBe(false);
  });

  it('rejects non-integer visit limit', () => {
    const r = AuthorizationRecordSchema.validate({
      patientId: 'p1', payerInsuranceId: 'i1',
      authStatus: AUTH_STATUS.APPROVED, authVisitLimit: -3,
    });
    expect(r.valid).toBe(false);
  });
});

describe('ConflictRecordSchema', () => {
  it('rejects missing reasons', () => {
    const r = ConflictRecordSchema.validate({
      patientId: 'p1',
      sourceModule: CONFLICT_SOURCE_MODULE.ELIGIBILITY,
      conflictReasons: [],
    });
    expect(r.valid).toBe(false);
  });

  it('rejects unknown reason', () => {
    const r = ConflictRecordSchema.validate({
      patientId: 'p1', sourceModule: CONFLICT_SOURCE_MODULE.ELIGIBILITY,
      conflictReasons: ['made_up_reason'],
    });
    expect(r.valid).toBe(false);
  });

  it('accepts a valid conflict', () => {
    const r = ConflictRecordSchema.validate({
      patientId: 'p1',
      sourceModule: CONFLICT_SOURCE_MODULE.ELIGIBILITY,
      conflictReasons: [CONFLICT_REASON.OPEN_HH_EPISODE, CONFLICT_REASON.CDPAP_ACTIVE],
    });
    expect(r.valid).toBe(true);
  });
});

describe('DisenrollmentAssistanceFlagSchema', () => {
  it('rejects missing note or follow-up', () => {
    const r = DisenrollmentAssistanceFlagSchema.validate({
      patientId: 'p1', flagType: DISENROLLMENT_FLAG_TYPE.EXPERT_MEDICAID_ASSIST,
    });
    expect(r.valid).toBe(false);
  });

  it('accepts a valid flag', () => {
    const r = DisenrollmentAssistanceFlagSchema.validate({
      patientId: 'p1',
      flagType: DISENROLLMENT_FLAG_TYPE.EXPERT_MEDICAID_ASSIST,
      note: 'Needs help with Medicaid disenrollment',
      followUpDate: '2026-05-10',
      followUpOwnerUserId: 'u1',
    });
    expect(r.valid).toBe(true);
  });
});
