/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  LIST_INITIAL,
  LIST_PAGE,
  LIST_IDLE_MS,
  useProgressiveReveal,
} from '../useProgressiveReveal.js';

function makeItems(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i}` }));
}

describe('useProgressiveReveal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.requestIdleCallback = (fn) => setTimeout(fn, 0);
    globalThis.cancelIdleCallback = (id) => clearTimeout(id);
    globalThis.IntersectionObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('paints 15 rows on first render', () => {
    const { result } = renderHook(() => useProgressiveReveal(makeItems(100)));
    expect(result.current.visible).toHaveLength(LIST_INITIAL);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.total).toBe(100);
  });

  it('prefetch paints the next 30, not only the row that just scrolled into view', () => {
    const { result } = renderHook(() => useProgressiveReveal(makeItems(100)));
    act(() => result.current.revealMore());
    expect(result.current.visible).toHaveLength(LIST_INITIAL + LIST_PAGE);
  });

  it('after 5s idle, background-fills the rest in page-sized chunks', () => {
    const { result } = renderHook(() => useProgressiveReveal(makeItems(100)));
    act(() => { vi.advanceTimersByTime(LIST_IDLE_MS); });
    act(() => { vi.runAllTimers(); });
    expect(result.current.visible).toHaveLength(100);
    expect(result.current.hasMore).toBe(false);
  });

  it('resets to 15 when filters change', () => {
    const { result, rerender } = renderHook(
      ({ key, items }) => useProgressiveReveal(items, { resetKey: key }),
      { initialProps: { key: 'a', items: makeItems(80) } },
    );
    act(() => result.current.revealMore());
    expect(result.current.visible.length).toBe(LIST_INITIAL + LIST_PAGE);
    rerender({ key: 'b', items: makeItems(80) });
    expect(result.current.visible).toHaveLength(LIST_INITIAL);
  });

  it('shows the full list when windowing is disabled', () => {
    const items = makeItems(40);
    const { result } = renderHook(() => useProgressiveReveal(items, { enabled: false }));
    expect(result.current.visible).toHaveLength(40);
    expect(result.current.hasMore).toBe(false);
  });

  it('keeps a fully revealed list in sync when a row is added', () => {
    const { result, rerender } = renderHook(
      ({ items }) => useProgressiveReveal(items),
      { initialProps: { items: makeItems(15) } },
    );
    expect(result.current.visible).toHaveLength(15);
    rerender({ items: makeItems(16) });
    expect(result.current.visible).toHaveLength(16);
  });
});
