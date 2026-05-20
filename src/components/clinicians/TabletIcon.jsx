import palette, { hexToRgba } from '../../utils/colors.js';

// A small inline-SVG tablet icon that doubles as a status pip. The screen
// portion is tinted based on online/offline state, and an optional battery
// bar runs along the bottom. Sized so it lines up nicely with 13-14px text.
//
// Props:
//   online    boolean   green halo when truthy, dim otherwise
//   battery   0..100    if provided, paints a battery sliver along the bottom
//   size      number    pixel width (default 18)
//   title     string    accessible / hover tooltip
export default function TabletIcon({ online = false, battery = null, size = 18, title }) {
  const stroke = online
    ? palette.accentGreen.hex
    : hexToRgba(palette.backgroundDark.hex, 0.35);
  const screen = online
    ? hexToRgba(palette.accentGreen.hex, 0.15)
    : hexToRgba(palette.backgroundDark.hex, 0.05);

  const hasBattery = typeof battery === 'number' && battery >= 0 && battery <= 100;
  const batteryColor = battery == null
    ? hexToRgba(palette.backgroundDark.hex, 0.25)
    : battery <= 15 ? palette.primaryMagenta.hex
    : battery <= 35 ? palette.accentOrange.hex
    : palette.accentGreen.hex;

  return (
    <svg
      width={size}
      height={Math.round(size * 1.35)}
      viewBox="0 0 18 24"
      fill="none"
      role="img"
      aria-label={title || (online ? 'Tablet online' : 'Tablet offline')}
    >
      <title>{title || (online ? 'Tablet online' : 'Tablet offline')}</title>
      <rect x="1" y="1" width="16" height="22" rx="2.4" stroke={stroke} strokeWidth="1.4" fill={screen} />
      <rect x="3" y="3.2" width="12" height="15.6" rx="0.8" fill={online ? hexToRgba(palette.accentGreen.hex, 0.08) : 'transparent'} />
      <circle cx="9" cy="21" r="0.8" fill={stroke} />
      {hasBattery && (
        <rect
          x="3"
          y="18.5"
          width={Math.max(0.5, (battery / 100) * 12)}
          height="0.7"
          rx="0.35"
          fill={batteryColor}
        />
      )}
    </svg>
  );
}
