import { describe, it, expect } from 'vitest';
import {
  normalizeInsuranceCategory,
  deriveSuggestedBillingModel,
  validateInsuranceEntry,
  determineConflictReasons,
  determineEligibilityWarnings,
  shouldRequireHumanReview,
  canFinalizeEligibility,
  suggestSourceForCategory,
} from '../eligibilityPolicies.js';
import {
  INSURANCE_CATEGORY,
  VERIFICATION_STATUS,
  VERIFICATION_SOURCE,
  CONFLICT_REASON,
  ORDER_RANK,
  BILLING_MODEL,
} from '../../eligibilityEnums.js';

// ── A.1 normalizeInsuranceCategory ──────────────────────────────────────────
describe('normalizeInsuranceCategory', () => {
  it('straight Medicare maps to medicare', () => {
    expect(normalizeInsuranceCategory({ medicareType: 'ffs' }).category)
      .toBe(INSURANCE_CATEGORY.MEDICARE);
    expect(normalizeInsuranceCategory({ rawLabel: 'Medicare' }).category)
      .toBe(INSURANCE_CATEGORY.MEDICARE);
  });

  it('straight Medicaid maps to medicaid', () => {
    expect(normalizeInsuranceCategory({ medicaidType: 'ffs' }).category)
      .toBe(INSURANCE_CATEGORY.MEDICAID);
    expect(normalizeInsuranceCategory({ rawLabel: 'NY Medicaid' }).category)
      .toBe(INSURANCE_CATEGORY.MEDICAID);
  });

  it('managed Medicare maps to medicare_managed', () => {
    expect(normalizeInsuranceCategory({ medicareType: 'advantage' }).category)
      .toBe(INSURANCE_CATEGORY.MEDICARE_MANAGED);
    expect(normalizeInsuranceCategory({ rawLabel: 'Medicare Advantage HMO' }).category)
      .toBe(INSURANCE_CATEGORY.MEDICARE_MANAGED);
  });

  it('managed Medicaid maps to medicaid_managed', () => {
    expect(normalizeInsuranceCategory({ medicaidType: 'mco' }).category)
      .toBe(INSURANCE_CATEGORY.MEDICAID_MANAGED);
    expect(normalizeInsuranceCategory({ rawLabel: 'Managed Medicaid MLTC' }).category)
      .toBe(INSURANCE_CATEGORY.MEDICAID_MANAGED);
  });

  it('commercial label maps to commercial', () => {
    expect(normalizeInsuranceCategory({ rawLabel: 'Aetna PPO' }).category)
      .toBe(INSURANCE_CATEGORY.COMMERCIAL);
  });

  it('third-party label maps to third_party', () => {
    expect(normalizeInsuranceCategory({ rawLabel: 'LTC Private Policy' }).category)
      .toBe(INSURANCE_CATEGORY.THIRD_PARTY);
  });

  it('invalid/ambiguous values produce requiresHumanReview', () => {
    const r = normalizeInsuranceCategory({ rawLabel: 'Plan ABC-123' });
    expect(r.category).toBe(INSURANCE_CATEGORY.UNKNOWN);
    expect(r.requiresHumanReview).toBe(true);
  });

  it('both Medicare and Medicaid in label → review', () => {
    const r = normalizeInsuranceCategory({ rawLabel: 'Medicare / Medicaid combined' });
    expect(r.requiresHumanReview).toBe(true);
  });

  it('missing input produces review', () => {
    expect(normalizeInsuranceCategory({}).requiresHumanReview).toBe(true);
  });
});

// ── A.2 deriveSuggestedBillingModel ─────────────────────────────────────────
describe('deriveSuggestedBillingModel', () => {
  it('Medicare → episodic suggestion, requires human review', () => {
    const r = deriveSuggestedBillingModel({ category: INSURANCE_CATEGORY.MEDICARE });
    expect(r.suggestedBillingModel).toBe(BILLING_MODEL.EPISODIC);
    expect(r.requiresHumanReview).toBe(true);
  });

  it('Medicaid 18+ → suggested episodic only if business rule configured', () => {
    const dob = new Date(Date.now() - 25 * 365.25 * 24 * 3600 * 1000).toISOString();
    const rOff = deriveSuggestedBillingModel({ category: INSURANCE_CATEGORY.MEDICAID, dob });
    expect(rOff.suggestedBillingModel).toBe(BILLING_MODEL.NEEDS_REVIEW);

    const rOn = deriveSuggestedBillingModel({
      category: INSURANCE_CATEGORY.MEDICAID,
      dob,
      config: { enableMedicaidDobHeuristic: true, medicaidAdultBillingModel: BILLING_MODEL.EPISODIC },
    });
    expect(rOn.suggestedBillingModel).toBe(BILLING_MODEL.EPISODIC);
    expect(rOn.requiresHumanReview).toBe(true);
  });

  it('Medicaid under 18 → suggested FFS only if business rule configured', () => {
    const dob = new Date(Date.now() - 10 * 365.25 * 24 * 3600 * 1000).toISOString();
    const r = deriveSuggestedBillingModel({
      category: INSURANCE_CATEGORY.MEDICAID,
      dob,
      config: { enableMedicaidDobHeuristic: true, medicaidPediatricBillingModel: BILLING_MODEL.FFS },
    });
    expect(r.suggestedBillingModel).toBe(BILLING_MODEL.FFS);
    expect(r.requiresHumanReview).toBe(true);
  });

  it('ambiguous DOB or missing DOB → requiresHumanReview, NEEDS_REVIEW suggestion', () => {
    const r = deriveSuggestedBillingModel({
      category: INSURANCE_CATEGORY.MEDICAID,
      dob: null,
      config: { enableMedicaidDobHeuristic: true },
    });
    expect(r.requiresHumanReview).toBe(true);
    expect(r.suggestedBillingModel).toBe(BILLING_MODEL.NEEDS_REVIEW);
  });

  it('Managed categories never auto-finalise', () => {
    const r = deriveSuggestedBillingModel({ category: INSURANCE_CATEGORY.MEDICARE_MANAGED });
    expect(r.requiresHumanReview).toBe(true);
  });

  it('UNKNOWN → needs review', () => {
    const r = deriveSuggestedBillingModel({ category: INSURANCE_CATEGORY.UNKNOWN });
    expect(r.suggestedBillingModel).toBe(BILLING_MODEL.NEEDS_REVIEW);
    expect(r.requiresHumanReview).toBe(true);
  });
});

// ── validateInsuranceEntry ──────────────────────────────────────────────────
describe('validateInsuranceEntry', () => {
  it('rejects missing patient and payer', () => {
    const r = validateInsuranceEntry({});
    expect(r.valid).toBe(false);
    expect(r.errors.map((e) => e.field)).toEqual(expect.arrayContaining(['patientId', 'payerDisplayName', 'insuranceCategory']));
  });

  it('rejects invalid category', () => {
    const r = validateInsuranceEntry({
      patientId: 'p1',
      payerDisplayName: 'X',
      insuranceCategory: 'bogus',
    });
    expect(r.valid).toBe(false);
  });

  it('accepts a minimal valid entry', () => {
    const r = validateInsuranceEntry({
      patientId: 'p1',
      payerDisplayName: 'Aetna',
      insuranceCategory: INSURANCE_CATEGORY.COMMERCIAL,
    });
    expect(r.valid).toBe(true);
  });

  it('rejects end date before start date', () => {
    const r = validateInsuranceEntry({
      patientId: 'p1', payerDisplayName: 'A', insuranceCategory: INSURANCE_CATEGORY.COMMERCIAL,
      effectiveDate: '2025-12-01', terminationDate: '2025-06-01',
    });
    expect(r.valid).toBe(false);
  });
});

// ── A.3 determineConflictReasons ────────────────────────────────────────────
describe('determineConflictReasons', () => {
  it('legacy blocker booleans convert to structured conflict reasons', () => {
    const out = determineConflictReasons({
      legacyFlags: { has_open_hh_episode: true, cdpap_active: true },
    });
    expect(out).toEqual(expect.arrayContaining([
      CONFLICT_REASON.OPEN_HH_EPISODE,
      CONFLICT_REASON.CDPAP_ACTIVE,
    ]));
  });

  it('multiple blockers produce multiple conflict reasons (deduped)', () => {
    const out = determineConflictReasons({
      legacyFlags: { hospice_overlap: true, snf_present: true },
      explicitReasons: [CONFLICT_REASON.HOSPICE_OVERLAP],
    });
    expect(out).toEqual(expect.arrayContaining([
      CONFLICT_REASON.HOSPICE_OVERLAP,
      CONFLICT_REASON.SNF_PRESENT,
    ]));
    expect(out.filter((r) => r === CONFLICT_REASON.HOSPICE_OVERLAP)).toHaveLength(1);
  });

  it('no blockers returns empty array', () => {
    expect(determineConflictReasons({})).toEqual([]);
  });

  it('auth denied and coverage_not_active are promoted into reasons', () => {
    const out = determineConflictReasons({ authDenied: true, coverageNotActive: true });
    expect(out).toEqual(expect.arrayContaining([
      CONFLICT_REASON.AUTH_DENIED,
      CONFLICT_REASON.COVERAGE_NOT_ACTIVE,
    ]));
  });

  it('unknown reason keys are ignored', () => {
    const out = determineConflictReasons({ explicitReasons: ['not_a_reason'] });
    expect(out).toEqual([]);
  });
});

// ── A.4 shouldRequireHumanReview ────────────────────────────────────────────
describe('shouldRequireHumanReview', () => {
  it('unclear payer order → true', () => {
    expect(shouldRequireHumanReview({
      staffConfirmedOrderRank: ORDER_RANK.UNKNOWN,
    }).required).toBe(true);
  });

  it('conflicting managed/straight signals → true', () => {
    const r = shouldRequireHumanReview({
      staffConfirmedOrderRank: ORDER_RANK.PRIMARY,
      suggestedPayerType: INSURANCE_CATEGORY.MEDICARE,
      staffConfirmedPayerType: INSURANCE_CATEGORY.MEDICARE_MANAGED,
    });
    expect(r.required).toBe(true);
    expect(r.reasons.some((x) => x.toLowerCase().includes('medicare'))).toBe(true);
  });

  it('missing source verification with confirmed status → true', () => {
    const r = shouldRequireHumanReview({
      staffConfirmedOrderRank: ORDER_RANK.PRIMARY,
      verificationStatus: VERIFICATION_STATUS.CONFIRMED_ACTIVE,
      verificationSources: [],
    });
    expect(r.required).toBe(true);
  });

  it('DOB-derived suggestion without staff confirmation → true', () => {
    const r = shouldRequireHumanReview({
      staffConfirmedOrderRank: ORDER_RANK.PRIMARY,
      dobDerivedSuggestion: true,
    });
    expect(r.required).toBe(true);
  });

  it('fully confirmed state → false', () => {
    const r = shouldRequireHumanReview({
      staffConfirmedOrderRank: ORDER_RANK.PRIMARY,
      verificationStatus: VERIFICATION_STATUS.CONFIRMED_ACTIVE,
      verificationSources: [VERIFICATION_SOURCE.WAYSTAR],
      category: INSURANCE_CATEGORY.MEDICARE,
      staffConfirmedPayerType: INSURANCE_CATEGORY.MEDICARE,
      suggestedPayerType: INSURANCE_CATEGORY.MEDICARE,
    });
    expect(r.required).toBe(false);
  });
});

// ── determineEligibilityWarnings ────────────────────────────────────────────
describe('determineEligibilityWarnings', () => {
  it('warns when no insurance is active', () => {
    const w = determineEligibilityWarnings([
      { verificationStatus: VERIFICATION_STATUS.UNREVIEWED, verificationSources: [] },
    ]);
    expect(w.some((x) => x.code === 'no_active_coverage')).toBe(true);
  });

  it('warns when multiple primaries exist', () => {
    const w = determineEligibilityWarnings([
      { verificationStatus: VERIFICATION_STATUS.CONFIRMED_ACTIVE, staffConfirmedOrderRank: ORDER_RANK.PRIMARY, verificationSources: [VERIFICATION_SOURCE.WAYSTAR] },
      { verificationStatus: VERIFICATION_STATUS.CONFIRMED_ACTIVE, staffConfirmedOrderRank: ORDER_RANK.PRIMARY, verificationSources: [VERIFICATION_SOURCE.EPACES] },
    ]);
    expect(w.some((x) => x.code === 'multiple_primaries')).toBe(true);
  });

  it('warns when active status has no source', () => {
    const w = determineEligibilityWarnings([
      { insuranceId: 'i1', verificationStatus: VERIFICATION_STATUS.CONFIRMED_ACTIVE, verificationSources: [] },
    ]);
    expect(w.some((x) => x.code === 'missing_source')).toBe(true);
  });
});

// ── canFinalizeEligibility ──────────────────────────────────────────────────
describe('canFinalizeEligibility', () => {
  it('blocks finalisation on unreviewed entries', () => {
    const r = canFinalizeEligibility([
      { verificationStatus: VERIFICATION_STATUS.UNREVIEWED },
    ]);
    expect(r.canFinalize).toBe(false);
  });

  it('blocks finalisation when confirmed active is missing sources/verifier', () => {
    const r = canFinalizeEligibility([
      { verificationStatus: VERIFICATION_STATUS.CONFIRMED_ACTIVE, staffConfirmedOrderRank: ORDER_RANK.PRIMARY },
    ]);
    expect(r.canFinalize).toBe(false);
  });

  it('allows finalisation when fully complete', () => {
    const r = canFinalizeEligibility([
      {
        verificationStatus: VERIFICATION_STATUS.CONFIRMED_ACTIVE,
        staffConfirmedOrderRank: ORDER_RANK.PRIMARY,
        verifiedByUserId: 'u1',
        verificationDateTime: new Date().toISOString(),
        verificationSources: [VERIFICATION_SOURCE.WAYSTAR],
      },
    ]);
    expect(r.canFinalize).toBe(true);
  });
});

// ── suggestSourceForCategory ────────────────────────────────────────────────
describe('suggestSourceForCategory', () => {
  it('suggests Waystar for straight Medicare', () => {
    expect(suggestSourceForCategory(INSURANCE_CATEGORY.MEDICARE)).toEqual([VERIFICATION_SOURCE.WAYSTAR]);
  });
  it('suggests ePACES / eMedNY for Medicaid', () => {
    const out = suggestSourceForCategory(INSURANCE_CATEGORY.MEDICAID);
    expect(out).toEqual(expect.arrayContaining([VERIFICATION_SOURCE.EPACES, VERIFICATION_SOURCE.EMEDNY]));
  });
});
