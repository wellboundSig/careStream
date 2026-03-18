import palette, { hexToRgba } from '../../utils/colors.js';

// Inject pulse keyframes once
if (typeof document !== 'undefined') {
  const id = 'cs-skeleton-pulse';
  if (!document.getElementById(id)) {
    const el = document.createElement('style');
    el.id = id;
    el.textContent = '@keyframes cs-skeleton-pulse{0%,100%{opacity:1}50%{opacity:.4}}';
    document.head.appendChild(el);
  }
}

const BASE = {
  background: hexToRgba(palette.backgroundDark.hex, 0.07),
  animation: 'cs-skeleton-pulse 1.5s ease-in-out infinite',
};

export function SkeletonLine({ width = '100%', height = 14, style }) {
  return <div style={{ ...BASE, width, height, borderRadius: 4, ...style }} />;
}

export function SkeletonRect({ width = '100%', height = 60, borderRadius = 8, style }) {
  return <div style={{ ...BASE, width, height, borderRadius, ...style }} />;
}

export function SkeletonCircle({ size = 32, style }) {
  return <div style={{ ...BASE, width: size, height: size, borderRadius: '50%', ...style }} />;
}

// Matches the StatCard shape on Dashboard
export function SkeletonStatCard() {
  return (
    <div
      style={{
        background: palette.backgroundLight.hex,
        borderRadius: 12,
        padding: '18px 20px',
        border: '1px solid var(--color-border)',
        borderTop: `3px solid ${hexToRgba(palette.backgroundDark.hex, 0.06)}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <SkeletonLine width={80} height={10} />
      <SkeletonLine width={50} height={28} />
      <SkeletonLine width={110} height={11} />
    </div>
  );
}

// Matches a table row
export function SkeletonTableRow({ columns = 5 }) {
  const widths = [140, 70, 90, 60, 100];
  return (
    <tr style={{ borderBottom: `1px solid ${hexToRgba(palette.backgroundDark.hex, 0.05)}` }}>
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} style={{ padding: '13px 16px' }}>
          <SkeletonLine width={widths[i % widths.length]} height={13} />
        </td>
      ))}
    </tr>
  );
}

// Matches a pipeline stage card
export function SkeletonStageCard() {
  return (
    <div
      style={{
        background: palette.backgroundLight.hex,
        border: '1px solid var(--color-border)',
        borderRadius: 10,
        padding: '14px 16px',
      }}
    >
      <SkeletonLine width={90} height={10} style={{ marginBottom: 10 }} />
      <SkeletonLine width={40} height={24} />
    </div>
  );
}
