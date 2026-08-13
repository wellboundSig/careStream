import palette, { hexToRgba } from '../../utils/colors.js';

/**
 * Small subtitle under a patient name in list rows:
 * "Clinical review in progress by {nurse}". Pair with
 * useClinicalReviewInProgress() — pass the resolved starter name.
 */
export default function ClinicalReviewByline({ name, compact = false }) {
  if (!name) return null;
  const ink = hexToRgba(palette.backgroundDark.hex, 0.72);
  return (
    <span
      title={`Clinical review in progress by ${name}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: compact ? 4 : 5,
        marginTop: compact ? 0 : 2,
        flexShrink: 0,
        fontSize: compact ? 10 : 10.5,
        fontWeight: 600,
        color: ink,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        maxWidth: compact ? 160 : '100%',
      }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {compact ? `In review · ${name}` : `Clinical review in progress by ${name}`}
      </span>
      <span
        aria-hidden
        style={{
          display: 'inline-flex',
          alignItems: 'flex-end',
          gap: 2.5,
          height: 10,
          flexShrink: 0,
          marginLeft: 1,
        }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: 3,
              height: 3,
              borderRadius: '50%',
              background: ink,
              animation: 'crInProgressBounce 1.05s ease-in-out infinite',
              animationDelay: `${i * 0.16}s`,
            }}
          />
        ))}
      </span>
      <style>{`
        @keyframes crInProgressBounce {
          0%, 70%, 100% { transform: translateY(0); opacity: 0.45; }
          35% { transform: translateY(-3.5px); opacity: 1; }
        }
      `}</style>
    </span>
  );
}
