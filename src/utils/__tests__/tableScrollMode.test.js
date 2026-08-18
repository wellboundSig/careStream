import { describe, it, expect } from 'vitest';
import {
  TABLE_SCROLL_FULL,
  TABLE_SCROLL_LOCKED,
  isLockedTableScroll,
  lockedGridClass,
  lockColClass,
  flipSlotCount,
  flipMaxStart,
  nextFlipStart,
} from '../tableScrollMode.js';

describe('tableScrollMode', () => {
  it('defaults to full (unlocked)', () => {
    expect(isLockedTableScroll(undefined)).toBe(false);
    expect(isLockedTableScroll({})).toBe(false);
    expect(isLockedTableScroll({ tableScrollMode: TABLE_SCROLL_FULL })).toBe(false);
  });

  it('treats locked as flip-window mode', () => {
    expect(isLockedTableScroll({ tableScrollMode: TABLE_SCROLL_LOCKED })).toBe(true);
  });

  it('adds flip class only when locked', () => {
    expect(lockedGridClass(false)).toBe('data-grid');
    expect(lockedGridClass(true)).toContain('table-flip-rows');
    expect(lockColClass(true)).toBeUndefined();
  });

  it('computes fixed slot counts from viewport height', () => {
    expect(flipSlotCount(400, 40, 48)).toBe(7);
    expect(flipSlotCount(40, 40, 48)).toBe(1);
    expect(flipMaxStart(20, 7)).toBe(13);
    expect(flipMaxStart(5, 7)).toBe(0);
  });

  it('steps the window start without leaving the list', () => {
    expect(nextFlipStart(0, 1, 10)).toBe(1);
    expect(nextFlipStart(0, -1, 10)).toBe(0);
    expect(nextFlipStart(10, 3, 10)).toBe(10);
  });
});
