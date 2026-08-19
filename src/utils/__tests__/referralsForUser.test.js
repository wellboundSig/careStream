import { describe, it, expect } from 'vitest';
import { marketerIdsForUser, referralsForUser } from '../referralsForUser.js';

const user = { id: 'usr_nissan', _id: 'rec_u1' };
const marketers = {
  rec_m1: { id: 'mkt_001', user_id: 'usr_nissan', first_name: 'Nissan' },
};

describe('marketerIdsForUser', () => {
  it('resolves the Marketers row linked by user_id', () => {
    expect(marketerIdsForUser(user, marketers)).toEqual(['mkt_001']);
  });
});

describe('referralsForUser', () => {
  it('includes the marketer book, not only intake-owned cases', () => {
    const referrals = {
      a: { id: 'ref_1', marketer_id: 'mkt_001', current_stage: 'Intake' },
      b: { id: 'ref_2', intake_owner_id: 'usr_nissan', current_stage: 'Intake' },
      c: { id: 'ref_3', marketer_id: 'mkt_other', current_stage: 'Intake' },
    };
    const rows = referralsForUser(user, { referrals, marketers });
    expect(rows.map((r) => r.id).sort()).toEqual(['ref_1', 'ref_2']);
  });

  it('matches marketer_id stored as the user id', () => {
    const rows = referralsForUser(user, {
      referrals: { a: { id: 'ref_4', marketer_id: 'usr_nissan' } },
      marketers: {},
    });
    expect(rows.map((r) => r.id)).toEqual(['ref_4']);
  });

  it('returns empty when the user has no linked cases', () => {
    expect(referralsForUser(user, { referrals: {}, marketers })).toEqual([]);
  });
});
