/**
 * reportEngine.js
 *
 * Schema definitions, filter formula building, data fetching with lookup
 * resolution, and Excel (XLSX) export for the CareStream Reports page.
 */

import airtable from '../api/airtable.js';
import * as XLSX from 'xlsx';

// ── Enum constants (mirroring ERD) ────────────────────────────────────────────

export const STAGES = [
  'Lead Entry', 'Intake', 'Eligibility Verification', 'Disenrollment Required',
  'F2F/MD Orders Pending', 'Clinical Intake RN Review', 'Authorization Pending',
  'Conflict', 'Staffing Feasibility', 'Admin Confirmation',
  'Pre-SOC', 'SOC Scheduled', 'SOC Completed', 'Hold', 'NTUC',
];

export const ACTIVE_STAGES = STAGES.filter(
  (s) => s !== 'SOC Completed' && s !== 'NTUC',
);

export const DIVISIONS    = ['ALF', 'Special Needs'];
export const SERVICES     = ['SN', 'PT', 'OT', 'ST', 'HHA', 'ABA'];
export const PRIORITIES   = ['Low', 'Normal', 'High', 'Critical'];
export const F2F_URGENCY  = ['Green', 'Yellow', 'Orange', 'Red', 'Expired'];
export const REGIONS      = ['LI', 'Bronx', 'Westchester', 'NYC'];
export const SOURCE_TYPES = [
  'Hospital', 'SNF', 'MD/PCP', 'ALF', 'Web', 'Vendor', 'Fax',
  'Allscripts', 'Wellness Director', 'Campaign', 'Self-Referral', 'Other',
];

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
          { key: 'division',             label: 'Division',              type: 'enum',    options: DIVISIONS,   filterable: true },
          { key: 'current_stage',        label: 'Stage',                 type: 'enum',    options: STAGES,      filterable: true },
          { key: 'priority',             label: 'Priority',              type: 'enum',    options: PRIORITIES,  filterable: true },
          { key: 'services_requested',   label: 'Services Requested',    type: 'text',    filterable: false },
          { key: 'referral_date',        label: 'Referral Date',         type: 'date',    filterable: true },
          { key: 'admitted_date',        label: 'Admitted Date',         type: 'date',    filterable: true },
          { key: 'soc_scheduled_date',   label: 'SOC Scheduled Date',    type: 'date',    filterable: true },
          { key: 'soc_completed_date',   label: 'SOC Completed Date',    type: 'date',    filterable: true },
          { key: 'hchb_entered',         label: 'HCHB Entered',          type: 'boolean', filterable: true },
          { key: 'is_pecos_verified',    label: 'PECOS Verified',        type: 'boolean', filterable: true },
          { key: 'is_opra_verified',     label: 'OPRA Verified',         type: 'boolean', filterable: true },
        ],
      },
      {
        label: 'F2F / Clinical',
        fields: [
          { key: 'f2f_date',       label: 'F2F Date',        type: 'date',    filterable: true },
          { key: 'f2f_expiration', label: 'F2F Expiration',  type: 'date',    filterable: true },
          { key: 'f2f_urgency',    label: 'F2F Urgency',     type: 'enum',    options: F2F_URGENCY, filterable: true },
        ],
      },
      {
        label: 'NTUC & Hold',
        fields: [
          { key: 'ntuc_reason',              label: 'NTUC Reason',               type: 'text', filterable: true },
          { key: 'ntuc_financial_impact',    label: 'NTUC Financial Impact',     type: 'text', filterable: false },
          { key: 'hold_reason',              label: 'Hold Reason',               type: 'text', filterable: false },
          { key: 'hold_expected_resolution', label: 'Hold Exp. Resolution',      type: 'date', filterable: true },
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
      { key: 'referral_date',  label: 'Referral Date', type: 'date' },
      { key: 'soc_scheduled_date', label: 'SOC Date', type: 'date' },
      { key: 'soc_completed_date', label: 'SOC Completed', type: 'date' },
      { key: 'hchb_entered',   label: 'HCHB Entered', type: 'boolean' },
      { key: 'is_pecos_verified', label: 'PECOS Verified', type: 'boolean' },
      { key: 'ntuc_reason',    label: 'NTUC Reason', type: 'text' },
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
          { key: 'severity',         label: 'Severity',      type: 'enum', options: ['Low','Medium','High','Critical'], filterable: true },
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
      { key: 'severity', label: 'Severity', type: 'enum', options: ['Low','Medium','High','Critical'] },
      { key: 'status',   label: 'Status',   type: 'enum', options: ['Open','In Progress','Resolved','Waived'] },
      { key: 'created_at', label: 'Flagged Date', type: 'date' },
      { key: 'resolved_at', label: 'Resolved Date', type: 'date' },
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

async function resolveVirtualColumns(records, selectedKeys, primaryTable) {
  // Determine which lookup tables we need
  const needsPatient   = selectedKeys.some((k) => k.startsWith('__patient'));
  const needsMarketer  = selectedKeys.some((k) => k.startsWith('__marketer'));
  const needsFacility  = selectedKeys.some((k) => k.startsWith('__facility'));
  const needsSource    = selectedKeys.some((k) => k.startsWith('__source'));
  const needsPhysician = selectedKeys.some((k) => k.startsWith('__physician'));
  const needsCampaign  = selectedKeys.some((k) => k.startsWith('__campaign'));
  const needsAssigned  = selectedKeys.some((k) => k.startsWith('__assigned') || k.startsWith('__flagged') || k.startsWith('__resolved'));

  const [patients, marketers, facilities, sources, physicians, campaigns, users] = await Promise.all([
    needsPatient   ? getLookupMap('Patients')         : Promise.resolve({}),
    needsMarketer  ? getLookupMap('Marketers')        : Promise.resolve({}),
    needsFacility  ? getLookupMap('Facilities')       : Promise.resolve({}),
    needsSource    ? getLookupMap('ReferralSources')  : Promise.resolve({}),
    needsPhysician ? getLookupMap('Physicians')       : Promise.resolve({}),
    needsCampaign  ? getLookupMap('Campaigns')        : Promise.resolve({}),
    needsAssigned  ? getLookupMap('Users')            : Promise.resolve({}),
  ]);

  return records.map((row) => {
    const out = { ...row };

    // Patient lookups
    if (needsPatient) {
      const p = patients[row.patient_id] || {};
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
    if (needsFacility)  out.__facility_name  = resolve.facility(facilities[row.facility_id]);
    if (needsSource)    {
      const s = sources[row.referral_source_id] || {};
      out.__source_name = s.name || '—';
      out.__source_type = s.type || '—';
    }
    if (needsPhysician) out.__physician_name = resolve.physician(physicians[row.physician_id]);
    if (needsCampaign)  out.__campaign_name  = resolve.campaign(campaigns[row.campaign_id]);
    if (needsAssigned) {
      out.__assigned_name  = resolve.user(users[row.assigned_to_id]);
      out.__flagged_by     = resolve.user(users[row.flagged_by_id]);
      out.__resolved_by    = resolve.user(users[row.resolved_by_id]);
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

// ── Excel export ──────────────────────────────────────────────────────────────

function autoWidth(ws, cols) {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  ws['!cols'] = [];
  for (let C = range.s.c; C <= range.e.c; C++) {
    let max = cols[C]?.length || 10;
    for (let R = range.s.r; R <= range.e.r; R++) {
      const cell = ws[XLSX.utils.encode_cell({ c: C, r: R })];
      if (cell && cell.v != null) {
        const len = String(cell.v).length;
        if (len > max) max = len;
      }
    }
    ws['!cols'].push({ wch: Math.min(max + 2, 60) });
  }
}

/**
 * Generate and download an XLSX file.
 *
 * @param {Object[]} rows         - flat row objects
 * @param {Array}    columns      - [{ key, label }] in display order
 * @param {string}   reportTitle  - used for sheet name and filename
 * @param {string}   [subtitle]   - e.g. applied filters summary
 */
export function exportToExcel(rows, columns, reportTitle, subtitle = '') {
  const wb = XLSX.utils.book_new();

  const colLabels = columns.map((c) => c.label);
  const dataRows  = rows.map((row) =>
    columns.map((c) => {
      const v = row[c.key];
      if (v === null || v === undefined) return '';
      if (typeof v === 'boolean') return v ? 'Yes' : 'No';
      if (Array.isArray(v)) return v.join(', ');
      return v;
    }),
  );

  // Build AOA (array of arrays)
  const aoa = [
    [`${reportTitle} — CareStream Report`],
    [subtitle || `Generated: ${new Date().toLocaleString()}`],
    [`Total records: ${rows.length}`],
    [], // spacer
    colLabels,
    ...dataRows,
  ];

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  autoWidth(ws, colLabels);

  // Merge title cell across all columns
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: colLabels.length - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: colLabels.length - 1 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: colLabels.length - 1 } },
  ];

  const safeSheetName = reportTitle.replace(/[:\\/\[\]*?]/g, '').slice(0, 31);
  XLSX.utils.book_append_sheet(wb, ws, safeSheetName);

  const date     = new Date().toISOString().split('T')[0];
  const filename = `${reportTitle.replace(/\s+/g, '_')}_${date}.xlsx`;
  XLSX.writeFile(wb, filename);
}

// ── Aggregated reports (computed in JS after fetch) ───────────────────────────

/**
 * Marketer Performance — one row per marketer showing referral counts by stage.
 */
export async function runMarketerPerformance({ dateFrom, dateTo, division }) {
  const filters = [];
  if (dateFrom || dateTo) {
    if (dateFrom && dateTo) {
      filters.push({ field: 'referral_date', operator: 'between', value: dateFrom, value2: dateTo });
    } else if (dateFrom) {
      filters.push({ field: 'referral_date', operator: 'after', value: dateFrom });
    } else {
      filters.push({ field: 'referral_date', operator: 'before', value: dateTo });
    }
  }
  if (division) filters.push({ field: 'division', operator: 'eq', value: division });

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
    if (stage === 'NTUC')          g.ntuc++;
    if (stage === 'SOC Completed') g.soc++;
    if (stage === 'Hold')          g.hold++;
    if (!['NTUC','SOC Completed','Hold'].includes(stage)) g.active++;
  }

  const columns = [
    { key: 'marketer', label: 'Marketer' },
    { key: 'region',   label: 'Region' },
    { key: 'division', label: 'Division' },
    { key: 'total',    label: 'Total Referrals' },
    { key: 'active',   label: 'Active in Pipeline' },
    { key: 'soc',      label: 'SOC Completed' },
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
  return { rows: outputRows, columns };
}

/**
 * Source & Campaign Attribution — one row per source
 */
export async function runSourceAttribution({ dateFrom, dateTo, division }) {
  const filters = [];
  if (dateFrom && dateTo) filters.push({ field: 'referral_date', operator: 'between', value: dateFrom, value2: dateTo });
  else if (dateFrom) filters.push({ field: 'referral_date', operator: 'after', value: dateFrom });
  else if (dateTo)   filters.push({ field: 'referral_date', operator: 'before', value: dateTo });
  if (division) filters.push({ field: 'division', operator: 'eq', value: division });

  const { rows } = await fetchReportData({ tableName: 'Referrals', filters, selectedKeys: ['__source_name', '__source_type', '__campaign_name'] });

  const groups = {};
  for (const row of rows) {
    const sid = row.referral_source_id || '__unknown__';
    if (!groups[sid]) {
      groups[sid] = {
        sourceName: row.__source_name || '—',
        sourceType: row.__source_type || '—',
        campaigns:  new Set(),
        total: 0, soc: 0, ntuc: 0, active: 0,
      };
    }
    const g = groups[sid];
    g.total++;
    if (row.current_stage === 'SOC Completed') g.soc++;
    else if (row.current_stage === 'NTUC')    g.ntuc++;
    else g.active++;
    if (row.__campaign_name && row.__campaign_name !== '—') g.campaigns.add(row.__campaign_name);
  }

  const columns = [
    { key: 'sourceName',   label: 'Referral Source' },
    { key: 'sourceType',   label: 'Source Type' },
    { key: 'campaigns',    label: 'Campaigns' },
    { key: 'total',        label: 'Total Referrals' },
    { key: 'active',       label: 'Active' },
    { key: 'soc',          label: 'SOC Completed' },
    { key: 'ntuc',         label: 'NTUC' },
    { key: 'conversionRate', label: 'SOC Rate' },
    { key: 'ntucRate',     label: 'NTUC Rate' },
  ];

  const outputRows = Object.values(groups).map((g) => ({
    ...g,
    campaigns:      [...g.campaigns].join(', ') || '—',
    conversionRate: g.total ? `${Math.round((g.soc / g.total) * 100)}%` : '0%',
    ntucRate:       g.total ? `${Math.round((g.ntuc / g.total) * 100)}%` : '0%',
  }));

  outputRows.sort((a, b) => b.total - a.total);
  return { rows: outputRows, columns };
}

// ── Preset definitions ────────────────────────────────────────────────────────

export const PRESETS = [
  {
    id: 'pipeline_snapshot',
    title: 'Pipeline Snapshot',
    description: 'All referrals currently in the pipeline with patient info, stage, priority, marketer, and F2F status.',
    paramControls: ['dateRange', 'division', 'stage'],
    async run({ dateFrom, dateTo, division, stage }) {
      const filters = [];
      if (dateFrom && dateTo) filters.push({ field: 'referral_date', operator: 'between', value: dateFrom, value2: dateTo });
      else if (dateFrom) filters.push({ field: 'referral_date', operator: 'after', value: dateFrom });
      else if (dateTo)   filters.push({ field: 'referral_date', operator: 'before', value: dateTo });
      if (division) filters.push({ field: 'division', operator: 'eq', value: division });
      if (stage)    filters.push({ field: 'current_stage', operator: 'eq', value: stage });

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
    id: 'marketer_performance',
    title: 'Marketer Performance',
    description: 'Total referrals, stage distribution, SOC rate, and NTUC rate. Great for manager reviews.',
    paramControls: ['dateRange', 'division'],
    async run(params) { return runMarketerPerformance(params); },
  },
  {
    id: 'ntuc_analysis',
    title: 'NTUC & Declined Analysis',
    description: 'All referrals that ended as Not to Utilize Care.',
    paramControls: ['dateRange', 'division'],
    async run({ dateFrom, dateTo, division }) {
      const filters = [{ field: 'current_stage', operator: 'eq', value: 'NTUC' }];
      if (dateFrom && dateTo) filters.push({ field: 'referral_date', operator: 'between', value: dateFrom, value2: dateTo });
      else if (dateFrom) filters.push({ field: 'referral_date', operator: 'after', value: dateFrom });
      else if (dateTo)   filters.push({ field: 'referral_date', operator: 'before', value: dateTo });
      if (division) filters.push({ field: 'division', operator: 'eq', value: division });

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

      const today = Date.now();
      const enriched = rows.map((r) => ({
        ...r,
        days_until_expiry: r.f2f_expiration
          ? Math.ceil((new Date(r.f2f_expiration) - today) / 86400000)
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
    description: 'Total referrals, SOC rate, NTUC rate. Track which channels convert.',
    paramControls: ['dateRange', 'division'],
    async run(params) { return runSourceAttribution(params); },
  },
];
