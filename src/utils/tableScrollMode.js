export const TABLE_SCROLL_FULL = 'full';
export const TABLE_SCROLL_LOCKED = 'locked';

export function isLockedTableScroll(prefs) {
  return (prefs?.tableScrollMode || TABLE_SCROLL_FULL) === TABLE_SCROLL_LOCKED;
}

/** How many fixed row slots fit under the header in a viewport. */
export function flipSlotCount(viewportHeight, headerHeight, rowHeight) {
  const body = Math.max(0, Number(viewportHeight) - Number(headerHeight));
  const rh = Math.max(1, Number(rowHeight) || 1);
  return Math.max(1, Math.floor(body / rh));
}

export function flipMaxStart(total, slotCount) {
  return Math.max(0, Number(total) - Number(slotCount));
}

export function nextFlipStart(start, deltaRows, maxStart) {
  return Math.max(0, Math.min(Number(maxStart), Number(start) + Number(deltaRows)));
}

export function lockedGridClass(locked) {
  return locked ? 'data-grid table-flip-rows' : 'data-grid';
}

/** @deprecated Freeze-column helper — locked mode is flip-window, not sticky cols. */
export function lockColClass() {
  return undefined;
}
