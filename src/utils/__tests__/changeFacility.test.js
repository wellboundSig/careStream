import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateReferralOptimistic = vi.fn(async () => ({}));
const updatePatientOptimistic = vi.fn(async () => ({}));
const createNoteOptimistic = vi.fn(async () => ({}));
const recordActivity = vi.fn(async () => ({}));
const createNotification = vi.fn(async () => ({}));

vi.mock('../../store/mutations.js', () => ({
  updateReferralOptimistic: (...args) => updateReferralOptimistic(...args),
  updatePatientOptimistic: (...args) => updatePatientOptimistic(...args),
  createNoteOptimistic: (...args) => createNoteOptimistic(...args),
}));

vi.mock('../../api/activityLog.js', () => ({
  recordActivity: (...args) => recordActivity(...args),
}));

vi.mock('../../api/notifications.js', () => ({
  createNotification: (...args) => createNotification(...args),
}));

const { changeFacility } = await import('../changeFacility.js');

function basePreview(overrides = {}) {
  return {
    currentFacilityId: 'fac_old',
    newFacilityId: 'fac_new',
    newFacilityName: 'Sunrise ALF',
    sameFacility: false,
    rows: [
      { key: 'marketer', field: 'marketer_id', label: 'Primary marketer', currentValue: 'mkt_old', suggestedValue: 'mkt_new', status: 'conflict' },
      { key: 'coc_nurse', field: 'coc_nurse_id', label: 'COC nurse', currentValue: 'usr_old', suggestedValue: 'usr_new', status: 'conflict' },
    ],
    ...overrides,
  };
}

describe('changeFacility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates facility plus chosen assignments, writes note + activity, and notifies new assignees', async () => {
    const referral = {
      _id: 'recR1',
      id: 'ref_1',
      patient_id: 'pat_1',
      facility_id: 'fac_old',
      marketer_id: 'mkt_old',
      coc_nurse_id: 'usr_old',
    };

    const { fields, detail } = await changeFacility({
      referral,
      preview: basePreview(),
      decisions: {
        marketer: { action: 'adopt' },
        coc_nurse: { action: 'keep' },
      },
      actorUserId: 'usr_admin',
      actorName: 'Rafi Barides',
      previousFacilityName: 'Old ALF',
      newFacilityName: 'Sunrise ALF',
      newMarketerUserId: 'usr_mkt',
      newCocNurseUserId: 'usr_new',
      patientLabel: 'Chris Persaud',
    });

    expect(fields.facility_id).toBe('fac_new');
    expect(fields.marketer_id).toBe('mkt_new');
    expect(fields).not.toHaveProperty('coc_nurse_id');
    expect(detail).toContain('Old ALF → Sunrise ALF');

    expect(updateReferralOptimistic).toHaveBeenCalledWith('recR1', expect.objectContaining({
      facility_id: 'fac_new',
      marketer_id: 'mkt_new',
    }));
    expect(createNoteOptimistic).toHaveBeenCalled();
    expect(recordActivity).toHaveBeenCalledWith(expect.objectContaining({
      action: 'facility_changed',
      actorUserId: 'usr_admin',
    }));
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      recipient_user_id: 'usr_mkt',
      type: 'marketer_assigned',
    }));
    expect(createNotification).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'coc_nurse_assigned',
    }));
  });

  it('updates patient address when adopted', async () => {
    await changeFacility({
      referral: { _id: 'recR1', id: 'ref_1', patient_id: 'pat_1', facility_id: 'fac_old' },
      patient: { _id: 'recP1', id: 'pat_1' },
      preview: basePreview({
        rows: [{
          key: 'address',
          field: 'address',
          label: 'Patient address',
          currentValue: 'old',
          suggestedValue: 'new',
          status: 'conflict',
          suggestedAddress: { street: '10 Main St', zip: '10001', city: 'New York', state: 'NY', label: '10 Main St' },
        }],
      }),
      decisions: { address: { action: 'adopt' } },
      actorUserId: 'usr_admin',
    });

    expect(updatePatientOptimistic).toHaveBeenCalledWith('recP1', expect.objectContaining({
      address_street: '10 Main St',
      address_zip: '10001',
    }));
  });

  it('rejects changing to the same facility', async () => {
    await expect(changeFacility({
      referral: { _id: 'recR1', id: 'ref_1' },
      preview: basePreview({ sameFacility: true, newFacilityId: 'fac_old', currentFacilityId: 'fac_old' }),
      decisions: {},
      actorUserId: 'usr_admin',
    })).rejects.toThrow(/already assigned/i);
    expect(updateReferralOptimistic).not.toHaveBeenCalled();
  });

  it('never writes lead_created_by_id or intake_owner_id', async () => {
    await changeFacility({
      referral: {
        _id: 'recR1', id: 'ref_1', facility_id: 'fac_old',
        lead_created_by_id: 'usr_orig', intake_owner_id: 'usr_own',
      },
      preview: basePreview({ rows: [] }),
      decisions: {},
      actorUserId: 'usr_admin',
    });
    const patch = updateReferralOptimistic.mock.calls[0][1];
    expect(patch).not.toHaveProperty('lead_created_by_id');
    expect(patch).not.toHaveProperty('intake_owner_id');
  });
});
