import palette from '../../utils/colors.js';

/**
 * Flag on leads Clinical already signed off (Mark Viable). Distinct from the
 * magenta owned-by-me star.
 */
export default function ClinicalPreCheckApprovedIcon({
  size = 11,
  title = 'Clinical pre-check approved',
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-label={title}
      title={title}
      style={{ flexShrink: 0, display: 'block' }}
    >
      <path
        d="M5 3.5v17"
        fill="none"
        stroke={palette.accentGreen.hex}
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M6.2 4.2h10.6c.7 0 1.1.8.7 1.4L15.2 10l2.3 4.4c.4.6 0 1.4-.7 1.4H6.2V4.2z"
        fill={palette.accentGreen.hex}
      />
    </svg>
  );
}
