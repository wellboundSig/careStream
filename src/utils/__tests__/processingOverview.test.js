import { describe, it, expect } from 'vitest';
import {
  buildProcessingFlags,
  hasAuthorizationIfNeeded,
  isInProcessingPool,
  buildProcessingOverviewRows,
  linkId,
} from '../processingOverview.js';

describe('linkId', () => {
  it('unwraps Airtable link arrays', () => {
    expect(linkId(['recABC'])).toBe('recABC');
    expect(linkId('mkt_1')).toBe('mkt_1');
    expect(linkId(null)).toBe('');
  });
});

describe('isInProcessingPool', () => {
  it('excludes SOC completed by date and terminal stages', () => {
    expect(isInProcessingPool({ current_stage: 'Intake', soc_completed_date: '2026-08-01' })).toBe(false);
    expect(isInProcessingPool({ current_stage: 'SOC Completed' })).toBe(false);
    expect(isInProcessingPool({ current_stage: 'NTUC' })).toBe(false);
    expect(isInProcessingPool({ current_stage: 'Discarded Leads' })).toBe(false);
    expect(isInProcessingPool({ current_stage: 'Intake' })).toBe(true);
  });
});

describe('hasAuthorizationIfNeeded', () => {
  it('yes when stamped or past auth gate', () => {
    expect(hasAuthorizationIfNeeded({ auth_obtained_at: '2026-01-01' })).toBe(true);
    expect(hasAuthorizationIfNeeded({ current_stage: 'Staffing Feasibility' })).toBe(true);
    expect(hasAuthorizationIfNeeded({ current_stage: 'Authorization Pending' })).toBe(false);
    expect(hasAuthorizationIfNeeded({ current_stage: 'Intake' })).toBe(false);
  });
});

describe('buildProcessingFlags', () => {
  it('marks ALF triage complete without triage form', () => {
    const flags = buildProcessingFlags({
      division: 'ALF',
      current_stage: 'Intake',
      patient: {
        first_name: 'A', last_name: 'B', dob: '1990-01-01', gender: 'Female',
        phone_primary: '555', address_street: '1 Main', address_city: 'NY',
        address_state: 'NY', address_zip: '10001',
        insurance_plans: JSON.stringify(['Fidelis Care']),
        insurance_plan_details: JSON.stringify({ 'Fidelis Care': 'AB12' }),
      },
      f2f_date: '2026-01-02',
      clinical_review_completed_at: '2026-01-03',
      eligibility_completed_at: '2026-01-04',
    }, {
      physician: {
        is_pecos_enrolled: true,
        is_opra_enrolled: 'TRUE',
        npi: '1234567890',
        npi_status: 'active',
      },
    });
    expect(flags.demographics).toBe(true);
    expect(flags.triage).toBe(true);
    expect(flags.insurance).toBe(true);
    expect(flags.f2f).toBe(true);
    expect(flags.clinical).toBe(true);
    expect(flags.eligibility).toBe(true);
    expect(flags.pecos).toBe(true);
    expect(flags.opra).toBe(true);
    expect(flags.npi).toBe(true);
    expect(flags.socCompleted).toBe(false);
  });
});

describe('buildProcessingOverviewRows', () => {
  it('filters pool and resolves names from linked-record arrays', () => {
    const rows = buildProcessingOverviewRows([
      {
        _id: 'r1', id: 'ref_1', patient_id: ['pat_1'], patientName: 'pat_1',
        current_stage: 'Intake', division: 'ALF',
        facility_id: ['fac_1'],
        marketer_id: ['mkt_1'],
        intake_owner_id: ['usr_1'],
        physician_id: ['phy_1'],
      },
      {
        _id: 'r2', id: 'ref_2', patient_id: 'pat_2', patientName: 'Done Patient',
        current_stage: 'Intake', soc_completed_date: '2026-08-01', division: 'ALF',
        patient: {},
      },
    ], {
      patients: {
        pat_1: { _id: 'recPat1', id: 'pat_1', first_name: 'Ada', last_name: 'Lovelace' },
      },
      physicians: {
        phy_1: {
          _id: 'recPhy1', id: 'phy_1', first_name: 'Doc', last_name: 'Who',
          npi: '9999999999', npi_status: 'active',
        },
      },
      resolveFacility: (id) => (id === 'fac_1' ? 'Sunrise ALF' : '—'),
      resolveMarketer: (id) => (id === 'mkt_1' ? 'Marketer Sam' : '—'),
      resolveUser: (id) => (id === 'usr_1' ? 'Owner Pat' : '—'),
      resolvePhysician: () => '—',
      resolvePatient: (id) => (id === 'pat_1' ? 'Ada Lovelace' : '—'),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].patientName).toBe('Ada Lovelace');
    expect(rows[0].facility).toBe('Sunrise ALF');
    expect(rows[0].marketer).toBe('Marketer Sam');
    expect(rows[0].intakeOwner).toBe('Owner Pat');
    expect(rows[0].doctor).toBe('Doc Who');
    expect(rows[0].physician_record_id).toBe('recPhy1');
    expect(rows[0].npi).toBe('Yes');
  });
});
