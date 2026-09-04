import { describe, it, expect } from 'vitest';
import {
  buildVisitCheckCandidate,
  collectVisitCheckCandidates,
  defaultChecked,
  isPendingScheduledVisit,
  mergeVisitCheckRows,
  statusLabel,
} from '../hchbVisitCheck.js';

const scheduled = {
  _id: 'rec1',
  id: 'ref_1',
  soc_scheduled_date: '2026-09-01',
  episode_type: 'SOC',
  patientName: 'Jane Smith',
  patient: { first_name: 'Jane', last_name: 'Smith', dob: '1980-01-15' },
};

describe('isPendingScheduledVisit', () => {
  it('requires a scheduled date and no completion stamp', () => {
    expect(isPendingScheduledVisit(scheduled)).toBe(true);
    expect(isPendingScheduledVisit({ ...scheduled, soc_completed_date: '2026-09-01' })).toBe(false);
    expect(isPendingScheduledVisit({ ...scheduled, soc_scheduled_date: '' })).toBe(false);
  });
});

describe('buildVisitCheckCandidate', () => {
  it('sends token, names, kind, and scheduled date', () => {
    expect(buildVisitCheckCandidate(scheduled)).toEqual({
      token: 'rec1',
      first_name: 'Jane',
      last_name: 'Smith',
      dob: '1980-01-15',
      visit_kind: 'SOC',
      scheduled_date: '2026-09-01',
    });
  });

  it('uses ROC when the episode is a resumption', () => {
    expect(buildVisitCheckCandidate({ ...scheduled, episode_type: 'ROC' }).visit_kind).toBe('ROC');
  });
});

describe('mergeVisitCheckRows', () => {
  it('defaults strong matches on and soft matches off', () => {
    const rows = mergeVisitCheckRows(
      [scheduled, { ...scheduled, _id: 'rec2', id: 'ref_2' }],
      [
        { token: 'rec1', matched: true, status: 'match', confidence: 'strong', visit_date: '2026-09-01' },
        { token: 'rec2', matched: true, status: 'match', confidence: 'soft', visit_date: '2026-09-02' },
      ],
    );
    expect(rows[0].selected).toBe(true);
    expect(rows[1].selected).toBe(false);
    expect(defaultChecked(rows[0].match)).toBe(true);
  });

  it('only includes scheduled unfinished visits', () => {
    const rows = mergeVisitCheckRows(
      [scheduled, { ...scheduled, _id: 'done', soc_completed_date: '2026-09-01' }],
      [],
    );
    expect(rows).toHaveLength(1);
    expect(statusLabel(null)).toBe('Not checked');
  });
});

describe('collectVisitCheckCandidates', () => {
  it('skips completed visits', () => {
    const list = collectVisitCheckCandidates([
      scheduled,
      { ...scheduled, _id: 'done', soc_completed_date: '2026-09-01' },
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].token).toBe('rec1');
  });
});
