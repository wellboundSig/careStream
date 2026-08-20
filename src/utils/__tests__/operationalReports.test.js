import { describe, it, expect } from 'vitest';
import {
  calendarDaysBetween,
  agingBucket,
  hchbEntryAt,
  firstVisitAt,
  hasMdOrders,
  missingDocFlags,
  indexLinkedByReferral,
  buildReferralSpeedRows,
  summarizeReferralSpeed,
  buildSocMissingDocsRows,
  summarizeSocMissingDocs,
  buildMasterPatientRows,
} from '../operationalReports.js';

describe('calendarDaysBetween / aging', () => {
  it('counts calendar days without timezone shift', () => {
    expect(calendarDaysBetween('2026-08-01', '2026-08-02')).toBe(1);
    expect(calendarDaysBetween('2026-08-01T15:00:00Z', '2026-08-01')).toBe(0);
    expect(calendarDaysBetween(null, '2026-08-01')).toBe(null);
  });

  it('buckets aging from SOC', () => {
    expect(agingBucket(0)).toBe('0-2 days');
    expect(agingBucket(7)).toBe('3-7 days');
    expect(agingBucket(10)).toBe('8-14 days');
    expect(agingBucket(21)).toBe('15-30 days');
    expect(agingBucket(40)).toBe('31+ days');
    expect(agingBucket(null)).toBe('-');
  });
});

describe('HCHB / first visit stamps', () => {
  it('prefers initial EMR as HCHB entry', () => {
    expect(hchbEntryAt({
      emr_initial_onboarded_at: '2026-08-02T12:00:00Z',
      emr_onboarded_at: '2026-08-10T12:00:00Z',
    })).toBe('2026-08-02T12:00:00Z');
    expect(hchbEntryAt({ emr_onboarded_at: '2026-08-10' })).toBe('2026-08-10');
    expect(firstVisitAt({ soc_completed_date: '2026-08-05' })).toBe('2026-08-05');
  });
});

describe('referral → HCHB / first visit report', () => {
  it('flags 1-day HCHB target and days to SOC', () => {
    const rows = buildReferralSpeedRows([
      {
        __patient_name: 'Ada Cole',
        referral_date: '2026-08-01',
        emr_initial_onboarded_at: '2026-08-02',
        soc_completed_date: '2026-08-08',
        current_stage: 'SOC Completed',
        division: 'ALF',
      },
      {
        __patient_name: 'Late Chart',
        referral_date: '2026-08-01',
        emr_initial_onboarded_at: '2026-08-05',
        current_stage: 'Intake',
        division: 'ALF',
      },
      {
        __patient_name: 'Not entered',
        referral_date: '2026-08-01',
        current_stage: 'Intake',
        division: 'ALF',
      },
    ]);
    expect(rows.find((r) => r.patient_name === 'Ada Cole').opened_in_1_day).toBe('Yes');
    expect(rows.find((r) => r.patient_name === 'Ada Cole').days_to_first_visit).toBe(7);
    expect(rows.find((r) => r.patient_name === 'Late Chart').opened_in_1_day).toBe('No');
    expect(rows.find((r) => r.patient_name === 'Not entered').opened_in_1_day).toBe('Not entered');

    const summary = summarizeReferralSpeed(rows);
    expect(summary.kpis[0].value).toBe(3);
    expect(summary.kpis[1].value).toBe(2);
  });
});

describe('SOC missing docs + aging', () => {
  it('keeps only completed SOCs that still miss something', () => {
    const cursoryByRef = indexLinkedByReferral([
      { referral_id: 'ref_ok', physician_certification_present: true },
      { referral_id: 'ref_auth_only', physician_certification_present: true },
    ]);
    const rows = buildSocMissingDocsRows([
      {
        id: 'ref_ok',
        __patient_name: 'Complete',
        soc_completed_date: '2026-08-01',
        current_stage: 'SOC Completed',
        f2f_date: '2026-07-20',
      },
      {
        id: 'ref_auth_only',
        __patient_name: 'Auth Only',
        soc_completed_date: '2026-08-01',
        current_stage: 'SOC Completed',
        f2f_date: '2026-07-20',
      },
      {
        id: 'ref_gap',
        __patient_name: 'Gap Case',
        soc_completed_date: '2026-08-01',
        current_stage: 'Intake',
        f2f_date: '',
        __clinical_by: 'Irina Pinkhasov',
      },
      {
        id: 'ref_ntuc',
        __patient_name: 'NTUC',
        soc_completed_date: '2026-07-01',
        current_stage: 'NTUC',
      },
    ], { cursoryByRef, today: new Date(2026, 7, 20) });

    expect(rows).toHaveLength(1);
    expect(rows[0].patient_name).toBe('Gap Case');
    expect(rows[0].missing_list).toContain('F2F');
    expect(rows[0].missing_list).toContain('Orders');
    expect(rows[0].missing_list).not.toContain('Auth');
    expect(rows[0].clinical_rn).toBe('Irina Pinkhasov');
    expect(rows[0].aging_bucket).toBe('15-30 days');
    expect(summarizeSocMissingDocs(rows).kpis[0].value).toBe(1);
  });

  it('treats an MD Orders file as orders present', () => {
    const filesByRef = indexLinkedByReferral([
      { referral_id: 'ref_1', category: 'MD Orders' },
    ]);
    expect(hasMdOrders({ id: 'ref_1' }, { filesByRef })).toBe(true);
    expect(missingDocFlags({ id: 'ref_1', f2f_date: '2026-08-01' }, { filesByRef }).missingOrders).toBe(false);
  });
});

describe('master patient report', () => {
  it('puts patient identity first and keeps one row per episode', () => {
    const rows = buildMasterPatientRows([
      {
        id: 'ref_b',
        patient_id: 'pat_1',
        __patient_name: 'Zed Young',
        __patient_dob: '1950-01-15',
        referral_date: '2026-08-10',
        division: 'ALF',
        soc_completed_date: '2026-08-12',
        current_stage: 'SOC Completed',
      },
      {
        id: 'ref_a',
        patient_id: 'pat_1',
        __patient_name: 'Zed Young',
        __patient_dob: '1950-01-15',
        referral_date: '2026-06-01',
        division: 'ALF',
        current_stage: 'NTUC',
        ntuc_reason: 'Insurance',
      },
    ], { today: new Date(2026, 7, 20) });

    expect(rows).toHaveLength(2);
    expect(Object.keys(rows[0])[0]).toBe('patient_id');
    expect(rows[0].patient_name).toBe('Zed Young');
    expect(rows[0].referral_id).toBe('ref_b');
    expect(rows[0].soc_done).toBe('Yes');
    expect(rows[1].ntuc_reason).toBe('Insurance');
    expect(rows[0].age).toBe(76);
  });
});
