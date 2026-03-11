export const CHECK_SOURCES = ['Waystar', 'ePACES', 'Availity', 'Manual'];

export const CHECK_FLAGS = [
  { key: 'has_open_hh_episode',  label: 'Open HH Episode' },
  { key: 'hospice_overlap',      label: 'Hospice Overlap' },
  { key: 'snf_present',          label: 'SNF Present' },
  { key: 'cdpap_active',         label: 'CDPAP Active' },
  { key: 'auth_required',        label: 'Auth Required' },
  { key: 'disenrollment_needed', label: 'Disenrollment Needed' },
];

export const MEDICARE_OPTIONS = [
  { value: '',          label: '— Not checked —' },
  { value: 'none',      label: 'Not enrolled / Inactive' },
  { value: 'ffs',       label: 'Traditional Medicare (Fee-for-Service)' },
  { value: 'advantage', label: 'Medicare Advantage (Managed)' },
];

export const MEDICAID_OPTIONS = [
  { value: '',      label: '— Not checked —' },
  { value: 'none',  label: 'Not enrolled / Inactive' },
  { value: 'ffs',   label: 'Straight Medicaid (Fee-for-Service)' },
  { value: 'mco',   label: 'Managed Medicaid (MCO)' },
];

export const COMMERCIAL_PLANS = [
  'Aetna',
  'Aetna Better Health of NY (Medicaid)',
  'Anthem / Empire BlueCross BlueShield',
  'Blue Cross Blue Shield',
  'CDPHP',
  'Cigna',
  'EmblemHealth / GHI / HIP',
  'Excellus BlueCross BlueShield',
  'Fidelis Care',
  'HealthFirst',
  'HealthPlus / Amerigroup',
  'Humana',
  'Independent Health',
  'MetroPlus',
  'Molina Healthcare',
  'MVP Health Care',
  'Oscar Health',
  'Oxford Health / United Healthcare',
  'United Healthcare',
  'United Healthcare Community Plan (Medicaid)',
  'WellCare / Centene',
  'Wellpoint',
  'Other — specify in notes',
];

export function buildCheckFields({ referralId, patientId, authorId, form, flagValues, isSN }) {
  const medicareActive = form.medicare_type === 'ffs' || form.medicare_type === 'advantage';
  const medicaidActive = form.medicaid_type === 'ffs' || form.medicaid_type === 'mco';
  const isManagedMedicare = form.medicare_type === 'advantage';
  const isManagedMedicaid = form.medicaid_type === 'mco';

  const noteParts = [];
  if (form.medicare_type) {
    const opt = MEDICARE_OPTIONS.find((o) => o.value === form.medicare_type);
    noteParts.push(`Medicare: ${opt?.label || form.medicare_type}`);
  }
  if (form.medicaid_type) {
    const opt = MEDICAID_OPTIONS.find((o) => o.value === form.medicaid_type);
    noteParts.push(`Medicaid: ${opt?.label || form.medicaid_type}`);
  }
  if (form.managed_care_plan) noteParts.push(`Plan: ${form.managed_care_plan}`);
  if (isSN && form.exception_code) noteParts.push(`Exception Code: ${form.exception_code}`);
  if (form.result_summary) noteParts.push(form.result_summary);

  return {
    id: `ic_${Date.now()}`,
    referral_id: referralId,
    patient_id: patientId,
    checked_by_id: authorId || 'unknown',
    check_source: form.check_source,
    check_date: new Date().toISOString(),
    medicare_part_a: medicareActive,
    medicare_part_b: medicareActive,
    medicaid_active: medicaidActive,
    managed_care_plan: (isManagedMedicare || isManagedMedicaid) ? (form.managed_care_plan || null) : null,
    managed_care_id: (isSN && form.exception_code) ? form.exception_code : null,
    result_summary: noteParts.join('\n') || null,
    created_at: new Date().toISOString(),
    ...Object.fromEntries(Object.entries(flagValues).map(([k, v]) => [k, v === 'true'])),
  };
}

export const EMPTY_CHECK_FORM = {
  check_source: 'Manual',
  medicare_type: '',
  medicaid_type: '',
  managed_care_plan: '',
  exception_code: '',
  result_summary: '',
};
