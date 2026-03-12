import palette, { hexToRgba } from '../utils/colors.js';

// ── Stage slug mapping ────────────────────────────────────────────────────────
export const STAGE_SLUGS = {
  'Lead Entry':                'lead-entry',
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
    stages: ['Lead Entry', 'Intake', 'Eligibility Verification', 'Disenrollment Required', 'F2F/MD Orders Pending'],
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
    stages: ['Staffing Feasibility', 'Pre-SOC', 'SOC Scheduled', 'SOC Completed'],
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
    description: 'New referral submissions',
    isGlobal: false,
    isTerminal: false,
    color: palette.accentBlue.hex,
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
    description: 'Final review',
    isGlobal: false,
    isTerminal: false,
    color: palette.primaryDeepPlum.hex,
    protected: true,
  },
  'Pre-SOC': {
    description: 'Case accepted — preparing and scheduling start of care',
    isGlobal: false,
    isTerminal: false,
    color: palette.accentGreen.hex,
  },
  'SOC Scheduled': {
    description: 'Start of care visit officially scheduled',
    isGlobal: false,
    isTerminal: false,
    color: palette.accentGreen.hex,
  },
  'SOC Completed': {
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
