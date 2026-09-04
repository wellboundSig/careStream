import palette, { hexToRgba, hexOnWhite } from '../../utils/colors.js';
import { isSocCompletedReferral, isActiveClinicalHandoff, isFullyFinishedReferral } from '../../data/stageConfig.js';

// Color tokens — each stage has a solid-tint background + colored text.
// Conflict and Hold are deliberately distinct: Conflict is magenta (urgent problem),
// Hold is amber (paused — different urgency). Admin Confirmation uses deep plum
// (approval gate) so it doesn't collide with the yellow Hold/Disenrollment group.
const STAGE_COLORS = {
  'Clinical Lead Pre-Check':   { bg: hexOnWhite(palette.primaryDeepPlum.hex, 0.12),   text: palette.primaryDeepPlum.hex },
  'Lead Entry':                { bg: hexOnWhite(palette.accentBlue.hex, 0.12),        text: palette.accentBlue.hex },
  'Intake':                    { bg: hexOnWhite(palette.accentBlue.hex, 0.12),        text: palette.accentBlue.hex },
  'Eligibility Verification':  { bg: hexOnWhite(palette.accentOrange.hex, 0.14),      text: palette.accentOrange.hex },
  'Disenrollment Required':    { bg: hexOnWhite(palette.accentOrange.hex, 0.14),      text: palette.accentOrange.hex },
  'F2F/MD Orders Pending':     { bg: hexOnWhite(palette.accentOrange.hex, 0.14),      text: palette.accentOrange.hex },
  'Clinical Intake RN Review': { bg: hexOnWhite(palette.primaryMagenta.hex, 0.13),    text: palette.primaryMagenta.hex },
  'Authorization Pending':     { bg: hexOnWhite(palette.accentOrange.hex, 0.14),      text: palette.accentOrange.hex },
  'Conflict':                  { bg: hexOnWhite(palette.primaryMagenta.hex, 0.22),    text: palette.primaryMagenta.hex },
  'EMR Onboarding':            { bg: hexOnWhite(palette.accentGreen.hex, 0.16),       text: palette.accentGreen.hex },
  'Staffing Feasibility':      { bg: hexOnWhite(palette.accentBlue.hex, 0.12),        text: palette.accentBlue.hex },
  'Admin Confirmation':        { bg: hexOnWhite(palette.primaryDeepPlum.hex, 0.13),   text: palette.primaryDeepPlum.hex },
  'Pre-SOC':                   { bg: hexOnWhite(palette.accentGreen.hex, 0.13),       text: palette.accentGreen.hex },
  'SOC Scheduled':             { bg: hexOnWhite(palette.accentGreen.hex, 0.18),       text: palette.accentGreen.hex },
  'SOC Completed':             { bg: hexOnWhite(palette.accentGreen.hex, 0.26),       text: palette.accentGreen.hex },
  'Post Visit Intake':         { bg: hexOnWhite(palette.accentBlue.hex, 0.18),        text: palette.accentBlue.hex },
  'Post Visit Clinical Review': { bg: hexOnWhite(palette.accentBlue.hex, 0.18),       text: palette.primaryMagenta.hex },
  'Completed':                 { bg: hexOnWhite(palette.accentGreen.hex, 0.3),        text: palette.accentGreen.hex },
  'Hold':                      { bg: hexOnWhite(palette.highlightYellow.hex, 0.3),    text: '#6B4F00' },
  'NTUC':                      { bg: hexOnWhite(palette.backgroundDark.hex, 0.1),     text: hexToRgba(palette.backgroundDark.hex, 0.5) },
};

// Shortened display labels — full name always surfaced via the title tooltip.
const STAGE_SHORT = {
  'Clinical Lead Pre-Check':   'Lead Pre-Check',
  'Lead Entry':                'Lead Entry',
  'Intake':                    'Intake',
  'Eligibility Verification':  'Eligibility',
  'Disenrollment Required':    'Disenrollment',
  'F2F/MD Orders Pending':     'F2F / MD Orders',
  'Clinical Intake RN Review': 'Clinical Review',
  'Authorization Pending':     'Auth Pending',
  'Conflict':                  'Conflict',
  'EMR Onboarding':            'EMR Onboarding',
  'Staffing Feasibility':      'Staffing',
  'Admin Confirmation':        'Admin Confirm',
  'Pre-SOC':                   'Pre-SOC/ROC',
  'SOC Scheduled':             'SOC/ROC Sched',
  'SOC Completed':             'Visit Done',
  'Post Visit Intake':         'Post Visit Intake',
  'Post Visit Clinical Review': 'Clinical Review Post Visit',
  'Completed':                 'Completed',
  'Hold':                      'Hold',
  'NTUC':                      'NTUC',
};

const DEFAULT_COLOR = {
  bg: hexOnWhite(palette.backgroundDark.hex, 0.1),
  text: hexToRgba(palette.backgroundDark.hex, 0.55),
};

export function stageShortName(stage) {
  return STAGE_SHORT[stage] || stage || '';
}

const INTAKE_QUEUE_STAGES = new Set([
  'Intake',
  'F2F/MD Orders Pending',
  'EMR Onboarding',
  'Post Visit Intake',
]);

/**
 * UI-only stage label. DB `current_stage` is unchanged so older clients
 * keep seeing the stored name.
 */
export function displayStageName(referral, fallbackStage) {
  const stage = referral?.current_stage || fallbackStage || '';
  if (stage === 'Completed' || isFullyFinishedReferral(referral)) return 'Completed';

  const visitDone = referral ? isSocCompletedReferral(referral) : false;

  if (visitDone && isActiveClinicalHandoff(referral)) return 'Clinical Review Post Visit';
  if (visitDone && (INTAKE_QUEUE_STAGES.has(stage) || stage === 'SOC Completed')) {
    return 'Intake Post Visit';
  }
  if (stage === 'Post Visit Intake') return 'Intake Post Visit';
  if (stage === 'Post Visit Clinical Review') return 'Clinical Review Post Visit';
  return STAGE_SHORT[stage] || stage || '';
}

function colorKeyForLabel(label, stage) {
  if (label === 'Intake Post Visit') return 'Intake';
  if (label === 'Clinical Review Post Visit') return 'Clinical Intake RN Review';
  return stage;
}

export default function StageBadge({ stage, referral, size = 'default' }) {
  const label = displayStageName(referral, stage) || 'Unknown';
  const config = STAGE_COLORS[colorKeyForLabel(label, referral?.current_stage || stage)] || DEFAULT_COLOR;
  const isSmall = size === 'small';

  return (
    <span
      title={label}
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
        maxWidth: isSmall ? 210 : 230,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {label}
    </span>
  );
}
