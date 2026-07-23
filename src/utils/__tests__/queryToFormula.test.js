import { describe, it, expect } from 'vitest';
import {
  ruleToFilter,
  queryToFilters,
  ruleGroupToFormula,
  slotsToQuery,
  queryToSlots,
} from '../queryToFormula.js';

describe('ruleToFilter', () => {
  it('maps equality', () => {
    expect(ruleToFilter({ field: 'division', operator: '=', value: 'ALF' }))
      .toEqual({ field: 'division', operator: 'eq', value: 'ALF' });
  });

  it('maps between arrays', () => {
    expect(ruleToFilter({ field: 'referral_date', operator: 'between', value: ['2026-01-01', '2026-01-31'] }))
      .toEqual({
        field: 'referral_date',
        operator: 'between',
        value: '2026-01-01',
        value2: '2026-01-31',
      });
  });

  it('maps in lists', () => {
    expect(ruleToFilter({ field: 'marketer_id', operator: 'in', value: ['m1', 'm2'] }))
      .toEqual({ field: 'marketer_id', operator: 'in', value: ['m1', 'm2'] });
  });
});

describe('slotsToQuery / queryToSlots', () => {
  it('round-trips flat and slots', () => {
    const slots = {
      dateFrom: '2026-01-01',
      dateTo: '2026-01-31',
      division: 'ALF',
      marketerIds: ['mkt_1'],
      ownerIds: [],
      sourceIds: [],
      stages: [],
    };
    const q = slotsToQuery(slots);
    const back = queryToSlots(q);
    expect(back.dateFrom).toBe('2026-01-01');
    expect(back.dateTo).toBe('2026-01-31');
    expect(back.division).toBe('ALF');
    expect(back.marketerIds).toEqual(['mkt_1']);
  });
});

describe('queryToFilters / ruleGroupToFormula', () => {
  it('builds AND formula for flat query', () => {
    const { filters, formula } = queryToFilters({
      combinator: 'and',
      rules: [
        { field: 'division', operator: '=', value: 'ALF' },
        { field: 'current_stage', operator: 'in', value: ['Intake', 'Hold'] },
      ],
    });
    expect(filters).toHaveLength(2);
    expect(formula).toContain('division');
    expect(formula).toContain('OR(');
    expect(formula.startsWith('AND(')).toBe(true);
  });

  it('supports nested OR groups', () => {
    const formula = ruleGroupToFormula({
      combinator: 'and',
      rules: [
        { field: 'division', operator: '=', value: 'ALF' },
        {
          combinator: 'or',
          rules: [
            { field: 'marketer_id', operator: '=', value: 'a' },
            { field: 'marketer_id', operator: '=', value: 'b' },
          ],
        },
      ],
    });
    expect(formula).toContain('AND(');
    expect(formula).toContain('OR(');
  });
});
