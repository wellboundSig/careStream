import palette, { hexToRgba } from '../../utils/colors.js';

// Color tokens — each stage has a solid-tint background + colored text.
// Conflict and Hold are deliberately distinct: Conflict is magenta (urgent problem),
// Hold is amber (paused — different urgency). Admin Confirmation uses deep plum
// (approval gate) so it doesn't collide with the yellow Hold/Disenrollment group.
const STAGE_COLORS = {
  'Lead Entry':                { bg: hexToRgba(palette.accentBlue.hex, 0.12),        text: palette.accentBlue.hex },
  'Intake':                    { bg: hexToRgba(palette.accentBlue.hex, 0.12),        text: palette.accentBlue.hex },
  'Eligibility Verification':  { bg: hexToRgba(palette.accentOrange.hex, 0.14),      text: palette.accentOrange.hex },
  'Disenrollment Required':    { bg: hexToRgba(palette.accentOrange.hex, 0.14),      text: palette.accentOrange.hex },
  'F2F/MD Orders Pending':     { bg: hexToRgba(palette.accentOrange.hex, 0.14),      text: palette.accentOrange.hex },
  'Clinical Intake RN Review': { bg: hexToRgba(palette.primaryMagenta.hex, 0.13),    text: palette.primaryMagenta.hex },
  'Authorization Pending':     { bg: hexToRgba(palette.accentOrange.hex, 0.14),      text: palette.accentOrange.hex },
  'Conflict':                  { bg: hexToRgba(palette.primaryMagenta.hex, 0.22),    text: palette.primaryMagenta.hex },
  'Staffing Feasibility':      { bg: hexToRgba(palette.accentBlue.hex, 0.12),        text: palette.accentBlue.hex },
  'Admin Confirmation':        { bg: hexToRgba(palette.primaryDeepPlum.hex, 0.13),   text: palette.primaryDeepPlum.hex },
  'Pre-SOC':                   { bg: hexToRgba(palette.accentGreen.hex, 0.13),       text: palette.accentGreen.hex },
  'SOC Scheduled':             { bg: hexToRgba(palette.accentGreen.hex, 0.18),       text: palette.accentGreen.hex },
  'SOC Completed':             { bg: hexToRgba(palette.accentGreen.hex, 0.26),       text: palette.accentGreen.hex },
  'Hold':                      { bg: hexToRgba(palette.highlightYellow.hex, 0.3),    text: '#6B4F00' },
  'NTUC':                      { bg: hexToRgba(palette.backgroundDark.hex, 0.1),     text: hexToRgba(palette.backgroundDark.hex, 0.5) },
};

// Shortened display labels — full name always surfaced via the title tooltip.
const STAGE_SHORT = {
  'Lead Entry':                'Lead Entry',
  'Intake':                    'Intake',
  'Eligibility Verification':  'Eligibility',
  'Disenrollment Required':    'Disenrollment',
  'F2F/MD Orders Pending':     'F2F / MD Orders',
  'Clinical Intake RN Review': 'Clinical Intake',
  'Authorization Pending':     'Auth Pending',
  'Conflict':                  'Conflict',
  'Staffing Feasibility':      'Staffing',
  'Admin Confirmation':        'Admin Confirm',
  'Pre-SOC':                   'Pre-SOC',
  'SOC Scheduled':             'SOC Scheduled',
  'SOC Completed':             'SOC Completed',
  'Hold':                      'Hold',
  'NTUC':                      'NTUC',
};

const DEFAULT_COLOR = {
  bg:   hexToRgba(palette.backgroundDark.hex, 0.1),
  text: hexToRgba(palette.backgroundDark.hex, 0.55),
};

export default function StageBadge({ stage, size = 'default' }) {
  const config = STAGE_COLORS[stage] || DEFAULT_COLOR;
  const isSmall = size === 'small';
  const label = STAGE_SHORT[stage] || stage || 'Unknown';

  return (
    <span
      title={stage}
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
        maxWidth: isSmall ? 130 : 160,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {label}
    </span>
  );
}
