/**
 * Centralized enums, constants, and seeded checklist template for the OPWDD
 * Enrollment module.
 *
 * Mirrors the structure of `eligibilityEnums.js` — single source of truth for
 * every OPWDD-related string the system writes or reads. The values match
 * what lives in Airtable today (see scripts/schema-snapshot.json:
 * OPWDDEligibilityCases, OPWDDCaseChecklistItems, and the extended Files /
 * Tasks / Permissions singleSelects).
 */

// ── Case lifecycle status ────────────────────────────────────────────────────
export const OPWDD_CASE_STATUS = Object.freeze({
  NOT_STARTED:            'not_started',
  OUTREACH_IN_PROGRESS:   'outreach_in_progress',
  AWAITING_INITIAL_DOCS:  'awaiting_initial_docs',
  EVALUATIONS_PENDING:    'evaluations_pending',
  PACKET_READY:           'packet_ready',
  SUBMITTED_TO_CCO:       'submitted_to_cco',
  ELIGIBILITY_DETERMINED: 'eligibility_determined',
  MONITORING_CODE_95:     'monitoring_code_95',
  CODE_95_RECEIVED:       'code_95_received',
  CONVERTED_TO_INTAKE:    'converted_to_intake',
  CLOSED:                 'closed',
  CANCELLED:              'cancelled',
});

export const OPWDD_CASE_STATUS_OPTIONS = [
  { value: OPWDD_CASE_STATUS.NOT_STARTED,            label: 'Not Started' },
  { value: OPWDD_CASE_STATUS.OUTREACH_IN_PROGRESS,   label: 'Outreach in Progress' },
  { value: OPWDD_CASE_STATUS.AWAITING_INITIAL_DOCS,  label: 'Awaiting Initial Docs' },
  { value: OPWDD_CASE_STATUS.EVALUATIONS_PENDING,    label: 'Evaluations Pending' },
  { value: OPWDD_CASE_STATUS.PACKET_READY,           label: 'Packet Ready' },
  { value: OPWDD_CASE_STATUS.SUBMITTED_TO_CCO,       label: 'Submitted to CCO' },
  { value: OPWDD_CASE_STATUS.ELIGIBILITY_DETERMINED, label: 'Eligibility Determined' },
  { value: OPWDD_CASE_STATUS.MONITORING_CODE_95,     label: 'Monitoring for Code 95' },
  { value: OPWDD_CASE_STATUS.CODE_95_RECEIVED,       label: 'Code 95 Received' },
  { value: OPWDD_CASE_STATUS.CONVERTED_TO_INTAKE,    label: 'Converted to Intake' },
  { value: OPWDD_CASE_STATUS.CLOSED,                 label: 'Closed' },
  { value: OPWDD_CASE_STATUS.CANCELLED,              label: 'Cancelled' },
];

// Open-case statuses (i.e. actionable for the enrollment specialist).
export const OPWDD_OPEN_STATUSES = Object.freeze([
  OPWDD_CASE_STATUS.NOT_STARTED,
  OPWDD_CASE_STATUS.OUTREACH_IN_PROGRESS,
  OPWDD_CASE_STATUS.AWAITING_INITIAL_DOCS,
  OPWDD_CASE_STATUS.EVALUATIONS_PENDING,
  OPWDD_CASE_STATUS.PACKET_READY,
  OPWDD_CASE_STATUS.SUBMITTED_TO_CCO,
  OPWDD_CASE_STATUS.ELIGIBILITY_DETERMINED,
  OPWDD_CASE_STATUS.MONITORING_CODE_95,
]);

// ── Sub-status (finer blocker reason) ────────────────────────────────────────
export const OPWDD_SUB_STATUS = Object.freeze({
  PCG_NOT_INTERESTED:     'pcg_not_interested',
  ABA_ONLY_REFERRAL:      'aba_only_referral',
  DOCS_INCOMPLETE:        'docs_incomplete',
  AWAITING_PSYCH_EVAL:    'awaiting_psych_eval',
  AWAITING_PSYCHOSOCIAL:  'awaiting_psychosocial',
  AWAITING_NOTICE_LETTER: 'awaiting_notice_letter',
  AWAITING_CODE_95:       'awaiting_code_95',
  NONE:                   'none',
});

export const OPWDD_SUB_STATUS_OPTIONS = [
  { value: OPWDD_SUB_STATUS.NONE,                   label: '—' },
  { value: OPWDD_SUB_STATUS.PCG_NOT_INTERESTED,     label: 'PCG Not Interested' },
  { value: OPWDD_SUB_STATUS.ABA_ONLY_REFERRAL,      label: 'ABA-Only Referral' },
  { value: OPWDD_SUB_STATUS.DOCS_INCOMPLETE,        label: 'Documents Incomplete' },
  { value: OPWDD_SUB_STATUS.AWAITING_PSYCH_EVAL,    label: 'Awaiting Psychological Eval' },
  { value: OPWDD_SUB_STATUS.AWAITING_PSYCHOSOCIAL,  label: 'Awaiting Psychosocial Eval' },
  { value: OPWDD_SUB_STATUS.AWAITING_NOTICE_LETTER, label: 'Awaiting Notice Letter' },
  { value: OPWDD_SUB_STATUS.AWAITING_CODE_95,       label: 'Awaiting Code 95' },
];

// ── Closed-case reasons ──────────────────────────────────────────────────────
export const OPWDD_CLOSED_REASON = Object.freeze({
  CONVERTED_TO_INTAKE: 'converted_to_intake',
  PCG_DECLINED:        'pcg_declined',
  ABA_ONLY:            'aba_only',
  DUPLICATE:           'duplicate',
  NOT_ELIGIBLE:        'not_eligible',
  LOST_TO_FOLLOW_UP:   'lost_to_follow_up',
  WITHDRAWN:           'withdrawn',
  OTHER:               'other',
});

export const OPWDD_CLOSED_REASON_OPTIONS = [
  { value: OPWDD_CLOSED_REASON.CONVERTED_TO_INTAKE, label: 'Converted to Intake' },
  { value: OPWDD_CLOSED_REASON.PCG_DECLINED,        label: 'PCG Declined' },
  { value: OPWDD_CLOSED_REASON.ABA_ONLY,            label: 'ABA-Only Referral' },
  { value: OPWDD_CLOSED_REASON.DUPLICATE,           label: 'Duplicate' },
  { value: OPWDD_CLOSED_REASON.NOT_ELIGIBLE,        label: 'Not Eligible' },
  { value: OPWDD_CLOSED_REASON.LOST_TO_FOLLOW_UP,   label: 'Lost to Follow-up' },
  { value: OPWDD_CLOSED_REASON.WITHDRAWN,           label: 'Withdrawn' },
  { value: OPWDD_CLOSED_REASON.OTHER,               label: 'Other' },
];

// ── Evaluation status (psych + psychosocial share the same vocabulary) ───────
export const OPWDD_EVAL_STATUS = Object.freeze({
  NOT_NEEDED: 'not_needed',
  NEEDED:     'needed',
  SCHEDULED:  'scheduled',
  RECEIVED:   'received',
  EXPIRED:    'expired',
  ACCEPTED:   'accepted',
});

export const OPWDD_EVAL_STATUS_OPTIONS = [
  { value: OPWDD_EVAL_STATUS.NOT_NEEDED, label: 'Not Needed' },
  { value: OPWDD_EVAL_STATUS.NEEDED,     label: 'Needed' },
  { value: OPWDD_EVAL_STATUS.SCHEDULED,  label: 'Scheduled' },
  { value: OPWDD_EVAL_STATUS.RECEIVED,   label: 'Received' },
  { value: OPWDD_EVAL_STATUS.EXPIRED,    label: 'Expired' },
  { value: OPWDD_EVAL_STATUS.ACCEPTED,   label: 'Accepted' },
];

// Evaluation validity windows per business rules (psych = 3 years,
// psychosocial = 1 year). Used to compute *_valid_through on received date.
export const OPWDD_EVAL_VALIDITY_YEARS = Object.freeze({
  psychological: 3,
  psychosocial: 1,
});

// ── Submission + notice + eligibility determination ──────────────────────────
export const OPWDD_SUBMISSION_METHOD = Object.freeze({
  EMAIL:  'email',
  PORTAL: 'portal',
  FAX:    'fax',
  OTHER:  'other',
});

export const OPWDD_SUBMISSION_METHOD_OPTIONS = [
  { value: OPWDD_SUBMISSION_METHOD.EMAIL,  label: 'Email' },
  { value: OPWDD_SUBMISSION_METHOD.PORTAL, label: 'Portal' },
  { value: OPWDD_SUBMISSION_METHOD.FAX,    label: 'Fax' },
  { value: OPWDD_SUBMISSION_METHOD.OTHER,  label: 'Other' },
];

export const OPWDD_ELIGIBILITY_DETERMINATION = Object.freeze({
  PENDING:    'pending',
  ELIGIBLE:   'eligible',
  INELIGIBLE: 'ineligible',
  UNKNOWN:    'unknown',
});

export const OPWDD_ELIGIBILITY_DETERMINATION_OPTIONS = [
  { value: OPWDD_ELIGIBILITY_DETERMINATION.PENDING,    label: 'Pending' },
  { value: OPWDD_ELIGIBILITY_DETERMINATION.ELIGIBLE,   label: 'Eligible' },
  { value: OPWDD_ELIGIBILITY_DETERMINATION.INELIGIBLE, label: 'Ineligible' },
  { value: OPWDD_ELIGIBILITY_DETERMINATION.UNKNOWN,    label: 'Unknown' },
];

export const OPWDD_NOTICE_METHOD = Object.freeze({
  MAIL:    'mail',
  EMAIL:   'email',
  UPLOAD:  'upload',
  VERBAL:  'verbal',
  UNKNOWN: 'unknown',
});

export const OPWDD_NOTICE_METHOD_OPTIONS = [
  { value: OPWDD_NOTICE_METHOD.MAIL,    label: 'Mail' },
  { value: OPWDD_NOTICE_METHOD.EMAIL,   label: 'Email' },
  { value: OPWDD_NOTICE_METHOD.UPLOAD,  label: 'Uploaded Document' },
  { value: OPWDD_NOTICE_METHOD.VERBAL,  label: 'Verbal / Phone' },
  { value: OPWDD_NOTICE_METHOD.UNKNOWN, label: 'Unknown' },
];

// Code 95 monitoring window — per business process, notice receipt date + 30
// to +60 days is the expected window in which Code 95 lands.
export const OPWDD_CODE95_WINDOW_DAYS = Object.freeze({ start: 30, end: 60 });

// ── Interested services (PCG opted into at intake) ───────────────────────────
// ABA is intentionally excluded — ABA-only referrals do NOT proceed through
// this workflow per the enrollment SOP.
export const OPWDD_INTERESTED_SERVICE = Object.freeze({
  HHA: 'HHA',
  OT:  'OT',
  PT:  'PT',
  ST:  'ST',
  SN:  'SN',
});

export const OPWDD_INTERESTED_SERVICE_OPTIONS = [
  { value: OPWDD_INTERESTED_SERVICE.HHA, label: 'HHA (Home Health Aide)' },
  { value: OPWDD_INTERESTED_SERVICE.SN,  label: 'SN (Skilled Nursing)' },
  { value: OPWDD_INTERESTED_SERVICE.PT,  label: 'PT (Physical Therapy)' },
  { value: OPWDD_INTERESTED_SERVICE.OT,  label: 'OT (Occupational Therapy)' },
  { value: OPWDD_INTERESTED_SERVICE.ST,  label: 'ST (Speech Therapy)' },
];

// ── Referral handoff status (on Referrals.opwdd_handoff_status) ──────────────
export const OPWDD_HANDOFF_STATUS = Object.freeze({
  NOT_APPLICABLE:   'not_applicable',
  IN_PROGRESS:      'in_progress',
  READY_FOR_INTAKE: 'ready_for_intake',
  HANDED_OFF:       'handed_off',
});

export const OPWDD_HANDOFF_STATUS_OPTIONS = [
  { value: OPWDD_HANDOFF_STATUS.NOT_APPLICABLE,   label: 'Not Applicable' },
  { value: OPWDD_HANDOFF_STATUS.IN_PROGRESS,      label: 'In Progress' },
  { value: OPWDD_HANDOFF_STATUS.READY_FOR_INTAKE, label: 'Ready for Intake' },
  { value: OPWDD_HANDOFF_STATUS.HANDED_OFF,       label: 'Handed Off' },
];

// ── Checklist requirement keys + template ────────────────────────────────────
// Single source of truth for the 15 required/optional OPWDD documents.
// `defaultRequired` reflects the SOP minimums — staff can override per case.
// `validityYears` drives Files.document_valid_through computation when an
// upload is linked; 0 means no expiration.
export const OPWDD_REQUIREMENT_KEY = Object.freeze({
  PREVIOUS_PSYCHOLOGICAL_EVALUATION: 'previous_psychological_evaluation',
  SOCIAL_HISTORY_REPORT:             'social_history_report',
  IEP_LATEST:                        'iep_latest',
  IEP_PRIOR:                         'iep_prior',
  EARLY_INTERVENTION_DOCUMENTS:      'early_intervention_documents',
  SPECIALIST_LETTER:                 'specialist_letter',
  MEDICAL_FORM:                      'medical_form',
  INSURANCE_CARD:                    'insurance_card',
  SOCIAL_SECURITY_CARD:              'social_security_card',
  BIRTH_CERTIFICATE:                 'birth_certificate',
  PASSPORT:                          'passport',
  STATE_ID:                          'state_id',
  UPDATED_PSYCHOLOGICAL_EVALUATION:  'updated_psychological_evaluation',
  UPDATED_PSYCHOSOCIAL_EVALUATION:   'updated_psychosocial_evaluation',
  ELIGIBILITY_NOTICE_LETTER:         'eligibility_notice_letter',
});

/**
 * Ordered checklist template. This is what `seedChecklistForCase` writes
 * into `OPWDDCaseChecklistItems` when a case is opened. `sortOrder` is 1-based
 * and preserves the SOP narrative order (initial collection → evaluations →
 * identity → notice).
 *
 * `identityGroup` items (birth certificate, passport, state ID) satisfy the
 * same SOP requirement — at least one must land before a packet is ready.
 */
export const OPWDD_CHECKLIST_TEMPLATE = [
  // 1. Initial collection — prior psychological eval (any age; informational)
  {
    key: OPWDD_REQUIREMENT_KEY.PREVIOUS_PSYCHOLOGICAL_EVALUATION,
    label: 'Previous Psychological Evaluation',
    defaultRequired: false,
    sortOrder: 10,
    helpText: 'Any prior psych evaluation on file, even if outside the 3-year window.',
  },
  {
    key: OPWDD_REQUIREMENT_KEY.SOCIAL_HISTORY_REPORT,
    label: 'Social History Report',
    defaultRequired: true,
    sortOrder: 20,
  },
  {
    key: OPWDD_REQUIREMENT_KEY.IEP_LATEST,
    label: 'IEP — Most Recent',
    defaultRequired: true,
    sortOrder: 30,
    helpText: 'Last two IEPs ideal; this one is required.',
  },
  {
    key: OPWDD_REQUIREMENT_KEY.IEP_PRIOR,
    label: 'IEP — Prior Year',
    defaultRequired: false,
    sortOrder: 31,
  },
  {
    key: OPWDD_REQUIREMENT_KEY.EARLY_INTERVENTION_DOCUMENTS,
    label: 'Early Intervention Documents',
    defaultRequired: false,
    sortOrder: 40,
    helpText: 'Any EI documentation if applicable.',
  },
  {
    key: OPWDD_REQUIREMENT_KEY.SPECIALIST_LETTER,
    label: 'Specialist Letter (Neuro / other)',
    defaultRequired: false,
    sortOrder: 50,
    helpText: 'Only if the child is under the care of a specialist.',
  },
  {
    key: OPWDD_REQUIREMENT_KEY.MEDICAL_FORM,
    label: 'Medical Form',
    defaultRequired: true,
    sortOrder: 60,
  },

  // 2. Identity + insurance
  {
    key: OPWDD_REQUIREMENT_KEY.INSURANCE_CARD,
    label: 'Insurance Card (photo)',
    defaultRequired: true,
    sortOrder: 70,
  },
  {
    key: OPWDD_REQUIREMENT_KEY.SOCIAL_SECURITY_CARD,
    label: 'Social Security Card (photo)',
    defaultRequired: true,
    sortOrder: 80,
  },
  {
    key: OPWDD_REQUIREMENT_KEY.BIRTH_CERTIFICATE,
    label: 'Birth Certificate',
    defaultRequired: false,
    sortOrder: 90,
    identityGroup: true,
    helpText: 'One of: Birth Certificate, Passport, or State ID.',
  },
  {
    key: OPWDD_REQUIREMENT_KEY.PASSPORT,
    label: 'Passport',
    defaultRequired: false,
    sortOrder: 91,
    identityGroup: true,
  },
  {
    key: OPWDD_REQUIREMENT_KEY.STATE_ID,
    label: 'State ID',
    defaultRequired: false,
    sortOrder: 92,
    identityGroup: true,
  },

  // 3. Evaluations (scheduled/collected by the enrollment specialist)
  {
    key: OPWDD_REQUIREMENT_KEY.UPDATED_PSYCHOLOGICAL_EVALUATION,
    label: 'Updated Psychological Evaluation (<3 yr)',
    defaultRequired: true,
    sortOrder: 100,
    validityYears: 3,
    helpText: 'Must be dated within the last 3 years. Scheduled with Article 16 clinic.',
  },
  {
    key: OPWDD_REQUIREMENT_KEY.UPDATED_PSYCHOSOCIAL_EVALUATION,
    label: 'Updated Psychosocial Evaluation (<1 yr)',
    defaultRequired: true,
    sortOrder: 110,
    validityYears: 1,
    helpText: 'Must be dated within the last year.',
  },

  // 4. Eligibility notice (post-submission)
  {
    key: OPWDD_REQUIREMENT_KEY.ELIGIBILITY_NOTICE_LETTER,
    label: 'Eligibility / Determination Notice Letter',
    defaultRequired: true,
    sortOrder: 200,
    helpText: 'Received from OPWDD via mail or email after CCO submission.',
  },
];

export const OPWDD_CHECKLIST_BY_KEY = Object.freeze(
  Object.fromEntries(OPWDD_CHECKLIST_TEMPLATE.map((item) => [item.key, item])),
);

// ── Checklist groups (drives UI sub-sections in OpwddWorkspace) ──────────────
// Each `requirementKeys` array is rendered as its own collapsible sub-section
// with its own satisfied/total count. Order matches the SOP narrative.
export const OPWDD_CHECKLIST_GROUPS = Object.freeze([
  {
    id: 'core_docs',
    label: 'Core Documents',
    requirementKeys: [
      OPWDD_REQUIREMENT_KEY.SOCIAL_HISTORY_REPORT,
      OPWDD_REQUIREMENT_KEY.IEP_LATEST,
      OPWDD_REQUIREMENT_KEY.IEP_PRIOR,
      OPWDD_REQUIREMENT_KEY.EARLY_INTERVENTION_DOCUMENTS,
      OPWDD_REQUIREMENT_KEY.SPECIALIST_LETTER,
      OPWDD_REQUIREMENT_KEY.MEDICAL_FORM,
      OPWDD_REQUIREMENT_KEY.PREVIOUS_PSYCHOLOGICAL_EVALUATION,
    ],
  },
  {
    id: 'identity',
    label: 'Identity & Insurance',
    requirementKeys: [
      OPWDD_REQUIREMENT_KEY.INSURANCE_CARD,
      OPWDD_REQUIREMENT_KEY.SOCIAL_SECURITY_CARD,
      OPWDD_REQUIREMENT_KEY.BIRTH_CERTIFICATE,
      OPWDD_REQUIREMENT_KEY.PASSPORT,
      OPWDD_REQUIREMENT_KEY.STATE_ID,
    ],
  },
  {
    id: 'evaluations',
    label: 'Updated Evaluations',
    requirementKeys: [
      OPWDD_REQUIREMENT_KEY.UPDATED_PSYCHOLOGICAL_EVALUATION,
      OPWDD_REQUIREMENT_KEY.UPDATED_PSYCHOSOCIAL_EVALUATION,
    ],
  },
  {
    id: 'notice',
    label: 'Eligibility Notice',
    requirementKeys: [
      OPWDD_REQUIREMENT_KEY.ELIGIBILITY_NOTICE_LETTER,
    ],
  },
]);

// ── Workflow phases (drives the progress stepper at the top of the workspace)
// Each phase corresponds to a cluster of case statuses. `order` is a stable
// monotonic index used by the UI to mark completed / current / future steps.
export const OPWDD_PHASES = Object.freeze([
  {
    id: 'outreach', order: 0, label: 'Outreach', shortLabel: 'Outreach',
    statuses: [OPWDD_CASE_STATUS.NOT_STARTED, OPWDD_CASE_STATUS.OUTREACH_IN_PROGRESS],
  },
  {
    id: 'docs', order: 1, label: 'Documents', shortLabel: 'Docs',
    statuses: [OPWDD_CASE_STATUS.AWAITING_INITIAL_DOCS],
  },
  {
    id: 'evals', order: 2, label: 'Evaluations', shortLabel: 'Evals',
    statuses: [OPWDD_CASE_STATUS.EVALUATIONS_PENDING],
  },
  {
    id: 'submit', order: 3, label: 'Submission', shortLabel: 'Submit',
    statuses: [OPWDD_CASE_STATUS.PACKET_READY, OPWDD_CASE_STATUS.SUBMITTED_TO_CCO],
  },
  {
    id: 'monitor', order: 4, label: 'Monitor', shortLabel: 'Monitor',
    statuses: [OPWDD_CASE_STATUS.ELIGIBILITY_DETERMINED, OPWDD_CASE_STATUS.MONITORING_CODE_95],
  },
  {
    id: 'code95', order: 5, label: 'Code 95', shortLabel: 'Code 95',
    statuses: [OPWDD_CASE_STATUS.CODE_95_RECEIVED, OPWDD_CASE_STATUS.CONVERTED_TO_INTAKE],
  },
]);

export function getOpwddPhaseForStatus(status) {
  return OPWDD_PHASES.find((p) => p.statuses.includes(status)) || OPWDD_PHASES[0];
}

// ── Per-item checklist status ────────────────────────────────────────────────
export const OPWDD_CHECKLIST_STATUS = Object.freeze({
  MISSING:      'missing',
  REQUESTED:    'requested',
  RECEIVED:     'received',
  UNDER_REVIEW: 'under_review',
  ACCEPTED:     'accepted',
  REJECTED:     'rejected',
  EXPIRED:      'expired',
  WAIVED:       'waived',
});

export const OPWDD_CHECKLIST_STATUS_OPTIONS = [
  { value: OPWDD_CHECKLIST_STATUS.MISSING,      label: 'Missing' },
  { value: OPWDD_CHECKLIST_STATUS.REQUESTED,    label: 'Requested' },
  { value: OPWDD_CHECKLIST_STATUS.RECEIVED,     label: 'Received' },
  { value: OPWDD_CHECKLIST_STATUS.UNDER_REVIEW, label: 'Under Review' },
  { value: OPWDD_CHECKLIST_STATUS.ACCEPTED,     label: 'Accepted' },
  { value: OPWDD_CHECKLIST_STATUS.REJECTED,     label: 'Rejected' },
  { value: OPWDD_CHECKLIST_STATUS.EXPIRED,      label: 'Expired' },
  { value: OPWDD_CHECKLIST_STATUS.WAIVED,       label: 'Waived' },
];

// Terminal "satisfied" statuses (checklist item is complete).
export const OPWDD_SATISFIED_STATUSES = Object.freeze([
  OPWDD_CHECKLIST_STATUS.ACCEPTED,
  OPWDD_CHECKLIST_STATUS.WAIVED,
]);

// ── OPWDD file categories (extend Files.category singleSelect) ───────────────
export const OPWDD_FILE_CATEGORY = Object.freeze({
  OPWDD:            'OPWDD',
  OPWDD_EVALUATION: 'OPWDD Evaluation',
  OPWDD_IDENTITY:   'OPWDD Identity',
  OPWDD_INSURANCE:  'OPWDD Insurance',
  OPWDD_NOTICE:     'OPWDD Notice',
});

export const OPWDD_FILE_CATEGORIES = Object.values(OPWDD_FILE_CATEGORY);

/**
 * Maps a requirement_key to the best-guess Files.category.
 * Used when linking a file upload to a checklist item so the category is
 * pre-selected in the UI.
 */
export const OPWDD_REQUIREMENT_TO_CATEGORY = Object.freeze({
  [OPWDD_REQUIREMENT_KEY.PREVIOUS_PSYCHOLOGICAL_EVALUATION]: OPWDD_FILE_CATEGORY.OPWDD_EVALUATION,
  [OPWDD_REQUIREMENT_KEY.UPDATED_PSYCHOLOGICAL_EVALUATION]:  OPWDD_FILE_CATEGORY.OPWDD_EVALUATION,
  [OPWDD_REQUIREMENT_KEY.UPDATED_PSYCHOSOCIAL_EVALUATION]:   OPWDD_FILE_CATEGORY.OPWDD_EVALUATION,
  [OPWDD_REQUIREMENT_KEY.SOCIAL_HISTORY_REPORT]:             OPWDD_FILE_CATEGORY.OPWDD,
  [OPWDD_REQUIREMENT_KEY.IEP_LATEST]:                        OPWDD_FILE_CATEGORY.OPWDD,
  [OPWDD_REQUIREMENT_KEY.IEP_PRIOR]:                         OPWDD_FILE_CATEGORY.OPWDD,
  [OPWDD_REQUIREMENT_KEY.EARLY_INTERVENTION_DOCUMENTS]:      OPWDD_FILE_CATEGORY.OPWDD,
  [OPWDD_REQUIREMENT_KEY.SPECIALIST_LETTER]:                 OPWDD_FILE_CATEGORY.OPWDD,
  [OPWDD_REQUIREMENT_KEY.MEDICAL_FORM]:                      OPWDD_FILE_CATEGORY.OPWDD,
  [OPWDD_REQUIREMENT_KEY.INSURANCE_CARD]:                    OPWDD_FILE_CATEGORY.OPWDD_INSURANCE,
  [OPWDD_REQUIREMENT_KEY.SOCIAL_SECURITY_CARD]:              OPWDD_FILE_CATEGORY.OPWDD_IDENTITY,
  [OPWDD_REQUIREMENT_KEY.BIRTH_CERTIFICATE]:                 OPWDD_FILE_CATEGORY.OPWDD_IDENTITY,
  [OPWDD_REQUIREMENT_KEY.PASSPORT]:                          OPWDD_FILE_CATEGORY.OPWDD_IDENTITY,
  [OPWDD_REQUIREMENT_KEY.STATE_ID]:                          OPWDD_FILE_CATEGORY.OPWDD_IDENTITY,
  [OPWDD_REQUIREMENT_KEY.ELIGIBILITY_NOTICE_LETTER]:         OPWDD_FILE_CATEGORY.OPWDD_NOTICE,
});

// ── Activity log action names (extend ActivityLog.action multilineText) ──────
export const OPWDD_AUDIT_ACTION = Object.freeze({
  CASE_OPENED:               'opwdd_case_opened',
  OUTREACH_COMPLETED:        'opwdd_outreach_completed',
  PCG_INTEREST_CONFIRMED:    'opwdd_pcg_interest_confirmed',
  SERVICE_INTEREST_UPDATED:  'opwdd_service_interest_updated',
  CHECKLIST_ITEM_REQUESTED:  'opwdd_checklist_item_requested',
  CHECKLIST_ITEM_RECEIVED:   'opwdd_checklist_item_received',
  CHECKLIST_ITEM_ACCEPTED:   'opwdd_checklist_item_accepted',
  CHECKLIST_ITEM_REJECTED:   'opwdd_checklist_item_rejected',
  FILE_LINKED:               'opwdd_file_linked',
  EVAL_SCHEDULED:            'opwdd_eval_scheduled',
  EVAL_RECEIVED:             'opwdd_eval_received',
  PACKET_SUBMITTED:          'opwdd_packet_submitted',
  NOTICE_RECEIVED:           'opwdd_notice_received',
  CODE95_MONITORING_STARTED: 'opwdd_code95_monitoring_started',
  CODE95_RECEIVED:           'opwdd_code95_received',
  CONVERTED_TO_INTAKE:       'opwdd_converted_to_intake',
  CASE_CLOSED:               'opwdd_case_closed',
});

// ── OPWDD task types (extend Tasks.type singleSelect) ────────────────────────
export const OPWDD_TASK_TYPE = Object.freeze({
  OUTREACH:           'OPWDD Outreach',
  MISSING_DOCUMENT:   'OPWDD Missing Document',
  EVALUATION:         'OPWDD Evaluation',
  SUBMISSION:         'OPWDD Submission',
  CODE95_MONITORING:  'OPWDD Code 95 Monitoring',
});

// ── Permission keys (also exported from permissionKeys.js but re-exported    //
// here so OPWDD code doesn't need to import both modules) ────────────────────
export const OPWDD_PERMISSION_KEY = Object.freeze({
  CASE_VIEW:              'opwdd.case.view',
  CASE_CREATE:            'opwdd.case.create',
  CASE_EDIT:              'opwdd.case.edit',
  CASE_ASSIGN:            'opwdd.case.assign',
  CHECKLIST_EDIT:         'opwdd.checklist.edit',
  FILE_UPLOAD:            'opwdd.file.upload',
  FILE_VERIFY_CURRENT:    'opwdd.file.verify_current',
  SUBMIT_PACKET:          'opwdd.submit_packet',
  RECORD_NOTICE:          'opwdd.record_notice',
  MARK_CODE95_RECEIVED:   'opwdd.mark_code95_received',
  CONVERT_TO_INTAKE:      'opwdd.convert_to_intake',
  CLOSE_CASE:             'opwdd.close_case',
});
