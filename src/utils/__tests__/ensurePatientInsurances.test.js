import { describe, it, expect, vi, beforeEach } from 'vitest';

const getInsurancesByPatient = vi.fn();
const syncPatientInsurances = vi.fn();

vi.mock('../../api/patientInsurances.js', () => ({
  getInsurancesByPatient: (...args) => getInsurancesByPatient(...args),
}));

vi.mock('../../api/syncPatientInsurances.js', () => ({
  syncPatientInsurances: (...args) => syncPatientInsurances(...args),
}));

const { ensurePatientInsurancesFromJson } = await import('../ensurePatientInsurances.js');
const { memberIdFromDetail, hasInsuranceDetails } = await import('../insuranceDetails.js');

describe('insuranceDetails helpers', () => {
  it('reads bare string and object member ids', () => {
    expect(memberIdFromDetail('AB12345C')).toBe('AB12345C');
    expect(memberIdFromDetail({ member_id: 'XY99' })).toBe('XY99');
    expect(memberIdFromDetail('')).toBe('');
  });

  it('hasInsuranceDetails true when plan has CIN in JSON', () => {
    expect(hasInsuranceDetails({
      insurance_plans: JSON.stringify(['Fidelis Care']),
      insurance_plan_details: JSON.stringify({ 'Fidelis Care': 'AB12345C' }),
    })).toBe(true);
    expect(hasInsuranceDetails({
      insurance_plans: JSON.stringify(['Fidelis Care']),
      insurance_plan_details: JSON.stringify({ 'Fidelis Care': '' }),
    })).toBe(false);
  });
});

describe('ensurePatientInsurancesFromJson', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('syncs when PatientInsurances empty but JSON has plans + CIN', async () => {
    getInsurancesByPatient.mockResolvedValue([]);
    syncPatientInsurances.mockResolvedValue({ synced: true, created: ['x'] });

    const result = await ensurePatientInsurancesFromJson({
      patient: {
        insurance_plans: JSON.stringify(['Fidelis Care']),
        insurance_plan_details: JSON.stringify({ 'Fidelis Care': 'AB12345C' }),
      },
      patientRecordId: 'recP1',
      patientBusinessId: 'pat_1',
    });

    expect(result.healed).toBe(true);
    expect(syncPatientInsurances).toHaveBeenCalledWith(expect.objectContaining({
      patientRecordId: 'recP1',
      patientBusinessId: 'pat_1',
      plans: ['Fidelis Care'],
      details: { 'Fidelis Care': 'AB12345C' },
      enteredFrom: 'heal_json',
    }));
  });

  it('syncs when rows exist but member_id empty and JSON has CIN', async () => {
    getInsurancesByPatient.mockResolvedValue([{
      id: 'pi_1',
      fields: { payer_display_name: 'Fidelis Care', member_id: '' },
    }]);
    syncPatientInsurances.mockResolvedValue({ synced: true, updated: ['pi_1'] });

    const result = await ensurePatientInsurancesFromJson({
      patient: {
        insurance_plans: JSON.stringify(['Fidelis Care']),
        insurance_plan_details: JSON.stringify({ 'Fidelis Care': 'AB12345C' }),
      },
      patientRecordId: 'recP1',
      patientBusinessId: 'pat_1',
    });

    expect(result.healed).toBe(true);
    expect(syncPatientInsurances).toHaveBeenCalled();
  });

  it('skips when already synced', async () => {
    getInsurancesByPatient.mockResolvedValue([{
      id: 'pi_1',
      fields: { payer_display_name: 'Fidelis Care', member_id: 'AB12345C' },
    }]);

    const result = await ensurePatientInsurancesFromJson({
      patient: {
        insurance_plans: JSON.stringify(['Fidelis Care']),
        insurance_plan_details: JSON.stringify({ 'Fidelis Care': 'AB12345C' }),
      },
      patientRecordId: 'recP1',
      patientBusinessId: 'pat_1',
    });

    expect(result.healed).toBe(false);
    expect(result.reason).toBe('already_synced');
    expect(syncPatientInsurances).not.toHaveBeenCalled();
  });
});
