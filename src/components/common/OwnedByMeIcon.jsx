import palette from '../../utils/colors.js';

/**
 * Tiny star shown next to patients the current user owns (intake_owner_id).
 */
export default function OwnedByMeIcon({ size = 11, title = 'You own this case' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={palette.primaryMagenta.hex}
      aria-label={title}
      title={title}
      style={{ flexShrink: 0, display: 'Owned by you' }}
    >
      <path d="M12 2.5l2.9 6.1 6.6.7-5 4.5 1.4 6.5L12 16.8 6.1 20.3l1.4-6.5-5-4.5 6.6-.7L12 2.5z" />
    </svg>
  );
}
