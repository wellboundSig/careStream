import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flipMaxStart, flipSlotCount, nextFlipStart } from '../utils/tableScrollMode';

const PIXEL_PER_ROW = 48;

/**
 * Fixed row slots. The grid does not translate — records swap in place as
 * the window start index changes (Excel "data jump" scroll).
 */
export function useFlipWindow(items, enabled, { rowHeight = 44, headerHeight = 38 } = {}) {
  const viewportRef = useRef(null);
  const accumRef = useRef(0);
  const [start, setStart] = useState(0);
  const [slotCount, setSlotCount] = useState(12);

  const total = items.length;
  const listKey = `${total}:${items[0]?._id ?? items[0]?.id ?? ''}`;
  const maxStart = flipMaxStart(total, slotCount);
  const startIndex = Math.min(start, maxStart);
  const windowItems = enabled ? items.slice(startIndex, startIndex + slotCount) : items;

  useLayoutEffect(() => {
    if (!enabled) return undefined;
    const el = viewportRef.current;
    if (!el) return undefined;
    const measure = () => {
      setSlotCount(flipSlotCount(el.clientHeight, headerHeight, rowHeight));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [enabled, headerHeight, rowHeight, total]);

  useEffect(() => {
    setStart((s) => Math.min(s, maxStart));
  }, [maxStart]);

  const prevListKey = useRef(listKey);
  useEffect(() => {
    if (prevListKey.current === listKey) return;
    prevListKey.current = listKey;
    setStart(0);
  }, [listKey]);

  const move = useCallback((deltaRows) => {
    setStart((s) => nextFlipStart(s, deltaRows, maxStart));
  }, [maxStart]);

  useEffect(() => {
    if (!enabled) return undefined;
    const el = viewportRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      if (e.deltaMode === 1) {
        move(e.deltaY > 0 ? Math.max(1, Math.round(e.deltaY)) : Math.min(-1, Math.round(e.deltaY)));
        return;
      }
      accumRef.current += e.deltaY;
      while (accumRef.current >= PIXEL_PER_ROW) {
        move(1);
        accumRef.current -= PIXEL_PER_ROW;
      }
      while (accumRef.current <= -PIXEL_PER_ROW) {
        move(-1);
        accumRef.current += PIXEL_PER_ROW;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [enabled, move, total]);

  const onKeyDown = useCallback((e) => {
    if (!enabled) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'PageDown') { e.preventDefault(); move(slotCount); }
    else if (e.key === 'PageUp') { e.preventDefault(); move(-slotCount); }
    else if (e.key === 'Home') { e.preventDefault(); setStart(0); }
    else if (e.key === 'End') { e.preventDefault(); setStart(maxStart); }
  }, [enabled, maxStart, move, slotCount]);

  return {
    viewportRef,
    windowItems,
    startIndex,
    slotCount,
    maxStart,
    total,
    setStart,
    onKeyDown,
    enabled,
  };
}
