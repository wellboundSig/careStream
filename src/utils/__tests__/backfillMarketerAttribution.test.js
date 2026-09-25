import { describe, it, expect } from 'vitest';
import {
  resolveOriginalMarketer,
  resolveNtucDate,
} from '../../../scripts/backfill-marketer-attribution.js';

describe('resolveOriginalMarketer', () => {
  it('uses current marketer when there is no reassignment history', () => {
    expect(resolveOriginalMarketer('mkt_A', [])).toBe('mkt_A');
    expect(resolveOriginalMarketer('  mkt_A ', null)).toBe('mkt_A');
  });

  it('walks back to the earliest previous marketer across multiple reassignments', () => {
    const changes = [
      { prev: 'mkt_B', next: 'mkt_C', ts: '2026-06-01T00:00:00Z' },
      { prev: 'mkt_A', next: 'mkt_B', ts: '2026-03-01T00:00:00Z' },
    ];
    expect(resolveOriginalMarketer('mkt_C', changes)).toBe('mkt_A');
  });

  it('uses the first assignee when the referral started unassigned', () => {
    const changes = [
      { prev: null, next: 'mkt_B', ts: '2026-03-01T00:00:00Z' },
      { prev: 'mkt_B', next: 'mkt_C', ts: '2026-06-01T00:00:00Z' },
    ];
    expect(resolveOriginalMarketer('mkt_C', changes)).toBe('mkt_B');
  });
});

describe('resolveNtucDate', () => {
  it('prefers the latest stage_history NTUC entry', () => {
    const r = { ntuc_requested_at: '2026-05-01', updated_at: '2026-09-01' };
    const { ts, source } = resolveNtucDate(r, ['2026-06-01T10:00:00Z', '2026-07-15T10:00:00Z']);
    expect(ts).toBe('2026-07-15T10:00:00.000Z');
    expect(source).toBe('stage_history');
  });

  it('falls back to ntuc_requested_at, flagged for review', () => {
    const { ts, source } = resolveNtucDate({ ntuc_requested_at: '2026-05-01T09:00:00Z', updated_at: '2026-09-01' }, []);
    expect(ts).toBe('2026-05-01T09:00:00.000Z');
    expect(source).toContain('FLAG');
  });

  it('last-resorts to updated_at, flagged for review', () => {
    const { ts, source } = resolveNtucDate({ updated_at: '2026-09-01T00:00:00Z' }, []);
    expect(ts).toBe('2026-09-01T00:00:00.000Z');
    expect(source).toContain('FLAG');
  });

  it('rejects garbage timestamps', () => {
    const { ts } = resolveNtucDate({ ntuc_requested_at: 'not a date', updated_at: null }, ['275760-01-01']);
    expect(ts).toBeNull();
  });
});
