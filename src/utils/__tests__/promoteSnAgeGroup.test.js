import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateReferralOptimistic = vi.fn(async () => ({}));
const createNoteOptimistic = vi.fn(async () => ({}));
const recordActivity = vi.fn(async () => ({}));
const createNotification = vi.fn(async () => ({}));

const storeState = {
  referrals: {},
  patients: {},
  notes: {},
  activityLog: {},
};

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

vi.mock('../../store/careStore.js', () => ({
  useCareStore: {
    getState: () => storeState,
  },
}));

const {
  shouldPromoteSnAgeGroup,
  promoteSnAgeGroupToAdult,
  sweepSnAgeGroupPromotions,
  SN_AGE_PROMOTE_MESSAGE,
  promotionNotificationId,
} = await import('../promoteSnAgeGroup.js');

const TODAY = new Date(2026, 4, 11); // 2026-05-11 — 18th birthday = 2008-05-11

function pedsReferral(overrides = {}) {
  return {
    _id: 'recR1',
    id: 'ref_1',
    patient_id: 'pat_1',
    division: 'Special Needs',
    sn_age_group: 'Pediatric',
    current_stage: 'Intake',
    intake_owner_id: 'usr_006',
    ...overrides,
  };
}

describe('shouldPromoteSnAgeGroup', () => {
  it('promotes SPN Pediatric when DOB is 18 today', () => {
    expect(shouldPromoteSnAgeGroup({
      referral: pedsReferral(),
      patient: { id: 'pat_1', dob: '2008-05-11' },
      today: TODAY,
    })).toBe(true);
  });

  it('does not promote while still under 18', () => {
    expect(shouldPromoteSnAgeGroup({
      referral: pedsReferral(),
      patient: { id: 'pat_1', dob: '2008-05-12' },
      today: TODAY,
    })).toBe(false);
  });

  it('does not promote Adult, ALF, NTUC, or missing DOB', () => {
    const patient = { id: 'pat_1', dob: '2008-05-11' };
    expect(shouldPromoteSnAgeGroup({
      referral: pedsReferral({ sn_age_group: 'Adult' }),
      patient,
      today: TODAY,
    })).toBe(false);
    expect(shouldPromoteSnAgeGroup({
      referral: pedsReferral({ division: 'ALF' }),
      patient,
      today: TODAY,
    })).toBe(false);
    expect(shouldPromoteSnAgeGroup({
      referral: pedsReferral({ current_stage: 'NTUC' }),
      patient,
      today: TODAY,
    })).toBe(false);
    expect(shouldPromoteSnAgeGroup({
      referral: pedsReferral({ current_stage: 'Discarded Leads' }),
      patient,
      today: TODAY,
    })).toBe(false);
    expect(shouldPromoteSnAgeGroup({
      referral: pedsReferral(),
      patient: { id: 'pat_1' },
      today: TODAY,
    })).toBe(false);
  });

  it('still promotes cases sitting in SOC Completed / Hold', () => {
    const patient = { id: 'pat_1', dob: '2008-05-11' };
    expect(shouldPromoteSnAgeGroup({
      referral: pedsReferral({ current_stage: 'SOC Completed' }),
      patient,
      today: TODAY,
    })).toBe(true);
    expect(shouldPromoteSnAgeGroup({
      referral: pedsReferral({ current_stage: 'Hold' }),
      patient,
      today: TODAY,
    })).toBe(true);
  });
});

describe('promoteSnAgeGroupToAdult', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.referrals = {};
    storeState.patients = {};
    storeState.notes = {};
    storeState.activityLog = {};
  });

  it('flips the referral, writes a note, and notifies the intake owner', async () => {
    const referral = pedsReferral();
    storeState.referrals[referral._id] = referral;

    const result = await promoteSnAgeGroupToAdult({
      referral,
      patient: { id: 'pat_1', first_name: 'Alex', last_name: 'Rivera', dob: '2008-05-11' },
      today: TODAY,
    });

    expect(result.skipped).toBe(false);
    expect(updateReferralOptimistic).toHaveBeenCalledWith('recR1', expect.objectContaining({
      sn_age_group: 'Adult',
    }));
    expect(createNoteOptimistic).toHaveBeenCalledWith(expect.objectContaining({
      content: SN_AGE_PROMOTE_MESSAGE,
    }));
    expect(recordActivity).toHaveBeenCalledWith(expect.objectContaining({
      action: 'sn_age_group_auto_adult',
    }));
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      recipient_user_id: 'usr_006',
      type: 'sn_age_group_adult',
      id: promotionNotificationId('ref_1'),
      title: SN_AGE_PROMOTE_MESSAGE,
      body: 'Alex Rivera',
    }));
  });

  it('does not notify when there is no intake owner', async () => {
    const referral = pedsReferral({ intake_owner_id: null });
    storeState.referrals[referral._id] = referral;

    await promoteSnAgeGroupToAdult({
      referral,
      patient: { id: 'pat_1', dob: '2008-05-11' },
      today: TODAY,
    });

    expect(updateReferralOptimistic).toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('skips notify when a promotion note already exists, but still flips the field', async () => {
    const referral = pedsReferral();
    storeState.referrals[referral._id] = referral;
    storeState.notes.n1 = {
      id: 'note_sn_adult_ref_1',
      referral_id: 'ref_1',
      content: SN_AGE_PROMOTE_MESSAGE,
    };

    const result = await promoteSnAgeGroupToAdult({
      referral,
      patient: { id: 'pat_1', dob: '2008-05-11' },
      today: TODAY,
    });

    expect(result.reason).toBe('already_marked');
    expect(updateReferralOptimistic).toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });
});

describe('sweepSnAgeGroupPromotions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.referrals = {
      recR1: pedsReferral(),
      recR2: pedsReferral({
        _id: 'recR2',
        id: 'ref_2',
        patient_id: 'pat_2',
        sn_age_group: 'Pediatric',
      }),
    };
    storeState.patients = {
      recP1: { _id: 'recP1', id: 'pat_1', dob: '2008-05-11' },
      recP2: { _id: 'recP2', id: 'pat_2', dob: '2012-01-01' },
    };
    storeState.notes = {};
    storeState.activityLog = {};
  });

  it('promotes only the referral whose patient is now 18', async () => {
    const result = await sweepSnAgeGroupPromotions({ today: TODAY });
    expect(result.ran).toBe(true);
    expect(result.candidates).toBe(1);
    expect(updateReferralOptimistic).toHaveBeenCalledTimes(1);
    expect(updateReferralOptimistic).toHaveBeenCalledWith('recR1', expect.objectContaining({
      sn_age_group: 'Adult',
    }));
  });
});
