import palette, { hexToRgba } from '../../utils/colors.js';

const DIVISIONS = {
  ALF: {
    label: 'ALF',
    bg: hexToRgba(palette.highlightYellow.hex, 0.28),
    text: palette.highlightYellow.hex,
  },
  'Special Needs': {
    label: 'SPN',
    bg: hexToRgba(palette.primaryMagenta.hex, 0.28),
    text: palette.primaryMagenta.hex,
  },
};

export default function DivisionBadge({ division, size = 'default' }) {
  const config = DIVISIONS[division] || DIVISIONS['ALF'];
  const isSmall = size === 'small';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: isSmall ? '2px 7px' : '3px 9px',
        borderRadius: 20,
        fontSize: isSmall ? 11 : 12,
        fontWeight: 600,
        letterSpacing: '0.02em',
        background: config.bg,
        color: config.text,
        whiteSpace: 'nowrap',
      }}
    >
      {config.label}
    </span>
  );
}
