import { describe, it, expect } from 'vitest';
import {
  formatDaysInStage,
  isCaseloadOverdue,
  isExecutiveOverdue,
  listOverdueReferrals,
  overdueDaysInStage,
} from '../dashboardOverdue.js';

const now = new Date('2026-08-18T12:00:00Z').getTime();

function daysAgo(n) {
  return new Date(now - n * 86400000).toISOString();
}

describe('dashboardOverdue', () => {
  it('counts days from _days_in_stage when present', () => {
    expect(overdueDaysInStage({ _days_in_stage: 21, updated_at: daysAgo(3) }, now)).toBe(21);
  });

  it('falls back to updated_at', () => {
    expect(overdueDaysInStage({ updated_at: daysAgo(16) }, now)).toBe(16);
  });

  it('executive overdue skips parked / completed stages', () => {
    expect(isExecutiveOverdue({ current_stage: 'Intake', updated_at: daysAgo(20) }, now)).toBe(true);
    expect(isExecutiveOverdue({ current_stage: 'Hold', updated_at: daysAgo(20) }, now)).toBe(false);
    expect(isExecutiveOverdue({ current_stage: 'NTUC', updated_at: daysAgo(20) }, now)).toBe(false);
    expect(isExecutiveOverdue({ current_stage: 'Intake', updated_at: daysAgo(10) }, now)).toBe(false);
  });

  it('lists overdue rows longest-stuck first', () => {
    const rows = listOverdueReferrals([
      { _id: 'a', current_stage: 'Intake', updated_at: daysAgo(16) },
      { _id: 'b', current_stage: 'Intake', updated_at: daysAgo(30) },
      { _id: 'c', current_stage: 'Hold', updated_at: daysAgo(40) },
    ], isExecutiveOverdue, now);
    expect(rows.map((r) => r._id)).toEqual(['b', 'a']);
  });

  it('formats duration copy', () => {
    expect(formatDaysInStage(0)).toBe('Today');
    expect(formatDaysInStage(1)).toBe('1 day');
    expect(formatDaysInStage(18)).toBe('18 days');
  });

  it('caseload overdue includes NTUC but not Hold', () => {
    expect(isCaseloadOverdue({ current_stage: 'NTUC', updated_at: daysAgo(20) }, now)).toBe(true);
    expect(isCaseloadOverdue({ current_stage: 'Hold', updated_at: daysAgo(20) }, now)).toBe(false);
  });
});
