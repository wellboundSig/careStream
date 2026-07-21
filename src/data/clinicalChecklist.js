/**
 * Clinical Intake RN Review Checklist
 *
 * Single source of truth for the checklist structure. Items are grouped by
 * section and each item has a unique `key`.
 *
 * Persistence (2026-05-27)
 * ------------------------
 * Checklist responses are persisted to the `ClinicalReview` Airtable table —
 * one row per referral, upserted by `upsertClinicalReview` and surfaced via
 * `useClinicalReview`. The `dbField` on every item is the Airtable column
 * name; the UI key / DB column split mirrors the F2F CursoryReview pattern
 * so we can rename UI keys in the future without re-migrating data.
 *
 * The confirm button on the Clinical RN panel is locked until all required
 * items are checked.
 */

export const CLINICAL_CHECKLIST = [
  {
    section: 'Clinical Appropriateness',
    items: [
      { key: 'dx_reviewed',       dbField: 'dx_reviewed',       label: 'Primary diagnosis reviewed',                required: true },
      { key: 'comorbidities',     dbField: 'comorbidities',     label: 'Comorbidities noted',                       required: true },
      { key: 'hospitalization',   dbField: 'hospitalization',   label: 'Recent hospitalization / event reviewed',   required: true },
      { key: 'skilled_need',      dbField: 'skilled_need',      label: 'Skilled need identified',                   required: true },
    ],
  },
  {
    section: 'Home Health Eligibility',
    items: [
      { key: 'homebound',         dbField: 'homebound',         label: 'Patient meets homebound criteria',                  required: true },
      { key: 'physician_cert',    dbField: 'physician_cert',    label: 'Physician certification / order present or pending', required: true },
      { key: 'medical_necessity', dbField: 'medical_necessity', label: 'Medical necessity established',                     required: true },
    ],
  },
  {
    section: 'Medication & Safety Review',
    items: [
      { key: 'med_list',          dbField: 'med_list',          label: 'Medication list reviewed',                 required: true },
      { key: 'high_risk_meds',    dbField: 'high_risk_meds',    label: 'High-risk medications flagged',            required: false },
      { key: 'allergies',         dbField: 'allergies',         label: 'Allergies documented',                     required: true },
      { key: 'safety_risks',      dbField: 'safety_risks',      label: 'Safety risks identified',                  required: false },
    ],
  },
  {
    section: 'Level of Care Validation',
    items: [
      { key: 'loc_sn',            dbField: 'loc_sn',            label: 'Skilled Nursing needed',                   required: false },
      { key: 'loc_pt',            dbField: 'loc_pt',            label: 'Physical Therapy needed',                  required: false },
      { key: 'loc_ot',            dbField: 'loc_ot',            label: 'Occupational Therapy needed',              required: false },
      { key: 'loc_st',            dbField: 'loc_st',            label: 'Speech Therapy needed',                    required: false },
      { key: 'loc_hha',           dbField: 'loc_hha',           label: 'Home Health Aide needed',                  required: false },
    ],
  },
  {
    section: 'Risk Stratification',
    items: [
      { key: 'risk_high',         dbField: 'risk_high',         label: 'High risk',                                required: false, exclusive: 'risk' },
      { key: 'risk_moderate',     dbField: 'risk_moderate',     label: 'Moderate risk',                            required: false, exclusive: 'risk' },
      { key: 'risk_low',          dbField: 'risk_low',          label: 'Low risk',                                 required: false, exclusive: 'risk' },
    ],
  },
  {
    section: 'SOC Planning',
    items: [
      { key: 'soc_timeframe',     dbField: 'soc_timeframe',     label: 'SOC timeframe assigned',                   required: true },
      { key: 'scheduling_needs',  dbField: 'scheduling_needs',  label: 'Special scheduling needs identified',      required: false },
      { key: 'clinician_match',   dbField: 'clinician_match',   label: 'Clinician skill match required',           required: false },
    ],
  },
];

export const ALL_CHECKLIST_ITEMS = CLINICAL_CHECKLIST.flatMap((g) => g.items);
export const REQUIRED_ITEMS = ALL_CHECKLIST_ITEMS.filter((i) => i.required);

export function isChecklistComplete(checked) {
  return REQUIRED_ITEMS.every((item) => checked[item.key]);
}

// ── Risk Stratification (mutually exclusive group) ─────────────────────────
// The three risk-level items carry `exclusive: 'risk'` so they render as a
// single dropdown (you can't be both "high risk" and "low risk"). The UI keeps
// the underlying schema unchanged — three checkbox columns in Airtable — and
// just toggles them as a group at the boundary.
export const RISK_KEYS = ALL_CHECKLIST_ITEMS
  .filter((i) => i.exclusive === 'risk')
  .map((i) => i.key);

export const RISK_OPTIONS = ALL_CHECKLIST_ITEMS
  .filter((i) => i.exclusive === 'risk')
  .map((i) => ({ value: i.key, label: i.label }));

/** Returns the currently-selected risk key, or '' if none. */
export function getRiskLevel(checked) {
  for (const k of RISK_KEYS) if (checked?.[k]) return k;
  return '';
}

// Convenient lookup tables for the persistence layer (see api/clinicalReviews.js).
export const CLINICAL_UI_TO_DB = Object.fromEntries(ALL_CHECKLIST_ITEMS.map((i) => [i.key, i.dbField]));
export const CLINICAL_DB_TO_UI = Object.fromEntries(ALL_CHECKLIST_ITEMS.map((i) => [i.dbField, i.key]));

// Decline was removed 2026-05-20. Per the workflow overhaul, RNs who find
// an issue should create a Conflict instead of declining — the Conflict
// workflow captures the reason structurally and is reversible. Keeping the
// `decline` key absent from this catalog ensures the option never reappears
// in the UI; the historical `decline` value on Referrals.clinical_review_decision
// is still readable for legacy records.
export const CLINICAL_DECISIONS = [
  { key: 'accept', label: 'Accept', color: 'green' },
  { key: 'conditional', label: 'Conditional', color: 'yellow' },
];
