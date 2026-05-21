import palette from '../../utils/colors.js';

/**
 * UrgentCareIcon — red first-aid cross used everywhere a patient is flagged
 * `requires_urgent_care`. Inline SVG so it lines up with text without an asset
 * round-trip.
 *
 * Props:
 *   size   px width (default 14)
 *   title  hover / accessible label (default "Urgent care required")
 *   muted  render in a muted grey state — for "click to toggle" affordances
 */
export default function UrgentCareIcon({ size = 14, title = 'Urgent care required', muted = false }) {
  const color = muted ? 'currentColor' : palette.primaryMagenta.hex;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      role="img"
      aria-label={title}
      fill="none"
      style={{ display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
    >
      <title>{title}</title>
      <rect x="0.6" y="0.6" width="14.8" height="14.8" rx="2.4" stroke={color} strokeWidth="1.2" fill={muted ? 'transparent' : color} fillOpacity={muted ? 0 : 1} />
      <path
        d="M8 4v8M4 8h8"
        stroke={muted ? color : '#fff'}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
