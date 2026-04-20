import { describe, it, expect } from 'vitest';
import {
  determineAllowedAuthorizationPaths,
  validateAuthorizationRecord,
  suggestNar,
  validateFollowUp,
  determineRequiresFollowUp,
} from '../authorizationPolicies.js';
import {
  AUTH_STATUS,
  DIVISION,
  INSURANCE_CATEGORY,
  ROUTING_ACTION,
} from '../../eligibilityEnums.js';

// ── determineAllowedAuthorizationPaths ──────────────────────────────────────
describe('determineAllowedAuthorizationPaths', () => {
  it('denied never routes to NTUC', () => {
    const out = determineAllowedAuthorizationPaths({ authStatus: AUTH_STATUS.DENIED });
    // There is no NTUC in ROUTING_ACTION at all; assert no ntuc-ish string leaks.
    expect(out.find((a) => /ntuc/i.test(a))).toBeUndefined();
  });

  it('denied allows Conflict and Follow-up', () => {
    const out = determineAllowedAuthorizationPaths({ authStatus: AUTH_STATUS.DENIED });
    expect(out).toEqual(expect.arrayContaining([
      ROUTING_ACTION.SEND_TO_CONFLICT,
      ROUTING_ACTION.SEND_TO_FOLLOW_UP,
    ]));
  });

  it('SPN denied additionally allows SCA option', () => {
    const out = determineAllowedAuthorizationPaths({
      authStatus: AUTH_STATUS.DENIED,
      division: DIVISION.SPECIAL_NEEDS,
    });
    expect(out).toContain(ROUTING_ACTION.REQUEST_SCA);
  });

  it('ALF denied does NOT include SCA', () => {
    const out = determineAllowedAuthorizationPaths({
      authStatus: AUTH_STATUS.DENIED,
      division: DIVISION.ALF,
    });
    expect(out).not.toContain(ROUTING_ACTION.REQUEST_SCA);
  });

  it('approved allows advance to staffing', () => {
    const out = determineAllowedAuthorizationPaths({ authStatus: AUTH_STATUS.APPROVED });
    expect(out).toContain(ROUTING_ACTION.ADVANCE_TO_STAFFING);
  });

  it('NAR can be saved and proceed', () => {
    const out = determineAllowedAuthorizationPaths({ authStatus: AUTH_STATUS.NAR });
    expect(out).toContain(ROUTING_ACTION.ADVANCE_TO_STAFFING);
  });
});

// ── validateAuthorizationRecord ─────────────────────────────────────────────
describe('validateAuthorizationRecord', () => {
  it('requires payerInsuranceId', () => {
    const r = validateAuthorizationRecord({ patientId: 'p1', authStatus: AUTH_STATUS.APPROVED });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === 'payerInsuranceId')).toBe(true);
  });

  it('cannot store approved auth without payerInsuranceId (data-integrity)', () => {
    const r = validateAuthorizationRecord({ patientId: 'p1', authStatus: AUTH_STATUS.APPROVED, authNumber: 'A-1', authStartDate: '2026-01-01', authEndDate: '2026-02-01' });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === 'payerInsuranceId')).toBe(true);
  });

  it('approved requires auth number OR documented exception', () => {
    const r = validateAuthorizationRecord({
      patientId: 'p1', payerInsuranceId: 'i1', authStatus: AUTH_STATUS.APPROVED,
      authStartDate: '2026-01-01', authEndDate: '2026-02-01',
    });
    expect(r.valid).toBe(false);
    const r2 = validateAuthorizationRecord({
      patientId: 'p1', payerInsuranceId: 'i1', authStatus: AUTH_STATUS.APPROVED,
      authNumber: 'A-1', authStartDate: '2026-01-01', authEndDate: '2026-02-01',
    });
    expect(r2.valid).toBe(true);
    const r3 = validateAuthorizationRecord({
      patientId: 'p1', payerInsuranceId: 'i1', authStatus: AUTH_STATUS.APPROVED,
      documentedException: 'Payer verbal approval', authVisitLimit: 30,
    });
    expect(r3.valid).toBe(true);
  });

  it('approved requires a date window OR visit limit', () => {
    const r = validateAuthorizationRecord({
      patientId: 'p1', payerInsuranceId: 'i1', authStatus: AUTH_STATUS.APPROVED, authNumber: 'A-1',
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === 'authWindow')).toBe(true);
  });

  it('denied requires denial reason', () => {
    const r = validateAuthorizationRecord({
      patientId: 'p1', payerInsuranceId: 'i1', authStatus: AUTH_STATUS.DENIED,
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === 'denialReason')).toBe(true);
  });

  it('follow_up_needed requires date and owner', () => {
    const r = validateAuthorizationRecord({
      patientId: 'p1', payerInsuranceId: 'i1', authStatus: AUTH_STATUS.FOLLOW_UP_NEEDED,
    });
    expect(r.valid).toBe(false);
    expect(r.errors.map((e) => e.field)).toEqual(expect.arrayContaining(['followUpDate', 'followUpOwnerUserId']));
  });

  it('NAR can be saved with minimal data (no auth number)', () => {
    const r = validateAuthorizationRecord({
      patientId: 'p1', payerInsuranceId: 'i1', authStatus: AUTH_STATUS.NAR,
    });
    expect(r.valid).toBe(true);
  });

  it('rejects auth end date before start date', () => {
    const r = validateAuthorizationRecord({
      patientId: 'p1', payerInsuranceId: 'i1', authStatus: AUTH_STATUS.APPROVED,
      authNumber: 'A-1', authStartDate: '2026-03-01', authEndDate: '2026-01-01',
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === 'authEndDate')).toBe(true);
  });

  it('follow-up date without owner → invalid', () => {
    const r = validateAuthorizationRecord({
      patientId: 'p1', payerInsuranceId: 'i1', authStatus: AUTH_STATUS.PENDING,
      followUpDate: '2026-05-01',
    });
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.field === 'followUpOwnerUserId')).toBe(true);
  });
});

// ── suggestNar ──────────────────────────────────────────────────────────────
describe('suggestNar', () => {
  it('suggests NAR when ONLY straight Medicare + Medicaid present', () => {
    const r = suggestNar([
      { insuranceCategory: INSURANCE_CATEGORY.MEDICARE },
      { insuranceCategory: INSURANCE_CATEGORY.MEDICAID },
    ]);
    expect(r.suggestNar).toBe(true);
    expect(r.requiresConfirmation).toBe(true);
  });

  it('does NOT suggest NAR when a managed plan is present', () => {
    const r = suggestNar([
      { insuranceCategory: INSURANCE_CATEGORY.MEDICARE },
      { insuranceCategory: INSURANCE_CATEGORY.MEDICAID_MANAGED },
    ]);
    expect(r.suggestNar).toBe(false);
  });

  it('does NOT suggest NAR when commercial is present', () => {
    const r = suggestNar([
      { insuranceCategory: INSURANCE_CATEGORY.MEDICARE },
      { insuranceCategory: INSURANCE_CATEGORY.COMMERCIAL },
    ]);
    expect(r.suggestNar).toBe(false);
  });

  it('never auto-finalises — always requires confirmation', () => {
    const r = suggestNar([{ insuranceCategory: INSURANCE_CATEGORY.MEDICARE }]);
    expect(r.requiresConfirmation).toBe(true);
  });

  it('empty list returns no suggestion but requires confirmation', () => {
    const r = suggestNar([]);
    expect(r.suggestNar).toBe(false);
    expect(r.requiresConfirmation).toBe(true);
  });
});

// ── validateFollowUp ────────────────────────────────────────────────────────
describe('validateFollowUp', () => {
  it('requires date and owner', () => {
    expect(validateFollowUp({}).valid).toBe(false);
    expect(validateFollowUp({ followUpDate: '2026-05-01' }).valid).toBe(false);
    expect(validateFollowUp({ followUpOwnerUserId: 'u1' }).valid).toBe(false);
  });

  it('accepts a valid follow-up', () => {
    expect(validateFollowUp({
      followUpDate: '2026-05-01',
      followUpOwnerUserId: 'u1',
    }).valid).toBe(true);
  });

  it('rejects invalid date strings', () => {
    expect(validateFollowUp({
      followUpDate: 'not-a-date',
      followUpOwnerUserId: 'u1',
    }).valid).toBe(false);
  });
});

describe('determineRequiresFollowUp', () => {
  it('pending and follow_up_needed require follow-up', () => {
    expect(determineRequiresFollowUp({ authStatus: AUTH_STATUS.PENDING })).toBe(true);
    expect(determineRequiresFollowUp({ authStatus: AUTH_STATUS.FOLLOW_UP_NEEDED })).toBe(true);
    expect(determineRequiresFollowUp({ authStatus: AUTH_STATUS.APPROVED })).toBe(false);
    expect(determineRequiresFollowUp({ authStatus: AUTH_STATUS.NAR })).toBe(false);
  });
});
