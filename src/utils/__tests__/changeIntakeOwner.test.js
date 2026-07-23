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

const { changeIntakeOwner } = await import('../changeIntakeOwner.js');

describe('changeIntakeOwner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates owner, writes note + activity, and notifies new owner', async () => {
    const referral = {
      _id: 'recR1',
      id: 'ref_1',
      patient_id: 'pat_1',
      intake_owner_id: 'usr_old',
    };

    const { fields, detail } = await changeIntakeOwner({
      referral,
      newOwnerId: 'usr_new',
      actorUserId: 'usr_admin',
      actorName: 'Rafi Barides',
      previousOwnerName: 'Old Owner',
      newOwnerName: 'New Owner',
      patientLabel: 'Chris Persaud',
    });

    expect(fields.intake_owner_id).toBe('usr_new');
    expect(fields.intake_owner_changed_by_id).toBe('usr_admin');
    expect(fields.intake_owner_changed_at).toBeTruthy();
    expect(detail).toContain('Old Owner → New Owner');

    expect(updateReferralOptimistic).toHaveBeenCalledWith('recR1', expect.objectContaining({
      intake_owner_id: 'usr_new',
    }));
    expect(createNoteOptimistic).toHaveBeenCalled();
    expect(recordActivity).toHaveBeenCalledWith(expect.objectContaining({
      action: 'intake_owner_changed',
      actorUserId: 'usr_admin',
    }));
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      recipient_user_id: 'usr_new',
      type: 'intake_owner_assigned',
    }));
  });

  it('does not notify when assigning to self', async () => {
    await changeIntakeOwner({
      referral: { _id: 'recR1', id: 'ref_1', patient_id: 'pat_1', intake_owner_id: 'usr_a' },
      newOwnerId: 'usr_admin',
      actorUserId: 'usr_admin',
      actorName: 'Rafi',
      newOwnerName: 'Rafi',
    });
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('rejects no-op same owner', async () => {
    await expect(changeIntakeOwner({
      referral: { _id: 'recR1', id: 'ref_1', intake_owner_id: 'usr_a' },
      newOwnerId: 'usr_a',
      actorUserId: 'usr_admin',
    })).rejects.toThrow(/already the intake owner/i);
    expect(updateReferralOptimistic).not.toHaveBeenCalled();
  });

  it('never writes lead_created_by_id', async () => {
    await changeIntakeOwner({
      referral: { _id: 'recR1', id: 'ref_1', intake_owner_id: 'usr_a', lead_created_by_id: 'usr_orig' },
      newOwnerId: 'usr_b',
      actorUserId: 'usr_admin',
    });
    const patch = updateReferralOptimistic.mock.calls[0][1];
    expect(patch).not.toHaveProperty('lead_created_by_id');
  });
});
