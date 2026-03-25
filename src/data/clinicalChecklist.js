/**
 * Clinical Intake RN Review Checklist
 *
 * PLACEHOLDER — replace with final version from Shayna and Olesya when ready.
 * This file is the single source of truth for the checklist structure.
 * Items are grouped by section. Each item has a unique key.
 *
 * The checklist is UI-managed state only (not persisted to Airtable).
 * The confirm button is locked until all required items are checked.
 */

export const CLINICAL_CHECKLIST = [
  {
    section: 'Clinical Appropriateness',
    items: [
      { key: 'dx_reviewed',       label: 'Primary diagnosis reviewed',               required: true },
      { key: 'comorbidities',     label: 'Comorbidities noted',                      required: true },
      { key: 'hospitalization',   label: 'Recent hospitalization / event reviewed',   required: true },
      { key: 'skilled_need',      label: 'Skilled need identified',                  required: true },
    ],
  },
  {
    section: 'Home Health Eligibility',
    items: [
      { key: 'homebound',         label: 'Patient meets homebound criteria',         required: true },
      { key: 'physician_cert',    label: 'Physician certification / order present or pending', required: true },
      { key: 'medical_necessity', label: 'Medical necessity established',            required: true },
    ],
  },
  {
    section: 'Medication & Safety Review',
    items: [
      { key: 'med_list',          label: 'Medication list reviewed',                 required: true },
      { key: 'high_risk_meds',    label: 'High-risk medications flagged',            required: false },
      { key: 'allergies',         label: 'Allergies documented',                     required: true },
      { key: 'safety_risks',      label: 'Safety risks identified',                 required: false },
    ],
  },
  {
    section: 'Level of Care Determination',
    items: [
      { key: 'loc_sn',            label: 'Skilled Nursing needed',                   required: false },
      { key: 'loc_pt',            label: 'Physical Therapy needed',                  required: false },
      { key: 'loc_ot',            label: 'Occupational Therapy needed',              required: false },
      { key: 'loc_st',            label: 'Speech Therapy needed',                    required: false },
      { key: 'loc_hha',           label: 'Home Health Aide needed',                  required: false },
    ],
  },
  {
    section: 'Risk Stratification',
    items: [
      { key: 'risk_high',         label: 'High risk',                               required: false, exclusive: 'risk' },
      { key: 'risk_moderate',     label: 'Moderate risk',                            required: false, exclusive: 'risk' },
      { key: 'risk_low',          label: 'Low risk',                                 required: false, exclusive: 'risk' },
    ],
  },
  {
    section: 'SOC Planning',
    items: [
      { key: 'soc_timeframe',     label: 'SOC timeframe assigned',                  required: true },
      { key: 'scheduling_needs',  label: 'Special scheduling needs identified',     required: false },
      { key: 'clinician_match',   label: 'Clinician skill match required',           required: false },
    ],
  },
];

export const ALL_CHECKLIST_ITEMS = CLINICAL_CHECKLIST.flatMap((g) => g.items);
export const REQUIRED_ITEMS = ALL_CHECKLIST_ITEMS.filter((i) => i.required);

export function isChecklistComplete(checked) {
  return REQUIRED_ITEMS.every((item) => checked[item.key]);
}

export const CLINICAL_DECISIONS = [
  { key: 'accept', label: 'Accept', color: 'green' },
  { key: 'conditional', label: 'Conditional Accept', color: 'yellow' },
  { key: 'decline', label: 'Decline', color: 'red' },
];
