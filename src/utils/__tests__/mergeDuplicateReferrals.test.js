import { describe, it, expect } from 'vitest';
import {
  allConflictsResolved,
  buildMergePlan,
  isMergeableReferral,
  normalizeFieldValue,
  pickSurvivor,
  stageRank,
} from '../mergeDuplicateReferrals.js';

function ref(partial) {
  return {
    _id: partial._id || 'recR',
    id: partial.id || 'ref_1',
    patient_id: partial.patient_id || 'pat_1',
    current_stage: partial.current_stage || 'Intake',
    created_at: partial.created_at || '2026-01-01T00:00:00.000Z',
    patient: {
      _id: partial.patientRec || 'recP',
      id: partial.patient_id || 'pat_1',
      ...(partial.patient || {}),
    },
    ...partial,
  };
}

describe('stageRank / pickSurvivor', () => {
  it('ranks farther stages higher', () => {
    expect(stageRank('Clinical Intake RN Review')).toBeGreaterThan(stageRank('Intake'));
    expect(stageRank('Lead Entry')).toBeLessThan(stageRank('F2F/MD Orders Pending'));
  });

  it('picks farther-ahead referral as survivor', () => {
    const a = ref({
      _id: 'a', id: 'ref_a', patient_id: 'pat_a', patientRec: 'recPa',
      current_stage: 'Intake',
    });
    const b = ref({
      _id: 'b', id: 'ref_b', patient_id: 'pat_b', patientRec: 'recPb',
      current_stage: 'Authorization Pending',
    });
    const { survivor, loser } = pickSurvivor(a, b);
    expect(survivor.id).toBe('ref_b');
    expect(loser.id).toBe('ref_a');
  });

  it('tie-breaks to oldest when stage equal', () => {
    const a = ref({
      _id: 'a', id: 'ref_a', patient_id: 'pat_a',
      current_stage: 'Intake', created_at: '2026-01-01T00:00:00.000Z',
    });
    const b = ref({
      _id: 'b', id: 'ref_b', patient_id: 'pat_b',
      current_stage: 'Intake', created_at: '2026-02-01T00:00:00.000Z',
    });
    const { survivor } = pickSurvivor(a, b);
    expect(survivor.id).toBe('ref_a');
  });
});

describe('isMergeableReferral', () => {
  it('rejects EMR-onboarded and terminal stages', () => {
    expect(isMergeableReferral(ref({ emr_onboarded_at: '2026-01-01' }))).toBe(false);
    expect(isMergeableReferral(ref({ current_stage: 'NTUC' }))).toBe(false);
    expect(isMergeableReferral(ref({ current_stage: 'EMR Onboarding' }))).toBe(false);
    expect(isMergeableReferral(ref({ current_stage: 'Intake' }))).toBe(true);
  });
});

describe('buildMergePlan', () => {
  it('fill-blanks as auto and spelling diffs as conflict', () => {
    const a = ref({
      _id: 'a', id: 'ref_a', patient_id: 'pat_a', patientRec: 'recPa',
      current_stage: 'Clinical Intake RN Review',
      patient: {
        first_name: 'Jon',
        last_name: 'Smith',
        phone_primary: '5551112222',
        dob: '1990-01-01',
      },
    });
    const b = ref({
      _id: 'b', id: 'ref_b', patient_id: 'pat_b', patientRec: 'recPb',
      current_stage: 'Intake',
      patient: {
        first_name: 'John',
        last_name: 'Smith',
        phone_primary: '',
        email: 'john@example.com',
        dob: '1990-01-01',
      },
    });

    const plan = buildMergePlan(a, b);
    expect(plan.survivor.id).toBe('ref_a');
    expect(plan.survivorStage).toBe('Clinical Intake RN Review');

    const nameConflict = plan.conflicts.find((c) => c.key === 'first_name');
    expect(nameConflict).toBeTruthy();
    expect(nameConflict.survivorValue).toBe('Jon');
    expect(nameConflict.loserValue).toBe('John');

    const emailFill = plan.autoFills.find((c) => c.key === 'email');
    expect(emailFill?.takeFrom).toBe('loser');
    expect(emailFill?.value).toBe('john@example.com');
  });

  it('detects insurance CIN conflicts', () => {
    const a = ref({
      _id: 'a', id: 'ref_a', patient_id: 'pat_a',
      current_stage: 'Intake',
      patient: {
        insurance_plans: JSON.stringify(['Fidelis Care']),
        insurance_plan_details: JSON.stringify({ 'Fidelis Care': 'AAA111' }),
      },
    });
    const b = ref({
      _id: 'b', id: 'ref_b', patient_id: 'pat_b',
      current_stage: 'Intake',
      created_at: '2026-03-01T00:00:00.000Z',
      patient: {
        insurance_plans: JSON.stringify(['Fidelis Care']),
        insurance_plan_details: JSON.stringify({ 'Fidelis Care': 'BBB222' }),
      },
    });
    const plan = buildMergePlan(a, b);
    const cin = plan.conflicts.find((c) => c.key === 'insurance:Fidelis Care');
    expect(cin).toBeTruthy();
    expect(cin.survivorValue).toBe('AAA111');
    expect(cin.loserValue).toBe('BBB222');
  });

  it('includes union counts from context', () => {
    const a = ref({
      _id: 'a', id: 'ref_a', patient_id: 'pat_a', current_stage: 'Intake',
    });
    const b = ref({
      _id: 'b', id: 'ref_b', patient_id: 'pat_b', current_stage: 'Intake',
      created_at: '2026-06-01T00:00:00.000Z',
    });
    const plan = buildMergePlan(a, b, {
      contextByPatientId: {
        pat_a: { files: 1, notes: 2, insurances: 1, hasTriage: true },
        pat_b: { files: 3, notes: 0, insurances: 1, hasTriage: false },
      },
    });
    const files = plan.unions.find((u) => u.key === 'files');
    expect(files.combined).toBe(4);
  });
});

describe('allConflictsResolved', () => {
  it('requires a choice for every conflict', () => {
    const conflicts = [{ key: 'first_name' }, { key: 'phone_primary' }];
    expect(allConflictsResolved(conflicts, { first_name: 'survivor' })).toBe(false);
    expect(allConflictsResolved(conflicts, {
      first_name: 'survivor',
      phone_primary: 'loser',
    })).toBe(true);
  });
});

describe('normalizeFieldValue', () => {
  it('trims and joins arrays', () => {
    expect(normalizeFieldValue('  x  ')).toBe('x');
    expect(normalizeFieldValue(['SN', 'PT'])).toBe('SN, PT');
    expect(normalizeFieldValue(null)).toBe('');
  });
});
