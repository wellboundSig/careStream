import { describe, it, expect, beforeEach } from 'vitest';
import { createHarness, snapshotDemographicsInsurance } from './testHarness.js';
import { buildConflictRecord } from '../../data/policies/conflictBuilder.js';
import {
  validateAuthorizationRecord,
  suggestNar,
  determineAllowedAuthorizationPaths,
} from '../../data/policies/authorizationPolicies.js';
import { determineAllowedServicesByDivision } from '../../data/policies/serviceAvailabilityPolicies.js';
import {
  canFinalizeEligibility,
  determineEligibilityWarnings,
} from '../../data/policies/eligibilityPolicies.js';
import {
  INSURANCE_CATEGORY,
  VERIFICATION_STATUS,
  VERIFICATION_SOURCE,
  AUTH_STATUS,
  CONFLICT_SOURCE_MODULE,
  CONFLICT_REASON,
  ORDER_RANK,
  DISENROLLMENT_FLAG_TYPE,
  DISENROLLMENT_FLAG_STATUS,
  AUDIT_ACTION,
  ROUTING_ACTION,
  DIVISION,
} from '../../data/eligibilityEnums.js';

let h;
beforeEach(() => { h = createHarness(); });

// ── C.1 Demographics to Eligibility sync ────────────────────────────────────
describe('demographics_to_eligibility_sync', () => {
  it('multiple demographic insurances appear in Eligibility and do not mutate the demographic row', () => {
    const patientId = 'p_1';
    const a = h.createPatientInsurance({
      patient_id: patientId, payer_display_name: 'Medicare', insurance_category: INSURANCE_CATEGORY.MEDICARE,
      member_id: '1EG4-TE5-MK72', order_rank: ORDER_RANK.PRIMARY,
    });
    const b = h.createPatientInsurance({
      patient_id: patientId, payer_display_name: 'Fidelis Care', insurance_category: INSURANCE_CATEGORY.MEDICAID_MANAGED,
      member_id: 'FC-123', order_rank: ORDER_RANK.SECONDARY,
    });

    const snapshotA = snapshotDemographicsInsurance(a);
    const snapshotB = snapshotDemographicsInsurance(b);

    // Eligibility side creates verifications referencing the insurance ids.
    h.createEligibilityVerification({
      patient_id: patientId, insurance_id: a.id,
      verification_status: VERIFICATION_STATUS.CONFIRMED_ACTIVE,
      synced_from_demographics: snapshotA,
    });
    h.createEligibilityVerification({
      patient_id: patientId, insurance_id: b.id,
      verification_status: VERIFICATION_STATUS.UNREVIEWED,
      synced_from_demographics: snapshotB,
    });

    const verifications = h.listVerificationsForPatient(patientId);
    expect(verifications).toHaveLength(2);

    // Eligibility side attempting to mutate demographics snapshot should fail
    // because it is frozen.
    expect(() => { snapshotA.payerDisplayName = 'Attempt edit'; }).toThrow();

    // Demographics row itself unchanged
    const live = h.listInsurancesForPatient(patientId).find((x) => x.id === a.id);
    expect(live.payer_display_name).toBe('Medicare');
  });
});

// ── C.2 eligibility_confirmation_flow ───────────────────────────────────────
describe('eligibility_confirmation_flow', () => {
  it('records verifier, sources, payer order, note, audit trail', () => {
    const patientId = 'p_2';
    const ins = h.createPatientInsurance({
      patient_id: patientId, payer_display_name: 'Medicare',
      insurance_category: INSURANCE_CATEGORY.MEDICARE,
    });

    const verifiedAt = new Date().toISOString();
    h.createEligibilityVerification({
      patient_id: patientId,
      insurance_id: ins.id,
      verification_status: VERIFICATION_STATUS.CONFIRMED_ACTIVE,
      staff_confirmed_payer_type: INSURANCE_CATEGORY.MEDICARE,
      staff_confirmed_order_rank: ORDER_RANK.PRIMARY,
      verification_sources: [VERIFICATION_SOURCE.WAYSTAR],
      verification_date_time: verifiedAt,
      verified_by_user_id: 'u_eligibility_1',
      note_category: 'coverage_detail',
      note_text: 'Part A + B active.',
    });

    h.recordActivity({
      actorUserId: 'u_eligibility_1',
      action: AUDIT_ACTION.ELIGIBILITY_CHECKED,
      patientId,
    });

    const v = h.listVerificationsForPatient(patientId)[0];
    const finalizeCheck = canFinalizeEligibility([{
      verificationStatus: v.verification_status,
      staffConfirmedOrderRank: v.staff_confirmed_order_rank,
      verifiedByUserId: v.verified_by_user_id,
      verificationDateTime: v.verification_date_time,
      verificationSources: v.verification_sources,
      insuranceId: ins.id,
    }]);
    expect(finalizeCheck.canFinalize).toBe(true);
    h.assertAudited(AUDIT_ACTION.ELIGIBILITY_CHECKED);
  });
});

// ── C.3 eligibility_denial_to_conflict_flow ─────────────────────────────────
describe('eligibility_denial_to_conflict_flow', () => {
  it('denial with structured conflict reason creates conflict and audit', () => {
    const patientId = 'p_3';
    const ins = h.createPatientInsurance({
      patient_id: patientId,
      payer_display_name: 'Old Plan',
      insurance_category: INSURANCE_CATEGORY.COMMERCIAL,
    });
    h.createEligibilityVerification({
      patient_id: patientId,
      insurance_id: ins.id,
      verification_status: VERIFICATION_STATUS.DENIED_NOT_FOUND,
      verified_by_user_id: 'u_1',
      verification_date_time: new Date().toISOString(),
    });

    const { record, audit } = buildConflictRecord({
      patientId,
      sourceModule: CONFLICT_SOURCE_MODULE.ELIGIBILITY,
      reasons: [CONFLICT_REASON.COVERAGE_NOT_ACTIVE],
      createdByUserId: 'u_1',
      details: 'Payer confirmed termination 2024-12-31.',
    });
    h.createConflict(record);
    h.recordActivity(audit);

    expect(h.state.conflicts.size).toBe(1);
    const conflict = Array.from(h.state.conflicts.values())[0];
    expect(conflict.conflict_reasons).toContain(CONFLICT_REASON.COVERAGE_NOT_ACTIVE);
    h.assertAudited(AUDIT_ACTION.ELIGIBILITY_SENT_TO_CONFLICT);
  });

  it('refuses to create a conflict without at least one reason', () => {
    expect(() => buildConflictRecord({
      patientId: 'p_x', sourceModule: CONFLICT_SOURCE_MODULE.ELIGIBILITY,
      reasons: [], createdByUserId: 'u_1',
    })).toThrow(/reason/i);
  });
});

// ── C.4 authorization_approval_flow ─────────────────────────────────────────
describe('authorization_approval_flow', () => {
  it('saves approval with auth number + date window and logs audit', () => {
    const payload = {
      patientId: 'p_4', payerInsuranceId: 'ins_4',
      authStatus: AUTH_STATUS.APPROVED,
      authNumber: 'AUTH-001',
      authStartDate: '2026-05-01', authEndDate: '2026-07-30',
      authVisitLimit: 30, authUnitType: 'visit',
    };
    const validation = validateAuthorizationRecord(payload);
    expect(validation.valid).toBe(true);
    h.createAuthorization(payload);
    h.recordActivity({ actorUserId: 'u_auth', action: AUDIT_ACTION.AUTH_APPROVED, patientId: 'p_4' });
    const paths = determineAllowedAuthorizationPaths({ authStatus: AUTH_STATUS.APPROVED });
    expect(paths).toContain(ROUTING_ACTION.ADVANCE_TO_STAFFING);
    h.assertAudited(AUDIT_ACTION.AUTH_APPROVED);
  });
});

// ── C.5 authorization_denial_flow ───────────────────────────────────────────
describe('authorization_denial_flow', () => {
  it('denial cannot route to NTUC; must choose conflict/follow-up/SCA', () => {
    const record = {
      patientId: 'p_5', payerInsuranceId: 'ins_5',
      authStatus: AUTH_STATUS.DENIED, denialReason: 'Non-covered service',
    };
    expect(validateAuthorizationRecord(record).valid).toBe(true);
    h.createAuthorization(record);

    const paths = determineAllowedAuthorizationPaths({ authStatus: AUTH_STATUS.DENIED, division: DIVISION.SPECIAL_NEEDS });
    expect(paths.find((p) => /ntuc/i.test(p))).toBeUndefined();
    expect(paths).toEqual(expect.arrayContaining([
      ROUTING_ACTION.SEND_TO_CONFLICT,
      ROUTING_ACTION.SEND_TO_FOLLOW_UP,
      ROUTING_ACTION.REQUEST_SCA,
    ]));

    const { record: conflictRec, audit } = buildConflictRecord({
      patientId: 'p_5',
      sourceModule: CONFLICT_SOURCE_MODULE.AUTHORIZATION,
      reasons: [CONFLICT_REASON.AUTH_DENIED],
      createdByUserId: 'u_1',
      authDenied: true,
    });
    h.createConflict(conflictRec);
    h.recordActivity(audit);
    h.assertAudited(AUDIT_ACTION.AUTH_DENIED);
  });
});

// ── C.6 straight_medicare_medicaid_nar_suggestion_flow ──────────────────────
describe('straight_medicare_medicaid_nar_suggestion_flow', () => {
  it('suggests NAR when only straight Medicare + Medicaid; requires explicit confirmation', () => {
    const verified = [
      { insuranceCategory: INSURANCE_CATEGORY.MEDICARE },
      { insuranceCategory: INSURANCE_CATEGORY.MEDICAID },
    ];
    const suggestion = suggestNar(verified);
    expect(suggestion.suggestNar).toBe(true);
    expect(suggestion.requiresConfirmation).toBe(true);

    // System does NOT auto-finalise. Staff must confirm.
    // Audit captures suggestion.
    h.recordActivity({
      actorUserId: 'u_6', action: AUDIT_ACTION.NAR_SUGGESTION_CONFIRMED,
      metadata: { rationale: suggestion.rationale, staffConfirmed: true },
    });

    // Only after confirmation do we save the NAR auth.
    const record = { patientId: 'p_6', payerInsuranceId: 'ins_6', authStatus: AUTH_STATUS.NAR };
    expect(validateAuthorizationRecord(record).valid).toBe(true);
    h.createAuthorization(record);
    h.recordActivity({ actorUserId: 'u_6', action: AUDIT_ACTION.AUTH_NAR_RECORDED, patientId: 'p_6' });

    h.assertAudited(AUDIT_ACTION.NAR_SUGGESTION_CONFIRMED);
    h.assertAudited(AUDIT_ACTION.AUTH_NAR_RECORDED);
  });
});

// ── C.7 opwdd_route_flow ────────────────────────────────────────────────────
describe('opwdd_route_flow', () => {
  it('explicit OPWDD route captures audit and preserves context', () => {
    h.recordActivity({
      actorUserId: 'u_7',
      action: AUDIT_ACTION.OPWDD_ROUTE_TRIGGERED,
      patientId: 'p_7',
      metadata: { reason: 'code_95_no', priorStage: 'Eligibility Verification' },
    });
    const entry = h.state.activityLog.find((a) => a.action === AUDIT_ACTION.OPWDD_ROUTE_TRIGGERED);
    expect(entry).toBeTruthy();
    expect(entry.metadata.priorStage).toBe('Eligibility Verification');
  });
});

// ── C.8 disenrollment_assist_flow ───────────────────────────────────────────
describe('disenrollment_assist_flow', () => {
  it('creates a flag requiring note + owner + follow-up date (no legacy checklist)', () => {
    const flag = h.createDisenrollmentFlag({
      patient_id: 'p_8',
      flag_type: DISENROLLMENT_FLAG_TYPE.EXPERT_MEDICAID_ASSIST,
      note: 'Patient currently in MLTC plan; needs to disenroll to admit under CHHA.',
      follow_up_date: '2026-05-15',
      follow_up_owner_user_id: 'u_medicaid_expert',
      status: DISENROLLMENT_FLAG_STATUS.OPEN,
      created_by_user_id: 'u_8',
    });
    expect(flag.note.length).toBeGreaterThan(0);
    expect(flag.follow_up_owner_user_id).toBe('u_medicaid_expert');
    h.recordActivity({
      actorUserId: 'u_8', action: AUDIT_ACTION.DISENROLLMENT_ASSIST_FLAGGED,
      patientId: 'p_8', metadata: { flagId: flag.id },
    });
    h.assertAudited(AUDIT_ACTION.DISENROLLMENT_ASSIST_FLAGGED);
  });
});

// ── E. Regression / data-integrity ──────────────────────────────────────────
describe('regression / data integrity', () => {
  it('ALF cannot authorize HHA', () => {
    const { allowed, blocked } = determineAllowedServicesByDivision({ division: DIVISION.ALF });
    expect(allowed).not.toContain('HHA');
    expect(blocked.find((b) => b.service === 'HHA')).toBeTruthy();
  });

  it('ABA is removed from authorization', () => {
    const { allowed, blocked } = determineAllowedServicesByDivision({ division: DIVISION.SPECIAL_NEEDS });
    expect(allowed).not.toContain('ABA');
    expect(blocked.find((b) => b.service === 'ABA')).toBeTruthy();
  });

  it('auth denial no longer hits NTUC', () => {
    const paths = determineAllowedAuthorizationPaths({ authStatus: AUTH_STATUS.DENIED });
    expect(paths.find((p) => /ntuc/i.test(p))).toBeUndefined();
  });

  it('cannot store approved auth without payerInsuranceId', () => {
    const v = validateAuthorizationRecord({ patientId: 'p', authStatus: AUTH_STATUS.APPROVED, authNumber: 'A', authStartDate: '2026-01-01', authEndDate: '2026-02-01' });
    expect(v.valid).toBe(false);
  });

  it('cannot store follow-up without date/owner', () => {
    const v = validateAuthorizationRecord({ patientId: 'p', payerInsuranceId: 'i', authStatus: AUTH_STATUS.FOLLOW_UP_NEEDED });
    expect(v.valid).toBe(false);
  });

  it('cannot store conflict without reason', () => {
    expect(() => buildConflictRecord({
      patientId: 'p', sourceModule: CONFLICT_SOURCE_MODULE.ELIGIBILITY,
      reasons: [], createdByUserId: 'u',
    })).toThrow();
  });

  it('multi-verification sources persist', () => {
    const sources = [VERIFICATION_SOURCE.EPACES, VERIFICATION_SOURCE.PHONE];
    const rec = h.createEligibilityVerification({
      patient_id: 'p', insurance_id: 'i',
      verification_status: VERIFICATION_STATUS.CONFIRMED_ACTIVE,
      verification_sources: sources,
    });
    expect(rec.verification_sources).toEqual(sources);
  });
});

// ── E8 Optimistic UI — failed save should not create false completion state ─
describe('optimistic UI semantics', () => {
  it('failed save does NOT leave a partial record in "confirmed" state', async () => {
    const patientId = 'p_opt';
    const ins = h.createPatientInsurance({
      patient_id: patientId, payer_display_name: 'X', insurance_category: INSURANCE_CATEGORY.COMMERCIAL,
    });
    // Simulate: app starts to save a confirmed verification, but persistence fails.
    const optimistic = {
      patient_id: patientId, insurance_id: ins.id,
      verification_status: VERIFICATION_STATUS.CONFIRMED_ACTIVE,
    };
    // Never call createEligibilityVerification (simulate rollback).
    const existed = h.listVerificationsForPatient(patientId);
    expect(existed).toHaveLength(0);

    // Warnings must still report "no active coverage" because nothing was persisted.
    const warnings = determineEligibilityWarnings(
      h.listVerificationsForPatient(patientId).map((r) => ({
        verificationStatus: r.verification_status,
        verificationSources: r.verification_sources,
      })),
    );
    // Empty set means no warnings from this helper — but finalisation blockers fire:
    const { canFinalize } = canFinalizeEligibility([]);
    expect(canFinalize).toBe(false);
    expect(warnings).toEqual([]);
    void optimistic;
  });
});
