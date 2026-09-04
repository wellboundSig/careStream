/**
 * Backfill classifier for the post-visit flow rollout
 * (scripts/backfill-post-visit-stages.js `classify`).
 *
 * Mapping under test:
 *   open post-SOC clinical work          → Post Visit Clinical Review
 *   open deferred-docs hold              → Post Visit Intake
 *   SOC Completed, docs cleared/never    → Completed
 *   anything ambiguous / never-touch     → left alone (logged)
 */
import { describe, it, expect } from 'vitest';
import { classify } from '../../../scripts/backfill-post-visit-stages.js';

const SOC_DATE = '2026-06-01';

describe('backfill classify — never touch', () => {
  it('skips NTUC / Discarded Leads / Hold regardless of flags', () => {
    for (const stage of ['NTUC', 'Discarded Leads', 'Hold']) {
      const { to } = classify({
        current_stage: stage,
        soc_completed_date: SOC_DATE,
        documentation_deferred: true,
      });
      expect(to, stage).toBe(null);
    }
  });

  it('skips rows whose visit never happened', () => {
    expect(classify({ current_stage: 'Intake', documentation_deferred: true }).to).toBe(null);
    expect(classify({ current_stage: 'Pre-SOC' }).to).toBe(null);
  });
});

describe('backfill classify — Completed', () => {
  it('SOC Completed with docs never deferred → Completed', () => {
    expect(classify({
      current_stage: 'SOC Completed',
      soc_completed_date: SOC_DATE,
    }).to).toBe('Completed');
  });

  it('SOC Completed with a cleared deferral → Completed', () => {
    expect(classify({
      current_stage: 'SOC Completed',
      soc_completed_date: SOC_DATE,
      documentation_deferred: true,
      documentation_cleared_at: '2026-06-20T00:00:00Z',
    }).to).toBe('Completed');
  });
});

describe('backfill classify — Post Visit Intake', () => {
  it('SOC Completed with an open deferral → Post Visit Intake', () => {
    expect(classify({
      current_stage: 'SOC Completed',
      soc_completed_date: SOC_DATE,
      documentation_deferred: true,
    }).to).toBe('Post Visit Intake');
  });

  it('post-SOC deferred case currently worked in Intake / F2F → Post Visit Intake', () => {
    for (const stage of ['Intake', 'F2F/MD Orders Pending']) {
      expect(classify({
        current_stage: stage,
        soc_completed_date: SOC_DATE,
        documentation_deferred: true,
      }).to, stage).toBe('Post Visit Intake');
    }
  });

  it('handles postgres string booleans', () => {
    expect(classify({
      current_stage: 'SOC Completed',
      soc_completed_date: SOC_DATE,
      documentation_deferred: 'true',
    }).to).toBe('Post Visit Intake');
  });
});

describe('backfill classify — Post Visit Clinical Review', () => {
  it('post-SOC case sitting in Clinical Intake RN Review → Post Visit Clinical Review', () => {
    expect(classify({
      current_stage: 'Clinical Intake RN Review',
      soc_completed_date: SOC_DATE,
      documentation_deferred: true,
    }).to).toBe('Post Visit Clinical Review');
  });

  it('in_clinical_review flag wins over the deferred-docs rule', () => {
    expect(classify({
      current_stage: 'Intake',
      soc_completed_date: SOC_DATE,
      documentation_deferred: true,
      in_clinical_review: true,
    }).to).toBe('Post Visit Clinical Review');
  });

  it('assigned RN with no completion stamp counts as open clinical work', () => {
    expect(classify({
      current_stage: 'SOC Completed',
      soc_completed_date: SOC_DATE,
      clinical_review_assigned_to_id: 'usr_rn',
    }).to).toBe('Post Visit Clinical Review');
  });

  it('a completed clinical assignment does NOT count as open work', () => {
    expect(classify({
      current_stage: 'SOC Completed',
      soc_completed_date: SOC_DATE,
      clinical_review_assigned_to_id: 'usr_rn',
      clinical_review_completed_at: '2026-06-10T00:00:00Z',
    }).to).toBe('Completed');
  });
});

describe('backfill classify — conservative skips', () => {
  it('open clinical work at an unexpected stage is left for manual review', () => {
    const { to, why } = classify({
      current_stage: 'Eligibility Verification',
      soc_completed_date: SOC_DATE,
      in_clinical_review: true,
    });
    expect(to).toBe(null);
    expect(why).toMatch(/review manually/);
  });

  it('post-SOC row working in another stage with no open holds is left alone', () => {
    expect(classify({
      current_stage: 'Staffing Feasibility',
      soc_completed_date: SOC_DATE,
    }).to).toBe(null);
  });
});
