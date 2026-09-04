import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { KeepAliveActiveContext } from '../context/pageOutletContext.jsx';

/** First paint: enough rows to fill a screen without committing the whole census. */
export const LIST_INITIAL = 15;
/** Prefetch window: load the *next* page before the user reaches the last painted row. */
export const LIST_PAGE = 30;
/** Pause with no scroll/click/keys → background-fill the rest in page-sized chunks. */
export const LIST_IDLE_MS = 5000;
/** Start the next page before those rows enter the viewport. */
export const LIST_PREFETCH_MARGIN = '320px 0px';

function scheduleIdle(fn) {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(fn, { timeout: 250 });
    return () => cancelIdleCallback(id);
  }
  const t = setTimeout(fn, 0);
  return () => clearTimeout(t);
}

/**
 * Instagram-style list window over an already-hydrated array.
 * Does not fetch — it limits how many React nodes we commit.
 *
 * - Start at 15.
 * - When the sentinel nears the viewport, paint the next 30 (not the visible ones).
 * - After 5s of no scroll/click/keys, attach the remainder in idle chunks.
 */
export function useProgressiveReveal(items, {
  initial = LIST_INITIAL,
  page = LIST_PAGE,
  idleMs = LIST_IDLE_MS,
  enabled = true,
  resetKey = '',
  rootRef = null,
} = {}) {
  const active = useContext(KeepAliveActiveContext);
  const list = Array.isArray(items) ? items : [];
  const total = list.length;

  const [limit, setLimit] = useState(() => (enabled ? Math.min(initial, total) : total));
  const sentinelRef = useRef(null);
  const limitRef = useRef(limit);
  const totalRef = useRef(total);
  const prevTotalRef = useRef(total);
  const prevResetRef = useRef(resetKey);
  limitRef.current = limit;
  totalRef.current = total;

  useEffect(() => {
    if (prevResetRef.current === resetKey) return;
    prevResetRef.current = resetKey;
    if (!enabled) return;
    setLimit(Math.min(initial, totalRef.current));
  }, [resetKey, enabled, initial]);

  useEffect(() => {
    if (!enabled) {
      setLimit(total);
      prevTotalRef.current = total;
      return;
    }
    const prev = prevTotalRef.current;
    const wasFullyShown = limitRef.current >= prev;
    prevTotalRef.current = total;
    if (wasFullyShown && total > prev) setLimit(total);
    else if (total < limitRef.current) setLimit(total);
  }, [total, enabled]);

  const revealMore = useCallback(() => {
    if (!enabled) return;
    setLimit((n) => {
      const next = Math.min(totalRef.current, n + page);
      limitRef.current = next;
      return next;
    });
  }, [enabled, page]);

  useEffect(() => {
    if (!enabled || active === false) return undefined;
    if (limit >= total) return undefined;
    if (typeof IntersectionObserver !== 'function') return undefined;
    const node = sentinelRef.current;
    if (!node) return undefined;
    const root = rootRef?.current ?? null;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) revealMore();
      },
      { root, rootMargin: LIST_PREFETCH_MARGIN, threshold: 0 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [enabled, active, limit, total, revealMore, rootRef]);

  useEffect(() => {
    if (!enabled || active === false) return undefined;

    let cancelled = false;
    let stopChunk = () => {};
    let interactTimer;

    const fillChunk = () => {
      if (cancelled) return;
      const n = limitRef.current;
      if (n >= totalRef.current) return;
      const next = Math.min(totalRef.current, n + page);
      limitRef.current = next;
      setLimit(next);
      if (next < totalRef.current) {
        stopChunk();
        stopChunk = scheduleIdle(fillChunk);
      }
    };

    const armIdle = () => {
      clearTimeout(interactTimer);
      interactTimer = setTimeout(() => {
        stopChunk();
        stopChunk = scheduleIdle(fillChunk);
      }, idleMs);
    };

    const onBusy = () => {
      stopChunk();
      armIdle();
    };

    armIdle();
    window.addEventListener('scroll', onBusy, true);
    window.addEventListener('keydown', onBusy, true);
    window.addEventListener('pointerdown', onBusy, true);
    window.addEventListener('wheel', onBusy, { capture: true, passive: true });

    return () => {
      cancelled = true;
      clearTimeout(interactTimer);
      stopChunk();
      window.removeEventListener('scroll', onBusy, true);
      window.removeEventListener('keydown', onBusy, true);
      window.removeEventListener('pointerdown', onBusy, true);
      window.removeEventListener('wheel', onBusy, true);
    };
  }, [enabled, active, idleMs, page, resetKey]);

  const capped = enabled ? Math.min(limit, total) : total;
  const visible = enabled ? list.slice(0, capped) : list;

  return {
    visible,
    limit: capped,
    total,
    hasMore: enabled && capped < total,
    sentinelRef,
    revealMore,
  };
}
