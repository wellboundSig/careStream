/**
 * Triage completeness checker (v2 — 2026-05-27 spec).
 *
 * Implements careStream/triage_forms_spec.md.
 *
 * Three-state boolean logic:
 *   true  / 'true'  / 'TRUE'  / 'Yes' = YES (answered)
 *   false / 'false' / 'FALSE' / 'No'  = NO (answered)
 *   null  / undefined / ''            = UNANSWERED (incomplete)
 *
 * Conditional logic per spec:
 *   - A child field is required ONLY when its parent gate is answered Yes
 *     (or in one case, No — `emergency_same_as_primary`).
 *   - A gate that's null/empty itself is incomplete.
 *
 * Validation:
 *   - Phone fields must normalize to a valid 10-digit US number.
 *   - Email fields must pass `validator/isEmail`.
 *   - The 3-state OPWDD status field must be one of the three enum values.
 *   - Multi-select fields (services_needed) must be a non-empty array.
 *
 * Back-compat:
 *   - When a column is completely missing from the data object (e.g. an
 *     Airtable column hasn't been added yet), it's SKIPPED rather than
 *     marked missing. This protects against the schema-migration race
 *     where the UI was already shipped but `npm run schema:apply` hasn't
 *     been run on the base yet.
 */

import { normalizePhone } from './validation.js';
import isEmail from 'validator/lib/isEmail.js';

const OPWDD_STATUS_VALUES = new Set(['OPWDD Eligible', 'OPWDD Pending', 'Non-OPWDD']);

const CCO_NAMES = new Set([
  'Advance Care Alliance (ACA/NY)',
  'Care Design NY',
  'Tri-County Care',
]);

// ── Required field lists (always required when present in data) ─────────────

const ADULT_REQUIRED = [
  // OPWDD
  'opwdd_status',
  // Eligibility
  'insurance_plan_name',
  'medicaid_number',
  // Patient Information
  'patient_name',
  'dob',
  'address',
  'email',
  // Caregiver Information
  'caregiver_name',
  'caregiver_phone',
  'add_secondary_caregiver',
  // Home Environment
  'has_pets',
  'has_smoking',
  // Current Services
  'has_homecare_services',
  'has_community_hab',
  'has_in_home_therapies',
  // Requested Services
  'services_needed',
  // Clinical Information
  'health_conditions',
  // PCP Information
  'pcp_name',
  'pcp_last_visit',
  'pcp_phone',
  'pcp_fax',
  'pcp_address',
  'pcp_npi_number',
  // Care Management — CCO still required; CM contact fields are optional
  'cco_name',
];

const PEDIATRIC_REQUIRED = [
  // OPWDD
  'opwdd_status',
  // Eligibility
  'medicaid_number',
  // Contact Information
  'phone_call_made_to',
  'primary_caregiver_name',
  'primary_caregiver_phone',
  'add_secondary_caregiver',
  'emergency_same_as_primary',
  'email',
  // Patient Information
  'patient_name',
  'dob',
  'address',
  // Home Environment
  'has_pets',
  'has_smoking',
  // Current Services
  'has_homecare_services',
  'boe_services',
  'has_community_hab',
  // Requested Services
  'services_needed',
  // Clinical Information
  'health_conditions',
  'school_bus_time',
  'has_recent_hospitalization',
  // PCP Information
  'pcp_name',
  'pcp_last_visit',
  'pcp_phone',
  'pcp_fax',
  'pcp_address',
  // Care Management — CCO still required; CM contact fields are optional
  'cco_name',
];

// ── Conditional rules. `when: 'Yes' | 'No'` selects which gate state
//    activates the child. Default 'Yes'. ──────────────────────────────────────

const ADULT_CONDITIONAL = [
  { gate: 'add_secondary_caregiver', when: 'Yes', require: ['secondary_caregiver_name', 'secondary_caregiver_phone'] },
  { gate: 'has_homecare_services',   when: 'Yes', require: ['homecare_agency_name', 'homecare_hours_days'] },
  { gate: 'has_in_home_therapies',   when: 'Yes', require: ['current_therapy_services'] },
  // services_needed branches — see resolveServiceConditionals().
];

const PEDIATRIC_CONDITIONAL = [
  { gate: 'add_secondary_caregiver',   when: 'Yes', require: ['secondary_caregiver_name', 'secondary_caregiver_phone'] },
  { gate: 'emergency_same_as_primary', when: 'No',  require: ['emergency_contact_name', 'emergency_contact_phone'] },
  { gate: 'has_homecare_services',     when: 'Yes', require: ['homecare_agency_name', 'homecare_hours_days'] },
  // services_needed branches — see resolveServiceConditionals().
];

// ── Field type sets ─────────────────────────────────────────────────────────

const BOOLEAN_FIELDS = new Set([
  'add_secondary_caregiver',
  'has_pets',
  'has_smoking',
  'has_homecare_services',
  'has_community_hab',
  'has_in_home_therapies',
  'emergency_same_as_primary',
  'has_recent_hospitalization',
]);

const PHONE_FIELDS = new Set([
  'caregiver_phone',
  'primary_caregiver_phone',
  'secondary_caregiver_phone',
  'emergency_contact_phone',
  'pcp_phone',
  'pcp_fax',
  'cm_phone',
  'cm_fax',
]);

const EMAIL_FIELDS = new Set([
  'email',
  'cm_email',
]);

const ENUM_FIELDS = {
  opwdd_status: OPWDD_STATUS_VALUES,
  cco_name: CCO_NAMES,
};

const MULTI_SELECT_FIELDS = new Set(['services_needed']);

// NPI: federally-assigned 10-digit identifier. Validate digits-only length.
const NPI_FIELDS = new Set(['pcp_npi_number']);

// ── Value normalization helpers ─────────────────────────────────────────────

export function isBooleanAnswered(val) {
  if (val === true || val === false) return true;
  if (val === null || val === undefined || val === '') return false;
  if (typeof val === 'string') {
    const lower = val.toLowerCase();
    return lower === 'true' || lower === 'false' || lower === 'yes' || lower === 'no';
  }
  return false;
}

export function isYes(val) {
  if (val === true) return true;
  if (typeof val === 'string') {
    const lower = val.toLowerCase();
    return lower === 'true' || lower === 'yes';
  }
  return false;
}

export function isNo(val) {
  if (val === false) return true;
  if (typeof val === 'string') {
    const lower = val.toLowerCase();
    return lower === 'false' || lower === 'no';
  }
  return false;
}

function isFilled(val) {
  if (val === null || val === undefined) return false;
  if (typeof val === 'boolean') return true;
  if (Array.isArray(val)) return val.length > 0;
  if (typeof val === 'string') return val.trim().length > 0;
  return !!val;
}

function isValidPhone(val) {
  if (!val) return false;
  const r = normalizePhone(String(val));
  return r.valid === true;
}

function isValidEmail(val) {
  if (!val || typeof val !== 'string') return false;
  const trimmed = val.trim();
  return trimmed.length > 0 && isEmail(trimmed);
}

function isValidNpi(val) {
  if (!val) return false;
  const digits = String(val).replace(/\D/g, '');
  return digits.length === 10;
}

function checkField(key, val) {
  if (BOOLEAN_FIELDS.has(key)) return isBooleanAnswered(val);
  if (PHONE_FIELDS.has(key)) return isValidPhone(val);
  if (EMAIL_FIELDS.has(key)) return isValidEmail(val);
  if (NPI_FIELDS.has(key)) return isValidNpi(val);
  if (ENUM_FIELDS[key]) return typeof val === 'string' && ENUM_FIELDS[key].has(val);
  if (MULTI_SELECT_FIELDS.has(key)) return Array.isArray(val) && val.length > 0;
  return isFilled(val);
}

// ── services_needed → conditional children ──────────────────────────────────

function resolveServiceConditionals(type, services) {
  const arr = Array.isArray(services) ? services : [];
  // Therapy availability is required when ANY therapy modality is selected.
  // Spec uses long names ("Physical Therapy (P.T.)" etc.) but the existing DB
  // option values are PT / OT / ST. Match either.
  const hasTherapy = arr.some((s) =>
    /^(PT|OT|ST|Physical Therapy|Occupational Therapy|Speech Therapy)/i.test(String(s)),
  );
  const required = [];
  if (hasTherapy) required.push('therapy_availability');
  if (type === 'adult') {
    const hasHha = arr.some((s) => /^(HHA|Home Health Aide)/i.test(String(s)));
    if (hasHha) required.push('hha_hours_frequency');
  }
  return required;
}

// ── Public API ──────────────────────────────────────────────────────────────

export function isTriageComplete(data, type) {
  if (!data) return { complete: false, missing: ['No triage data'] };

  const required  = type === 'pediatric' ? PEDIATRIC_REQUIRED  : ADULT_REQUIRED;
  const condRules = type === 'pediatric' ? PEDIATRIC_CONDITIONAL : ADULT_CONDITIONAL;
  const missing = [];

  // Every required field is checked. Legacy records that pre-date the v2
  // schema will show as incomplete here (they ARE — they need to be
  // re-validated against the new spec), and that's the desired behavior:
  // the patient snapshot dot doesn't go green until staff opens the new
  // triage form and fills in the remaining fields.
  for (const key of required) {
    if (!checkField(key, data[key])) missing.push(key);
  }

  // Yes/No-gated conditional children.
  for (const rule of condRules) {
    const gateVal = data[rule.gate];
    const expect = rule.when || 'Yes';
    const triggered = expect === 'Yes' ? isYes(gateVal) : isNo(gateVal);
    if (!triggered) continue;
    for (const dep of rule.require) {
      if (!checkField(dep, data[dep])) missing.push(dep);
    }
  }

  // services_needed conditional children (therapy_availability / hha_hours_frequency).
  for (const dep of resolveServiceConditionals(type, data.services_needed)) {
    if (!checkField(dep, data[dep])) missing.push(dep);
  }

  return { complete: missing.length === 0, missing };
}

export function getRequiredFields(type) {
  return type === 'pediatric' ? [...PEDIATRIC_REQUIRED] : [...ADULT_REQUIRED];
}

// Re-exported so the form can use the same rules to decide visibility.
export {
  ADULT_CONDITIONAL,
  PEDIATRIC_CONDITIONAL,
  BOOLEAN_FIELDS,
  PHONE_FIELDS,
  EMAIL_FIELDS,
  ENUM_FIELDS,
  MULTI_SELECT_FIELDS,
  NPI_FIELDS,
  OPWDD_STATUS_VALUES,
  CCO_NAMES,
};
