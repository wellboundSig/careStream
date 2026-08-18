import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateReferralOptimistic = vi.fn(async () => ({}));
const createNoteOptimistic = vi.fn(async () => ({}));
const recordActivity = vi.fn(async () => ({}));
const createNotification = vi.fn(async () => ({}));

vi.mock('../../store/mutations.js', () => ({
  updateReferralOptimistic: (...args) => updateReferralOptimistic(...args),
  createNoteOptimistic: (...args) => createNoteOptimistic(...args),
}));

vi.mock('../../api/activityLog.js', () => ({
  recordActivity: (...args) => recordActivity(...args),
}));

vi.mock('../../api/notifications.js', () => ({
  createNotification: (...args) => createNotification(...args),
}));

const { changeMarketer } = await import('../changeMarketer.js');

describe('changeMarketer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates marketer, writes note + activity, and notifies linked user', async () => {
    const referral = {
      _id: 'recR1',
      id: 'ref_1',
      patient_id: 'pat_1',
      marketer_id: 'mkt_004',
    };

    const { fields, detail } = await changeMarketer({
      referral,
      newMarketerId: 'mkt_002',
      actorUserId: 'usr_admin',
      actorName: 'Rafi Barides',
      previousMarketerName: 'Janay Fernand',
      newMarketerName: 'David Krasner',
      newMarketerUserId: 'usr_005',
      patientLabel: 'Chris Persaud',
    });

    expect(fields.marketer_id).toBe('mkt_002');
    expect(detail).toContain('Janay Fernand → David Krasner');

    expect(updateReferralOptimistic).toHaveBeenCalledWith('recR1', expect.objectContaining({
      marketer_id: 'mkt_002',
    }));
    expect(createNoteOptimistic).toHaveBeenCalled();
    expect(recordActivity).toHaveBeenCalledWith(expect.objectContaining({
      action: 'marketer_changed',
      actorUserId: 'usr_admin',
    }));
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      recipient_user_id: 'usr_005',
      type: 'marketer_assigned',
    }));
  });

  it('does not notify when assigning to self', async () => {
    await changeMarketer({
      referral: { _id: 'recR1', id: 'ref_1', patient_id: 'pat_1', marketer_id: 'mkt_a' },
      newMarketerId: 'mkt_b',
      actorUserId: 'usr_005',
      newMarketerUserId: 'usr_005',
      newMarketerName: 'David',
    });
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('rejects no-op same marketer (including trailing whitespace)', async () => {
    await expect(changeMarketer({
      referral: { _id: 'recR1', id: 'ref_1', marketer_id: 'mkt_004\n' },
      newMarketerId: 'mkt_004',
      actorUserId: 'usr_admin',
    })).rejects.toThrow(/already assigned/i);
    expect(updateReferralOptimistic).not.toHaveBeenCalled();
  });

  it('never writes lead_created_by_id or intake_owner_id', async () => {
    await changeMarketer({
      referral: {
        _id: 'recR1', id: 'ref_1', marketer_id: 'mkt_a',
        lead_created_by_id: 'usr_orig', intake_owner_id: 'usr_own',
      },
      newMarketerId: 'mkt_b',
      actorUserId: 'usr_admin',
    });
    const patch = updateReferralOptimistic.mock.calls[0][1];
    expect(patch).not.toHaveProperty('lead_created_by_id');
    expect(patch).not.toHaveProperty('intake_owner_id');
  });
});
