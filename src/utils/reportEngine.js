/**
 * reportEngine.js
 *
 * Schema definitions, filter formula building, data fetching with lookup
 * resolution, presets, and multi-tab Excel export (Summary + Detail + charts)
 * for the CareStream Reports page.
 */

// LEGACY FILENAME: airtable.js is the Aurora (wellbound-api) records client. Not Airtable. Do not add Airtable URLs, PATs, or bases.
import airtable from '../api/airtable.js';
import { getSignedFileUrl } from './r2Upload.js';
import { exportReportWorkbook, buildAutoSummary } from './reportWorkbook.js';
import { daysUntilCalendarDate } from './dateFormat.js';
import { isSocCompletedReferral } from '../data/stageConfig.js';
import { hoursToClinicalLeadPreCheck } from './clinicalLeadPreCheck.js';
import { normalizeEpisodeType } from './episodeType.js';
import {
  PROCESSING_OVERVIEW_EXPORT_COLUMNS,
  buildProcessingFlags,
  isInProcessingPool,
} from './processingOverview.js';
import {
  buildReferralSourceReport,
  uniqueLookupRecords,
} from './referralSourceReport.js';
import {
  REFERRAL_SPEED_COLUMNS,
  SOC_MISSING_DOCS_COLUMNS,
  MASTER_PATIENT_COLUMNS,
  buildReferralSpeedRows,
  summarizeReferralSpeed,
  buildSocMissingDocsRows,
  summarizeSocMissingDocs,
  buildMasterPatientRows,
  summarizeMasterPatient,
  indexLinkedByReferral,
} from './operationalReports.js';

// ── Enum constants (mirroring ERD) ────────────────────────────────────────────

export const STAGES = [
  'Clinical Lead Pre-Check', 'Lead Entry', 'Intake', 'Eligibility Verification', 'Disenrollment Required',
  'F2F/MD Orders Pending', 'Clinical Intake RN Review', 'Authorization Pending',
  'Conflict', 'EMR Onboarding', 'Staffing Feasibility', 'Admin Confirmation',
  'Pre-SOC', 'SOC Scheduled', 'SOC Completed',
  'Post Visit Intake', 'Post Visit Clinical Review', 'Completed',
  'Hold', 'NTUC',
];

export const ACTIVE_STAGES = STAGES.filter(
  (s) => s !== 'SOC Completed' && s !== 'Completed' && s !== 'NTUC',
);

export const DIVISIONS    = ['ALF', 'Special Needs'];
export const SERVICES     = ['SN', 'PT', 'OT', 'ST', 'HHA', 'ABA'];
export const PRIORITIES   = ['Low', 'Normal', 'High', 'Critical'];
export const F2F_URGENCY  = ['Green', 'Yellow', 'Orange', 'Red', 'Expired'];
export const REGIONS      = ['LI', 'Bronx', 'Westchester', 'NYC'];

// File categories offered by the Files report picker. Keep the standard list
// in sync with FilesTab's upload categories; OPWDD categories come from the
// shared enum.
import { OPWDD_FILE_CATEGORIES } from '../data/opwddEnums.js';
export const FILE_REPORT_CATEGORIES = [
  ...['F2F', 'MD Orders', 'Auth Letter', 'Insurance', 'Facesheet', 'Discharge', 'ID', 'Consent', 'Medications', 'Progress Notes', 'Miscellaneous', 'Other'],
  ...OPWDD_FILE_CATEGORIES,
].filter((c, i, arr) => arr.indexOf(c) === i);
// Keep in sync with referralSources/sourceConstants.js (directory catalog).
import { SOURCE_TYPES, REFERRAL_METHODS } from '../components/referralSources/sourceConstants.js';
export { SOURCE_TYPES, REFERRAL_METHODS };

// ── Lookup cache (session-scoped) ─────────────────────────────────────────────

const _lookupCache = {};

async function getLookupMap(tableName) {
  if (_lookupCache[tableName]) return _lookupCache[tableName];
  const recs = await airtable.fetchAll(tableName);
  const map = {};
  for (const r of recs) {
    // Key by both custom `id` field AND Airtable record id (r.id)
    const fields = r.fields;
    map[r.id] = fields;
    if (fields.id) map[fields.id] = fields;
  }
  _lookupCache[tableName] = map;
  return map;
}

export function clearLookupCache() {
  Object.keys(_lookupCache).forEach((k) => delete _lookupCache[k]);
}

// Resolver helpers
const resolve = {
  patient:  (f) => `${f?.first_name || ''} ${f?.last_name || ''}`.trim() || '—',
  marketer: (f) => `${f?.first_name || ''} ${f?.last_name || ''}`.trim() || '—',
  user:     (f) => `${f?.first_name || ''} ${f?.last_name || ''}`.trim() || '—',
  facility: (f) => f?.name || '—',
  source:   (f) => f?.name || '—',
  physician:(f) => f ? `Dr. ${f.last_name || ''} ${f.first_name || ''}`.trim() : '—',
  campaign: (f) => f?.name || '—',
};

// ── Table schemas for Custom Report Builder ───────────────────────────────────
// type: 'text' | 'enum' | 'boolean' | 'date' | 'number' | 'lookup'
// filterable: whether a filter control is shown for this field

export const TABLE_SCHEMAS = {
  Referrals: {
    label: 'Referrals',
    description: 'Every intake journey through the pipeline',
    groups: [
      {
        label: 'Patient',
        fields: [
          { key: '__patient_name',    label: 'Patient Name',       type: 'virtual', virtual: true },
          { key: '__patient_dob',     label: 'Date of Birth',      type: 'virtual', virtual: true },
          { key: '__patient_gender',  label: 'Gender',             type: 'virtual', virtual: true },
          { key: '__patient_address', label: 'Address',            type: 'virtual', virtual: true },
          { key: '__patient_phone',   label: 'Phone',              type: 'virtual', virtual: true },
          { key: '__patient_medicaid',label: 'Medicaid #',         type: 'virtual', virtual: true },
          { key: '__patient_medicare',label: 'Medicare #',         type: 'virtual', virtual: true },
          { key: '__patient_insplan', label: 'Insurance Plan',     type: 'virtual', virtual: true },
        ],
      },
      {
        label: 'Referral',
        fields: [
          { key: 'id',                   label: 'Referral ID',           type: 'text',    filterable: true },
          { key: 'division',             label: 'Division',              type: 'enum',    options: DIVISIONS,   filterable: true },
          { key: 'episode_type',         label: 'SOC / ROC',             type: 'enum',    options: ['SOC', 'ROC'], filterable: true },
          { key: 'current_stage',        label: 'Stage',                 type: 'enum',    options: STAGES,      filterable: true },
          { key: 'priority',             label: 'Priority',              type: 'enum',    options: PRIORITIES,  filterable: true },
          { key: 'services_requested',   label: 'Services Requested',    type: 'text',    filterable: false },
          { key: 'referral_date',        label: 'Referral Date',         type: 'date',    filterable: true },
          { key: 'admitted_date',        label: 'Admitted Date',         type: 'date',    filterable: true },
          { key: 'soc_scheduled_date',   label: 'SOC/ROC Scheduled Date', type: 'date',   filterable: true },
          { key: 'soc_completed_date',   label: 'SOC/ROC Completed Date', type: 'date',   filterable: true },
          { key: 'hchb_entered',         label: 'HCHB Entered',          type: 'boolean', filterable: true },
          { key: 'is_pecos_verified',    label: 'PECOS Verified',        type: 'boolean', filterable: true },
          { key: 'is_opra_verified',     label: 'OPRA Verified',         type: 'boolean', filterable: true },
          { key: 'created_at',           label: 'Created At',            type: 'date',    filterable: true },
          { key: 'updated_at',           label: 'Updated At',            type: 'date',    filterable: true },
        ],
      },
      {
        label: 'Ownership & Staff',
        fields: [
          { key: '__intake_owner',       label: 'Intake Owner',          type: 'virtual', virtual: true },
          { key: 'intake_owner_id',       label: 'Intake Owner ID (raw)', type: 'text',    filterable: true },
          { key: '__lead_created_by',   label: 'Lead Submitted By',     type: 'virtual', virtual: true },
          { key: 'lead_created_by_id',  label: 'Lead Submitted By ID (raw)', type: 'text', filterable: true },
          { key: '__hold_owner',         label: 'Hold Owner',            type: 'virtual', virtual: true },
          { key: 'hold_owner_id',        label: 'Hold Owner ID (raw)',   type: 'text',    filterable: true },
        ],
      },
      {
        label: 'F2F / Clinical',
        fields: [
          { key: 'f2f_date',                       label: 'F2F Date',                    type: 'date',    filterable: true },
          { key: 'f2f_expiration',                 label: 'F2F Expiration',              type: 'date',    filterable: true },
          { key: 'f2f_urgency',                    label: 'F2F Urgency',                 type: 'enum',    options: F2F_URGENCY, filterable: true },
          { key: 'f2f_date_logged_at',             label: 'F2F Logged At',               type: 'date',    filterable: true },
          { key: '__f2f_logged_by',                label: 'F2F Logged By',               type: 'virtual', virtual: true },
          { key: 'clinical_lead_precheck_approved_at', label: 'Lead Pre-Check At', type: 'date', filterable: true },
          { key: '__clinical_precheck_by', label: 'Lead Pre-Check By', type: 'virtual', virtual: true },
          { key: '__hours_to_precheck', label: 'Hours to Pre-Check Sign-off', type: 'virtual', virtual: true },
          { key: 'clinical_review_decision',       label: 'Clinical Decision',           type: 'enum',    options: ['accept', 'conditional', 'decline'], filterable: true },
          { key: 'clinical_review_at',             label: 'Clinical Review At',          type: 'date',    filterable: true },
          { key: 'clinical_review_completed_at',   label: 'Clinical Completed At',       type: 'date',    filterable: true },
          { key: '__clinical_by',                  label: 'Clinical Reviewed By',        type: 'virtual', virtual: true },
          { key: 'clinical_review_pushed_at',      label: 'Pushed to Clinical At',       type: 'date',    filterable: true },
          { key: 'in_clinical_review',             label: 'In Clinical Review',          type: 'boolean', filterable: true },
          { key: '__clinical_assigned',            label: 'Clinical RN Assigned',        type: 'virtual', virtual: true },
          { key: 'clinical_review_assigned_at',    label: 'Clinical RN Assigned At',     type: 'date',    filterable: true },
          { key: 'returned_from_clinical',         label: 'Returned from Clinical',      type: 'boolean', filterable: true },
          { key: 'returned_from_clinical_at',      label: 'Returned from Clinical At',   type: 'date',    filterable: true },
          { key: 'returned_from_clinical_note',    label: 'Returned from Clinical Note', type: 'text',    filterable: false },
          { key: 'documentation_deferred',         label: 'Docs Deferred (post-SOC)',    type: 'boolean', filterable: true },
          { key: 'documentation_due_date',         label: 'Docs Due Date',               type: 'date',    filterable: true },
          { key: 'documentation_cleared_at',       label: 'Docs Cleared At',             type: 'date',    filterable: true },
        ],
      },
      {
        label: 'EMR & Auth stamps',
        fields: [
          { key: 'emr_initial_onboarded_at', label: 'Initial EMR At',      type: 'date',    filterable: true },
          { key: '__emr_initial_by',         label: 'Initial EMR By',      type: 'virtual', virtual: true },
          { key: 'emr_onboarded_at',         label: 'EMR Onboarded At',    type: 'date',    filterable: true },
          { key: '__emr_onboarded_by',       label: 'EMR Onboarded By',    type: 'virtual', virtual: true },
          { key: 'auth_obtained_at',         label: 'Auth Obtained At',    type: 'date',    filterable: true },
          { key: '__auth_obtained_by',       label: 'Auth Obtained By',    type: 'virtual', virtual: true },
          { key: 'eligibility_completed_at', label: 'Eligibility Done At', type: 'date',    filterable: true },
        ],
      },
      {
        label: 'NTUC & Hold',
        fields: [
          { key: 'ntuc_reason',              label: 'NTUC Reason',               type: 'text', filterable: true },
          { key: 'ntuc_financial_impact',    label: 'NTUC Financial Impact',     type: 'text', filterable: false },
          { key: 'hold_reason',              label: 'Hold Reason',               type: 'text', filterable: false },
          { key: 'hold_expected_resolution', label: 'Hold Exp. Resolution',      type: 'date', filterable: true },
          { key: 'hold_return_stage',        label: 'Hold Return Stage',         type: 'enum', options: STAGES, filterable: true },
        ],
      },
      {
        label: 'Attribution',
        fields: [
          { key: '__marketer_name',  label: 'Marketer',         type: 'virtual', virtual: true, filterable: false },
          { key: '__marketer_region',label: 'Marketer Region',  type: 'virtual', virtual: true, filterable: false },
          { key: '__facility_name',  label: 'Facility',         type: 'virtual', virtual: true, filterable: false },
          { key: '__source_name',    label: 'Referral Source',  type: 'virtual', virtual: true, filterable: false },
          { key: '__source_type',    label: 'Source Type',      type: 'virtual', virtual: true, filterable: false },
          { key: '__source_entity',  label: 'Source Entity',    type: 'virtual', virtual: true, filterable: false },
          { key: '__source_method',  label: 'Source Default Method', type: 'virtual', virtual: true, filterable: false },
          { key: '__source_phone',   label: 'Source Phone',     type: 'virtual', virtual: true, filterable: false },
          { key: '__source_email',   label: 'Source Email',     type: 'virtual', virtual: true, filterable: false },
          { key: 'referral_method',  label: 'Referral Method',  type: 'enum', options: REFERRAL_METHODS, filterable: true },
          { key: 'referral_source_id', label: 'Source ID (raw)', type: 'text', filterable: true },
          { key: '__physician_name', label: 'Physician',        type: 'virtual', virtual: true, filterable: false },
          { key: '__campaign_name',  label: 'Campaign',         type: 'virtual', virtual: true, filterable: false },
          { key: 'marketer_id',      label: 'Marketer ID (raw)',type: 'text',    filterable: true },
          { key: 'facility_id',      label: 'Facility ID (raw)',type: 'text',    filterable: true },
        ],
      },
    ],
    airtableFilters: [
      { key: 'division',       label: 'Division',    type: 'enum',    options: DIVISIONS },
      { key: 'current_stage',  label: 'Stage',       type: 'enum',    options: STAGES },
      { key: 'priority',       label: 'Priority',    type: 'enum',    options: PRIORITIES },
      { key: 'f2f_urgency',    label: 'F2F Urgency', type: 'enum',    options: F2F_URGENCY },
      { key: 'clinical_review_decision', label: 'Clinical Decision', type: 'enum', options: ['accept', 'conditional', 'decline'] },
      { key: 'referral_method', label: 'Referral Method', type: 'enum', options: REFERRAL_METHODS },
      { key: 'referral_source_id', label: 'Source ID', type: 'text' },
      { key: 'referral_date',  label: 'Referral Date', type: 'date' },
      { key: 'soc_scheduled_date', label: 'SOC Date', type: 'date' },
      { key: 'soc_completed_date', label: 'SOC/ROC Completed', type: 'date' },
      { key: 'clinical_review_completed_at', label: 'Clinical Completed', type: 'date' },
      { key: 'emr_onboarded_at', label: 'EMR Onboarded', type: 'date' },
      { key: 'emr_initial_onboarded_at', label: 'Initial EMR / HCHB', type: 'date' },
      { key: 'documentation_deferred', label: 'Docs Deferred', type: 'boolean' },
      { key: 'documentation_due_date', label: 'Docs Due', type: 'date' },
      { key: 'intake_owner_id', label: 'Intake Owner ID', type: 'text' },
      { key: 'hchb_entered',   label: 'HCHB Entered', type: 'boolean' },
      { key: 'is_pecos_verified', label: 'PECOS Verified', type: 'boolean' },
      { key: 'returned_from_clinical', label: 'Returned from Clinical', type: 'boolean' },
      { key: 'ntuc_reason',    label: 'NTUC Reason', type: 'text' },
    ],
  },

  ReferralSources: {
    label: 'Referral Sources',
    description: 'Live source directory: type, entity, method, marketer, and contact.',
    groups: [
      {
        label: 'Source',
        fields: [
          { key: 'name',           label: 'Name',           type: 'text',    filterable: true },
          { key: 'type',           label: 'Type',           type: 'enum',    options: SOURCE_TYPES, filterable: true },
          { key: 'source_entity',  label: 'Entity / Company', type: 'text',  filterable: true },
          { key: 'method',         label: 'Default Method', type: 'enum',    options: REFERRAL_METHODS, filterable: true },
          { key: '__marketer_name',label: 'Marketer',       type: 'virtual', virtual: true },
          { key: 'phone',          label: 'Phone',          type: 'text',    filterable: false },
          { key: 'email',          label: 'Email',          type: 'text',    filterable: false },
          { key: 'is_active',      label: 'Active',         type: 'boolean', filterable: true },
          { key: 'is_system',      label: 'System',         type: 'boolean', filterable: true },
          { key: 'created_at',     label: 'Created',        type: 'date',    filterable: true },
          { key: 'updated_at',     label: 'Updated',        type: 'date',    filterable: true },
          { key: 'id',             label: 'Source ID',      type: 'text',    filterable: true },
          { key: 'marketer_id',    label: 'Marketer ID (raw)', type: 'text', filterable: true },
        ],
      },
    ],
    airtableFilters: [
      { key: 'type',          label: 'Type',           type: 'enum',    options: SOURCE_TYPES },
      { key: 'method',        label: 'Default Method', type: 'enum',    options: REFERRAL_METHODS },
      { key: 'source_entity', label: 'Entity',         type: 'text' },
      { key: 'is_active',     label: 'Active',         type: 'boolean' },
      { key: 'name',          label: 'Name',           type: 'text' },
    ],
  },

  Patients: {
    label: 'Patients',
    description: 'Patient demographics and identifiers',
    groups: [
      {
        label: 'Identity',
        fields: [
          { key: 'first_name',    label: 'First Name',   type: 'text', filterable: true },
          { key: 'last_name',     label: 'Last Name',    type: 'text', filterable: true },
          { key: 'dob',           label: 'Date of Birth',type: 'date', filterable: true },
          { key: 'gender',        label: 'Gender',       type: 'enum', options: ['Male','Female','Other','Prefer Not to Say'], filterable: true },
          { key: 'division',      label: 'Division',     type: 'enum', options: DIVISIONS, filterable: true },
        ],
      },
      {
        label: 'Contact',
        fields: [
          { key: 'address_street', label: 'Street',       type: 'text', filterable: false },
          { key: 'address_city',   label: 'City',         type: 'text', filterable: true },
          { key: 'address_state',  label: 'State',        type: 'text', filterable: true },
          { key: 'address_zip',    label: 'ZIP',          type: 'text', filterable: true },
          { key: 'phone_primary',  label: 'Phone',        type: 'text', filterable: false },
          { key: 'email',          label: 'Email',        type: 'text', filterable: false },
        ],
      },
      {
        label: 'Insurance',
        fields: [
          { key: 'medicaid_number', label: 'Medicaid #',      type: 'text', filterable: true },
          { key: 'medicare_number', label: 'Medicare #',      type: 'text', filterable: true },
          { key: 'insurance_plan',  label: 'Insurance Plan',  type: 'text', filterable: true },
          { key: 'insurance_id',    label: 'Insurance Member ID', type: 'text', filterable: false },
        ],
      },
      {
        label: 'System',
        fields: [
          { key: 'is_active',   label: 'Active',      type: 'boolean', filterable: true },
          { key: 'created_at',  label: 'Created',     type: 'date',    filterable: true },
        ],
      },
    ],
    airtableFilters: [
      { key: 'division',        label: 'Division',      type: 'enum',    options: DIVISIONS },
      { key: 'gender',          label: 'Gender',        type: 'enum',    options: ['Male','Female','Other','Prefer Not to Say'] },
      { key: 'address_city',    label: 'City',          type: 'text' },
      { key: 'address_zip',     label: 'ZIP',           type: 'text' },
      { key: 'insurance_plan',  label: 'Insurance Plan',type: 'text' },
      { key: 'is_active',       label: 'Active',        type: 'boolean' },
      { key: 'created_at',      label: 'Created Date',  type: 'date' },
    ],
  },

  Episodes: {
    label: 'Episodes',
    description: 'Post-SOC episode records and recertification tracking',
    groups: [
      {
        label: 'Patient',
        fields: [
          { key: '__patient_name',   label: 'Patient Name',  type: 'virtual', virtual: true },
          { key: '__patient_dob',    label: 'Date of Birth', type: 'virtual', virtual: true },
          { key: '__patient_division',label:'Division',       type: 'virtual', virtual: true },
        ],
      },
      {
        label: 'Episode',
        fields: [
          { key: 'soc_date',            label: 'SOC Date',           type: 'date',    filterable: true },
          { key: 'episode_start',       label: 'Episode Start',      type: 'date',    filterable: true },
          { key: 'episode_end',         label: 'Episode End',        type: 'date',    filterable: true },
          { key: 'status',              label: 'Status',             type: 'enum',    options: ['Active','Discharged','Transferred','Expired'], filterable: true },
          { key: 'recert_due_date',     label: 'Recert Due',         type: 'date',    filterable: true },
          { key: 'auth_window_start',   label: 'Auth Window Start',  type: 'date',    filterable: false },
          { key: 'auth_window_end',     label: 'Auth Window End',    type: 'date',    filterable: false },
          { key: 'revenue_risk_flag',   label: 'Revenue Risk',       type: 'boolean', filterable: true },
          { key: 'revenue_risk_reason', label: 'Risk Reason',        type: 'text',    filterable: false },
          { key: 'hchb_synced',         label: 'HCHB Synced',        type: 'boolean', filterable: true },
        ],
      },
    ],
    airtableFilters: [
      { key: 'status',            label: 'Status',        type: 'enum',    options: ['Active','Discharged','Transferred','Expired'] },
      { key: 'soc_date',          label: 'SOC Date',      type: 'date' },
      { key: 'recert_due_date',   label: 'Recert Due',    type: 'date' },
      { key: 'revenue_risk_flag', label: 'Revenue Risk',  type: 'boolean' },
      { key: 'hchb_synced',       label: 'HCHB Synced',   type: 'boolean' },
    ],
  },

  Tasks: {
    label: 'Tasks',
    description: 'Work items, assignments, and blockers',
    groups: [
      {
        label: 'Patient',
        fields: [
          { key: '__patient_name', label: 'Patient Name', type: 'virtual', virtual: true },
        ],
      },
      {
        label: 'Task',
        fields: [
          { key: 'title',           label: 'Title',          type: 'text',    filterable: true },
          { key: 'type',            label: 'Type',           type: 'enum',    options: ['Insurance Barrier','Missing Document','Auth Needed','Disenrollment','Escalation','Follow-Up','Staffing','Scheduling','Other'], filterable: true },
          { key: 'route_to_role',   label: 'Route to Role',  type: 'enum',    options: ['Intake','Finance','Clinical','Scheduling','Admin'], filterable: true },
          { key: 'status',          label: 'Status',         type: 'enum',    options: ['Pending','In Progress','Completed','Cancelled'], filterable: true },
          { key: 'priority',        label: 'Priority',       type: 'enum',    options: PRIORITIES, filterable: true },
          { key: 'due_date',        label: 'Due Date',       type: 'date',    filterable: true },
          { key: 'completed_at',    label: 'Completed At',   type: 'date',    filterable: true },
          { key: 'blocks_stage_progression', label: 'Blocking', type: 'boolean', filterable: true },
          { key: 'source',          label: 'Source',         type: 'enum',    options: ['System','Manual'], filterable: true },
          { key: '__assigned_name', label: 'Assigned To',    type: 'virtual', virtual: true },
          { key: 'description',     label: 'Description',    type: 'text',    filterable: false },
          { key: 'created_at',      label: 'Created',        type: 'date',    filterable: true },
        ],
      },
    ],
    airtableFilters: [
      { key: 'type',          label: 'Type',         type: 'enum',    options: ['Insurance Barrier','Missing Document','Auth Needed','Disenrollment','Escalation','Follow-Up','Staffing','Scheduling','Other'] },
      { key: 'status',        label: 'Status',       type: 'enum',    options: ['Pending','In Progress','Completed','Cancelled'] },
      { key: 'priority',      label: 'Priority',     type: 'enum',    options: PRIORITIES },
      { key: 'route_to_role', label: 'Route To',     type: 'enum',    options: ['Intake','Finance','Clinical','Scheduling','Admin'] },
      { key: 'due_date',      label: 'Due Date',     type: 'date' },
      { key: 'blocks_stage_progression', label: 'Blocking', type: 'boolean' },
    ],
  },

  Insurance_Checks: {
    label: 'Insurance Checks',
    description: 'Eligibility verifications and insurance findings',
    groups: [
      {
        label: 'Patient',
        fields: [
          { key: '__patient_name', label: 'Patient Name', type: 'virtual', virtual: true },
        ],
      },
      {
        label: 'Check Details',
        fields: [
          { key: 'check_source',         label: 'Check Source',        type: 'enum',    options: ['Waystar','ePACES','Availity','Manual'], filterable: true },
          { key: 'check_date',           label: 'Check Date',          type: 'date',    filterable: true },
          { key: 'medicare_part_a',      label: 'Medicare Part A',     type: 'boolean', filterable: true },
          { key: 'medicare_part_b',      label: 'Medicare Part B',     type: 'boolean', filterable: true },
          { key: 'medicaid_active',      label: 'Medicaid Active',     type: 'boolean', filterable: true },
          { key: 'managed_care_plan',    label: 'Managed Care Plan',   type: 'text',    filterable: true },
          { key: 'has_open_hh_episode',  label: 'Open HH Episode',     type: 'boolean', filterable: true },
          { key: 'open_episode_agency',  label: 'Open Episode Agency', type: 'text',    filterable: false },
          { key: 'hospice_overlap',      label: 'Hospice Overlap',     type: 'boolean', filterable: true },
          { key: 'snf_present',          label: 'SNF Present',         type: 'boolean', filterable: true },
          { key: 'hospital_present',     label: 'Hospital Present',    type: 'boolean', filterable: true },
          { key: 'qmb_status',           label: 'QMB Status',          type: 'boolean', filterable: true },
          { key: 'cdpap_active',         label: 'CDPAP Active',        type: 'boolean', filterable: true },
          { key: 'auth_required',        label: 'Auth Required',       type: 'boolean', filterable: true },
          { key: 'disenrollment_needed', label: 'Disenrollment Needed',type: 'boolean', filterable: true },
          { key: 'result_summary',       label: 'Summary',             type: 'text',    filterable: false },
        ],
      },
    ],
    airtableFilters: [
      { key: 'check_source',         label: 'Check Source',    type: 'enum',    options: ['Waystar','ePACES','Availity','Manual'] },
      { key: 'check_date',           label: 'Check Date',      type: 'date' },
      { key: 'auth_required',        label: 'Auth Required',   type: 'boolean' },
      { key: 'disenrollment_needed', label: 'Disenrollment',   type: 'boolean' },
      { key: 'hospice_overlap',      label: 'Hospice Overlap', type: 'boolean' },
      { key: 'has_open_hh_episode',  label: 'Open HH Episode', type: 'boolean' },
      { key: 'medicaid_active',      label: 'Medicaid Active', type: 'boolean' },
    ],
  },

  Authorizations: {
    label: 'Authorizations',
    description: 'Prior authorization records by plan',
    groups: [
      {
        label: 'Patient',
        fields: [
          { key: '__patient_name', label: 'Patient Name', type: 'virtual', virtual: true },
        ],
      },
      {
        label: 'Auth',
        fields: [
          { key: 'plan_name',           label: 'Plan Name',          type: 'text', filterable: true },
          { key: 'auth_number',         label: 'Auth Number',        type: 'text', filterable: false },
          { key: 'status',              label: 'Status',             type: 'enum', options: ['Pending','Approved','Denied','Expired','Appealed'], filterable: true },
          { key: 'services_authorized', label: 'Services Authorized',type: 'text', filterable: false },
          { key: 'submitted_date',      label: 'Submitted',          type: 'date', filterable: true },
          { key: 'approved_date',       label: 'Approved',           type: 'date', filterable: true },
          { key: 'effective_start',     label: 'Effective Start',    type: 'date', filterable: true },
          { key: 'effective_end',       label: 'Effective End',      type: 'date', filterable: true },
          { key: 'denial_reason',       label: 'Denial Reason',      type: 'text', filterable: false },
          { key: 'notes',               label: 'Notes',              type: 'text', filterable: false },
          { key: 'created_at',          label: 'Created',            type: 'date', filterable: true },
        ],
      },
    ],
    airtableFilters: [
      { key: 'status',         label: 'Status',     type: 'enum', options: ['Pending','Approved','Denied','Expired','Appealed'] },
      { key: 'plan_name',      label: 'Plan Name',  type: 'text' },
      { key: 'submitted_date', label: 'Submitted',  type: 'date' },
      { key: 'effective_end',  label: 'Expires',    type: 'date' },
    ],
  },

  Conflicts: {
    label: 'Conflicts',
    description: 'Flagged blockers that prevent stage progression',
    groups: [
      {
        label: 'Patient',
        fields: [
          { key: '__patient_name', label: 'Patient Name', type: 'virtual', virtual: true },
        ],
      },
      {
        label: 'Conflict',
        fields: [
          { key: 'type',             label: 'Type',          type: 'enum', options: ['Hospice Overlap','SNF Overlap','CDPAP','HHA Respite Overlap','ALF Refusal','No-Fault','Regulatory','Clinical','Other'], filterable: true },
          { key: 'severity',         label: 'Severity',      type: 'enum', options: ['Low','High'], filterable: true },
          { key: 'status',           label: 'Status',        type: 'enum', options: ['Open','In Progress','Resolved','Waived'], filterable: true },
          { key: 'description',      label: 'Description',   type: 'text', filterable: false },
          { key: 'resolution_note',  label: 'Resolution',    type: 'text', filterable: false },
          { key: 'resolved_at',      label: 'Resolved At',   type: 'date', filterable: true },
          { key: 'created_at',       label: 'Flagged At',    type: 'date', filterable: true },
          { key: '__flagged_by',     label: 'Flagged By',    type: 'virtual', virtual: true },
          { key: '__resolved_by',    label: 'Resolved By',   type: 'virtual', virtual: true },
        ],
      },
    ],
    airtableFilters: [
      { key: 'type',     label: 'Type',     type: 'enum', options: ['Hospice Overlap','SNF Overlap','CDPAP','HHA Respite Overlap','ALF Refusal','No-Fault','Regulatory','Clinical','Other'] },
      { key: 'severity', label: 'Severity', type: 'enum', options: ['Low','High'] },
      { key: 'status',   label: 'Status',   type: 'enum', options: ['Open','In Progress','Resolved','Waived'] },
      { key: 'created_at', label: 'Flagged Date', type: 'date' },
      { key: 'resolved_at', label: 'Resolved Date', type: 'date' },
    ],
  },

  StageHistory: {
    label: 'Stage History',
    description: 'Every stage transition (who moved the patient, when, and why)',
    groups: [
      {
        label: 'Transition',
        fields: [
          { key: 'from_stage',       label: 'From Stage',   type: 'enum', options: STAGES, filterable: true },
          { key: 'to_stage',         label: 'To Stage',     type: 'enum', options: STAGES, filterable: true },
          { key: 'reason',           label: 'Reason / Note', type: 'text', filterable: true },
          { key: 'timestamp',        label: 'Timestamp',    type: 'date', filterable: true },
          { key: '__actor_name',     label: 'Changed By',   type: 'virtual', virtual: true },
          { key: 'changed_by_id',    label: 'Changed By ID', type: 'text', filterable: true },
          { key: 'referral_id',      label: 'Referral ID',  type: 'text', filterable: true },
        ],
      },
    ],
    airtableFilters: [
      { key: 'from_stage', label: 'From Stage', type: 'enum', options: STAGES },
      { key: 'to_stage',   label: 'To Stage',   type: 'enum', options: STAGES },
      { key: 'timestamp',  label: 'Timestamp',  type: 'date' },
      { key: 'changed_by_id', label: 'Changed By ID', type: 'text' },
      { key: 'reason', label: 'Reason contains', type: 'text' },
    ],
  },

  ActivityLog: {
    label: 'Activity Log',
    description: 'Staff audit trail of key actions across CareStream',
    groups: [
      {
        label: 'Event',
        fields: [
          { key: 'action',         label: 'Action',      type: 'text', filterable: true },
          { key: 'detail',         label: 'Detail',      type: 'text', filterable: true },
          { key: 'timestamp',      label: 'Timestamp',   type: 'date', filterable: true },
          { key: '__actor_name',   label: 'Actor',       type: 'virtual', virtual: true },
          { key: 'actor_id',       label: 'Actor ID',    type: 'text', filterable: true },
          { key: '__patient_name', label: 'Patient',     type: 'virtual', virtual: true },
          { key: 'patient_id',     label: 'Patient ID',  type: 'text', filterable: true },
          { key: 'referral_id',    label: 'Referral ID', type: 'text', filterable: true },
          { key: 'metadata',       label: 'Metadata',    type: 'text', filterable: false },
        ],
      },
    ],
    airtableFilters: [
      { key: 'action',     label: 'Action',     type: 'text' },
      { key: 'timestamp',  label: 'Timestamp',  type: 'date' },
      { key: 'actor_id',   label: 'Actor ID',   type: 'text' },
      { key: 'detail',     label: 'Detail contains', type: 'text' },
    ],
  },

  Notes: {
    label: 'Notes',
    description: 'Patient / referral notes written by staff',
    groups: [
      {
        label: 'Note',
        fields: [
          { key: 'content',        label: 'Content',     type: 'text', filterable: true },
          { key: 'is_pinned',      label: 'Pinned',      type: 'boolean', filterable: true },
          { key: 'created_at',     label: 'Created',     type: 'date', filterable: true },
          { key: '__actor_name',   label: 'Author',      type: 'virtual', virtual: true },
          { key: 'author_id',      label: 'Author ID',   type: 'text', filterable: true },
          { key: '__patient_name', label: 'Patient',     type: 'virtual', virtual: true },
          { key: 'patient_id',     label: 'Patient ID',  type: 'text', filterable: true },
          { key: 'referral_id',    label: 'Referral ID', type: 'text', filterable: true },
        ],
      },
    ],
    airtableFilters: [
      { key: 'created_at', label: 'Created', type: 'date' },
      { key: 'author_id',  label: 'Author ID', type: 'text' },
      { key: 'is_pinned',  label: 'Pinned', type: 'boolean' },
      { key: 'content',    label: 'Content contains', type: 'text' },
    ],
  },

  PatientInsurances: {
    label: 'Patient Insurances',
    description: 'Payer rows linked to patients (category, member ID, order)',
    groups: [
      {
        label: 'Payer',
        fields: [
          { key: '__patient_name',      label: 'Patient',           type: 'virtual', virtual: true },
          { key: 'payer_display_name',  label: 'Payer Name',        type: 'text', filterable: true },
          { key: 'insurance_category',  label: 'Category',          type: 'text', filterable: true },
          { key: 'plan_name',           label: 'Plan Name',         type: 'text', filterable: true },
          { key: 'member_id',           label: 'Member ID',         type: 'text', filterable: true },
          { key: 'group_number',        label: 'Group #',           type: 'text', filterable: false },
          { key: 'order_rank',          label: 'Order',             type: 'enum', options: ['primary', 'secondary', 'tertiary', 'informational'], filterable: true },
          { key: 'created_at',          label: 'Created',           type: 'date', filterable: true },
        ],
      },
    ],
    airtableFilters: [
      { key: 'payer_display_name', label: 'Payer Name', type: 'text' },
      { key: 'insurance_category', label: 'Category', type: 'text' },
      { key: 'order_rank', label: 'Order', type: 'enum', options: ['primary', 'secondary', 'tertiary', 'informational'] },
      { key: 'created_at', label: 'Created', type: 'date' },
    ],
  },

  ClinicalReview: {
    label: 'Clinical Reviews',
    description: 'Clinical RN checklist working state and decision per referral',
    groups: [
      {
        label: 'Review',
        fields: [
          { key: 'decision',       label: 'Decision',     type: 'enum', options: ['accept', 'conditional'], filterable: true },
          { key: 'auth_required',  label: 'Auth Required', type: 'boolean', filterable: true },
          { key: 'reviewed_by',    label: 'Reviewed By ID', type: 'text', filterable: true },
          { key: '__actor_name',   label: 'Reviewed By',  type: 'virtual', virtual: true },
          { key: 'referral_id',    label: 'Referral ID',  type: 'text', filterable: true },
          { key: 'created_at',     label: 'Created',      type: 'date', filterable: true },
          { key: 'updated_at',     label: 'Updated',      type: 'date', filterable: true },
          { key: 'dx_reviewed',    label: 'Dx Reviewed',  type: 'boolean', filterable: true },
          { key: 'skilled_need',   label: 'Skilled Need', type: 'boolean', filterable: true },
          { key: 'homebound',      label: 'Homebound',    type: 'boolean', filterable: true },
          { key: 'risk_high',      label: 'Risk High',    type: 'boolean', filterable: true },
          { key: 'risk_moderate',  label: 'Risk Moderate', type: 'boolean', filterable: true },
          { key: 'risk_low',       label: 'Risk Low',     type: 'boolean', filterable: true },
        ],
      },
    ],
    airtableFilters: [
      { key: 'decision', label: 'Decision', type: 'enum', options: ['accept', 'conditional'] },
      { key: 'reviewed_by', label: 'Reviewed By ID', type: 'text' },
      { key: 'updated_at', label: 'Updated', type: 'date' },
      { key: 'auth_required', label: 'Auth Required', type: 'boolean' },
    ],
  },

  SocRescheduleLog: {
    label: 'SOC Reschedules',
    description: 'Audit log of SOC date changes with reason categories',
    groups: [
      {
        label: 'Reschedule',
        fields: [
          { key: 'previous_soc_date', label: 'Previous SOC Date', type: 'date', filterable: true },
          { key: 'new_soc_date',      label: 'New SOC Date',      type: 'date', filterable: true },
          { key: 'reason_category',   label: 'Reason Category',   type: 'text', filterable: true },
          { key: 'reason_detail',     label: 'Detail',            type: 'text', filterable: false },
          { key: 'created_at',        label: 'Logged At',         type: 'date', filterable: true },
          { key: '__actor_name',      label: 'Logged By',         type: 'virtual', virtual: true },
          { key: 'rescheduled_by_id', label: 'Logged By ID',      type: 'text', filterable: true },
          { key: 'referral_id',       label: 'Referral ID',       type: 'text', filterable: true },
          { key: '__patient_name',    label: 'Patient',           type: 'virtual', virtual: true },
        ],
      },
    ],
    airtableFilters: [
      { key: 'reason_category', label: 'Reason Category', type: 'text' },
      { key: 'created_at', label: 'Logged At', type: 'date' },
      { key: 'rescheduled_by_id', label: 'Logged By ID', type: 'text' },
    ],
  },
};

// ── Filter formula builder ─────────────────────────────────────────────────────

/**
 * Convert an array of filter objects to an Airtable filterByFormula string.
 *
 * filter shape: { field, operator, value, value2 }
 *   operator: 'eq' | 'neq' | 'contains' | 'not_empty' | 'is_empty'
 *             | 'in' (value = [])
 *             | 'before' | 'after' | 'between'
 *             | 'true' | 'false'
 *             | 'gt' | 'lt' | 'gte' | 'lte'
 */
export function buildFormula(filters) {
  const parts = filters
    .filter((f) => f.field && f.operator)
    .map((f) => {
      const fld = `{${f.field}}`;
      const v   = f.value;
      switch (f.operator) {
        case 'eq':        return `${fld} = "${v}"`;
        case 'neq':       return `${fld} != "${v}"`;
        case 'contains':  return `SEARCH("${v}", ${fld}) > 0`;
        case 'not_empty': return `NOT(${fld} = "")`;
        case 'is_empty':  return `${fld} = ""`;
        case 'true':      return `${fld} = 1`;
        case 'false':     return `OR(${fld} = 0, ${fld} = "")`;
        case 'in': {
          if (!Array.isArray(v) || v.length === 0) return null;
          return v.length === 1
            ? `${fld} = "${v[0]}"`
            : `OR(${v.map((o) => `${fld} = "${o}"`).join(',')})`;
        }
        case 'before':  return `IS_BEFORE(${fld}, "${v}")`;
        case 'after':   return `IS_AFTER(${fld}, "${v}")`;
        case 'between':
          return f.value2
            ? `AND(IS_AFTER(${fld}, "${v}"), IS_BEFORE(${fld}, "${f.value2}"))`
            : `IS_AFTER(${fld}, "${v}")`;
        case 'gt':  return `${fld} > ${v}`;
        case 'lt':  return `${fld} < ${v}`;
        case 'gte': return `${fld} >= ${v}`;
        case 'lte': return `${fld} <= ${v}`;
        default:    return null;
      }
    })
    .filter(Boolean);

  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return `AND(${parts.join(',')})`;
}

// ── Virtual column resolvers ──────────────────────────────────────────────────

function firstId(v) {
  if (Array.isArray(v) && v.length) return v[0];
  return v || null;
}

async function resolveVirtualColumns(records, selectedKeys, primaryTable) {
  // Determine which lookup tables we need
  const needsPatient   = selectedKeys.some((k) => k.startsWith('__patient'));
  const needsMarketer  = selectedKeys.some((k) => k.startsWith('__marketer'));
  const needsFacility  = selectedKeys.some((k) => k.startsWith('__facility'));
  const needsSource    = selectedKeys.some((k) => k.startsWith('__source'));
  const needsPhysician = selectedKeys.some((k) => k.startsWith('__physician'));
  const needsCampaign  = selectedKeys.some((k) => k.startsWith('__campaign'));
  const needsUsers = selectedKeys.some((k) =>
    k.startsWith('__assigned')
    || k.startsWith('__flagged')
    || k.startsWith('__resolved')
    || k.startsWith('__intake_owner')
    || k.startsWith('__lead_created_by')
    || k.startsWith('__hold_owner')
    || k.startsWith('__clinical_by')
    || k.startsWith('__clinical_precheck_by')
    || k.startsWith('__clinical_assigned')
    || k.startsWith('__f2f_logged_by')
    || k.startsWith('__emr_')
    || k.startsWith('__auth_obtained_by')
    || k.startsWith('__uploaded_by')
    || k.startsWith('__actor_name')
  );

  const [patients, marketers, legacyFacilities, networkFacilities, sources, physicians, campaigns, users] = await Promise.all([
    needsPatient   ? getLookupMap('Patients')           : Promise.resolve({}),
    needsMarketer  ? getLookupMap('Marketers')          : Promise.resolve({}),
    needsFacility  ? getLookupMap('Facilities')         : Promise.resolve({}),
    // ALF referrals store NetworkFacilities ids on facility_id — must resolve both tables.
    needsFacility  ? getLookupMap('NetworkFacilities')  : Promise.resolve({}),
    needsSource    ? getLookupMap('ReferralSources')    : Promise.resolve({}),
    needsPhysician ? getLookupMap('Physicians')         : Promise.resolve({}),
    needsCampaign  ? getLookupMap('Campaigns')          : Promise.resolve({}),
    needsUsers     ? getLookupMap('Users')              : Promise.resolve({}),
  ]);

  // Prefer network facility names when both tables share a key (same as useLookups).
  const facilities = needsFacility
    ? { ...legacyFacilities, ...networkFacilities }
    : {};

  return records.map((row) => {
    const out = { ...row };

    // Patient lookups (patient_id may be link array on some tables)
    if (needsPatient) {
      const pid = firstId(row.patient_id);
      const p = patients[pid] || {};
      out.__patient_name     = resolve.patient(p);
      out.__patient_dob      = p.dob || '—';
      out.__patient_gender   = p.gender || '—';
      out.__patient_address  = [p.address_street, p.address_city, p.address_state, p.address_zip].filter(Boolean).join(', ') || '—';
      out.__patient_phone    = p.phone_primary || '—';
      out.__patient_medicaid = p.medicaid_number || '—';
      out.__patient_medicare = p.medicare_number || '—';
      out.__patient_insplan  = p.insurance_plan || '—';
      out.__patient_division = p.division || '—';
    }
    if (needsMarketer) {
      const m = marketers[row.marketer_id] || {};
      out.__marketer_name   = resolve.marketer(m);
      out.__marketer_region = m.region || '—';
    }
    if (needsFacility) {
      const fid = firstId(row.facility_id);
      out.__facility_name = resolve.facility(facilities[fid]);
    }
    if (needsSource)    {
      const s = sources[row.referral_source_id] || {};
      out.__source_name = s.name || '—';
      out.__source_type = s.type || '—';
      out.__source_entity = s.source_entity || '—';
      out.__source_method = s.method || '—';
      out.__source_phone = s.phone || '—';
      out.__source_email = s.email || '—';
    }
    if (needsPhysician) out.__physician_name = resolve.physician(physicians[row.physician_id]);
    if (needsCampaign)  out.__campaign_name  = resolve.campaign(campaigns[row.campaign_id]);
    const hoursPrecheck = hoursToClinicalLeadPreCheck(row);
    out.__hours_to_precheck = hoursPrecheck == null ? '' : hoursPrecheck;
    if (needsUsers) {
      out.__assigned_name     = resolve.user(users[row.assigned_to_id]);
      out.__flagged_by        = resolve.user(users[row.flagged_by_id]);
      out.__resolved_by       = resolve.user(users[row.resolved_by_id]);
      // Lead Entry / Discarded Leads are not referrals yet — no intake owner.
      // (Older rows may incorrectly have creator/marketer stamped as owner.)
      out.__intake_owner = (
        row.current_stage === 'Lead Entry'
        || row.current_stage === 'Clinical Lead Pre-Check'
        || row.current_stage === 'Discarded Leads'
        || !row.intake_owner_id
      )
        ? ''
        : resolve.user(users[row.intake_owner_id]);
      out.__hold_owner        = resolve.user(users[row.hold_owner_id]);
      out.__lead_created_by   = resolve.user(users[row.lead_created_by_id]);
      out.__clinical_by       = resolve.user(users[firstId(row.clinical_review_completed_by_id) || firstId(row.clinical_review_by) || firstId(row.reviewed_by)]);
      out.__clinical_precheck_by = resolve.user(users[firstId(row.clinical_lead_precheck_approved_by_id)]);
      // Assigned RN while the review is open; after complete, assignment is cleared.
      out.__clinical_assigned = resolve.user(users[
        firstId(row.clinical_review_assigned_to_id)
        || firstId(row.clinical_review_completed_by_id)
        || firstId(row.clinical_review_by)
      ]);
      out.__f2f_logged_by     = resolve.user(users[row.f2f_date_logged_by_id]);
      out.__emr_initial_by    = resolve.user(users[row.emr_initial_onboarded_by_id]);
      out.__emr_onboarded_by  = resolve.user(users[row.emr_onboarded_by_id]);
      out.__auth_obtained_by  = resolve.user(users[row.auth_obtained_by_id]);
      out.__uploaded_by       = resolve.user(users[row.uploaded_by_id]);
      out.__actor_name        = resolve.user(users[
        row.changed_by_id || row.actor_id || row.author_id || row.reviewed_by || row.rescheduled_by_id
      ]);
    }

    return out;
  });
}

// ── Core data fetcher ─────────────────────────────────────────────────────────

/**
 * Fetch records from an Airtable table, apply formula filters, and resolve
 * all virtual (joined) columns.
 *
 * @param {string} tableName - Airtable table name
 * @param {Array}  filters   - filter objects for buildFormula()
 * @param {Array}  selectedKeys - column keys to include (determines which lookups to load)
 * @param {Array}  sort      - [{ field, direction }]
 * @returns {Promise<{rows: Object[], total: number}>}
 */
export async function fetchReportData({ tableName, filters = [], selectedKeys = [], sort = [] }) {
  const formula = buildFormula(filters);
  const params = { sort };
  if (formula) params.filterByFormula = formula;

  const records = await airtable.fetchAll(tableName, params);
  const rawRows = records.map((r) => ({ _id: r.id, ...r.fields }));

  // Resolve virtual columns if any are selected
  const virtualKeys = selectedKeys.filter((k) => k.startsWith('__'));
  const rows = virtualKeys.length > 0
    ? await resolveVirtualColumns(rawRows, selectedKeys, tableName)
    : rawRows;

  return { rows, total: rows.length };
}

// ── Excel export (multi-tab: Summary + Detail + Chart Data) ───────────────────

/**
 * Generate and download a styled multi-sheet XLSX workbook.
 * Accepts optional `summary` with KPIs/charts; otherwise auto-builds from rows.
 *
 * @param {Object[]} rows
 * @param {Array}    columns
 * @param {string}   reportTitle
 * @param {string}   [subtitle]
 * @param {object}   [summary]
 * @param {Array}    [extraSheets]
 */
export async function exportToExcel(rows, columns, reportTitle, subtitle = '', summary = null, extraSheets = []) {
  await exportReportWorkbook({
    rows,
    columns,
    reportTitle,
    subtitle,
    summary: summary || buildAutoSummary(rows, columns),
    extraSheets,
  });
}

// ── Aggregated reports (computed in JS after fetch) ───────────────────────────

/** Shared date + division + multi-id filters for referral reports. */
export function buildReferralParamFilters({
  dateFrom, dateTo, division,
  dateField = 'referral_date',
  marketerIds, ownerIds, sourceIds, stages,
} = {}) {
  const filters = [];
  if (dateFrom && dateTo) filters.push({ field: dateField, operator: 'between', value: dateFrom, value2: dateTo });
  else if (dateFrom) filters.push({ field: dateField, operator: 'after', value: dateFrom });
  else if (dateTo) filters.push({ field: dateField, operator: 'before', value: dateTo });
  if (division) filters.push({ field: 'division', operator: 'eq', value: division });
  if (Array.isArray(stages) && stages.length) {
    filters.push({ field: 'current_stage', operator: 'in', value: stages });
  }
  if (Array.isArray(marketerIds) && marketerIds.length) {
    filters.push({ field: 'marketer_id', operator: 'in', value: marketerIds });
  }
  if (Array.isArray(ownerIds) && ownerIds.length) {
    filters.push({ field: 'intake_owner_id', operator: 'in', value: ownerIds });
  }
  if (Array.isArray(sourceIds) && sourceIds.length) {
    filters.push({ field: 'referral_source_id', operator: 'in', value: sourceIds });
  }
  return filters;
}

/**
 * Marketer Performance — one row per marketer showing referral counts by stage.
 */
export async function runMarketerPerformance({ dateFrom, dateTo, division, marketerIds } = {}) {
  const filters = buildReferralParamFilters({ dateFrom, dateTo, division, marketerIds });

  const { rows } = await fetchReportData({ tableName: 'Referrals', filters, selectedKeys: ['__marketer_name', '__marketer_region'] });
  const marketers = await getLookupMap('Marketers');

  // Group by marketer_id
  const groups = {};
  for (const row of rows) {
    const mid   = row.marketer_id || '__unassigned__';
    const mData = marketers[mid] || {};
    if (!groups[mid]) {
      groups[mid] = {
        marketer:   row.__marketer_name || `${mData.first_name || ''} ${mData.last_name || ''}`.trim() || 'Unassigned',
        region:     row.__marketer_region || mData.region || '—',
        division:   mData.division || '—',
        total:      0,
        ntuc:       0,
        soc:        0,
        hold:       0,
        active:     0,
        stageBreak: {},
      };
    }
    const g = groups[mid];
    g.total++;
    const stage = row.current_stage || 'Unknown';
    g.stageBreak[stage] = (g.stageBreak[stage] || 0) + 1;
    if (stage === 'NTUC') g.ntuc++;
    if (isSocCompletedReferral(row)) g.soc++;
    if (stage === 'Hold') g.hold++;
    if (!['NTUC','SOC Completed','Completed','Hold'].includes(stage)) g.active++;
  }

  const columns = [
    { key: 'marketer', label: 'Marketer' },
    { key: 'region',   label: 'Region' },
    { key: 'division', label: 'Division' },
    { key: 'total',    label: 'Total Referrals' },
    { key: 'active',   label: 'Active in Pipeline' },
    { key: 'soc',      label: 'SOC/ROC Completed' },
    { key: 'ntuc',     label: 'NTUC' },
    { key: 'hold',     label: 'On Hold' },
    { key: 'socRate',  label: 'SOC Rate' },
    { key: 'ntucRate', label: 'NTUC Rate' },
    ...STAGES.map((s) => ({ key: `stage_${s}`, label: s })),
  ];

  const outputRows = Object.values(groups).map((g) => ({
    ...g,
    socRate:  g.total ? `${Math.round((g.soc / g.total) * 100)}%` : '0%',
    ntucRate: g.total ? `${Math.round((g.ntuc / g.total) * 100)}%` : '0%',
    ...Object.fromEntries(STAGES.map((s) => [`stage_${s}`, g.stageBreak[s] || 0])),
  }));

  outputRows.sort((a, b) => b.total - a.total);

  const top = outputRows.slice(0, 12);
  const summary = {
    kpis: [
      { label: 'Marketers', value: outputRows.length },
      { label: 'Total referrals', value: outputRows.reduce((s, r) => s + r.total, 0) },
      { label: 'SOC completed', value: outputRows.reduce((s, r) => s + r.soc, 0) },
      { label: 'NTUC', value: outputRows.reduce((s, r) => s + r.ntuc, 0) },
    ],
    charts: [
      {
        title: 'Referrals by marketer',
        type: 'bar',
        labels: top.map((r) => r.marketer),
        datasets: [{
          label: 'Total',
          data: top.map((r) => r.total),
          backgroundColor: '#C41E6ACC',
          borderColor: '#C41E6A',
          borderWidth: 1,
        }],
      },
      {
        title: 'SOC vs NTUC (top marketers)',
        type: 'bar',
        labels: top.map((r) => r.marketer),
        datasets: [
          {
            label: 'SOC',
            data: top.map((r) => r.soc),
            backgroundColor: '#059669CC',
            borderColor: '#059669',
            borderWidth: 1,
          },
          {
            label: 'NTUC',
            data: top.map((r) => r.ntuc),
            backgroundColor: '#EA580CCC',
            borderColor: '#EA580C',
            borderWidth: 1,
          },
        ],
      },
    ],
  };

  return { rows: outputRows, columns, summary };
}

/**
 * Intake Volume — referrals created in range with owner / stage / daily volume.
 */
export async function runIntakeVolume({ dateFrom, dateTo, division, ownerIds, marketerIds } = {}) {
  const filters = buildReferralParamFilters({ dateFrom, dateTo, division, ownerIds, marketerIds });

  const cols = [
    '__patient_name', 'division', 'current_stage', 'priority', 'referral_date',
    '__intake_owner', '__marketer_name', '__facility_name', '__source_name', 'referral_method',
    'services_requested', 'clinical_review_decision', 'soc_scheduled_date', 'soc_completed_date',
  ];
  const { rows } = await fetchReportData({
    tableName: 'Referrals',
    filters,
    selectedKeys: cols,
    sort: [{ field: 'referral_date', direction: 'desc' }],
  });

  const columns = [
    { key: '__patient_name', label: 'Patient' },
    { key: 'division', label: 'Division' },
    { key: 'current_stage', label: 'Stage' },
    { key: 'priority', label: 'Priority' },
    { key: 'referral_date', label: 'Referral Date' },
    { key: '__intake_owner', label: 'Intake Owner' },
    { key: '__marketer_name', label: 'Marketer' },
    { key: '__facility_name', label: 'Facility' },
    { key: '__source_name', label: 'Source' },
    { key: 'referral_method', label: 'Method' },
    { key: 'services_requested', label: 'Services' },
    { key: 'clinical_review_decision', label: 'Clinical Decision' },
    { key: 'soc_scheduled_date', label: 'SOC Scheduled' },
    { key: 'soc_completed_date', label: 'SOC/ROC Completed' },
  ];

  const byDay = {};
  const byOwner = {};
  const byStage = {};
  for (const r of rows) {
    const day = String(r.referral_date || '').slice(0, 10) || '(no date)';
    byDay[day] = (byDay[day] || 0) + 1;
    const owner = r.__intake_owner || 'Unassigned';
    byOwner[owner] = (byOwner[owner] || 0) + 1;
    const stage = r.current_stage || 'Unknown';
    byStage[stage] = (byStage[stage] || 0) + 1;
  }
  const daySeries = Object.entries(byDay).sort((a, b) => a[0].localeCompare(b[0]));
  const ownerSeries = Object.entries(byOwner).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const stageSeries = Object.entries(byStage).sort((a, b) => b[1] - a[1]);

  const summary = {
    kpis: [
      { label: 'Referrals in range', value: rows.length },
      { label: 'Intake owners', value: Object.keys(byOwner).length },
      { label: 'Reached Clinical+', value: rows.filter((r) => !!r.clinical_review_decision || ['Clinical Intake RN Review', 'EMR Onboarding', 'Staffing Feasibility', 'Admin Confirmation', 'Pre-SOC', 'SOC Scheduled', 'SOC Completed', 'Post Visit Intake', 'Post Visit Clinical Review', 'Completed'].includes(r.current_stage)).length },
      { label: 'SOC completed', value: rows.filter((r) => isSocCompletedReferral(r)).length },
    ],
    charts: [
      {
        title: 'Intake volume by day',
        type: 'bar',
        labels: daySeries.map(([d]) => d),
        datasets: [{
          label: 'Referrals',
          data: daySeries.map(([, n]) => n),
          backgroundColor: '#C41E6ACC',
          borderColor: '#C41E6A',
          borderWidth: 1,
        }],
      },
      {
        title: 'By intake owner',
        type: 'bar',
        labels: ownerSeries.map(([d]) => d),
        datasets: [{
          label: 'Referrals',
          data: ownerSeries.map(([, n]) => n),
          backgroundColor: '#2563EBCC',
          borderColor: '#2563EB',
          borderWidth: 1,
        }],
      },
      {
        title: 'Current stage mix',
        type: 'doughnut',
        labels: stageSeries.map(([d]) => d),
        datasets: [{
          data: stageSeries.map(([, n]) => n),
          backgroundColor: ['#C41E6A', '#2563EB', '#059669', '#EA580C', '#7C3AED', '#0891B2', '#CA8A04', '#BE123C', '#4B5563', '#0F766E'],
        }],
      },
    ],
  };

  return { rows, columns, summary };
}

/**
 * Staff Audit — stage moves + activity log actions by staff in a date range.
 */
export async function runStaffAudit({ dateFrom, dateTo }) {
  const histFilters = [];
  const actFilters = [];
  if (dateFrom && dateTo) {
    histFilters.push({ field: 'timestamp', operator: 'between', value: dateFrom, value2: dateTo });
    actFilters.push({ field: 'timestamp', operator: 'between', value: dateFrom, value2: dateTo });
  } else if (dateFrom) {
    histFilters.push({ field: 'timestamp', operator: 'after', value: dateFrom });
    actFilters.push({ field: 'timestamp', operator: 'after', value: dateFrom });
  } else if (dateTo) {
    histFilters.push({ field: 'timestamp', operator: 'before', value: dateTo });
    actFilters.push({ field: 'timestamp', operator: 'before', value: dateTo });
  }

  const [{ rows: history }, { rows: activity }] = await Promise.all([
    fetchReportData({
      tableName: 'StageHistory',
      filters: histFilters,
      selectedKeys: ['__actor_name'],
      sort: [{ field: 'timestamp', direction: 'desc' }],
    }),
    fetchReportData({
      tableName: 'ActivityLog',
      filters: actFilters,
      selectedKeys: ['__actor_name', '__patient_name'],
      sort: [{ field: 'timestamp', direction: 'desc' }],
    }).catch(() => ({ rows: [] })),
  ]);

  // Combined detail: stage moves first, then activity events tagged by type
  const stageRows = history.map((r) => ({
    event_type: 'Stage Move',
    timestamp: r.timestamp || r.created_at || '',
    staff: r.__actor_name || '—',
    action: `${r.from_stage || '?'} → ${r.to_stage || '?'}`,
    detail: r.reason || '',
    patient: '',
    referral_id: r.referral_id || '',
  }));
  const activityRows = activity.map((r) => ({
    event_type: 'Activity',
    timestamp: r.timestamp || r.created_at || '',
    staff: r.__actor_name || '—',
    action: r.action || '—',
    detail: r.detail || '',
    patient: r.__patient_name || '',
    referral_id: r.referral_id || '',
  }));

  const rows = [...stageRows, ...activityRows].sort((a, b) =>
    String(b.timestamp).localeCompare(String(a.timestamp)));

  const columns = [
    { key: 'event_type', label: 'Event Type' },
    { key: 'timestamp', label: 'Timestamp' },
    { key: 'staff', label: 'Staff' },
    { key: 'action', label: 'Action' },
    { key: 'detail', label: 'Detail' },
    { key: 'patient', label: 'Patient' },
    { key: 'referral_id', label: 'Referral ID' },
  ];

  const byStaff = {};
  for (const r of rows) {
    const s = r.staff || '—';
    if (!byStaff[s]) byStaff[s] = { staff: s, stage_moves: 0, activities: 0, total: 0 };
    if (r.event_type === 'Stage Move') byStaff[s].stage_moves++;
    else byStaff[s].activities++;
    byStaff[s].total++;
  }
  const staffSeries = Object.values(byStaff).sort((a, b) => b.total - a.total).slice(0, 15);

  const summary = {
    kpis: [
      { label: 'Total events', value: rows.length },
      { label: 'Stage moves', value: stageRows.length },
      { label: 'Activity events', value: activityRows.length },
      { label: 'Staff involved', value: Object.keys(byStaff).length },
    ],
    charts: [
      {
        title: 'Events by staff',
        type: 'bar',
        labels: staffSeries.map((s) => s.staff),
        datasets: [
          {
            label: 'Stage moves',
            data: staffSeries.map((s) => s.stage_moves),
            backgroundColor: '#C41E6ACC',
            borderColor: '#C41E6A',
            borderWidth: 1,
          },
          {
            label: 'Activity',
            data: staffSeries.map((s) => s.activities),
            backgroundColor: '#2563EBCC',
            borderColor: '#2563EB',
            borderWidth: 1,
          },
        ],
      },
    ],
  };

  return { rows, columns, summary };
}

/**
 * Source & Campaign Attribution — one row per source
 */
export async function runSourceAttribution({ dateFrom, dateTo, division, sourceIds } = {}) {
  const filters = buildReferralParamFilters({ dateFrom, dateTo, division, sourceIds });

  const { rows } = await fetchReportData({ tableName: 'Referrals', filters, selectedKeys: ['__source_name', '__source_type', '__campaign_name', 'referral_method'] });

  const groups = {};
  for (const row of rows) {
    const sid = row.referral_source_id || '__unknown__';
    if (!groups[sid]) {
      groups[sid] = {
        sourceName: row.__source_name || '—',
        sourceType: row.__source_type || '—',
        methods:    new Set(),
        campaigns:  new Set(),
        total: 0, soc: 0, ntuc: 0, active: 0,
      };
    }
    const g = groups[sid];
    g.total++;
    if (row.current_stage === 'NTUC') g.ntuc++;
    if (isSocCompletedReferral(row)) g.soc++;
    if (!['NTUC', 'SOC Completed', 'Completed'].includes(row.current_stage)) g.active++;
    if (row.__campaign_name && row.__campaign_name !== '—') g.campaigns.add(row.__campaign_name);
    if (row.referral_method) g.methods.add(row.referral_method);
  }

  const columns = [
    { key: 'sourceName',   label: 'Referral Source' },
    { key: 'sourceType',   label: 'Source Type' },
    { key: 'methods',      label: 'Methods Seen' },
    { key: 'campaigns',    label: 'Campaigns' },
    { key: 'total',        label: 'Total Referrals' },
    { key: 'active',       label: 'Active' },
    { key: 'soc',          label: 'SOC/ROC Completed' },
    { key: 'ntuc',         label: 'NTUC' },
    { key: 'conversionRate', label: 'SOC Rate' },
    { key: 'ntucRate',     label: 'NTUC Rate' },
  ];

  const outputRows = Object.values(groups).map((g) => ({
    ...g,
    methods:        [...g.methods].join(', ') || '—',
    campaigns:      [...g.campaigns].join(', ') || '—',
    conversionRate: g.total ? `${Math.round((g.soc / g.total) * 100)}%` : '0%',
    ntucRate:       g.total ? `${Math.round((g.ntuc / g.total) * 100)}%` : '0%',
  }));

  outputRows.sort((a, b) => b.total - a.total);
  return { rows: outputRows, columns };
}

/**
 * Method Attribution — one row per referral method (how the lead reached us).
 */
export async function runMethodAttribution({ dateFrom, dateTo, division, sourceIds } = {}) {
  const filters = buildReferralParamFilters({ dateFrom, dateTo, division, sourceIds });
  const { rows } = await fetchReportData({
    tableName: 'Referrals',
    filters,
    selectedKeys: ['referral_method', '__source_name'],
  });

  const groups = {};
  for (const row of rows) {
    const method = (row.referral_method || '').trim() || '(Blank)';
    if (!groups[method]) {
      groups[method] = { method, total: 0, soc: 0, ntuc: 0, active: 0, sources: new Set() };
    }
    const g = groups[method];
    g.total++;
    if (row.current_stage === 'NTUC') g.ntuc++;
    if (isSocCompletedReferral(row)) g.soc++;
    if (!['NTUC', 'SOC Completed', 'Completed'].includes(row.current_stage)) g.active++;
    if (row.__source_name && row.__source_name !== '—') g.sources.add(row.__source_name);
  }

  const columns = [
    { key: 'method', label: 'Referral Method' },
    { key: 'sources', label: 'Sources' },
    { key: 'total', label: 'Total Referrals' },
    { key: 'active', label: 'Active' },
    { key: 'soc', label: 'SOC/ROC Completed' },
    { key: 'ntuc', label: 'NTUC' },
    { key: 'conversionRate', label: 'SOC Rate' },
    { key: 'ntucRate', label: 'NTUC Rate' },
  ];

  const outputRows = Object.values(groups).map((g) => {
    const listed = [...g.sources].slice(0, 8).join(', ');
    const more = g.sources.size > 8 ? ` (+${g.sources.size - 8})` : '';
    return {
      method: g.method,
      sources: listed ? `${listed}${more}` : '—',
      total: g.total,
      active: g.active,
      soc: g.soc,
      ntuc: g.ntuc,
      conversionRate: g.total ? `${Math.round((g.soc / g.total) * 100)}%` : '0%',
      ntucRate: g.total ? `${Math.round((g.ntuc / g.total) * 100)}%` : '0%',
    };
  });

  outputRows.sort((a, b) => {
    if (a.method === '(Blank)') return 1;
    if (b.method === '(Blank)') return -1;
    return b.total - a.total;
  });
  return { rows: outputRows, columns };
}

/** First linked-record id from Airtable-style link fields (array or scalar). */
function firstLink(v) {
  if (Array.isArray(v) && v.length) return v[0];
  return v || null;
}

function formatPersonName(f) {
  if (!f) return '—';
  if (f.name) return String(f.name).trim() || '—';
  return `${f.first_name || ''} ${f.last_name || ''}`.trim() || f.email || '—';
}

function formatTicketTag(num) {
  return num != null ? `WB-${String(num).padStart(5, '0')}` : '—';
}

/** Human-readable duration between two ISO timestamps (or "—" / "Still open"). */
function formatResolveDuration(createdAt, resolvedAt) {
  if (!createdAt) return '—';
  const start = new Date(createdAt).getTime();
  if (!Number.isFinite(start)) return '—';
  if (!resolvedAt) return 'Still open';
  const end = new Date(resolvedAt).getTime();
  if (!Number.isFinite(end) || end < start) return '—';
  const mins = Math.floor((end - start) / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

// Mirrors Support/support/src/lib/schema.js — ID Tech vs in-house ownership.
const ID_TECH_EMAIL = 'support@idtechsolutions.com';

function isIdTechTeam(team) {
  return !!team && String(team.primary_email || '').trim().toLowerCase() === ID_TECH_EMAIL;
}

/**
 * Effective ID Tech check (same rules as the Support app):
 *  - native ID Tech category (unless internal_override), OR
 *  - staff escalated via "Route to ID Tech" (routed_to_idtech_at set).
 * internal_override always wins (forces in-house handling).
 */
function effectiveIsIdTech(team, ticketFields) {
  if (ticketFields?.internal_override) return false;
  return isIdTechTeam(team) || !!ticketFields?.routed_to_idtech_at;
}

/**
 * Support Tickets — full ticket log from the IT Support app (Tickets table).
 * Sender, topic, description, attachments, managed-by (ID Tech vs Internal),
 * time-to-resolve, resolver, notes.
 */
export async function runSupportTicketsReport({ dateFrom, dateTo, ticketStatus }) {
  const filters = [];
  if (ticketStatus) filters.push({ field: 'status', operator: 'eq', value: ticketStatus });
  if (dateFrom && dateTo) filters.push({ field: 'created_at', operator: 'between', value: dateFrom, value2: dateTo });
  else if (dateFrom) filters.push({ field: 'created_at', operator: 'after', value: dateFrom });
  else if (dateTo)   filters.push({ field: 'created_at', operator: 'before', value: dateTo });

  const formula = buildFormula(filters);
  const ticketParams = { sort: [{ field: 'created_at', direction: 'desc' }] };
  if (formula) ticketParams.filterByFormula = formula;

  const [ticketRecs, categoryMap, teamMap, userMap, clinicianMap, attachmentRecs] = await Promise.all([
    airtable.fetchAll('Tickets', ticketParams),
    getLookupMap('Categories'),
    getLookupMap('Teams'),
    getLookupMap('Users'),
    getLookupMap('Clinicians'),
    airtable.fetchAll('Attachments').catch(() => []),
  ]);

  // Group attachments by ticket record id / primary id
  const attsByTicket = {};
  for (const rec of attachmentRecs) {
    const f = rec.fields || {};
    const tid = firstLink(f.ticket_id);
    if (!tid) continue;
    if (!attsByTicket[tid]) attsByTicket[tid] = [];
    attsByTicket[tid].push({
      _id: rec.id,
      file_name: f.file_name || (f.r2_object_key ? String(f.r2_object_key).split('/').pop() : 'file'),
      r2_object_key: f.r2_object_key || '',
    });
  }

  // Collect unique keys to sign (avoid duplicate /sign calls)
  const keysToSign = new Set();
  for (const list of Object.values(attsByTicket)) {
    for (const a of list) {
      if (a.r2_object_key) keysToSign.add(a.r2_object_key);
    }
  }
  const signedByKey = {};
  await Promise.all(
    [...keysToSign].map(async (key) => {
      try {
        const url = await getSignedFileUrl({ r2_key: key });
        if (url) signedByKey[key] = url;
      } catch {
        /* best-effort — export still lists file names */
      }
    }),
  );

  const rows = ticketRecs.map((rec) => {
    const f = rec.fields || {};
    const categoryId = firstLink(f.category_id);
    const category = categoryMap[categoryId] || {};
    const team = teamMap[firstLink(category.team_id)] || {};
    const managedBy = effectiveIsIdTech(team, f) ? 'Managed by ID Tech' : 'Managed Internally';
    const isField = (f.source || 'clerk') === 'field';
    const sender = isField
      ? formatPersonName(clinicianMap[firstLink(f.clinician_id)])
      : formatPersonName(userMap[firstLink(f.requester_id)]);
    const resolver = formatPersonName(userMap[firstLink(f.resolved_by_id)]);

    const rawAtts = [
      ...(attsByTicket[rec.id] || []),
      ...(f.id && f.id !== rec.id ? (attsByTicket[f.id] || []) : []),
    ];
    const seen = new Set();
    const atts = rawAtts.filter((a) => {
      if (seen.has(a._id)) return false;
      seen.add(a._id);
      return true;
    });

    const attachmentLinks = atts.length
      ? atts.map((a) => {
          const url = a.r2_object_key ? signedByKey[a.r2_object_key] : '';
          return url ? `${a.file_name}: ${url}` : a.file_name;
        }).join('\n')
      : '—';

    return {
      ticket_number: formatTicketTag(f.ticket_number),
      status: f.status || '—',
      managed_by: managedBy,
      sender,
      topic: category.name || '—',
      details: f.details || '',
      attachments: attachmentLinks,
      created_at: f.created_at || '',
      resolved_at: f.resolved_at || '',
      time_to_resolve: formatResolveDuration(f.created_at, f.resolved_at),
      resolved_by: resolver,
      resolution_note: f.resolution_note || '',
      source: isField ? 'Field' : 'Clerk',
    };
  });

  const columns = [
    { key: 'ticket_number',    label: 'Ticket #' },
    { key: 'status',           label: 'Status' },
    { key: 'managed_by',       label: 'Managed By' },
    { key: 'sender',           label: 'Sender' },
    { key: 'topic',            label: 'Topic' },
    { key: 'details',          label: 'Description' },
    { key: 'attachments',      label: 'Attachments' },
    { key: 'created_at',       label: 'Created' },
    { key: 'resolved_at',      label: 'Resolved' },
    { key: 'time_to_resolve',  label: 'Time to Resolve' },
    { key: 'resolved_by',      label: 'Resolved By' },
    { key: 'resolution_note',  label: 'Resolution Notes' },
    { key: 'source',           label: 'Source' },
  ];

  return { rows, columns };
}

/**
 * SOC / ROC completed — patients with completion stamp in a date range.
 */
export async function runSocCompleted({ dateFrom, dateTo, division, marketerIds, ownerIds, episodeType } = {}) {
  // Durable stamp: include cases sent back to Intake for post-SOC work.
  const filters = [
    { field: 'soc_completed_date', operator: 'not_empty' },
    ...buildReferralParamFilters({
      dateFrom,
      dateTo,
      division,
      marketerIds,
      ownerIds,
      dateField: 'soc_completed_date',
    }),
  ];

  const cols = [
    '__patient_name', '__patient_dob', 'division', 'episode_type', 'current_stage',
    'referral_date', 'soc_scheduled_date', 'soc_completed_date',
    '__marketer_name', '__intake_owner', '__facility_name', '__source_name',
    'services_requested',
  ];
  const { rows: fetched } = await fetchReportData({
    tableName: 'Referrals',
    filters,
    selectedKeys: cols,
    sort: [{ field: 'soc_completed_date', direction: 'desc' }],
  });
  let rows = fetched.filter((r) => isSocCompletedReferral(r));
  if (episodeType === 'SOC' || episodeType === 'ROC') {
    rows = rows.filter((r) => normalizeEpisodeType(r) === episodeType);
  }
  rows = rows.map((r) => ({
    ...r,
    episode_type: normalizeEpisodeType(r),
  }));

  const columns = [
    { key: '__patient_name', label: 'Patient' },
    { key: '__patient_dob', label: 'DOB' },
    { key: 'division', label: 'Division' },
    { key: 'episode_type', label: 'SOC / ROC' },
    { key: 'soc_completed_date', label: 'Completed' },
    { key: 'soc_scheduled_date', label: 'Scheduled' },
    { key: 'referral_date', label: 'Referral Date' },
    { key: '__marketer_name', label: 'Marketer' },
    { key: '__intake_owner', label: 'Intake Owner' },
    { key: '__facility_name', label: 'Facility' },
    { key: '__source_name', label: 'Source' },
    { key: 'services_requested', label: 'Services' },
  ];

  const byMarketer = {};
  let socCount = 0;
  let rocCount = 0;
  for (const r of rows) {
    const m = r.__marketer_name || 'Unassigned';
    byMarketer[m] = (byMarketer[m] || 0) + 1;
    if (r.episode_type === 'ROC') rocCount += 1;
    else socCount += 1;
  }
  const marketerSeries = Object.entries(byMarketer).sort((a, b) => b[1] - a[1]).slice(0, 12);

  return {
    rows,
    columns,
    summary: {
      kpis: [
        { label: 'SOC completed', value: socCount },
        { label: 'ROC completed', value: rocCount },
        { label: 'Total', value: rows.length },
        { label: 'Marketers', value: Object.keys(byMarketer).length },
        { label: 'ALF', value: rows.filter((r) => r.division === 'ALF').length },
        { label: 'Special Needs', value: rows.filter((r) => r.division === 'Special Needs').length },
      ],
      charts: marketerSeries.length ? [{
        title: 'Completed by marketer',
        type: 'bar',
        labels: marketerSeries.map(([m]) => m),
        datasets: [{
          label: 'SOC/ROC',
          data: marketerSeries.map(([, n]) => n),
          backgroundColor: '#059669CC',
          borderColor: '#059669',
          borderWidth: 1,
        }],
      }] : [],
    },
  };
}

async function runProcessingOverview({ dateFrom, dateTo, division, marketerIds } = {}) {
  const filters = buildReferralParamFilters({ dateFrom, dateTo, division, marketerIds });
  const cols = [
    '__patient_name', 'division', 'current_stage', 'patient_id', 'physician_id',
    'facility_id', 'marketer_id', 'intake_owner_id',
    'f2f_date', 'clinical_review_completed_at', 'auth_obtained_at',
    'eligibility_completed_at', 'emr_onboarded_at', 'staffing_confirmed_at',
    'soc_scheduled_date', 'soc_completed_date',
    '__facility_name', '__marketer_name', '__intake_owner', '__physician_name',
  ];
  const { rows: raw } = await fetchReportData({
    tableName: 'Referrals',
    filters,
    selectedKeys: cols,
  });

  const [physiciansMap, triageAdultRecs, triagePedRecs, patientsMap] = await Promise.all([
    getLookupMap('Physicians'),
    airtable.fetchAll('TriageAdult').catch(() => []),
    airtable.fetchAll('TriagePediatric').catch(() => []),
    getLookupMap('Patients'),
  ]);

  const triageAdult = {};
  for (const r of triageAdultRecs) {
    const f = { _id: r.id, ...r.fields };
    triageAdult[r.id] = f;
    if (f.id) triageAdult[f.id] = f;
  }
  const triagePediatric = {};
  for (const r of triagePedRecs) {
    const f = { _id: r.id, ...r.fields };
    triagePediatric[r.id] = f;
    if (f.id) triagePediatric[f.id] = f;
  }

  function triageFor(row) {
    const refId = row.id;
    const match = (t) => {
      const tid = t.referral_id;
      if (!tid) return false;
      if (tid === refId || tid === row._id) return true;
      if (Array.isArray(tid)) return tid.includes(refId) || tid.includes(row._id);
      return false;
    };
    return Object.values(triageAdult).find(match)
      || Object.values(triagePediatric).find(match)
      || null;
  }

  const rows = [];
  for (const row of raw) {
    if (!isInProcessingPool(row)) continue;
    const pid = Array.isArray(row.patient_id) ? row.patient_id[0] : row.patient_id;
    const patient = patientsMap[pid] || {};
    const referral = {
      ...row,
      patient: {
        ...patient,
        first_name: patient.first_name,
        last_name: patient.last_name,
        dob: patient.dob || row.__patient_dob,
        gender: patient.gender,
        phone_primary: patient.phone_primary,
        address_street: patient.address_street,
        address_city: patient.address_city,
        address_state: patient.address_state,
        address_zip: patient.address_zip,
        insurance_plan: patient.insurance_plan,
        insurance_plans: patient.insurance_plans,
        insurance_plan_details: patient.insurance_plan_details,
      },
    };
    const phyId = firstId(row.physician_id);
    const physician = (phyId && physiciansMap[phyId]) || null;
    const flags = buildProcessingFlags(referral, {
      triageData: triageFor(row),
      physician,
    });
    rows.push({
      patientName: row.__patient_name || pid || '',
      division: row.division || '',
      current_stage: row.current_stage || '',
      ...Object.fromEntries(
        Object.entries(flags).map(([k, v]) => [k, v ? 'Yes' : 'No']),
      ),
      facility: row.__facility_name && row.__facility_name !== '—' ? row.__facility_name : '',
      marketer: row.__marketer_name && row.__marketer_name !== '—' ? row.__marketer_name : '',
      intakeOwner: row.__intake_owner || '',
      doctor: (row.__physician_name && row.__physician_name !== '—'
        ? row.__physician_name
        : `${physician?.first_name || ''} ${physician?.last_name || ''}`.trim()) || '',
    });
  }

  rows.sort((a, b) => (a.patientName || '').localeCompare(b.patientName || '', undefined, { sensitivity: 'base' }));

  return {
    rows,
    columns: PROCESSING_OVERVIEW_EXPORT_COLUMNS,
    summary: {
      total: rows.length,
      note: 'Open pipeline only (excludes SOC/ROC completed, NTUC, Discarded).',
    },
  };
}

/**
 * Every referral source in the directory, with contacts, type, method, entity,
 * marketer, and patient totals. Excel adds a patient-level sheet.
 */
export async function runReferralSourceReport({ dateFrom, dateTo, division, sourceIds } = {}) {
  const filters = buildReferralParamFilters({ dateFrom, dateTo, division, sourceIds });
  const cols = [
    '__patient_name', '__patient_dob', '__patient_phone', '__patient_insplan',
    '__source_name', '__source_type',
    '__marketer_name', '__facility_name', '__intake_owner', '__campaign_name',
    'referral_method',
  ];
  const [{ rows: referrals }, sourcesMap, marketersMap, patientsMap] = await Promise.all([
    fetchReportData({ tableName: 'Referrals', filters, selectedKeys: cols }),
    getLookupMap('ReferralSources'),
    getLookupMap('Marketers'),
    getLookupMap('Patients'),
  ]);

  let sources = uniqueLookupRecords(sourcesMap);
  if (Array.isArray(sourceIds) && sourceIds.length) {
    const want = new Set(sourceIds);
    sources = sources.filter((s) => want.has(s.id));
  }

  return buildReferralSourceReport({
    sources,
    marketers: marketersMap,
    referrals,
    patients: patientsMap,
  });
}

/**
 * Time from referral to HCHB chart open and first visit (SOC completed).
 * Date range is referral_date; blank = all time.
 */
export async function runReferralSpeed({ dateFrom, dateTo, division, marketerIds, ownerIds } = {}) {
  const filters = buildReferralParamFilters({ dateFrom, dateTo, division, marketerIds, ownerIds });
  const cols = [
    '__patient_name', '__facility_name', '__intake_owner', '__marketer_name', '__source_name',
    'division', 'episode_type', 'current_stage', 'referral_date', 'created_at',
    'emr_initial_onboarded_at', 'emr_onboarded_at', 'soc_completed_date',
  ];
  const { rows: fetched } = await fetchReportData({
    tableName: 'Referrals',
    filters,
    selectedKeys: cols,
    sort: [{ field: 'referral_date', direction: 'desc' }],
  });
  const rows = buildReferralSpeedRows(fetched);
  return { rows, columns: REFERRAL_SPEED_COLUMNS, summary: summarizeReferralSpeed(rows) };
}

/**
 * SOC/ROC completed but still missing F2F, MD orders, auth, or eligibility.
 * Date range is soc_completed_date; blank = all completed starts.
 */
export async function runSocMissingDocs({ dateFrom, dateTo, division, marketerIds, ownerIds, episodeType } = {}) {
  const filters = [
    { field: 'soc_completed_date', operator: 'not_empty' },
    ...buildReferralParamFilters({
      dateFrom, dateTo, division, marketerIds, ownerIds, dateField: 'soc_completed_date',
    }),
  ];
  const cols = [
    '__patient_name', '__patient_dob', '__intake_owner', '__clinical_assigned', '__clinical_by',
    '__marketer_name', '__facility_name',
    'division', 'episode_type', 'current_stage', 'soc_completed_date',
    'f2f_date', 'auth_obtained_at', 'eligibility_completed_at',
    'documentation_due_date',
  ];
  const [{ rows: fetched }, cursoryRecs, fileRecs] = await Promise.all([
    fetchReportData({
      tableName: 'Referrals',
      filters,
      selectedKeys: cols,
      sort: [{ field: 'soc_completed_date', direction: 'desc' }],
    }),
    airtable.fetchAll('CursoryReview').catch(() => []),
    airtable.fetchAll('Files').catch(() => []),
  ]);

  let pool = fetched.filter((r) => isSocCompletedReferral(r));
  if (episodeType === 'SOC' || episodeType === 'ROC') {
    pool = pool.filter((r) => normalizeEpisodeType(r) === episodeType);
  }

  const cursoryByRef = indexLinkedByReferral(cursoryRecs.map((r) => ({ _id: r.id, ...r.fields })));
  const filesByRef = indexLinkedByReferral(
    fileRecs
      .map((r) => ({ _id: r.id, ...r.fields }))
      .filter((f) => String(f.category || '').trim() === 'MD Orders'),
  );
  const rows = buildSocMissingDocsRows(pool, { cursoryByRef, filesByRef });
  return { rows, columns: SOC_MISSING_DOCS_COLUMNS, summary: summarizeSocMissingDocs(rows) };
}

/**
 * One row per episode. Patient columns first.
 */
export async function runMasterPatient({ dateFrom, dateTo, division, marketerIds, ownerIds } = {}) {
  const filters = buildReferralParamFilters({ dateFrom, dateTo, division, marketerIds, ownerIds });
  const cols = [
    '__patient_name', '__patient_dob', '__patient_gender', '__patient_address',
    '__patient_phone', '__patient_medicaid', '__patient_medicare', '__patient_insplan',
    '__intake_owner', '__clinical_assigned', '__clinical_by', '__lead_created_by', '__marketer_name', '__facility_name',
    '__source_name', '__source_type', '__source_entity', '__source_method',
    '__physician_name', '__campaign_name',
    'id', 'patient_id', 'division', 'episode_type', 'current_stage', 'priority',
    'services_requested', 'referral_date', 'created_at', 'updated_at',
    'emr_initial_onboarded_at', 'emr_onboarded_at', 'eligibility_completed_at',
    'f2f_date', 'clinical_review_completed_at', 'clinical_review_decision',
    'auth_obtained_at', 'staffing_confirmed_at',
    'soc_scheduled_date', 'soc_completed_date',
    'hchb_entered', 'is_pecos_verified', 'is_opra_verified',
    'documentation_deferred', 'documentation_due_date', 'documentation_cleared_at',
    'hold_reason', 'ntuc_reason',
  ];
  const [{ rows: fetched }, cursoryRecs, fileRecs] = await Promise.all([
    fetchReportData({
      tableName: 'Referrals',
      filters,
      selectedKeys: cols,
      sort: [{ field: 'referral_date', direction: 'desc' }],
    }),
    airtable.fetchAll('CursoryReview').catch(() => []),
    airtable.fetchAll('Files').catch(() => []),
  ]);
  const cursoryByRef = indexLinkedByReferral(cursoryRecs.map((r) => ({ _id: r.id, ...r.fields })));
  const filesByRef = indexLinkedByReferral(
    fileRecs
      .map((r) => ({ _id: r.id, ...r.fields }))
      .filter((f) => String(f.category || '').trim() === 'MD Orders'),
  );
  const rows = buildMasterPatientRows(fetched, { cursoryByRef, filesByRef });
  return { rows, columns: MASTER_PATIENT_COLUMNS, summary: summarizeMasterPatient(rows) };
}

// ── Files report ──────────────────────────────────────────────────────────────

function fmtFileSize(n) {
  const bytes = Number(n);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function dateOnly(v) {
  const s = String(v || '');
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

/**
 * Files & Uploaders — one row per file in the system (optionally limited to
 * selected categories and an upload-date window). Patient name leftmost,
 * upload timestamp + uploader front and center, then the rest of the file
 * metadata. The workbook's extra sheet breaks down upload counts per
 * uploader per file type.
 */
export async function runFilesReport({ dateFrom, dateTo, fileCategories } = {}) {
  const selected = Array.isArray(fileCategories) ? fileCategories.filter(Boolean) : [];
  const filters = selected.length
    ? [{ field: 'category', operator: 'in', value: selected }]
    : [];

  const { rows: raw } = await fetchReportData({
    tableName: 'Files',
    filters,
    selectedKeys: ['__patient_name', '__uploaded_by'],
  });

  // Inclusive upload-date window, applied in JS so a `dateTo` of today still
  // includes files uploaded today (created_at is a timestamp).
  const fromMs = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : null;
  const toMs   = dateTo   ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;

  const rows = raw
    .filter((f) => {
      if (fromMs == null && toMs == null) return true;
      const t = new Date(f.created_at || 0).getTime();
      if (Number.isNaN(t)) return false;
      if (fromMs != null && t < fromMs) return false;
      if (toMs != null && t > toMs) return false;
      return true;
    })
    .map((f) => ({
      __patient_name: f.__patient_name || '—',
      category:       f.category || '(no type)',
      document_subtype: f.document_subtype || '',
      file_name:      f.file_name || '',
      uploaded_at:    f.created_at
        ? new Date(f.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
        : '',
      __uploaded_by:  f.__uploaded_by || '—',
      f2f_visit_date: dateOnly(f.f2f_visit_date),
      document_date:  dateOnly(f.document_date),
      document_valid_through: dateOnly(f.document_valid_through),
      file_size:      fmtFileSize(f.file_size),
      referral_id:    f.referral_id || '',
      _sortMs:        new Date(f.created_at || 0).getTime() || 0,
    }))
    .sort((a, b) =>
      a.__patient_name.localeCompare(b.__patient_name)
      || a._sortMs - b._sortMs);

  const columns = [
    { key: '__patient_name',         label: 'Patient' },
    { key: 'category',               label: 'File Type' },
    { key: 'document_subtype',       label: 'Subtype' },
    { key: 'file_name',              label: 'File Name' },
    { key: 'uploaded_at',            label: 'Uploaded' },
    { key: '__uploaded_by',          label: 'Uploaded By' },
    { key: 'f2f_visit_date',         label: 'F2F Visit Date' },
    { key: 'document_date',          label: 'Document Date' },
    { key: 'document_valid_through', label: 'Valid Through' },
    { key: 'file_size',              label: 'Size' },
    { key: 'referral_id',            label: 'Referral ID' },
  ];

  // ── Uploader × file-type counts (summary sheet + charts) ─────────────────
  const typeSet = new Set(rows.map((r) => r.category));
  const types = (selected.length ? selected.filter((t) => typeSet.has(t)) : [...typeSet]).sort();
  const byUploader = {};
  for (const r of rows) {
    const u = r.__uploaded_by;
    if (!byUploader[u]) byUploader[u] = { __uploaded_by: u, __total: 0 };
    byUploader[u][r.category] = (byUploader[u][r.category] || 0) + 1;
    byUploader[u].__total += 1;
  }
  const uploaderRows = Object.values(byUploader).sort((a, b) => b.__total - a.__total);
  const uploaderSheet = {
    name: 'Uploads by Uploader',
    columns: [
      { key: '__uploaded_by', label: 'Uploader' },
      ...types.map((t) => ({ key: t, label: t })),
      { key: '__total', label: 'Total' },
    ],
    rows: uploaderRows.map((r) => {
      const out = { __uploaded_by: r.__uploaded_by, __total: r.__total };
      for (const t of types) out[t] = r[t] || 0;
      return out;
    }),
  };

  const byType = countRows(rows, 'category');
  const summary = {
    kpis: [
      { label: 'Total files', value: rows.length },
      { label: 'Patients', value: new Set(rows.map((r) => r.__patient_name)).size },
      { label: 'Uploaders', value: uploaderRows.length },
      { label: 'File types', value: types.length },
    ],
    charts: [
      {
        title: 'Uploads by uploader',
        type: 'bar',
        labels: uploaderRows.slice(0, 14).map((r) => r.__uploaded_by),
        datasets: [{ label: 'Files', data: uploaderRows.slice(0, 14).map((r) => r.__total), backgroundColor: '#C41E6ACC', borderColor: '#C41E6A', borderWidth: 1 }],
      },
      {
        title: 'Uploads by file type',
        type: 'bar',
        labels: byType.map((x) => x.label),
        datasets: [{ label: 'Files', data: byType.map((x) => x.count), backgroundColor: '#2563EBCC', borderColor: '#2563EB', borderWidth: 1 }],
      },
    ],
  };

  return { rows, columns, summary, extraSheets: [uploaderSheet] };
}

function countRows(rows, key) {
  const map = {};
  for (const r of rows) {
    const v = String(r[key] ?? '(blank)');
    map[v] = (map[v] || 0) + 1;
  }
  return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
}

// ── Preset definitions ────────────────────────────────────────────────────────

export const PRESETS = [
  {
    id: 'files_report',
    title: 'Files & Uploaders',
    description: 'Every file in the system — one row per file with patient, type, upload date, and uploader. Pick one, several, or all file types. Excel includes an Uploads-by-Uploader summary sheet (counts per file type per uploader).',
    paramControls: ['dateRange', 'fileCategories'],
    async run(params) { return runFilesReport(params); },
  },
  {
    id: 'referral_speed',
    title: 'Referral to HCHB and First Visit',
    description: 'Days from referral date to HCHB chart open and to SOC completed. Blank dates = all time.',
    paramControls: ['dateRange', 'division'],
    async run(params) { return runReferralSpeed(params); },
  },
  {
    id: 'soc_missing_docs',
    title: 'SOC Done, Missing Docs',
    description: 'Completed SOCs still missing F2F or MD orders, with aging. Blank dates = all completed starts.',
    paramControls: ['dateRange', 'division'],
    async run(params) { return runSocMissingDocs(params); },
  },
  {
    id: 'master_patient',
    title: 'Master Patient Report',
    description: 'One row per episode. Patient first, then staff, dates, and gaps. Blank dates = all time.',
    paramControls: ['dateRange', 'division'],
    async run(params) { return runMasterPatient(params); },
  },
  {
    id: 'intake_volume',
    title: 'Intake Volume',
    description: 'Daily intake volume with owner, marketer, source, and stage mix. Summary charts for leadership.',
    paramControls: ['dateRange', 'division'],
    async run(params) { return runIntakeVolume(params); },
  },
  {
    id: 'processing_overview',
    title: 'Processing Overview',
    description: 'Open-pipeline checklist: demographics, triage, insurance, F2F, clinical, auth, eligibility, PECOS/OPRA/NPI, EMR, staffing, SOC. Spot bottlenecks fast.',
    paramControls: ['dateRange', 'division'],
    async run(params) { return runProcessingOverview(params); },
  },
  {
    id: 'referral_sources',
    title: 'Referral Sources',
    description: 'Every source in the directory: contact, type, method, entity, marketer, and patient totals. Excel includes a patient-level sheet.',
    paramControls: ['dateRange', 'division'],
    async run(params) { return runReferralSourceReport(params); },
  },
  {
    id: 'staff_audit',
    title: 'Staff Audit',
    description: 'Who moved patients and which CareStream actions they took. Stage history + activity log combined.',
    paramControls: ['dateRange'],
    async run(params) { return runStaffAudit(params); },
  },
  {
    id: 'marketer_performance',
    title: 'Marketer Performance',
    description: 'Total referrals, stage distribution, SOC rate, and NTUC rate with charts for manager reviews.',
    paramControls: ['dateRange', 'division'],
    async run(params) { return runMarketerPerformance(params); },
  },
  {
    id: 'pipeline_snapshot',
    title: 'Pipeline Snapshot',
    description: 'All referrals currently in the pipeline with patient info, stage, priority, marketer, and F2F status.',
    paramControls: ['dateRange', 'division', 'stage'],
    async run({ dateFrom, dateTo, division, stage, stages, marketerIds } = {}) {
      const stageList = Array.isArray(stages) && stages.length
        ? stages
        : (stage ? [stage] : []);
      const filters = buildReferralParamFilters({
        dateFrom, dateTo, division, marketerIds, stages: stageList,
      });

      const cols = ['__patient_name','__patient_dob','division','current_stage','priority','services_requested','referral_date','__marketer_name','__facility_name','__source_name','f2f_urgency','f2f_expiration','is_pecos_verified','hchb_entered'];
      const { rows } = await fetchReportData({ tableName: 'Referrals', filters, selectedKeys: cols });

      const columns = [
        { key: '__patient_name',   label: 'Patient' },
        { key: '__patient_dob',    label: 'DOB' },
        { key: 'division',         label: 'Division' },
        { key: 'current_stage',    label: 'Stage' },
        { key: 'priority',         label: 'Priority' },
        { key: 'services_requested', label: 'Services' },
        { key: 'referral_date',    label: 'Referral Date' },
        { key: '__marketer_name',  label: 'Marketer' },
        { key: '__facility_name',  label: 'Facility' },
        { key: '__source_name',    label: 'Source' },
        { key: 'f2f_urgency',      label: 'F2F Urgency' },
        { key: 'f2f_expiration',   label: 'F2F Expires' },
        { key: 'is_pecos_verified',label: 'PECOS' },
        { key: 'hchb_entered',     label: 'HCHB' },
      ];
      return { rows, columns };
    },
  },
  {
    id: 'ntuc_analysis',
    title: 'NTUC & Declined Analysis',
    description: 'All referrals that ended as Not to Utilize Care.',
    paramControls: ['dateRange', 'division'],
    async run({ dateFrom, dateTo, division, marketerIds, sourceIds } = {}) {
      const filters = [
        { field: 'current_stage', operator: 'eq', value: 'NTUC' },
        ...buildReferralParamFilters({ dateFrom, dateTo, division, marketerIds, sourceIds }),
      ];

      const cols = ['__patient_name','division','ntuc_reason','ntuc_financial_impact','referral_date','services_requested','__marketer_name','__facility_name','__source_name'];
      const { rows } = await fetchReportData({ tableName: 'Referrals', filters, selectedKeys: cols });

      const columns = [
        { key: '__patient_name',        label: 'Patient' },
        { key: 'division',              label: 'Division' },
        { key: 'ntuc_reason',           label: 'NTUC Reason' },
        { key: 'ntuc_financial_impact', label: 'Financial Impact' },
        { key: 'referral_date',         label: 'Referral Date' },
        { key: 'services_requested',    label: 'Services' },
        { key: '__marketer_name',       label: 'Marketer' },
        { key: '__facility_name',       label: 'Facility' },
        { key: '__source_name',         label: 'Source' },
      ];
      return { rows, columns };
    },
  },
  {
    id: 'f2f_expiration',
    title: 'F2F Expiration Risk',
    description: 'Referrals with F2F documents expiring soon or already expired. Filter by urgency level.',
    paramControls: ['division', 'f2fUrgency'],
    async run({ division, f2fUrgency }) {
      const filters = [{ field: 'f2f_date', operator: 'not_empty' }];
      if (division)   filters.push({ field: 'division',    operator: 'eq', value: division });
      if (f2fUrgency) filters.push({ field: 'f2f_urgency', operator: 'eq', value: f2fUrgency });

      const cols = ['__patient_name','division','current_stage','f2f_date','f2f_expiration','f2f_urgency','__marketer_name'];
      const { rows } = await fetchReportData({
        tableName: 'Referrals', filters, selectedKeys: cols,
        sort: [{ field: 'f2f_expiration', direction: 'asc' }],
      });

      const enriched = rows.map((r) => ({
        ...r,
        days_until_expiry: r.f2f_expiration
          ? daysUntilCalendarDate(r.f2f_expiration)
          : null,
      }));

      const columns = [
        { key: '__patient_name',    label: 'Patient' },
        { key: 'division',          label: 'Division' },
        { key: 'current_stage',     label: 'Stage' },
        { key: 'f2f_date',          label: 'F2F Date' },
        { key: 'f2f_expiration',    label: 'Expires' },
        { key: 'days_until_expiry', label: 'Days Remaining' },
        { key: 'f2f_urgency',       label: 'Urgency' },
        { key: '__marketer_name',   label: 'Marketer' },
      ];
      return { rows: enriched, columns };
    },
  },
  {
    id: 'hold_aging',
    title: 'Hold Aging',
    description: 'All referrals currently on Hold.',
    paramControls: ['division'],
    async run({ division }) {
      const filters = [{ field: 'current_stage', operator: 'eq', value: 'Hold' }];
      if (division) filters.push({ field: 'division', operator: 'eq', value: division });

      const cols = ['__patient_name','division','hold_reason','hold_expected_resolution','services_requested','referral_date','__marketer_name','__facility_name'];
      const { rows } = await fetchReportData({ tableName: 'Referrals', filters, selectedKeys: cols });

      const today = Date.now();
      const enriched = rows.map((r) => ({
        ...r,
        days_on_hold: r.updated_at
          ? Math.floor((today - new Date(r.updated_at)) / 86400000)
          : '—',
      }));

      const columns = [
        { key: '__patient_name',           label: 'Patient' },
        { key: 'division',                 label: 'Division' },
        { key: 'hold_reason',              label: 'Hold Reason' },
        { key: 'hold_expected_resolution', label: 'Expected Resolution' },
        { key: 'days_on_hold',             label: 'Days on Hold' },
        { key: 'referral_date',            label: 'Referral Date' },
        { key: '__marketer_name',          label: 'Marketer' },
        { key: '__facility_name',          label: 'Facility' },
        { key: 'services_requested',       label: 'Services' },
      ];
      return { rows: enriched, columns };
    },
  },
  {
    id: 'insurance_barriers',
    title: 'Insurance Barrier Report',
    description: 'All insurance verification records. Medicare/Medicaid status, auth required, overlaps, and disenrollment flags.',
    paramControls: ['dateRange'],
    async run({ dateFrom, dateTo }) {
      const filters = [];
      if (dateFrom && dateTo) filters.push({ field: 'check_date', operator: 'between', value: dateFrom, value2: dateTo });
      else if (dateFrom) filters.push({ field: 'check_date', operator: 'after', value: dateFrom });
      else if (dateTo)   filters.push({ field: 'check_date', operator: 'before', value: dateTo });

      const cols = ['__patient_name'];
      const { rows } = await fetchReportData({ tableName: 'Insurance_Checks', filters, selectedKeys: cols, sort: [{ field: 'check_date', direction: 'desc' }] });

      const columns = [
        { key: '__patient_name',       label: 'Patient' },
        { key: 'check_date',           label: 'Check Date' },
        { key: 'check_source',         label: 'Source' },
        { key: 'medicare_part_a',      label: 'Medicare A' },
        { key: 'medicare_part_b',      label: 'Medicare B' },
        { key: 'medicaid_active',      label: 'Medicaid Active' },
        { key: 'managed_care_plan',    label: 'Plan' },
        { key: 'auth_required',        label: 'Auth Required' },
        { key: 'disenrollment_needed', label: 'Disenrollment' },
        { key: 'has_open_hh_episode',  label: 'Open HH Episode' },
        { key: 'open_episode_agency',  label: 'Open Agency' },
        { key: 'hospice_overlap',      label: 'Hospice Overlap' },
        { key: 'snf_present',          label: 'SNF Present' },
        { key: 'qmb_status',           label: 'QMB' },
        { key: 'cdpap_active',         label: 'CDPAP' },
        { key: 'result_summary',       label: 'Notes' },
      ];
      return { rows, columns };
    },
  },
  {
    id: 'authorization_tracker',
    title: 'Authorization Tracker',
    description: 'Prior auth status by patient and plan. Pending, approved, denied, and expired auths with effective date windows.',
    paramControls: ['dateRange', 'authStatus'],
    async run({ dateFrom, dateTo, authStatus }) {
      const filters = [];
      if (authStatus) filters.push({ field: 'status', operator: 'eq', value: authStatus });
      if (dateFrom && dateTo) filters.push({ field: 'submitted_date', operator: 'between', value: dateFrom, value2: dateTo });
      else if (dateFrom) filters.push({ field: 'submitted_date', operator: 'after', value: dateFrom });
      else if (dateTo)   filters.push({ field: 'submitted_date', operator: 'before', value: dateTo });

      const cols = ['__patient_name'];
      const { rows } = await fetchReportData({ tableName: 'Authorizations', filters, selectedKeys: cols, sort: [{ field: 'submitted_date', direction: 'desc' }] });

      const columns = [
        { key: '__patient_name',       label: 'Patient' },
        { key: 'plan_name',            label: 'Plan' },
        { key: 'auth_number',          label: 'Auth #' },
        { key: 'status',               label: 'Status' },
        { key: 'services_authorized',  label: 'Services' },
        { key: 'submitted_date',       label: 'Submitted' },
        { key: 'approved_date',        label: 'Approved' },
        { key: 'effective_start',      label: 'Eff. Start' },
        { key: 'effective_end',        label: 'Eff. End' },
        { key: 'denial_reason',        label: 'Denial Reason' },
        { key: 'notes',                label: 'Notes' },
      ];
      return { rows, columns };
    },
  },
  {
    id: 'active_episodes',
    title: 'Active Episodes',
    description: 'Post-SOC episode records. Recertification due dates, revenue risk flags, and HCHB sync status.',
    paramControls: ['episodeStatus', 'revenueRisk'],
    async run({ episodeStatus, revenueRisk }) {
      const filters = [];
      if (episodeStatus) filters.push({ field: 'status', operator: 'eq', value: episodeStatus });
      if (revenueRisk === 'true') filters.push({ field: 'revenue_risk_flag', operator: 'true' });

      const cols = ['__patient_name','__patient_dob','__patient_division'];
      const { rows } = await fetchReportData({ tableName: 'Episodes', filters, selectedKeys: cols, sort: [{ field: 'soc_date', direction: 'desc' }] });

      const columns = [
        { key: '__patient_name',     label: 'Patient' },
        { key: '__patient_dob',      label: 'DOB' },
        { key: '__patient_division', label: 'Division' },
        { key: 'soc_date',           label: 'SOC Date' },
        { key: 'episode_start',      label: 'Episode Start' },
        { key: 'episode_end',        label: 'Episode End' },
        { key: 'status',             label: 'Status' },
        { key: 'recert_due_date',    label: 'Recert Due' },
        { key: 'revenue_risk_flag',  label: 'Revenue Risk' },
        { key: 'revenue_risk_reason',label: 'Risk Reason' },
        { key: 'hchb_synced',        label: 'HCHB Synced' },
      ];
      return { rows, columns };
    },
  },
  {
    id: 'conflict_log',
    title: 'Conflict Log',
    description: 'All flagged conflicts. Type, severity, resolution status, and days to resolve.',
    paramControls: ['dateRange', 'conflictStatus'],
    async run({ dateFrom, dateTo, conflictStatus }) {
      const filters = [];
      if (conflictStatus) filters.push({ field: 'status', operator: 'eq', value: conflictStatus });
      if (dateFrom && dateTo) filters.push({ field: 'created_at', operator: 'between', value: dateFrom, value2: dateTo });
      else if (dateFrom) filters.push({ field: 'created_at', operator: 'after', value: dateFrom });
      else if (dateTo)   filters.push({ field: 'created_at', operator: 'before', value: dateTo });

      const cols = ['__patient_name','__flagged_by','__resolved_by'];
      const { rows } = await fetchReportData({ tableName: 'Conflicts', filters, selectedKeys: cols, sort: [{ field: 'created_at', direction: 'desc' }] });

      const today = Date.now();
      const enriched = rows.map((r) => ({
        ...r,
        days_open: r.created_at
          ? Math.floor((today - new Date(r.created_at)) / 86400000)
          : '—',
      }));

      const columns = [
        { key: '__patient_name',  label: 'Patient' },
        { key: 'type',            label: 'Type' },
        { key: 'severity',        label: 'Severity' },
        { key: 'status',          label: 'Status' },
        { key: 'description',     label: 'Description' },
        { key: 'created_at',      label: 'Flagged' },
        { key: 'resolved_at',     label: 'Resolved' },
        { key: 'days_open',       label: 'Days Open' },
        { key: '__flagged_by',    label: 'Flagged By' },
        { key: '__resolved_by',   label: 'Resolved By' },
        { key: 'resolution_note', label: 'Resolution' },
      ];
      return { rows: enriched, columns };
    },
  },
  {
    id: 'source_attribution',
    title: 'Source & Campaign Attribution',
    description: 'Total referrals, SOC rate, NTUC rate. Track which sources convert.',
    paramControls: ['dateRange', 'division'],
    async run(params) { return runSourceAttribution(params); },
  },
  {
    id: 'method_attribution',
    title: 'Referral Method Attribution',
    description: 'Outcomes by how the lead reached us (Word of Mouth, Facebook Ads, etc.).',
    paramControls: ['dateRange', 'division'],
    async run(params) { return runMethodAttribution(params); },
  },
  {
    id: 'support_tickets',
    title: 'Support Tickets',
    description: 'IT support tickets with sender, topic, ID Tech vs internal ownership, attachments, time to resolve, and resolution details.',
    paramControls: ['dateRange', 'ticketStatus'],
    async run(params) { return runSupportTicketsReport(params); },
  },
];
