import { describe, it, expect } from 'vitest';
import {
  selectedFilterValues,
  filterIsActive,
  cellMatchesFilter,
  matchesYesNoFilter,
  matchesNumericFilter,
} from '../columnFilters.js';

describe('columnFilters', () => {
  it('parses arrays and legacy strings', () => {
    expect(selectedFilterValues(['ALF', 'Adult'])).toEqual(['ALF', 'Adult']);
    expect(selectedFilterValues('ALF')).toEqual(['ALF']);
    expect(selectedFilterValues('')).toEqual([]);
    expect(filterIsActive(['ALF'])).toBe(true);
    expect(filterIsActive([])).toBe(false);
  });

  it('matches any checked value (OR)', () => {
    expect(cellMatchesFilter('ALF', ['ALF', 'Adult'])).toBe(true);
    expect(cellMatchesFilter('Adult', ['ALF', 'Adult'])).toBe(true);
    expect(cellMatchesFilter('Pediatric', ['ALF', 'Adult'])).toBe(false);
    expect(cellMatchesFilter('ALF', [])).toBe(true);
  });

  it('matches yes/no and exact day values', () => {
    expect(matchesYesNoFilter(true, ['yes'])).toBe(true);
    expect(matchesYesNoFilter(true, ['no'])).toBe(false);
    expect(matchesYesNoFilter(true, ['yes', 'no'])).toBe(true);
    expect(matchesNumericFilter(14, ['7', '14'])).toBe(true);
    expect(matchesNumericFilter(3, ['7', '14'])).toBe(false);
  });
});
