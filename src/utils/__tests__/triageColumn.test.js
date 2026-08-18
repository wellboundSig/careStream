import { describe, it, expect } from 'vitest';
import {
  TRIAGE_COLUMN_LABELS,
  buildTriagePresenceMap,
  matchesTriageFilter,
  referralHasTriageRecord,
  triageColumnLabel,
} from '../triageColumn.js';

describe('triageColumn', () => {
  it('detects adult and pediatric triage rows by referral id', () => {
    const adult = { a: { referral_id: 'ref_1' } };
    const ped = { p: { referral_id: 'ref_2' } };
    expect(referralHasTriageRecord('ref_1', adult, ped)).toBe(true);
    expect(referralHasTriageRecord('ref_2', adult, ped)).toBe(true);
    expect(referralHasTriageRecord('ref_3', adult, ped)).toBe(false);
    expect(buildTriagePresenceMap(adult, ped)).toEqual({ ref_1: true, ref_2: true });
  });

  it('labels SN rows Done/Needed and other divisions N/A', () => {
    expect(triageColumnLabel({ division: 'Special Needs' }, true)).toBe(TRIAGE_COLUMN_LABELS.DONE);
    expect(triageColumnLabel({ division: 'Special Needs' }, false)).toBe(TRIAGE_COLUMN_LABELS.NEEDED);
    expect(triageColumnLabel({ division: 'ALF' }, true)).toBe(TRIAGE_COLUMN_LABELS.NA);
    expect(triageColumnLabel({ division: 'Home Health' }, false)).toBe(TRIAGE_COLUMN_LABELS.NA);
  });

  it('matches displayed labels and short aliases', () => {
    expect(matchesTriageFilter('Done', 'done')).toBe(true);
    expect(matchesTriageFilter('Done', 'yes')).toBe(true);
    expect(matchesTriageFilter('Needed', 'needed')).toBe(true);
    expect(matchesTriageFilter('Needed', 'no')).toBe(true);
    expect(matchesTriageFilter('N/A', 'na')).toBe(true);
    expect(matchesTriageFilter('Done', 'needed')).toBe(false);
    expect(matchesTriageFilter('Needed', '')).toBe(true);
    expect(matchesTriageFilter('Done', ['Needed', 'Done'])).toBe(true);
    expect(matchesTriageFilter('N/A', ['Done'])).toBe(false);
  });
});
