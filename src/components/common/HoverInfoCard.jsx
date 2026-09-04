import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import palette, { hexToRgba } from '../../utils/colors.js';

/**
 * Instant custom hover card (replaces slow, tiny native `title` tooltips).
 * Wraps an inline trigger; on hover, renders a small floating card above it
 * via a portal so table overflow / sticky columns can't clip it.
 */
export default function HoverInfoCard({ title, detail, accent = palette.backgroundDark.hex, children }) {
  const [pos, setPos] = useState(null);
  const ref = useRef(null);

  function show() {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left + r.width / 2, y: r.top });
  }

  return (
    <span
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={() => setPos(null)}
      style={{ display: 'inline-flex', alignItems: 'center' }}
    >
      {children}
      {pos && createPortal(
        <div
          role="tooltip"
          style={{
            position: 'fixed',
            left: pos.x,
            top: pos.y - 7,
            transform: 'translate(-50%, -100%)',
            zIndex: 10000,
            pointerEvents: 'none',
            background: palette.backgroundLight.hex,
            border: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.12)}`,
            borderRadius: 9,
            boxShadow: `0 6px 20px ${hexToRgba(palette.backgroundDark.hex, 0.16)}`,
            padding: '7px 11px',
            whiteSpace: 'nowrap',
          }}
        >
          <p style={{ margin: 0, fontSize: 11, fontWeight: 750, letterSpacing: '0.02em', color: accent }}>
            {title}
          </p>
          {detail && (
            <p style={{ margin: '2px 0 0', fontSize: 12.5, fontWeight: 600, color: palette.backgroundDark.hex, fontVariantNumeric: 'tabular-nums' }}>
              {detail}
            </p>
          )}
          <span
            aria-hidden
            style={{
              position: 'absolute',
              left: '50%',
              bottom: -5,
              transform: 'translateX(-50%) rotate(45deg)',
              width: 8,
              height: 8,
              background: palette.backgroundLight.hex,
              borderRight: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.12)}`,
              borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.12)}`,
            }}
          />
        </div>,
        document.body,
      )}
    </span>
  );
}
