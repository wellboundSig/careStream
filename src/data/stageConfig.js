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
  'Intake':                    'intake',
  'Eligibility Verification':  'eligibility',
  'OPWDD Enrollment':          'opwdd-enrollment',
  'Disenrollment Required':    'disenrollment',
  'F2F/MD Orders Pending':     'f2f',
  'Clinical Intake RN Review': 'clinical-rn',
  'Authorization Pending':     'authorization',
  'Conflict':                  'conflict',
  'EMR Onboarding':            'emr-onboarding',
  'Staffing Feasibility':      'staffing',
  'Admin Confirmation':        'admin-confirmation',
  'Pre-SOC':                   'pre-soc',
  'SOC Scheduled':             'soc-scheduled',
  'SOC Completed':             'soc-completed',
  'Hold':                      'hold',
  'NTUC':                      'ntuc',
  'Discarded Leads':           'discarded-leads',
};

export const SLUG_TO_STAGE = Object.fromEntries(
  Object.entries(STAGE_SLUGS).map(([k, v]) => [v, k])
);

export const ALL_STAGES = Object.keys(STAGE_SLUGS);

// ── Role modes (sidebar module groups) ────────────────────────────────────────
// The group pill cycles these lists. Label "Intake Modules" (not "Intake") so
// it is not confused with the Intake stage/module link below it.
export const ROLE_MODES = [
  {
    id: 'intake',
    label: 'Intake Modules',
    color: palette.accentBlue.hex,
    // OPWDD stays with intake but last in the list.
    stages: [
      'Lead Entry',
      'Intake',
      'Disenrollment Required',
      'EMR Onboarding',
      'Pre-SOC',
      'OPWDD Enrollment',
    ],
  },
  {
    id: 'authorization',
    label: 'Authorization',
    color: palette.accentOrange.hex,
    stages: ['Eligibility Verification', 'Authorization Pending'],
  },
  {
    id: 'clinical',
    label: 'Clinical',
    color: palette.primaryMagenta.hex,
    stages: ['Clinical Intake RN Review'],
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
    stages: [
      'Conflict',
      'Discarded Leads',
      'NTUC',
      'SOC Completed',
      'Admin Confirmation',
      'Hold',
    ],
  },
  {
    id: 'all',
    label: 'All Modules',
    color: hexToRgba(palette.backgroundLight.hex, 0.45),
    stages: Object.keys(STAGE_SLUGS),
  },
];

// ── Stage display metadata ────────────────────────────────────────────────────
//
// `matchReferral(r)` is the canonical "is this referral a member of this
// module's view?" predicate. It supersedes `consolidatedStages` for any module
// whose membership depends on flags (Clinical RN, Authorization Pending,
// Disenrollment Required) and lets the simple stages keep their plain
// `current_stage === stage` semantics with no extra plumbing.
//
// `consolidatedStages` is preserved as a back-compat hint for older callers /
// tests; ModulePage prefers `matchReferral` when present.
//
// Auth/Disen activity helpers used below are referenced loosely — the active
// store entries are read inside ModulePage where the data is available; here
// we expose them as named flags on the referral that ModulePage decorates onto
// each row before evaluating the predicate. See `decorateReferralForModule()`
// in ModulePage.jsx.
export const STAGE_META = {
  'Lead Entry': {
    displayName: 'Leads',
    description: 'New referral submissions',
    isGlobal: false,
    isTerminal: false,
    color: palette.accentBlue.hex,
    matchReferral: (r) => r.current_stage === 'Lead Entry',
  },
  'Discarded Leads': {
    displayName: 'Discarded',
    description: 'Leads that were reviewed and discarded with a reason',
    isGlobal: false,
    isTerminal: true,
    color: hexToRgba(palette.backgroundDark.hex, 0.35),
    matchReferral: (r) => r.current_stage === 'Discarded Leads',
  },
  'Intake': {
    description: 'Referrals being processed by intake',
    isGlobal: false,
    isTerminal: false,
    color: palette.accentBlue.hex,
    consolidatedStages: ['Intake', 'F2F/MD Orders Pending'],
    matchReferral: (r) => r.current_stage === 'Intake' || r.current_stage === 'F2F/MD Orders Pending',
  },
  'Eligibility Verification': {
    description: 'Insurance and episode eligibility check. Authorization Pending and Disenrollment Required are concurrent supportive workflows.',
    isGlobal: false,
    isTerminal: false,
    color: palette.accentOrange.hex,
    matchReferral: (r) => r.current_stage === 'Eligibility Verification',
  },
  'Disenrollment Required': {
    description: 'Supportive sub-module of Eligibility. Lists patients with an open Disenrollment Assistance flag (current_stage stays Eligibility).',
    isGlobal: false,
    isTerminal: false,
    color: palette.highlightYellow.hex,
    // Decorated by ModulePage: `_hasOpenDisenrollmentFlag` = boolean
    matchReferral: (r) => r.current_stage === 'Disenrollment Required' || r._hasOpenDisenrollmentFlag === true,
  },
  'F2F/MD Orders Pending': {
    description: 'Awaiting face-to-face documentation and physician orders',
    isGlobal: false,
    isTerminal: false,
    color: palette.accentOrange.hex,
    // F2F is handled inside the Intake module now (consolidatedStages on Intake).
    // Hide the standalone module link from the sidebar to avoid duplicate nav.
    hiddenFromNav: true,
    matchReferral: (r) => r.current_stage === 'F2F/MD Orders Pending',
  },
  'Clinical Intake RN Review': {
    description: 'Skilled need + safety review by clinical RN. Patients may be here concurrent with Intake (via in_clinical_review) until Confirm fires.',
    isGlobal: false,
    isTerminal: false,
    color: palette.primaryMagenta.hex,
    protected: true,
    matchReferral: (r) =>
      r.current_stage === 'Clinical Intake RN Review' ||
      r.in_clinical_review === true ||
      r.in_clinical_review === 'true',
  },
  'Authorization Pending': {
    description: 'Supportive sub-module of Eligibility. Lists patients with an active Authorizations row (current_stage stays Eligibility).',
    isGlobal: false,
    isTerminal: false,
    color: palette.accentOrange.hex,
    // Decorated by ModulePage: `_hasActiveAuthorization` = boolean
    matchReferral: (r) => r.current_stage === 'Authorization Pending' || r._hasActiveAuthorization === true,
  },
  'Conflict': {
    description: 'Regulatory or service overlap conflict requiring resolution',
    isGlobal: false,
    isTerminal: false,
    color: palette.primaryMagenta.hex,
    matchReferral: (r) => r.current_stage === 'Conflict',
  },
  'EMR Onboarding': {
    description: 'Onboard the patient into the external EMR (HCHB) before scheduling. Download the EMR Onboarding Packet, complete onboarding, then mark the patient onboarded to advance to Staffing Feasibility.',
    isGlobal: false,
    isTerminal: false,
    color: palette.accentGreen.hex,
    matchReferral: (r) => r.current_stage === 'EMR Onboarding',
  },
  'Staffing Feasibility': {
    description: 'Clinician availability — the entire active pipeline is your radar',
    isGlobal: false,
    isTerminal: false,
    color: palette.accentBlue.hex,
    consolidatedStages: [
      'Intake', 'Eligibility Verification', 'Disenrollment Required',
      'F2F/MD Orders Pending', 'Clinical Intake RN Review', 'Authorization Pending',
      'Conflict', 'EMR Onboarding', 'Staffing Feasibility',
    ],
    matchReferral: (r) => [
      'Intake', 'Eligibility Verification', 'Disenrollment Required',
      'F2F/MD Orders Pending', 'Clinical Intake RN Review', 'Authorization Pending',
      'Conflict', 'EMR Onboarding', 'Staffing Feasibility',
    ].includes(r.current_stage),
  },
  'Admin Confirmation': {
    description: 'Side-channel NTUC review gate. Reached only via NTUC requests from non-direct users.',
    isGlobal: false,
    isTerminal: false,
    color: palette.primaryDeepPlum.hex,
    protected: true,
    matchReferral: (r) => r.current_stage === 'Admin Confirmation',
  },
  'Pre-SOC': {
    description: 'EMR onboarding → SOC scheduling → SOC completion',
    isGlobal: false,
    isTerminal: false,
    color: palette.accentGreen.hex,
    consolidatedStages: ['Pre-SOC', 'SOC Scheduled'],
    matchReferral: (r) => r.current_stage === 'Pre-SOC' || r.current_stage === 'SOC Scheduled',
  },
  'SOC Scheduled': {
    description: 'Start of care visit officially scheduled',
    isGlobal: false,
    isTerminal: false,
    color: palette.accentGreen.hex,
    hiddenFromNav: true,
    matchReferral: (r) => r.current_stage === 'SOC Scheduled',
  },
  'SOC Completed': {
    displayName: 'Completed',
    description: 'SOC performed — patient transferred to HCHB',
    isGlobal: false,
    isTerminal: true,
    color: palette.accentGreen.hex,
    matchReferral: (r) => r.current_stage === 'SOC Completed',
  },
  'OPWDD Enrollment': {
    displayName: 'OPWDD',
    description: 'Special Needs referral routed for OPWDD enrollment (Code 95 = No)',
    isGlobal: false,
    isTerminal: false,
    color: palette.primaryDeepPlum.hex,
    matchReferral: (r) => r.current_stage === 'OPWDD Enrollment',
  },
  'Hold': {
    description: 'Temporarily paused, awaiting resolution',
    isGlobal: true,
    isTerminal: false,
    color: palette.highlightYellow.hex,
    hiddenFromNav: true,
    matchReferral: (r) => r.current_stage === 'Hold',
  },
  'NTUC': {
    description: 'Not taken under care',
    isGlobal: true,
    isTerminal: true,
    color: hexToRgba(palette.backgroundDark.hex, 0.4),
    matchReferral: (r) => r.current_stage === 'NTUC',
  },
};
