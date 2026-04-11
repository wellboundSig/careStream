/**
 * Triage completeness checker.
 * Returns true only when every required field is filled — this gates
 * the "Triage" checkoff in the patient snapshot.
 */

const ADULT_REQUIRED = [
  'caregiver_name',
  'caregiver_phone',
  'has_pets',           // boolean — must be explicitly true or false
  'has_homecare_services',
  'has_community_hab',
  'code_95',
  'services_needed',    // array — must have length > 0
  'therapy_availability',
  'is_diabetic',
  'pcp_name',
  'pcp_last_visit',
  'pcp_phone',
  'cm_name',
  'cm_company',
  'cm_phone',
];

const ADULT_CONDITIONAL = [
  { gate: 'has_pets', require: ['pet_details'] },
  { gate: 'has_homecare_services', require: ['homecare_agency_name', 'homecare_hours', 'homecare_days'] },
  { gate: 'is_diabetic', require: ['diabetes_monitor_by'] },
];

const PEDIATRIC_REQUIRED = [
  'phone_call_made_to',
  'household_description',
  'has_pets',
  'has_homecare_services',
  'has_community_hab',
  'has_boe_services',
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
  'cm_name',
  'cm_phone',
];

const PEDIATRIC_CONDITIONAL = [
  { gate: 'has_pets', require: ['pet_details'] },
  { gate: 'has_homecare_services', require: ['homecare_agency_name', 'homecare_hours', 'homecare_days'] },
  { gate: 'is_diabetic', require: ['diabetes_monitor_by'] },
  { gate: 'has_recent_hospitalization', require: ['recent_hospitalization'] },
  { gate: 'has_boe_services', require: ['boe_services'] },
];

function isTruthy(val) {
  if (val === true || val === 'true' || val === 'TRUE' || val === 'yes') return true;
  return false;
}

function isFilled(val) {
  if (val === null || val === undefined) return false;
  if (typeof val === 'boolean') return true; // boolean fields: any explicit value counts
  if (Array.isArray(val)) return val.length > 0;
  if (typeof val === 'string') return val.trim().length > 0;
  return !!val;
}

function isBooleanAnswered(val) {
  if (val === null || val === undefined || val === '') return false;
  return val === true || val === false || val === 'true' || val === 'false' || val === 'TRUE' || val === 'FALSE' || val === 'yes' || val === 'no';
}

/**
 * Check if a triage record is complete.
 * @param {object} data - triage record fields
 * @param {'adult'|'pediatric'} type
 * @returns {{ complete: boolean, missing: string[] }}
 */
export function isTriageComplete(data, type) {
  if (!data) return { complete: false, missing: ['No triage data'] };

  const required = type === 'pediatric' ? PEDIATRIC_REQUIRED : ADULT_REQUIRED;
  const conditional = type === 'pediatric' ? PEDIATRIC_CONDITIONAL : ADULT_CONDITIONAL;
  const missing = [];

  const BOOLEAN_FIELDS = new Set([
    'has_pets', 'has_homecare_services', 'has_community_hab', 'is_diabetic',
    'immunizations_up_to_date', 'has_recent_hospitalization', 'has_boe_services',
  ]);

  for (const key of required) {
    if (BOOLEAN_FIELDS.has(key)) {
      if (!isBooleanAnswered(data[key])) missing.push(key);
    } else if (!isFilled(data[key])) {
      missing.push(key);
    }
  }

  for (const rule of conditional) {
    if (isTruthy(data[rule.gate])) {
      for (const dep of rule.require) {
        if (!isFilled(data[dep])) missing.push(dep);
      }
    }
  }

  return { complete: missing.length === 0, missing };
}

/** Returns the list of all required field keys for a given triage type. */
export function getRequiredFields(type) {
  return type === 'pediatric' ? [...PEDIATRIC_REQUIRED] : [...ADULT_REQUIRED];
}
