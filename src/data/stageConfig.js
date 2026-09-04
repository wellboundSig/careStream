import palette, { hexToRgba } from '../utils/colors.js';

/**
 * Durable “SOC was performed” membership. Once `soc_completed_date` is stamped,
 * the patient stays on the SOC Completed list/count even if `current_stage`
 * moves back to Intake (or elsewhere) for post-SOC paperwork / ICD fixes.
 * NTUC / discarded cases leave the Completed list.
 */
const SOC_COMPLETED_LEFT_PIPELINE = new Set(['NTUC', 'Discarded Leads']);

export function isSocCompletedReferral(r) {
  if (!r) return false;
  if (SOC_COMPLETED_LEFT_PIPELINE.has(r.current_stage)) return false;
  if (r.current_stage === 'SOC Completed') return true;
  const d = r.soc_completed_date;
  return d != null && d !== '' && d !== false;
}

// ── Post-visit documentation stages ──────────────────────────────────────────
// Rushed / no-docs / urgent care cases whose visit already happened work
// through these stages inside the existing Intake and Clinical RN modules.
export const POST_VISIT_INTAKE = 'Post Visit Intake';
export const POST_VISIT_CLINICAL = 'Post Visit Clinical Review';
export const POST_VISIT_STAGES = new Set([POST_VISIT_INTAKE, POST_VISIT_CLINICAL]);

export function isPostVisitStage(stage) {
  return POST_VISIT_STAGES.has(stage);
}

// Stages where paperwork keeps getting worked after the visit happened.
// Post-visit is a STATUS (visit done, paperwork open), not a stage — the
// dedicated Post Visit stages are legacy-only and no longer routed into.
const POST_VISIT_WORKING_STAGES = new Set([
  'Intake', 'F2F/MD Orders Pending', 'Clinical Intake RN Review',
  'Eligibility Verification', 'EMR Onboarding', 'Conflict', 'Hold',
]);

export function isPostVisitReferral(r) {
  if (!r) return false;
  // Legacy rows still parked in the dedicated post-visit stages.
  if (POST_VISIT_STAGES.has(r.current_stage)) return true;
  // Legacy 'SOC Completed' rows with paperwork still open are the same
  // post-visit situation.
  if (r.current_stage === 'SOC Completed' && legacyVisitPaperworkOpen(r)) return true;
  // Status-quo flow: the visit already happened (durable stamp) while the
  // paperwork continues in a working stage.
  const d = r.soc_completed_date;
  return d != null && d !== '' && d !== false && POST_VISIT_WORKING_STAGES.has(r.current_stage);
}

/** Legacy 'SOC Completed' stage: is post-visit paperwork still open? */
export function legacyVisitPaperworkOpen(r) {
  const openDocs = (r.documentation_deferred === true || r.documentation_deferred === 'true')
    && !r.documentation_cleared_at;
  const clinicalDone = !!r.clinical_review_completed_at || !!r.clinical_review_decision;
  return openDocs || !clinicalDone;
}

function isTruthyFlag(v) {
  return v === true || v === 'true' || v === 'True' || v === 'TRUE' || v === 1 || v === '1';
}

/** Active Clinical Review handoff — used by both module queues. */
export function isActiveClinicalHandoff(r) {
  if (!r) return false;
  if (
    r.current_stage === 'Clinical Intake RN Review'
    || r.current_stage === 'Post Visit Clinical Review'
  ) return true;
  if (isTruthyFlag(r.in_clinical_review)) return true;
  const assigned = r.clinical_review_assigned_to_id;
  const hasAssignee = Array.isArray(assigned) ? assigned.length > 0 : !!assigned;
  return hasAssignee && !r.clinical_review_completed_at;
}

/**
 * Terminal Completed membership. New-UI cases land on `current_stage ===
 * 'Completed'`. Older clients parked the same finished work on
 * `SOC Completed` after the visit — those still count here when clinical
 * and docs are closed, but the UI label is Completed (DB stage unchanged).
 */
export function isFullyFinishedReferral(r) {
  if (!r) return false;
  if (r.current_stage === 'NTUC' || r.current_stage === 'Discarded Leads' || r.current_stage === 'Hold') {
    return false;
  }
  if (r.current_stage === 'Completed') return true;
  // Older clients parked finished work on SOC Completed / Post Visit Intake.
  // A leftover in_clinical_review flag or assignee must not hide them —
  // clinical_review_decision / completed_at is what closed the paperwork.
  if (r.current_stage !== 'SOC Completed' && r.current_stage !== 'Post Visit Intake') {
    return false;
  }
  return !legacyVisitPaperworkOpen(r);
}

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
  'Clinical Lead Pre-Check':   'clinical-lead-pre-check',
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
  'Post Visit Intake':         'post-visit-intake',
  'Post Visit Clinical Review': 'post-visit-clinical',
  'Completed':                 'completed',
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
    // EMR Onboarding is consolidated into the Intake module (no standalone link).
    stages: [
      'Lead Entry',
      'Intake',
      'Disenrollment Required',
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
    stages: ['Staffing Feasibility', 'Pre-SOC', 'Completed'],
  },
  {
    id: 'admin',
    label: 'Admin',
    color: palette.highlightYellow.hex,
    stages: [
      'Conflict',
      'Discarded Leads',
      'NTUC',
      'Completed',
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
  'Clinical Lead Pre-Check': {
    displayName: 'Lead Pre-Check',
    description: 'New lead awaiting a clinical viability glance. Concurrent in Leads and Clinical Review until Mark Viable.',
    isGlobal: false,
    isTerminal: false,
    color: palette.primaryDeepPlum.hex,
    hiddenFromNav: true,
    matchReferral: (r) => r.current_stage === 'Clinical Lead Pre-Check',
  },
  'Lead Entry': {
    displayName: 'Leads',
    description: 'New referral submissions, including leads still awaiting the clinical pre-check',
    isGlobal: false,
    isTerminal: false,
    color: palette.accentBlue.hex,
    consolidatedStages: ['Clinical Lead Pre-Check', 'Lead Entry'],
    matchReferral: (r) =>
      r.current_stage === 'Lead Entry' || r.current_stage === 'Clinical Lead Pre-Check',
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
    description: 'Referrals being processed by intake, including EMR onboarding. Cases whose visit already happened stay here as Intake Post Visit until paperwork is done. Once pushed to Clinical they leave this queue.',
    isGlobal: false,
    isTerminal: false,
    color: palette.accentBlue.hex,
    consolidatedStages: ['Intake', 'F2F/MD Orders Pending', 'EMR Onboarding', 'Post Visit Intake'],
    matchReferral: (r) => {
      // Push-to-Clinical is a hard handoff: the case belongs on Clinical
      // Review until Send Back returns it. Do not list both queues.
      if (isActiveClinicalHandoff(r) || isFullyFinishedReferral(r)) return false;
      return r.current_stage === 'Intake'
        || r.current_stage === 'F2F/MD Orders Pending'
        || r.current_stage === 'EMR Onboarding'
        || r.current_stage === 'Post Visit Intake'
        // Visit happened, paperwork still open — stay here as Intake Post Visit.
        || r.current_stage === 'SOC Completed';
    },
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
    displayName: 'Clinical Review',
    description: 'Skilled need + safety review. Post-visit cases stay in this queue until paperwork is approved.',
    isGlobal: false,
    isTerminal: false,
    color: palette.primaryMagenta.hex,
    protected: true,
    consolidatedStages: ['Clinical Intake RN Review', 'Post Visit Clinical Review', 'Clinical Lead Pre-Check'],
    matchReferral: (r) =>
      (r.current_stage === 'Clinical Lead Pre-Check' || isActiveClinicalHandoff(r))
      && !isFullyFinishedReferral(r),
  },
  'Authorization Pending': {
    description: 'Supportive sub-module of Eligibility. Lists patients with an active Authorizations row (current_stage stays Eligibility).',
    isGlobal: false,
    isTerminal: false,
    color: palette.accentOrange.hex,
    // Decorated by ModulePage: `_hasActiveAuthorization` = boolean.
    // Leaves the queue once Authorization Obtained stamps `auth_obtained_at`.
    matchReferral: (r) =>
      !r.auth_obtained_at
      && (r.current_stage === 'Authorization Pending' || r._hasActiveAuthorization === true),
  },
  'Conflict': {
    description: 'Regulatory or service overlap conflict requiring resolution',
    isGlobal: false,
    isTerminal: false,
    color: palette.primaryMagenta.hex,
    matchReferral: (r) => r.current_stage === 'Conflict',
  },
  'EMR Onboarding': {
    description: 'Onboard the patient into the external EMR (HCHB). Worked inside the Intake module; the drawer\'s EMR Onboarding tab tracks initial + complete milestones.',
    isGlobal: false,
    isTerminal: false,
    color: palette.accentGreen.hex,
    // Consolidated into the Intake module (consolidatedStages on Intake) —
    // the stage still exists for legacy cases but has no standalone nav link.
    hiddenFromNav: true,
    matchReferral: (r) => r.current_stage === 'EMR Onboarding',
  },
  'Staffing Feasibility': {
    description: 'Clinician availability. The entire active pipeline is your radar',
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
    displayName: 'SOC/ROC',
    description: 'Schedule and complete the Start or Resumption of Care visit. Runs concurrently with Intake — cases appear here as soon as the EMR chart exists, and leave once the visit is marked completed.',
    isGlobal: false,
    isTerminal: false,
    color: palette.accentGreen.hex,
    consolidatedStages: ['Pre-SOC', 'SOC Scheduled'],
    matchReferral: (r) => {
      if (r.current_stage === 'Pre-SOC' || r.current_stage === 'SOC Scheduled') return true;
      // Concurrent scheduling: once the patient exists in the EMR (initial or
      // full onboarding), SOC/ROC staff can schedule the visit while paperwork
      // continues in Intake/Clinical. Marking the visit completed stamps
      // soc_completed_date, which removes the case from this module.
      if (r.soc_completed_date) return false;
      if (!r.emr_initial_onboarded_at && !r.emr_onboarded_at) return false;
      return [
        'Intake', 'F2F/MD Orders Pending', 'Eligibility Verification',
        'Clinical Intake RN Review', 'EMR Onboarding', 'Staffing Feasibility',
      ].includes(r.current_stage);
    },
  },
  'SOC Scheduled': {
    displayName: 'SOC/ROC Scheduled',
    description: 'Care start or resumption visit scheduled',
    isGlobal: false,
    isTerminal: false,
    color: palette.accentGreen.hex,
    hiddenFromNav: true,
    matchReferral: (r) => r.current_stage === 'SOC Scheduled',
  },
  'SOC Completed': {
    displayName: 'Visit Completed',
    description: 'Legacy pass-through stage: visit performed. New-UI cases route straight to Completed or Post Visit Intake; no standalone module.',
    isGlobal: false,
    isTerminal: false,
    color: palette.accentGreen.hex,
    // No standalone module in the new UI — completed-visit cases either finish
    // in Completed or keep working paperwork inside Intake (Post Visit Intake).
    hiddenFromNav: true,
    matchReferral: (r) => isSocCompletedReferral(r),
  },
  'Post Visit Intake': {
    displayName: 'Post Visit Intake',
    description: 'Post-visit paperwork collection — worked inside the Intake module',
    isGlobal: false,
    isTerminal: false,
    color: palette.accentBlue.hex,
    // Worked inside the Intake module (consolidatedStages on Intake).
    hiddenFromNav: true,
    matchReferral: (r) => r.current_stage === 'Post Visit Intake',
  },
  'Post Visit Clinical Review': {
    displayName: 'Clinical Review Post Visit',
    description: 'Post-visit clinical review — worked inside the Clinical Review module',
    isGlobal: false,
    isTerminal: false,
    color: palette.primaryMagenta.hex,
    protected: true,
    // Worked inside the Clinical RN module (consolidatedStages on Clinical).
    hiddenFromNav: true,
    matchReferral: (r) => r.current_stage === 'Post Visit Clinical Review',
  },
  'Completed': {
    displayName: 'Completed',
    description: 'Fully finished cases. Visit, paperwork, and clinical review are all done. Visit-done work still open stays in Intake or Clinical Review.',
    isGlobal: false,
    isTerminal: true,
    color: palette.accentGreen.hex,
    matchReferral: (r) => isFullyFinishedReferral(r),
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
