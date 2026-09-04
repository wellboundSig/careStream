/**
 * Quiet episode marker — SOC (start) yellow · ROC (continue) blue.
 * No borders. Tiny by default.
 */
import palette, { hexToRgba, hexOnWhite } from '../../utils/colors.js';
import { normalizeEpisodeType } from '../../utils/episodeType.js';

/** Planted flag — beginning of care. */
function SocIcon({ size = 10 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M4.5 2.5v11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M4.5 3.25h6.25L9.4 5.75l1.35 2.5H4.5V3.25Z" fill="currentColor" />
    </svg>
  );
}

/** Cycle — care resumed / continuing. */
function RocIcon({ size = 10 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M12.25 8a4.25 4.25 0 1 1-1.25-3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M12.25 3.5v3h-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const STYLES = {
  SOC: {
    bg: hexOnWhite(palette.highlightYellow.hex, 0.22),
    text: '#8A6A00',
    Icon: SocIcon,
    title: 'Start of Care',
  },
  ROC: {
    bg: hexOnWhite(palette.accentBlue.hex, 0.12),
    text: palette.accentBlue.hex,
    Icon: RocIcon,
    title: 'Resumption of Care',
  },
};

export default function EpisodeTypeBadge({ episodeType, referral, size = 'tiny' }) {
  const type = normalizeEpisodeType(episodeType ?? referral);
  const config = STYLES[type] || STYLES.SOC;
  const Icon = config.Icon;
  const isTiny = size === 'tiny' || size === 'small';

  return (
    <span
      title={config.title}
      data-testid={`episode-type-${type.toLowerCase()}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        padding: isTiny ? '1px 5px 1px 4px' : '2px 7px 2px 6px',
        borderRadius: 4,
        fontSize: isTiny ? 9.5 : 10.5,
        fontWeight: 700,
        letterSpacing: '0.03em',
        textTransform: 'uppercase',
        background: config.bg,
        color: config.text,
        whiteSpace: 'nowrap',
        lineHeight: 1.2,
        flexShrink: 0,
      }}
    >
      <Icon size={isTiny ? 9 : 10} />
      {type}
    </span>
  );
}
