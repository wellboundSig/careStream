import palette, { hexToRgba } from '../../utils/colors.js';

/** Discrete-row scrollbar for flip-window tables (grid stays put). */
export default function FlipScrollBar({ start, maxStart, slotCount, total, headerHeight = 38, onChange }) {
  if (maxStart <= 0 || total <= slotCount) return null;
  const trackable = 1 - slotCount / total;
  const thumbPct = Math.max(12, (slotCount / total) * 100);
  const topPct = trackable <= 0 ? 0 : (start / maxStart) * (100 - thumbPct);

  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        top: headerHeight,
        right: 2,
        bottom: 4,
        width: 8,
        borderRadius: 4,
        background: hexToRgba(palette.backgroundDark.hex, 0.08),
        zIndex: 5,
      }}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const y = (e.clientY - rect.top) / rect.height;
        onChange(Math.round(y * maxStart));
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 1,
          right: 1,
          top: `${topPct}%`,
          height: `${thumbPct}%`,
          borderRadius: 4,
          background: hexToRgba(palette.backgroundDark.hex, 0.28),
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
