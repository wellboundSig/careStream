import palette, { hexToRgba } from '../../utils/colors.js';

// On dark backgrounds (e.g. patient drawer header) the bg tint is subtle;
// the colored text carries the readability. Borders removed sitewide.
const STAGE_COLORS = {
  'Lead Entry':                { bg: hexToRgba(palette.accentBlue.hex, 0.2),         text: palette.accentBlue.hex },
  'Intake':                    { bg: hexToRgba(palette.accentBlue.hex, 0.2),         text: palette.accentBlue.hex },
  'Eligibility Verification':  { bg: hexToRgba(palette.accentOrange.hex, 0.18),      text: palette.accentOrange.hex },
  'Disenrollment Required':    { bg: hexToRgba(palette.highlightYellow.hex, 0.22),   text: '#7A5F00' },
  'F2F/MD Orders Pending':     { bg: hexToRgba(palette.accentOrange.hex, 0.18),      text: palette.accentOrange.hex },
  'Clinical Intake RN Review': { bg: hexToRgba(palette.primaryMagenta.hex, 0.18),    text: palette.primaryMagenta.hex },
  'Authorization Pending':     { bg: hexToRgba(palette.accentOrange.hex, 0.18),      text: palette.accentOrange.hex },
  'Conflict':                  { bg: hexToRgba(palette.primaryMagenta.hex, 0.18),    text: palette.primaryMagenta.hex },
  'Staffing Feasibility':      { bg: hexToRgba(palette.accentBlue.hex, 0.18),        text: palette.accentBlue.hex },
  'Admin Confirmation':        { bg: hexToRgba(palette.highlightYellow.hex, 0.22),   text: '#7A5F00' },
  'Pre-SOC':                   { bg: hexToRgba(palette.accentGreen.hex, 0.18),       text: palette.accentGreen.hex },
  'SOC Scheduled':             { bg: hexToRgba(palette.accentGreen.hex, 0.22),       text: palette.accentGreen.hex },
  'SOC Completed':             { bg: hexToRgba(palette.accentGreen.hex, 0.28),       text: palette.accentGreen.hex },
  'Hold':                      { bg: hexToRgba(palette.highlightYellow.hex, 0.22),   text: '#7A5F00' },
  'NTUC':                      { bg: hexToRgba(palette.backgroundDark.hex, 0.12),    text: hexToRgba(palette.backgroundDark.hex, 0.55) },
};

const DEFAULT_COLOR = {
  bg: hexToRgba(palette.backgroundDark.hex, 0.1),
  text: hexToRgba(palette.backgroundDark.hex, 0.55),
};

export default function StageBadge({ stage, size = 'default' }) {
  const config = STAGE_COLORS[stage] || DEFAULT_COLOR;
  const isSmall = size === 'small';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: isSmall ? '2px 8px' : '3px 10px',
        borderRadius: 20,
        fontSize: isSmall ? 11 : 12,
        fontWeight: 600,
        background: config.bg,
        color: config.text,
        whiteSpace: 'nowrap',
      }}
    >
      {stage || 'Unknown'}
    </span>
  );
}
