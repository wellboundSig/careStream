/**
 * Processing Overview — checklist rows for Data Tools + canned report.
 * Lists open pipeline referrals (excludes SOC/ROC completed) with Yes/No
 * readiness flags for bottleneck spotting.
 */

import { hasClinicalCompleted, hasF2FReceived } from './documentationDeferred.js';
import { hasInsuranceDetails } from './insuranceDetails.js';
import { isTriageComplete } from './triageCompleteness.js';
import { isSocCompletedReferral } from '../data/stageConfig.js';
import { ageFromDob } from './dateFormat.js';

const DEMOGRAPHICS_FIELDS = [
  'first_name', 'last_name', 'dob', 'gender', 'phone_primary',
  'address_street', 'address_city', 'address_state', 'address_zip',
];

const PAST_AUTH_GATE = new Set([
  'EMR Onboarding',
  'Staffing Feasibility',
  'Admin Confirmation',
  'Pre-SOC',
  'SOC Scheduled',
  'SOC Completed',
]);

const EXCLUDED_STAGES = new Set(['NTUC', 'Discarded Leads']);

/** Checklist keys shown as Yes/No columns (order = table order). */
export const PROCESSING_FLAG_COLUMNS = [
  { key: 'demographics', label: 'Demographics' },
  { key: 'triage', label: 'Triage' },
  { key: 'insurance', label: 'Insurance Details' },
  { key: 'f2f', label: 'F2F Documentation' },
  { key: 'clinical', label: 'Clinical Review Complete' },
  { key: 'authorization', label: 'Authorization (if needed)' },
  { key: 'eligibility', label: 'Eligibility Check' },
  { key: 'pecos', label: 'Doctor PECOS', verifiable: true },
  { key: 'opra', label: 'Doctor OPRA', verifiable: true },
  { key: 'npi', label: 'Doctor NPI', verifiable: true },
  { key: 'emr', label: 'EMR Onboarded' },
  { key: 'clinicianMatched', label: 'Clinician Matched' },
  { key: 'socScheduled', label: 'SOC Scheduled' },
  { key: 'socCompleted', label: 'SOC Completed' },
];

export const VERIFYABLE_FLAG_KEYS = new Set(
  PROCESSING_FLAG_COLUMNS.filter((c) => c.verifiable).map((c) => c.key),
);

/** Identity / ownership columns — shown before checklist for visibility. */
export const PROCESSING_META_COLUMNS = [
  { key: 'facility', label: 'Facility' },
  { key: 'marketer', label: 'Marketer' },
  { key: 'intakeOwner', label: 'Intake Owner' },
  { key: 'doctor', label: 'Doctor / PCP' },
];

export function truthyFlag(v) {
  return v === true || v === 'true' || v === 'TRUE' || v === 1 || v === '1';
}

/** Unwrap Airtable linked-record arrays to a single id string. */
export function linkId(raw) {
  if (raw == null || raw === '') return '';
  if (Array.isArray(raw)) return raw[0] ? String(raw[0]).trim() : '';
  return String(raw).trim();
}

function resolveName(resolver, rawId) {
  const id = linkId(rawId);
  if (!id || typeof resolver !== 'function') return '';
  const name = resolver(id);
  if (!name || name === '—') return '';
  return name;
}

/** Auth obtained, or already past the auth gate (auth not needed / cleared). */
export function hasAuthorizationIfNeeded(referral) {
  if (referral?.auth_obtained_at) return true;
  return PAST_AUTH_GATE.has(referral?.current_stage);
}

export function isInProcessingPool(referral) {
  if (!referral) return false;
  if (isSocCompletedReferral(referral)) return false;
  if (EXCLUDED_STAGES.has(referral.current_stage)) return false;
  return true;
}

function hasDemographics(patient) {
  const p = patient || {};
  return DEMOGRAPHICS_FIELDS.every((f) => p[f] != null && String(p[f]).trim() !== '');
}

function hasTriageComplete(referral, triageData) {
  if (referral?.division === 'ALF') return true;
  if (referral?.division !== 'Special Needs') return false;
  if (!triageData || typeof triageData !== 'object') return false;
  const age = ageFromDob(referral?.patient?.dob);
  const type = age !== null && age < 18 ? 'pediatric' : 'adult';
  const result = isTriageComplete(triageData, type);
  return result.complete === true && result.missing.length === 0;
}

export function buildProcessingFlags(referral, ctx = {}) {
  const patient = referral?.patient || {};
  const physician = ctx.physician || null;
  const npiDigits = String(physician?.npi || '').replace(/\D/g, '');
  // NPI check column: Yes only when CMS/NPPES verification marked active.
  // Unchecked / missing / failed → No (click-to-check in Data Tools).
  const npiVerified = physician?.npi_status === 'active'
    || (!physician?.npi_status && npiDigits.length === 10);

  return {
    demographics: hasDemographics(patient),
    triage: hasTriageComplete(referral, ctx.triageData || null),
    insurance: hasInsuranceDetails(patient),
    f2f: hasF2FReceived(referral),
    clinical: hasClinicalCompleted(referral),
    authorization: hasAuthorizationIfNeeded(referral),
    eligibility: !!referral?.eligibility_completed_at,
    pecos: !!(physician && truthyFlag(physician.is_pecos_enrolled)),
    opra: !!(physician && truthyFlag(physician.is_opra_enrolled)),
    npi: !!npiVerified,
    emr: !!referral?.emr_onboarded_at,
    clinicianMatched: !!referral?.staffing_confirmed_at,
    socScheduled: !!String(referral?.soc_scheduled_date || '').trim(),
    socCompleted: isSocCompletedReferral(referral),
  };
}

function findTriageForReferral(referral, triageAdult = {}, triagePediatric = {}) {
  const refId = referral?.id;
  const refRec = referral?._id;
  if (!refId && !refRec) return null;
  const match = (t) => {
    const tid = t?.referral_id;
    if (!tid) return false;
    if (tid === refId || tid === refRec) return true;
    if (Array.isArray(tid)) return tid.includes(refId) || tid.includes(refRec);
    return false;
  };
  return Object.values(triageAdult || {}).find(match)
    || Object.values(triagePediatric || {}).find(match)
    || null;
}

export function findPhysician(referral, physicians = {}) {
  const id = linkId(referral?.physician_id);
  if (!id) return null;
  if (physicians[id]) return physicians[id];
  return Object.values(physicians).find((p) => p.id === id || p._id === id) || null;
}

function physicianDisplayName(physician) {
  if (!physician) return '';
  const name = `${physician.first_name || ''} ${physician.last_name || ''}`.trim();
  return name || physician.name || physician.npi || '';
}

/**
 * Build display/export rows for the processing pool.
 *
 * @param {object[]} referrals
 * @param {object} helpers
 */
function isRawPatientId(value) {
  const s = String(value || '').trim();
  if (!s) return true;
  return /^pat[_-]/i.test(s) || /^rec[a-zA-Z0-9]{8,}$/.test(s);
}

export function buildProcessingOverviewRows(referrals, {
  triageAdult = {},
  triagePediatric = {},
  physicians = {},
  patients = {},
  resolveFacility = () => '',
  resolveMarketer = () => '',
  resolveUser = () => '',
  resolvePhysician = () => '',
  resolvePatient = () => '',
} = {}) {
  return (referrals || [])
    .filter(isInProcessingPool)
    .map((r) => {
      const triageData = findTriageForReferral(r, triageAdult, triagePediatric);
      const physician = findPhysician(r, physicians);
      const flags = buildProcessingFlags(r, { triageData, physician });
      const phyLink = linkId(r.physician_id);
      const doctorName = physicianDisplayName(physician)
        || resolveName(resolvePhysician, phyLink)
        || '';

      const pid = linkId(r.patient_id);
      const patientRec = r.patient
        || (pid && (patients[pid]
          || Object.values(patients).find((p) => p.id === pid || p._id === pid)))
        || null;
      const joinedName = `${patientRec?.first_name || ''} ${patientRec?.last_name || ''}`.trim();
      const pipelineName = r.patientName && !isRawPatientId(r.patientName) ? r.patientName : '';
      const resolvedName = resolveName(resolvePatient, pid);
      const patientName = pipelineName || joinedName || resolvedName || 'Unknown';

      return {
        _id: r._id,
        referral_id: r.id,
        patient_id: pid || r.patient_id,
        physician_id: phyLink,
        physician_record_id: physician?._id || '',
        physician_npi: physician?.npi ? String(physician.npi).replace(/\D/g, '') : '',
        patientName,
        division: r.division || '',
        current_stage: r.current_stage || '',
        facility: resolveName(resolveFacility, r.facility_id),
        marketer: resolveName(resolveMarketer, r.marketer_id),
        intakeOwner: (
          r.current_stage === 'Lead Entry' || !linkId(r.intake_owner_id)
            ? ''
            : resolveName(resolveUser, r.intake_owner_id)
        ),
        doctor: doctorName,
        flags,
        // Flat Yes/No for Excel
        ...Object.fromEntries(
          PROCESSING_FLAG_COLUMNS.map(({ key }) => [key, flags[key] ? 'Yes' : 'No']),
        ),
        referral: r,
      };
    })
    .sort((a, b) => (a.patientName || '').localeCompare(b.patientName || '', undefined, { sensitivity: 'base' }));
}

export const PROCESSING_OVERVIEW_EXPORT_COLUMNS = [
  { key: 'patientName', label: 'Patient' },
  { key: 'division', label: 'Division' },
  { key: 'current_stage', label: 'Stage' },
  ...PROCESSING_META_COLUMNS,
  ...PROCESSING_FLAG_COLUMNS.map(({ key, label }) => ({ key, label })),
];
