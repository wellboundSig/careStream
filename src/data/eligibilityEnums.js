/**
 * Centralized enums / constants for the Eligibility + Authorization modules.
 *
 * Single source of truth. Any UI selector, policy function, validator, or
 * persistence layer should import these — do not redeclare string literals
 * anywhere else.
 *
 * Safety principle: these constants describe the vocabulary the system
 * understands. They do NOT encode legal or billing decisions. Policy
 * functions that operate on these values must route to human confirmation
 * for anything consequential.
 */

// ── Insurance category ───────────────────────────────────────────────────────
// Raw demographic entry classification. "Managed" is modelled as a distinct
// category from its fee-for-service parent, per business requirement.
export const INSURANCE_CATEGORY = Object.freeze({
  MEDICARE:         'medicare',            // Straight / fee-for-service Medicare
  MEDICARE_MANAGED: 'medicare_managed',    // Medicare Advantage / MA plan
  MEDICAID:         'medicaid',            // Straight Medicaid (fee-for-service)
  MEDICAID_MANAGED: 'medicaid_managed',    // Medicaid MCO / MLTC / managed plan
  THIRD_PARTY:      'third_party',         // Non-Medicare / non-Medicaid (e.g. LTC, workers comp, private pay stack)
  COMMERCIAL:       'commercial',          // Commercial plan (Aetna, Cigna, BCBS, etc.)
  UNKNOWN:          'unknown',             // Ambiguous entry — requires human review
});

export const INSURANCE_CATEGORY_OPTIONS = [
  { value: INSURANCE_CATEGORY.MEDICARE,         label: 'Medicare' },
  { value: INSURANCE_CATEGORY.MEDICARE_MANAGED, label: 'Medicare Managed (Advantage)' },
  { value: INSURANCE_CATEGORY.MEDICAID,         label: 'Medicaid' },
  { value: INSURANCE_CATEGORY.MEDICAID_MANAGED, label: 'Medicaid Managed (MCO / MLTC)' },
  { value: INSURANCE_CATEGORY.COMMERCIAL,       label: 'Commercial Plan' },
  { value: INSURANCE_CATEGORY.THIRD_PARTY,      label: 'Third Party' },
  { value: INSURANCE_CATEGORY.UNKNOWN,          label: 'Unknown / Needs Review' },
];

// Note: Third Party and Commercial are intentionally separate per business
// requirement — they are not interchangeable in the intake workflow.

// ── Payer order rank ─────────────────────────────────────────────────────────
export const ORDER_RANK = Object.freeze({
  PRIMARY:   'primary',
  SECONDARY: 'secondary',
  TERTIARY:  'tertiary',
  UNKNOWN:   'unknown',
});

export const ORDER_RANK_OPTIONS = [
  { value: ORDER_RANK.PRIMARY,   label: 'Primary' },
  { value: ORDER_RANK.SECONDARY, label: 'Secondary' },
  { value: ORDER_RANK.TERTIARY,  label: 'Tertiary' },
  { value: ORDER_RANK.UNKNOWN,   label: 'Unknown / Needs Review' },
];

// ── Verification sources (multi-select) ──────────────────────────────────────
// Used by EligibilityVerification.verificationSources[] — audit requirement.
export const VERIFICATION_SOURCE = Object.freeze({
  WAYSTAR:           'waystar',
  AVAILITY:          'availity',
  EPACES:            'epaces',
  EMEDNY:            'emedny',
  OPTUM:             'optum',
  COMMERCIAL_PORTAL: 'commercial_portal',
  PHONE:             'phone',
  FAX:               'fax',
  OTHER:             'other',
});

export const VERIFICATION_SOURCE_OPTIONS = [
  { value: VERIFICATION_SOURCE.WAYSTAR,           label: 'Waystar',                 hint: 'Typically used for straight Medicare' },
  { value: VERIFICATION_SOURCE.AVAILITY,          label: 'Availity',                hint: 'Multi-payer clearinghouse' },
  { value: VERIFICATION_SOURCE.EPACES,            label: 'ePACES',                  hint: 'NY Medicaid eligibility portal' },
  { value: VERIFICATION_SOURCE.EMEDNY,            label: 'eMedNY',                  hint: 'NY Medicaid' },
  { value: VERIFICATION_SOURCE.OPTUM,             label: 'Optum',                   hint: '' },
  { value: VERIFICATION_SOURCE.COMMERCIAL_PORTAL, label: 'Commercial Portal',       hint: 'Plan-specific web portal' },
  { value: VERIFICATION_SOURCE.PHONE,             label: 'Phone',                   hint: 'Called payer directly' },
  { value: VERIFICATION_SOURCE.FAX,               label: 'Fax',                     hint: '' },
  { value: VERIFICATION_SOURCE.OTHER,             label: 'Other',                   hint: 'Document in notes' },
];

// ── Eligibility verification status (per insurance, per event) ───────────────
export const VERIFICATION_STATUS = Object.freeze({
  UNREVIEWED:         'unreviewed',
  CONFIRMED_ACTIVE:   'confirmed_active',
  CONFIRMED_INACTIVE: 'confirmed_inactive',
  DENIED_NOT_FOUND:   'denied_not_found',
  PARTIAL:            'partial',
  UNABLE_TO_VERIFY:   'unable_to_verify',
});

export const VERIFICATION_STATUS_OPTIONS = [
  { value: VERIFICATION_STATUS.UNREVIEWED,         label: 'Unreviewed' },
  { value: VERIFICATION_STATUS.CONFIRMED_ACTIVE,   label: 'Confirmed Active' },
  { value: VERIFICATION_STATUS.CONFIRMED_INACTIVE, label: 'Confirmed Inactive' },
  { value: VERIFICATION_STATUS.DENIED_NOT_FOUND,   label: 'Denied / Not Found' },
  { value: VERIFICATION_STATUS.PARTIAL,            label: 'Partial' },
  { value: VERIFICATION_STATUS.UNABLE_TO_VERIFY,   label: 'Unable to Verify' },
];

// ── Note categories (eligibility notes first-class) ──────────────────────────
export const NOTE_CATEGORY = Object.freeze({
  GENERAL:              'general',
  COVERAGE_DETAIL:      'coverage_detail',
  MANAGED_CARE_PLAN:    'managed_care_plan',
  DISENROLLMENT:        'disenrollment',
  OPEN_EPISODE:         'open_episode',
  HOSPICE:              'hospice',
  CDPAP:                'cdpap',
  COORDINATION_OF_CARE: 'coordination_of_care',
  AUDIT_CLARIFICATION:  'audit_clarification',
  OTHER:                'other',
});

export const NOTE_CATEGORY_OPTIONS = [
  { value: NOTE_CATEGORY.GENERAL,              label: 'General' },
  { value: NOTE_CATEGORY.COVERAGE_DETAIL,      label: 'Coverage Detail' },
  { value: NOTE_CATEGORY.MANAGED_CARE_PLAN,    label: 'Managed Care Plan' },
  { value: NOTE_CATEGORY.DISENROLLMENT,        label: 'Disenrollment' },
  { value: NOTE_CATEGORY.OPEN_EPISODE,         label: 'Open Episode' },
  { value: NOTE_CATEGORY.HOSPICE,              label: 'Hospice' },
  { value: NOTE_CATEGORY.CDPAP,                label: 'CDPAP' },
  { value: NOTE_CATEGORY.COORDINATION_OF_CARE, label: 'Coordination of Care' },
  { value: NOTE_CATEGORY.AUDIT_CLARIFICATION,  label: 'Audit Clarification' },
  { value: NOTE_CATEGORY.OTHER,                label: 'Other' },
];

// ── Billing model suggestion (NEVER silently finalised) ──────────────────────
// The system suggests one of these; staff must confirm before persistence.
export const BILLING_MODEL = Object.freeze({
  EPISODIC:         'episodic',          // Medicare / LUPA 30-day / PDGM
  FFS:              'ffs',               // Fee-for-service (visit-based)
  MANAGED_CARE:     'managed_care',      // Managed plan — separate auth rules
  NON_BILLABLE:     'non_billable',      // Agency cannot bill this setup
  NEEDS_REVIEW:     'needs_review',      // Staff must decide
});

// ── Authorization status ─────────────────────────────────────────────────────
export const AUTH_STATUS = Object.freeze({
  NAR:               'nar',               // No Auth Required
  PENDING:           'pending',
  APPROVED:          'approved',
  DENIED:            'denied',
  FOLLOW_UP_NEEDED:  'follow_up_needed',
});

export const AUTH_STATUS_OPTIONS = [
  { value: AUTH_STATUS.NAR,              label: 'No Auth Required (NAR)' },
  { value: AUTH_STATUS.PENDING,          label: 'Pending' },
  { value: AUTH_STATUS.APPROVED,         label: 'Approved' },
  { value: AUTH_STATUS.DENIED,           label: 'Denied' },
  { value: AUTH_STATUS.FOLLOW_UP_NEEDED, label: 'Follow-up Needed' },
];

// ── Authorization unit types ─────────────────────────────────────────────────
export const AUTH_UNIT_TYPE = Object.freeze({
  VISIT:   'visit',
  HOUR:    'hour',
  DAY:     'day',
  EPISODE: 'episode',
});

export const AUTH_UNIT_TYPE_OPTIONS = [
  { value: AUTH_UNIT_TYPE.VISIT,   label: 'Visits' },
  { value: AUTH_UNIT_TYPE.HOUR,    label: 'Hours' },
  { value: AUTH_UNIT_TYPE.DAY,     label: 'Days' },
  { value: AUTH_UNIT_TYPE.EPISODE, label: 'Episodes' },
];

// ── Services (canonical list — ABA deliberately excluded for CHHA auth) ──────
// `ABA` is NOT listed here for the authorization module per business rule.
// Division rules (see serviceAvailabilityPolicies) further restrict which
// services are billable per setting.
export const AUTH_SERVICE = Object.freeze({
  SN:  'SN',
  PT:  'PT',
  OT:  'OT',
  ST:  'ST',
  HHA: 'HHA',
  MSW: 'MSW',
});

export const ALL_AUTH_SERVICES = [
  AUTH_SERVICE.SN,
  AUTH_SERVICE.PT,
  AUTH_SERVICE.OT,
  AUTH_SERVICE.ST,
  AUTH_SERVICE.HHA,
  AUTH_SERVICE.MSW,
];

// ── Division / facility setting ──────────────────────────────────────────────
export const DIVISION = Object.freeze({
  ALF:           'ALF',
  SPECIAL_NEEDS: 'Special Needs',
});

export const FACILITY_SETTING = Object.freeze({
  HOME:       'home',
  ALF:        'alf',
  ALP:        'alp',
  ADULT_HOME: 'adult_home',
});

export const FACILITY_SETTING_OPTIONS = [
  { value: FACILITY_SETTING.HOME,       label: 'Home / Community' },
  { value: FACILITY_SETTING.ALF,        label: 'ALF (Assisted Living Facility)' },
  { value: FACILITY_SETTING.ALP,        label: 'ALP (Assisted Living Program)' },
  { value: FACILITY_SETTING.ADULT_HOME, label: 'Adult Home' },
];

// ── Clinical category (shifts billing rules; staff-selected) ─────────────────
export const CLINICAL_CATEGORY = Object.freeze({
  POST_ACUTE_RECOVERY:       'post_acute_recovery',
  LONG_TERM_SUPPORTS:        'long_term_supports',
  DEVELOPMENTALLY_DISABLED:  'developmentally_disabled',
  HOSPICE_ADJACENT:          'hospice_adjacent',
  NOT_CLASSIFIED:            'not_classified',
});

export const CLINICAL_CATEGORY_OPTIONS = [
  { value: CLINICAL_CATEGORY.POST_ACUTE_RECOVERY,      label: 'Post-Acute Recovery' },
  { value: CLINICAL_CATEGORY.LONG_TERM_SUPPORTS,       label: 'Long-Term Supports' },
  { value: CLINICAL_CATEGORY.DEVELOPMENTALLY_DISABLED, label: 'Developmentally Disabled' },
  { value: CLINICAL_CATEGORY.HOSPICE_ADJACENT,         label: 'Hospice-Adjacent' },
  { value: CLINICAL_CATEGORY.NOT_CLASSIFIED,           label: 'Not Classified' },
];

// ── Conflict reasons (structured; replaces legacy booleans) ──────────────────
// When staff route a referral to Conflict from Eligibility or Authorization,
// they must select at least one of these. Legacy yes/no fields on the main
// form are REMOVED; they are only surfaced here as structured selectable
// reasons when the staff member explicitly initiates a conflict.
export const CONFLICT_REASON = Object.freeze({
  OPEN_HH_EPISODE:       'open_hh_episode',
  HOSPICE_OVERLAP:       'hospice_overlap',
  SNF_PRESENT:           'snf_present',
  CDPAP_ACTIVE:          'cdpap_active',
  AUTH_REQUIRED:         'auth_required',
  DISENROLLMENT_NEEDED:  'disenrollment_needed',
  AUTH_DENIED:           'auth_denied',
  PAYER_NOT_BILLABLE:    'payer_not_billable',
  COVERAGE_NOT_ACTIVE:   'coverage_not_active',
  ORDER_UNCLEAR:         'order_unclear',
  SERVICE_NOT_ALLOWED:   'service_not_allowed',
  OTHER:                 'other',
});

export const CONFLICT_REASON_OPTIONS = [
  { value: CONFLICT_REASON.OPEN_HH_EPISODE,      label: 'Open HH Episode (another agency)' },
  { value: CONFLICT_REASON.HOSPICE_OVERLAP,      label: 'Hospice Overlap' },
  { value: CONFLICT_REASON.SNF_PRESENT,          label: 'SNF Present' },
  { value: CONFLICT_REASON.CDPAP_ACTIVE,         label: 'CDPAP Active' },
  { value: CONFLICT_REASON.AUTH_REQUIRED,        label: 'Auth Required But Not Obtained' },
  { value: CONFLICT_REASON.DISENROLLMENT_NEEDED, label: 'Disenrollment Needed' },
  { value: CONFLICT_REASON.AUTH_DENIED,          label: 'Auth Denied by Payer' },
  { value: CONFLICT_REASON.PAYER_NOT_BILLABLE,   label: 'Payer Not Billable by Agency' },
  { value: CONFLICT_REASON.COVERAGE_NOT_ACTIVE,  label: 'Coverage Not Active / Terminated' },
  { value: CONFLICT_REASON.ORDER_UNCLEAR,        label: 'Payer Order Unclear' },
  { value: CONFLICT_REASON.SERVICE_NOT_ALLOWED,  label: 'Requested Service Not Allowed in This Setting' },
  { value: CONFLICT_REASON.OTHER,                label: 'Other (describe in details)' },
];

// ── Legacy flag → conflict reason map ────────────────────────────────────────
// Used by policy + migration code to translate legacy InsuranceChecks
// boolean flags into structured conflict reasons. Source of truth for the
// one-way mapping: do NOT reverse this for new writes.
export const LEGACY_FLAG_TO_CONFLICT_REASON = Object.freeze({
  has_open_hh_episode:  CONFLICT_REASON.OPEN_HH_EPISODE,
  hospice_overlap:      CONFLICT_REASON.HOSPICE_OVERLAP,
  snf_present:          CONFLICT_REASON.SNF_PRESENT,
  cdpap_active:         CONFLICT_REASON.CDPAP_ACTIVE,
  auth_required:        CONFLICT_REASON.AUTH_REQUIRED,
  disenrollment_needed: CONFLICT_REASON.DISENROLLMENT_NEEDED,
});

// ── SCA / downstream states ──────────────────────────────────────────────────
export const SCA_STATUS = Object.freeze({
  NONE:          'none',
  REQUESTED:     'requested',
  UNDER_REVIEW:  'under_review',
  GRANTED:       'granted',
  DECLINED:      'declined',
});

export const SCA_STATUS_OPTIONS = [
  { value: SCA_STATUS.NONE,         label: '—' },
  { value: SCA_STATUS.REQUESTED,    label: 'Requested' },
  { value: SCA_STATUS.UNDER_REVIEW, label: 'Under Review' },
  { value: SCA_STATUS.GRANTED,      label: 'Granted' },
  { value: SCA_STATUS.DECLINED,     label: 'Declined' },
];

// ── Resolution status for Conflict records ──────────────────────────────────
export const RESOLUTION_STATUS = Object.freeze({
  OPEN:        'open',
  IN_PROGRESS: 'in_progress',
  RESOLVED:    'resolved',
  WAIVED:      'waived',
});

// ── Disenrollment assistance flag types ─────────────────────────────────────
export const DISENROLLMENT_FLAG_TYPE = Object.freeze({
  EXPERT_MEDICAID_ASSIST: 'expert_medicaid_assist',
});

export const DISENROLLMENT_FLAG_STATUS = Object.freeze({
  OPEN:       'open',
  IN_REVIEW:  'in_review',
  COMPLETED:  'completed',
  CANCELLED:  'cancelled',
});

// ── Source module for Conflict records ──────────────────────────────────────
export const CONFLICT_SOURCE_MODULE = Object.freeze({
  ELIGIBILITY:   'eligibility',
  AUTHORIZATION: 'authorization',
  CLINICAL:      'clinical',
  INTAKE:        'intake',
  OTHER:         'other',
});

// ── Routing action names (used by activity log + routingPolicies) ───────────
export const ROUTING_ACTION = Object.freeze({
  SEND_TO_CONFLICT:           'send_to_conflict',
  SEND_TO_FOLLOW_UP:          'send_to_follow_up',
  REQUEST_SCA:                'request_sca',
  ROUTE_TO_OPWDD:             'route_to_opwdd',
  FLAG_DISENROLLMENT_ASSIST:  'flag_disenrollment_assist',
  ADVANCE_TO_AUTHORIZATION:   'advance_to_authorization',
  ADVANCE_TO_STAFFING:        'advance_to_staffing',
});

// ── Activity log action labels ──────────────────────────────────────────────
// Extends the existing ActivityLog action enum. These must match what the
// audit-log writer records for the eligibility/authorization flows.
export const AUDIT_ACTION = Object.freeze({
  INSURANCE_ADDED:               'insurance_added',
  INSURANCE_EDITED:              'insurance_edited',
  ELIGIBILITY_CHECKED:           'eligibility_checked',
  PAYER_ORDER_CHANGED:           'payer_order_changed',
  PAYER_TYPE_CHANGED:            'payer_type_changed',
  ELIGIBILITY_SENT_TO_CONFLICT:  'eligibility_sent_to_conflict',
  AUTH_APPROVED:                 'auth_approved',
  AUTH_DENIED:                   'auth_denied',
  AUTH_NAR_RECORDED:             'auth_nar_recorded',
  AUTH_FOLLOW_UP_SCHEDULED:      'auth_follow_up_scheduled',
  OPWDD_ROUTE_TRIGGERED:         'opwdd_route_triggered',
  DISENROLLMENT_ASSIST_FLAGGED:  'disenrollment_assist_flagged',
  SCA_REQUESTED:                 'sca_requested',
  NAR_SUGGESTION_CONFIRMED:      'nar_suggestion_confirmed',
});

// ── Helpers ─────────────────────────────────────────────────────────────────
export const ALL_INSURANCE_CATEGORIES = Object.values(INSURANCE_CATEGORY);
export const ALL_VERIFICATION_SOURCES = Object.values(VERIFICATION_SOURCE);
export const ALL_VERIFICATION_STATUSES = Object.values(VERIFICATION_STATUS);
export const ALL_AUTH_STATUSES = Object.values(AUTH_STATUS);
export const ALL_CONFLICT_REASONS = Object.values(CONFLICT_REASON);
export const ALL_ORDER_RANKS = Object.values(ORDER_RANK);
