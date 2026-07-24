import { describe, it, expect } from 'vitest';
import { resolveMyMarketerId, isReferralVisibleToUser } from '../referralVisibility.js';

describe('resolveMyMarketerId', () => {
  it('finds marketer row by user_id', () => {
    const marketers = {
      a: { id: 'mkt_1', user_id: 'usr_a' },
      b: { id: 'mkt_2', user_id: 'usr_b' },
    };
    expect(resolveMyMarketerId(marketers, 'usr_b')).toBe('mkt_2');
    expect(resolveMyMarketerId(marketers, 'usr_z')).toBe(null);
  });
});

describe('isReferralVisibleToUser', () => {
  const base = { canViewAll: false, myMarketerId: 'mkt_me', appUserId: 'usr_me' };

  it('shows everything when canViewAll', () => {
    expect(isReferralVisibleToUser(
      { marketer_id: 'mkt_other', lead_created_by_id: 'usr_other' },
      { ...base, canViewAll: true },
    )).toBe(true);
  });

  it('shows when user is the marketer', () => {
    expect(isReferralVisibleToUser(
      { marketer_id: 'mkt_me', lead_created_by_id: 'usr_other' },
      base,
    )).toBe(true);
  });

  it('shows when user entered the lead even if not marketer', () => {
    expect(isReferralVisibleToUser(
      { marketer_id: 'mkt_other', lead_created_by_id: 'usr_me' },
      base,
    )).toBe(true);
  });

  it('hides others when restricted', () => {
    expect(isReferralVisibleToUser(
      { marketer_id: 'mkt_other', lead_created_by_id: 'usr_other' },
      base,
    )).toBe(false);
  });
});
