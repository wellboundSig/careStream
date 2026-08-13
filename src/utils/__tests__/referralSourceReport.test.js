import { describe, it, expect } from 'vitest';
import { buildReferralSourceReport } from '../referralSourceReport.js';

describe('buildReferralSourceReport', () => {
  const sources = [
    { id: 'src_a', name: 'Pat Rivera', type: 'CCO', source_entity: 'Tri-County Care', method: 'Fax', phone: '555-0100', email: 'pat@tcc.org', marketer_id: 'mkt_1', is_active: true },
    { id: 'src_b', name: 'Idle Source', type: 'Hospital', source_entity: 'NYU', method: '', is_active: 'false' },
  ];
  const marketers = {
    mkt_1: { id: 'mkt_1', first_name: 'Alex', last_name: 'Chen' },
  };
  const patients = {
    pat_1: { id: 'pat_1', first_name: 'Ada', last_name: 'Lovelace', county: 'Bronx', insurance_plan: 'Fidelis', dob: '1990-01-01' },
    pat_2: { id: 'pat_2', first_name: 'Grace', last_name: 'Hopper', county: 'Queens' },
  };

  it('includes every directory source, even with zero referrals', () => {
    const { rows } = buildReferralSourceReport({ sources, marketers, referrals: [], patients });
    expect(rows.map((r) => r.sourceId).sort()).toEqual(['src_a', 'src_b']);
    const idle = rows.find((r) => r.sourceId === 'src_b');
    expect(idle.referrals).toBe(0);
    expect(idle.patients).toBe(0);
    expect(idle.entity).toBe('NYU');
    expect(idle.active).toBe('No');
  });

  it('rolls up patient totals, contacts, type, and method', () => {
    const referrals = [
      {
        patient_id: 'pat_1', referral_source_id: 'src_a', division: 'ALF',
        current_stage: 'Intake', referral_date: '2026-07-01', referral_method: 'Email',
        __patient_name: 'Ada Lovelace', __facility_name: 'Sunrise', __marketer_name: 'Alex Chen',
      },
      {
        patient_id: 'pat_1', referral_source_id: 'src_a', division: 'ALF',
        current_stage: 'SOC Completed', soc_completed_date: '2026-08-01',
        referral_date: '2026-07-15', referral_method: 'Fax',
        __patient_name: 'Ada Lovelace',
      },
      {
        patient_id: 'pat_2', referral_source_id: 'src_a', division: 'Special Needs',
        current_stage: 'NTUC', ntuc_reason: 'Insurance', referral_date: '2026-07-20',
        __patient_name: 'Grace Hopper',
      },
    ];
    const { rows, extraSheets, summary } = buildReferralSourceReport({
      sources, marketers, referrals, patients,
    });
    const a = rows.find((r) => r.sourceId === 'src_a');
    expect(a.name).toBe('Pat Rivera');
    expect(a.type).toBe('CCO');
    expect(a.entity).toBe('Tri-County Care');
    expect(a.method).toBe('Fax');
    expect(a.phone).toBe('555-0100');
    expect(a.email).toBe('pat@tcc.org');
    expect(a.marketer).toBe('Alex Chen');
    expect(a.referrals).toBe(3);
    expect(a.patients).toBe(2);
    expect(a.alf).toBe(2);
    expect(a.specialNeeds).toBe(1);
    expect(a.socCompleted).toBe(1);
    expect(a.ntuc).toBe(1);
    expect(a.activePipeline).toBe(1);
    expect(a.methodsSeen).toBe('Email, Fax');
    expect(a.facilities).toBe('Sunrise');
    expect(extraSheets[0].rows).toHaveLength(3);
    expect(summary.kpis.find((k) => k.label === 'Sources in directory').value).toBe(2);
    expect(summary.kpis.find((k) => k.label === 'Patients in range').value).toBe(2);
  });

  it('keeps orphan referrals on a missing-source row', () => {
    const { rows, extraSheets } = buildReferralSourceReport({
      sources,
      marketers,
      referrals: [{
        patient_id: 'pat_2',
        referral_source_id: 'src_gone',
        current_stage: 'Intake',
        __patient_name: 'Grace Hopper',
      }],
      patients,
    });
    const missing = rows.find((r) => r.sourceId === 'src_gone');
    expect(missing.referrals).toBe(1);
    expect(missing.name).toContain('Missing from directory');
    expect(extraSheets[0].rows[0].sourceName).toContain('Missing from directory');
  });
});
