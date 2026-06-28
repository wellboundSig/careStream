import { describe, it, expect } from 'vitest';
import {
  F2F_REVIEW_CHECKLIST,
  F2F_REQUIRED_ITEMS,
  isF2FChecklistComplete,
  isF2FTabComplete,
} from '../f2fChecklist.js';

const allRequiredChecked = Object.fromEntries(F2F_REQUIRED_ITEMS.map((i) => [i.key, true]));
const optionalKeys = F2F_REVIEW_CHECKLIST.filter((i) => !i.required).map((i) => i.key);

describe('F2F tab completion rule (single source of truth)', () => {
  it('is complete when a file is uploaded, a visit date is logged, and mandatory cursory items are checked', () => {
    expect(isF2FTabComplete({ hasF2FFile: true, hasF2FDate: true, cursoryChecked: allRequiredChecked })).toBe(true);
  });

  it('does NOT require the optional cursory items', () => {
    // All required checked, optional explicitly false → still complete.
    const withOptionalUnchecked = { ...allRequiredChecked };
    for (const k of optionalKeys) withOptionalUnchecked[k] = false;
    expect(optionalKeys.length).toBeGreaterThan(0); // guards the premise
    expect(isF2FChecklistComplete(withOptionalUnchecked)).toBe(true);
    expect(isF2FTabComplete({ hasF2FFile: true, hasF2FDate: true, cursoryChecked: withOptionalUnchecked })).toBe(true);
  });

  it('is incomplete without a file', () => {
    expect(isF2FTabComplete({ hasF2FFile: false, hasF2FDate: true, cursoryChecked: allRequiredChecked })).toBe(false);
  });

  it('is incomplete without a visit date', () => {
    expect(isF2FTabComplete({ hasF2FFile: true, hasF2FDate: false, cursoryChecked: allRequiredChecked })).toBe(false);
  });

  it('is incomplete when a mandatory cursory item is unchecked', () => {
    const missingOne = { ...allRequiredChecked, [F2F_REQUIRED_ITEMS[0].key]: false };
    expect(isF2FTabComplete({ hasF2FFile: true, hasF2FDate: true, cursoryChecked: missingOne })).toBe(false);
  });

  it('handles empty/missing input safely', () => {
    expect(isF2FTabComplete()).toBe(false);
    expect(isF2FTabComplete({})).toBe(false);
  });
});
