import palette, { hexToRgba } from '../../utils/colors.js';

/**
 * Small subtitle under a patient name in list rows:
 * "Clinical review in progress by {nurse}". Pair with
 * useClinicalReviewInProgress() — pass the resolved starter name.
 */
export default function ClinicalReviewByline({ name }) {
  if (!name) return null;
  return (
    <span
      title={`Clinical review in progress by ${name}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        marginTop: 2,
        fontSize: 10.5,
        fontWeight: 600,
        color: palette.accentBlue.hex,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        maxWidth: '100%',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 5,
          height: 5,
          borderRadius: '50%',
          background: palette.accentBlue.hex,
          boxShadow: `0 0 0 2.5px ${hexToRgba(palette.accentBlue.hex, 0.18)}`,
          flexShrink: 0,
        }}
      />
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
        Clinical review in progress by {name}
      </span>
    </span>
  );
}
