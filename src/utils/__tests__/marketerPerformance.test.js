import { describe, it, expect } from 'vitest';
import {
  attributionMarketerId,
  isOpenReferral,
  summarizeMarketerReferrals,
  computeMarketerPerformance,
  formatCloseRate,
  UNASSIGNED_KEY,
} from '../marketerPerformance.js';
import { quarterBounds, dateRangeBounds } from '../../components/common/DateRangeFilter.jsx';

const ref = (over = {}) => ({
  id: 'ref_x',
  current_stage: 'Intake',
  referral_date: '2026-07-10T12:00:00.000Z',
  marketer_id: 'mkt_001',
  ...over,
});

describe('attributionMarketerId', () => {
  it('prefers the originally assigned marketer over the current one', () => {
    expect(attributionMarketerId(ref({ original_marketer_id: 'mkt_009', marketer_id: 'mkt_001' }))).toBe('mkt_009');
  });
  it('falls back to marketer_id for rows not yet backfilled', () => {
    expect(attributionMarketerId(ref({ original_marketer_id: '', marketer_id: 'mkt_001' }))).toBe('mkt_001');
    expect(attributionMarketerId(ref({ marketer_id: 'mkt_001' }))).toBe('mkt_001');
  });
});

describe('isOpenReferral', () => {
  it('open while being worked, including Hold', () => {
    expect(isOpenReferral(ref({ current_stage: 'Intake' }))).toBe(true);
    expect(isOpenReferral(ref({ current_stage: 'Hold' }))).toBe(true);
  });
  it('not open once resolved or discarded', () => {
    expect(isOpenReferral(ref({ current_stage: 'NTUC' }))).toBe(false);
    expect(isOpenReferral(ref({ current_stage: 'Discarded Leads' }))).toBe(false);
    expect(isOpenReferral(ref({ current_stage: 'SOC Completed', soc_completed_date: '2026-07-20' }))).toBe(false);
    expect(isOpenReferral(ref({ current_stage: 'Completed', soc_completed_date: '2026-07-20' }))).toBe(false);
  });
});

describe('summarizeMarketerReferrals — close rate = SOC ÷ (SOC + NTUC)', () => {
  it('computes the rate on resolved referrals only; open sits outside', () => {
    const rows = [
      ref({ current_stage: 'Completed', soc_completed_date: '2026-07-20' }), // SOC
      ref({ current_stage: 'Completed', soc_completed_date: '2026-08-02' }), // SOC
      ref({ current_stage: 'NTUC', ntuc_date: '2026-07-25' }),               // NTUC
      ref({ current_stage: 'Intake' }),                                      // open
      ref({ current_stage: 'Hold' }),                                        // open
    ];
    const s = summarizeMarketerReferrals(rows, null);
    expect(s.soc).toBe(2);
    expect(s.ntuc).toBe(1);
    expect(s.closed).toBe(3);
    expect(s.closeRate).toBeCloseTo(2 / 3);
    expect(s.open).toBe(2);
    expect(s.received).toBe(5);
  });

  it('returns null (never 0%) when nothing has closed', () => {
    const s = summarizeMarketerReferrals([ref(), ref({ current_stage: 'Hold' })], null);
    expect(s.closeRate).toBeNull();
    expect(formatCloseRate(s.closeRate)).toBe('N/A');
  });

  it('excludes discarded leads from every count', () => {
    const s = summarizeMarketerReferrals([
      ref({ current_stage: 'Discarded Leads' }),
      ref({ current_stage: 'Completed', soc_completed_date: '2026-07-20' }),
    ], null);
    expect(s.received).toBe(1);
    expect(s.soc).toBe(1);
    expect(s.open).toBe(0);
  });

  it('buckets outcomes by OUTCOME date, not referral date', () => {
    const q3 = { preset: 'custom', from: '2026-07-01', to: '2026-09-30' };
    const rows = [
      // Referred in Q2, SOC'd in Q3 → counts in Q3.
      ref({ referral_date: '2026-05-10', current_stage: 'Completed', soc_completed_date: '2026-07-15' }),
      // Referred AND NTUC'd in Q2 → does not count in Q3.
      ref({ referral_date: '2026-04-01', current_stage: 'NTUC', ntuc_date: '2026-06-20' }),
      // Referred in Q3, still open → received only.
      ref({ referral_date: '2026-08-01', current_stage: 'Intake' }),
    ];
    const s = summarizeMarketerReferrals(rows, q3);
    expect(s.soc).toBe(1);
    expect(s.ntuc).toBe(0);
    expect(s.received).toBe(1);
    expect(s.closeRate).toBe(1);
  });

  it('open count is a current snapshot, never period-scoped', () => {
    const lastYear = { preset: 'custom', from: '2025-01-01', to: '2025-12-31' };
    const s = summarizeMarketerReferrals([ref({ referral_date: '2026-08-01', current_stage: 'Intake' })], lastYear);
    expect(s.received).toBe(0); // received outside the period
    expect(s.open).toBe(1);     // but still open right now
  });

  it('a re-opened NTUC (stage left NTUC, ntuc_date cleared) is not a loss', () => {
    const s = summarizeMarketerReferrals([
      ref({ current_stage: 'Intake', ntuc_date: null }),
    ], null);
    expect(s.ntuc).toBe(0);
    expect(s.open).toBe(1);
  });
});

describe('computeMarketerPerformance — attribution grouping', () => {
  it('credits the original marketer even after reassignment', () => {
    const rows = [
      ref({ original_marketer_id: 'mkt_A', marketer_id: 'mkt_B', current_stage: 'Completed', soc_completed_date: '2026-07-20' }),
      ref({ original_marketer_id: 'mkt_B', marketer_id: 'mkt_B', current_stage: 'NTUC', ntuc_date: '2026-07-21' }),
    ];
    const perf = computeMarketerPerformance(rows, null);
    expect(perf.mkt_A.soc).toBe(1);
    expect(perf.mkt_B.soc).toBe(0);
    expect(perf.mkt_B.ntuc).toBe(1);
  });

  it('groups rows with no marketer under UNASSIGNED_KEY', () => {
    const perf = computeMarketerPerformance([ref({ marketer_id: '' })], null);
    expect(perf[UNASSIGNED_KEY].received).toBe(1);
  });
});

describe('quarter / YTD presets', () => {
  it('quarterBounds spans a full calendar quarter', () => {
    const now = new Date(2026, 8, 22); // Sep 22, 2026 → Q3
    const q = quarterBounds(0, now);
    expect(new Date(q.fromTs).toDateString()).toBe(new Date(2026, 6, 1).toDateString());
    expect(new Date(q.toTs + 1).toDateString()).toBe(new Date(2026, 9, 1).toDateString());
  });
  it('last quarter crosses the year boundary in Q1', () => {
    const now = new Date(2026, 1, 10); // Feb 2026 → last quarter = Q4 2025
    const q = quarterBounds(-1, now);
    expect(new Date(q.fromTs).getFullYear()).toBe(2025);
    expect(new Date(q.fromTs).getMonth()).toBe(9); // October
  });
  it('dateRangeBounds resolves qtd/lastq/ytd presets', () => {
    expect(dateRangeBounds({ preset: 'qtd' })).toBeTruthy();
    expect(dateRangeBounds({ preset: 'lastq' })?.toTs).toBeTruthy();
    expect(dateRangeBounds({ preset: 'ytd' })?.fromTs).toBe(new Date(new Date().getFullYear(), 0, 1).getTime());
  });
});
