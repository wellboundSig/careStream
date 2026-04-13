/**
 * Triage completeness checker.
 *
 * Three-state boolean logic:
 *   true / 'true' / 'TRUE' / 'Yes' = YES (answered)
 *   false / 'false' / 'FALSE' / 'No' = NO (answered)
 *   null / undefined / '' = UNANSWERED (incomplete)
 *
 * Conditional logic:
 *   If a Yes/No gate is answered "No", sub-fields are NOT required.
 *   If a Yes/No gate is answered "Yes", sub-fields ARE required.
 *   If a Yes/No gate is unanswered, it's marked as missing.
 */

// Always required for adult triage
const ADULT_REQUIRED = [
  'caregiver_name',
  'caregiver_phone',
  'caregiver_email',
  'has_pets',
  'has_homecare_services',
  'has_community_hab',
  'code_95',
  'services_needed',
  'therapy_availability',
  'is_diabetic',
  'pcp_name',
  'pcp_last_visit',
  'pcp_phone',
  'pcp_fax',
  'pcp_address',
  'cm_name',
  'cm_company',
  'cm_phone',
  'cm_fax_or_email',
];

// Only required when the gate field is Yes
const ADULT_CONDITIONAL = [
  { gate: 'has_pets', require: ['pet_details'] },
  { gate: 'has_homecare_services', require: ['homecare_agency_name', 'homecare_hours', 'homecare_days'] },
  { gate: 'is_diabetic', require: ['diabetes_monitor_by'] },
];

// Always required for pediatric triage
// Note: has_boe_services and has_recent_hospitalization are only required
// if the column exists in the DB. If missing from the data entirely, skip.
const PEDIATRIC_REQUIRED = [
  'phone_call_made_to',
  'household_description',
  'has_pets',
  'has_homecare_services',
  'has_community_hab',
  'code_95',
  'services_needed',
  'therapy_availability',
  'hha_hours_frequency',
  'is_diabetic',
  'immunizations_up_to_date',
  'school_bus_time',
  'has_recent_hospitalization',
  'pcp_name',
  'pcp_last_visit',
  'pcp_phone',
  'pcp_fax',
  'pcp_address',
  'cm_name',
  'cm_phone',
];

const PEDIATRIC_CONDITIONAL = [
  { gate: 'has_pets', require: ['pet_details'] },
  { gate: 'has_homecare_services', require: ['homecare_agency_name', 'homecare_hours', 'homecare_days'] },
  { gate: 'is_diabetic', require: ['diabetes_monitor_by'] },
  { gate: 'has_recent_hospitalization', require: ['hospitalization_note'] },
  { gate: 'has_boe_services', require: ['boe_services'] },
];

const BOOLEAN_FIELDS = new Set([
  'has_pets', 'has_homecare_services', 'has_community_hab', 'is_diabetic',
  'immunizations_up_to_date', 'has_recent_hospitalization', 'has_boe_services',
]);

const PHONE_FIELDS = new Set([
  'caregiver_phone', 'pcp_phone', 'pcp_fax', 'cm_phone',
]);

const EMAIL_FIELDS = new Set([
  'caregiver_email', 'cm_fax_or_email',
]);

function isBooleanAnswered(val) {
  if (val === true || val === false) return true;
  if (val === null || val === undefined || val === '') return false;
  if (typeof val === 'string') {
    const lower = val.toLowerCase();
    return lower === 'true' || lower === 'false' || lower === 'yes' || lower === 'no';
  }
  return false;
}

function isYes(val) {
  if (val === true) return true;
  if (typeof val === 'string') {
    const lower = val.toLowerCase();
    return lower === 'true' || lower === 'yes';
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
  const digits = String(val).replace(/\D/g, '');
  return digits.length === 10;
}

function isValidEmail(val) {
  if (!val || typeof val !== 'string') return false;
  const trimmed = val.trim();
  return trimmed.length > 0 && trimmed.includes('@') && trimmed.includes('.');
}

function checkField(key, val) {
  if (BOOLEAN_FIELDS.has(key)) return isBooleanAnswered(val);
  if (PHONE_FIELDS.has(key)) return isValidPhone(val);
  if (EMAIL_FIELDS.has(key)) return isValidEmail(val);
  return isFilled(val);
}

export function isTriageComplete(data, type) {
  if (!data) return { complete: false, missing: ['No triage data'] };

  const required = type === 'pediatric' ? PEDIATRIC_REQUIRED : ADULT_REQUIRED;
  const conditional = type === 'pediatric' ? PEDIATRIC_CONDITIONAL : ADULT_CONDITIONAL;
  const missing = [];

  // Check all always-required fields
  for (const key of required) {
    // If a boolean gate field doesn't exist in the data at all (column may not
    // exist in Airtable yet), skip it rather than blocking completion
    if (BOOLEAN_FIELDS.has(key) && !(key in data)) continue;
    if (!checkField(key, data[key])) missing.push(key);
  }

  // Conditional fields: only required when the gate is answered YES
  for (const rule of conditional) {
    if (isYes(data[rule.gate])) {
      for (const dep of rule.require) {
        if (!checkField(dep, data[dep])) missing.push(dep);
      }
    }
    // If gate is No or unanswered, sub-fields are NOT required
  }

  return { complete: missing.length === 0, missing };
}

export function getRequiredFields(type) {
  return type === 'pediatric' ? [...PEDIATRIC_REQUIRED] : [...ADULT_REQUIRED];
}
