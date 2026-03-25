import palette, { hexToRgba } from '../utils/colors.js';

// ── Stage slug mapping ────────────────────────────────────────────────────────
// ── Discard reasons — PLACEHOLDER ────────────────────────────────────────────
// TODO: Replace with final business-approved enum values.
// These are the broad-reason options shown in the Discard Lead dropdown.
export const DISCARD_REASONS = [
  'Duplicate referral',
  'Patient declined services',
  'Out of service area',
  'Insurance not accepted',
  'Incomplete / invalid referral',
  'Referred to another agency',
  'Patient unreachable',
  'Other',
];

// ── Stage slug mapping ────────────────────────────────────────────────────────
export const STAGE_SLUGS = {
  'Lead Entry':                'lead-entry',
  'Discarded Leads':           'discarded-leads',
  'Intake':                    'intake',
  'Eligibility Verification':  'eligibility',
  'Disenrollment Required':    'disenrollment',
  'F2F/MD Orders Pending':     'f2f',
  'Clinical Intake RN Review': 'clinical-rn',
  'Authorization Pending':     'authorization',
  'Conflict':                  'conflict',
  'Staffing Feasibility':      'staffing',
  'Admin Confirmation':        'admin-confirmation',
  'Pre-SOC':                   'pre-soc',
  'SOC Scheduled':             'soc-scheduled',
  'SOC Completed':             'soc-completed',
  'Hold':                      'hold',
  'NTUC':                      'ntuc',
};

export const SLUG_TO_STAGE = Object.fromEntries(
  Object.entries(STAGE_SLUGS).map(([k, v]) => [v, k])
);

export const ALL_STAGES = Object.keys(STAGE_SLUGS);

// ── Role modes ────────────────────────────────────────────────────────────────
export const ROLE_MODES = [
  {
    id: 'intake',
    label: 'Intake',
    color: palette.accentBlue.hex,
    stages: ['Lead Entry', 'Discarded Leads', 'Intake', 'Eligibility Verification', 'Disenrollment Required', 'F2F/MD Orders Pending'],
  },
  {
    id: 'clinical',
    label: 'Clinical RN',
    color: palette.primaryMagenta.hex,
    stages: ['F2F/MD Orders Pending', 'Clinical Intake RN Review', 'Conflict'],
  },
  {
    id: 'authorization',
    label: 'Authorization',
    color: palette.accentOrange.hex,
    stages: ['Eligibility Verification', 'Authorization Pending', 'Conflict'],
  },
  {
    id: 'scheduler',
    label: 'Scheduler',
    color: palette.accentGreen.hex,
    stages: ['Staffing Feasibility', 'Pre-SOC', 'SOC Completed'],
  },
  {
    id: 'admin',
    label: 'Admin',
    color: palette.highlightYellow.hex,
    stages: ['Admin Confirmation', 'Hold', 'NTUC'],
  },
  {
    id: 'all',
    label: 'All Modules',
    color: hexToRgba(palette.backgroundLight.hex, 0.45),
    stages: Object.keys(STAGE_SLUGS),
  },
];

// ── Stage display metadata ────────────────────────────────────────────────────
export const STAGE_META = {
  'Lead Entry': {
    displayName: 'Leads',
    description: 'New referral submissions',
    isGlobal: false,
    isTerminal: false,
    color: palette.accentBlue.hex,
  },
  'Discarded Leads': {
    displayName: 'Discarded',
    description: 'Leads that were reviewed and discarded with a reason',
    isGlobal: false,
    isTerminal: true,
    color: hexToRgba(palette.backgroundDark.hex, 0.35),
  },
  'Intake': {
    description: 'Referrals being processed by intake',
    isGlobal: false,
    isTerminal: false,
    color: palette.accentBlue.hex,
  },
  'Eligibility Verification': {
    description: 'Insurance and episode eligibility check',
    isGlobal: false,
    isTerminal: false,
    color: palette.accentOrange.hex,
  },
  'Disenrollment Required': {
    description: 'Pending disenrollment',
    isGlobal: false,
    isTerminal: false,
    color: palette.highlightYellow.hex,
  },
  'F2F/MD Orders Pending': {
    description: 'Awaiting face-to-face documentation and physician orders',
    isGlobal: false,
    isTerminal: false,
    color: palette.accentOrange.hex,
  },
  'Clinical Intake RN Review': {
    description: 'Skilled need + safety review by clinical RN',
    isGlobal: false,
    isTerminal: false,
    color: palette.primaryMagenta.hex,
    protected: true,
  },
  'Authorization Pending': {
    description: 'Waiting for managed care prior authorization',
    isGlobal: false,
    isTerminal: false,
    color: palette.accentOrange.hex,
  },
  'Conflict': {
    description: 'Regulatory or service overlap conflict requiring resolution',
    isGlobal: false,
    isTerminal: false,
    color: palette.primaryMagenta.hex,
  },
  'Staffing Feasibility': {
    description: 'Clinician availability check — discipline, region, schedule',
    isGlobal: false,
    isTerminal: false,
    color: palette.accentBlue.hex,
  },
  'Admin Confirmation': {
    description: 'Admin review — confirm or deny NTUC. Accept moves to Pre-SOC, decline triggers NTUC.',
    isGlobal: false,
    isTerminal: false,
    color: palette.primaryDeepPlum.hex,
    protected: true,
  },
  'Pre-SOC': {
    description: 'EMR onboarding → SOC scheduling → SOC completion',
    isGlobal: false,
    isTerminal: false,
    color: palette.accentGreen.hex,
    consolidatedStages: ['Pre-SOC', 'SOC Scheduled'],
  },
  'SOC Scheduled': {
    description: 'Start of care visit officially scheduled',
    isGlobal: false,
    isTerminal: false,
    color: palette.accentGreen.hex,
    hiddenFromNav: true,
  },
  'SOC Completed': {
    displayName: 'Completed',
    description: 'SOC performed — patient transferred to HCHB',
    isGlobal: false,
    isTerminal: true,
    color: palette.accentGreen.hex,
  },
  'Hold': {
    description: 'Temporarily paused, awaiting resolution',
    isGlobal: true,
    isTerminal: false,
    color: palette.highlightYellow.hex,
  },
  'NTUC': {
    description: 'Not taken under care',
    isGlobal: true,
    isTerminal: true,
    color: hexToRgba(palette.backgroundDark.hex, 0.4),
  },
};
