import palette from '../../utils/colors.js';

/**
 * Compact shield/check icon for rows where authorization has been obtained.
 * Hover title carries the obtained date (passed by the caller).
 */
export default function AuthObtainedIcon({ size = 13, title = 'Authorization obtained', muted = false }) {
  const color = muted ? 'rgba(0,0,0,0.28)' : palette.accentGreen.hex;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      role="img"
      aria-label={title}
      title={title}
      style={{ flexShrink: 0, display: 'block' }}
    >
      <path
        d="M12 3l7 3v6c0 4.5-2.8 7.6-7 9-4.2-1.4-7-4.5-7-9V6l7-3z"
        stroke={color}
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M9 12l2 2 4-4"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
