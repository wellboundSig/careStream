/**
 * Leadership operational reports built from stamps we already capture:
 *   - Referral → HCHB entry (emr_initial_onboarded_at) and first visit (SOC completed)
 *   - SOC done but still missing F2F / MD orders / auth / eligibility, with aging
 *   - Patient-first master row (one episode per row, patient columns leftmost)
 *
 * OASIS within 5 days of SOC is not here. That needs HCHB OASIS data.
 */

import { ageFromDob, parseCalendarDate } from './dateFormat.js';
import { isSocCompletedReferral } from '../data/stageConfig.js';
import { normalizeEpisodeType } from './episodeType.js';
import { hasF2FReceived } from './documentationDeferred.js';

export const HCHB_OPEN_TARGET_DAYS = 1;

export const AGING_BUCKETS = ['0-2 days', '3-7 days', '8-14 days', '15-30 days', '31+ days'];

export function yesNo(v) {
  return v ? 'Yes' : 'No';
}

export function dash(v) {
  if (v == null || v === '') return '-';
  return v;
}

export function formatServices(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(', ') || '-';
  return String(value || '').trim() || '-';
}

/** Whole calendar days from `from` to `to`. Negative if `to` is earlier. */
export function calendarDaysBetween(from, to) {
  const a = parseCalendarDate(from);
  const b = parseCalendarDate(to);
  if (!a || !b) return null;
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((utcB - utcA) / 86400000);
}

export function agingBucket(days) {
  if (days == null || !Number.isFinite(days)) return '-';
  const n = Math.max(0, days);
  if (n <= 2) return '0-2 days';
  if (n <= 7) return '3-7 days';
  if (n <= 14) return '8-14 days';
  if (n <= 30) return '15-30 days';
  return '31+ days';
}

/** Immediate HCHB chart create during Intake; fall back to full EMR onboard. */
export function hchbEntryAt(referral) {
  return referral?.emr_initial_onboarded_at || referral?.emr_onboarded_at || '';
}

/** CareStream confirmation that the start-of-care visit happened. */
export function firstVisitAt(referral) {
  return referral?.soc_completed_date || '';
}

export function isTruthyFlag(v) {
  return v === true || v === 'true' || v === 'TRUE' || v === 1 || v === '1';
}

function asIdList(value) {
  if (value == null || value === '') return [];
  return (Array.isArray(value) ? value : [value]).map((v) => String(v).trim()).filter(Boolean);
}

export function indexLinkedByReferral(records) {
  const map = new Map();
  for (const rec of records || []) {
    const keys = new Set([
      ...asIdList(rec.referral_id),
      ...asIdList(rec.id),
      ...asIdList(rec._id),
    ]);
    for (const key of keys) {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(rec);
    }
  }
  return map;
}

export function recordsForReferral(map, referral) {
  if (!map) return [];
  const keys = [
    ...asIdList(referral?.id),
    ...asIdList(referral?._id),
  ];
  const seen = new Set();
  const out = [];
  for (const key of keys) {
    for (const rec of map.get(key) || []) {
      const id = rec._id || rec.id || rec;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(rec);
    }
  }
  return out;
}

export function hasMdOrders(referral, { cursoryByRef, filesByRef } = {}) {
  const reviews = recordsForReferral(cursoryByRef, referral);
  if (reviews.some((c) => isTruthyFlag(c.physician_certification_present) || isTruthyFlag(c.md_orders_present))) {
    return true;
  }
  const files = recordsForReferral(filesByRef, referral);
  return files.some((f) => String(f.category || '').trim() === 'MD Orders');
}

export function missingDocFlags(referral, extras = {}) {
  const missingF2f = !hasF2FReceived(referral);
  const missingOrders = !hasMdOrders(referral, extras);
  const missing = [];
  if (missingF2f) missing.push('F2F');
  if (missingOrders) missing.push('Orders');
  return {
    missingF2f,
    missingOrders,
    missingList: missing.join(', ') || '-',
    missingCount: missing.length,
  };
}

export const REFERRAL_SPEED_COLUMNS = [
  { key: 'patient_name', label: 'Patient' },
  { key: 'facility', label: 'Facility' },
  { key: 'division', label: 'Division' },
  { key: 'episode_type', label: 'SOC / ROC' },
  { key: 'current_stage', label: 'Stage' },
  { key: 'referral_date', label: 'Referral Date' },
  { key: 'hchb_entry_at', label: 'HCHB Entered' },
  { key: 'days_to_hchb', label: 'Days Referral → HCHB' },
  { key: 'opened_in_1_day', label: 'Opened within 1 day' },
  { key: 'first_visit_at', label: 'First Visit (SOC completed)' },
  { key: 'days_to_first_visit', label: 'Days Referral → First Visit' },
  { key: 'intake_owner', label: 'Intake Owner' },
  { key: 'marketer', label: 'Marketer' },
  { key: 'source', label: 'Source' },
];

export function buildReferralSpeedRow(referral, { today = new Date() } = {}) {
  const referralDate = referral.referral_date || referral.created_at || '';
  const hchbAt = hchbEntryAt(referral);
  const visitAt = firstVisitAt(referral);
  const daysToHchb = calendarDaysBetween(referralDate, hchbAt);
  const daysToVisit = calendarDaysBetween(referralDate, visitAt);
  let opened = 'Not entered';
  if (daysToHchb != null) opened = daysToHchb <= HCHB_OPEN_TARGET_DAYS ? 'Yes' : 'No';

  return {
    patient_name: referral.__patient_name || '-',
    facility: cleanName(referral.__facility_name),
    division: referral.division || '-',
    episode_type: normalizeEpisodeType(referral),
    current_stage: referral.current_stage || '-',
    referral_date: referralDate || '-',
    hchb_entry_at: hchbAt || '-',
    days_to_hchb: daysToHchb == null ? '-' : daysToHchb,
    opened_in_1_day: opened,
    first_visit_at: visitAt || '-',
    days_to_first_visit: daysToVisit == null ? '-' : daysToVisit,
    intake_owner: cleanName(referral.__intake_owner),
    marketer: cleanName(referral.__marketer_name),
    source: cleanName(referral.__source_name),
    _days_to_hchb: daysToHchb,
    _days_to_first_visit: daysToVisit,
    _as_of: today,
  };
}

export function buildReferralSpeedRows(referrals, opts) {
  return (referrals || [])
    .map((r) => buildReferralSpeedRow(r, opts))
    .sort((a, b) => String(b.referral_date).localeCompare(String(a.referral_date)));
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function summarizeReferralSpeed(rows) {
  const entered = rows.filter((r) => r._days_to_hchb != null);
  const onTime = entered.filter((r) => r._days_to_hchb <= HCHB_OPEN_TARGET_DAYS);
  const visited = rows.filter((r) => r._days_to_first_visit != null);
  const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '-');

  return {
    kpis: [
      { label: 'Referrals', value: rows.length },
      { label: 'HCHB entered', value: entered.length },
      { label: 'Opened within 1 day', value: `${onTime.length} (${pct(onTime.length, entered.length)})` },
      { label: 'Median days to HCHB', value: median(entered.map((r) => r._days_to_hchb)) ?? '-' },
      { label: 'First visit recorded', value: visited.length },
      { label: 'Median days to first visit', value: median(visited.map((r) => r._days_to_first_visit)) ?? '-' },
    ],
    note: 'HCHB entry is Initial EMR (chart created in Intake), then full EMR onboard. First visit is SOC/ROC completed in CareStream, not an HCHB visit extract.',
    charts: entered.length ? [{
      title: 'Opened in HCHB within 1 calendar day',
      type: 'bar',
      labels: ['Within 1 day', 'Later', 'Not entered'],
      datasets: [{
        label: 'Referrals',
        data: [
          onTime.length,
          entered.length - onTime.length,
          rows.length - entered.length,
        ],
        backgroundColor: '#059669CC',
        borderColor: '#059669',
        borderWidth: 1,
      }],
    }] : [],
  };
}

export const SOC_MISSING_DOCS_COLUMNS = [
  { key: 'patient_name', label: 'Patient' },
  { key: 'dob', label: 'DOB' },
  { key: 'division', label: 'Division' },
  { key: 'episode_type', label: 'SOC / ROC' },
  { key: 'soc_completed_date', label: 'SOC Completed' },
  { key: 'days_since_soc', label: 'Days Since SOC' },
  { key: 'aging_bucket', label: 'Aging' },
  { key: 'missing_list', label: 'Still Missing' },
  { key: 'missing_f2f', label: 'Missing F2F' },
  { key: 'missing_orders', label: 'Missing Orders' },
  { key: 'documentation_due_date', label: 'Docs Due' },
  { key: 'current_stage', label: 'Current Stage' },
  { key: 'clinical_rn', label: 'Clinical RN' },
  { key: 'intake_owner', label: 'Intake Owner' },
  { key: 'marketer', label: 'Marketer' },
  { key: 'facility', label: 'Facility' },
];

export function buildSocMissingDocsRow(referral, extras = {}) {
  const today = extras.today || new Date();
  const socDate = referral.soc_completed_date || '';
  const days = calendarDaysBetween(socDate, today);
  const flags = missingDocFlags(referral, extras);
  return {
    patient_name: referral.__patient_name || '-',
    dob: referral.__patient_dob || '-',
    division: referral.division || '-',
    episode_type: normalizeEpisodeType(referral),
    soc_completed_date: socDate || '-',
    days_since_soc: days == null ? '-' : days,
    aging_bucket: agingBucket(days),
    missing_list: flags.missingList,
    missing_f2f: yesNo(flags.missingF2f),
    missing_orders: yesNo(flags.missingOrders),
    documentation_due_date: referral.documentation_due_date || '-',
    current_stage: referral.current_stage || '-',
    clinical_rn: cleanName(referral.__clinical_assigned || referral.__clinical_by),
    intake_owner: cleanName(referral.__intake_owner),
    marketer: cleanName(referral.__marketer_name),
    facility: cleanName(referral.__facility_name),
    _days: days,
    _missingCount: flags.missingCount,
    _missingF2f: flags.missingF2f,
    _missingOrders: flags.missingOrders,
  };
}

export function buildSocMissingDocsRows(referrals, extras = {}) {
  return (referrals || [])
    .filter((r) => isSocCompletedReferral(r))
    .map((r) => buildSocMissingDocsRow(r, extras))
    .filter((r) => r._missingCount > 0)
    .sort((a, b) => (b._days ?? -1) - (a._days ?? -1));
}

export function summarizeSocMissingDocs(rows) {
  const bucketCounts = Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0]));
  for (const r of rows) {
    if (bucketCounts[r.aging_bucket] != null) bucketCounts[r.aging_bucket] += 1;
  }
  return {
    kpis: [
      { label: 'SOC done, still missing docs', value: rows.length },
      { label: 'Missing F2F', value: rows.filter((r) => r._missingF2f).length },
      { label: 'Missing orders', value: rows.filter((r) => r._missingOrders).length },
      { label: 'Aging 31+ days', value: bucketCounts['31+ days'] },
    ],
    note: 'SOC/ROC completed only. Docs means F2F and MD orders. Auth and eligibility are not treated as missing paperwork.',
    charts: [{
      title: 'Aging since SOC completed',
      type: 'bar',
      labels: AGING_BUCKETS,
      datasets: [{
        label: 'Cases',
        data: AGING_BUCKETS.map((b) => bucketCounts[b]),
        backgroundColor: '#7C3AEDCC',
        borderColor: '#7C3AED',
        borderWidth: 1,
      }],
    }],
  };
}

export const MASTER_PATIENT_COLUMNS = [
  { key: 'patient_id', label: 'Patient ID' },
  { key: 'patient_name', label: 'Patient' },
  { key: 'dob', label: 'DOB' },
  { key: 'age', label: 'Age' },
  { key: 'gender', label: 'Gender' },
  { key: 'phone', label: 'Phone' },
  { key: 'address', label: 'Address' },
  { key: 'medicaid', label: 'Medicaid #' },
  { key: 'medicare', label: 'Medicare #' },
  { key: 'insurance', label: 'Insurance Plan' },
  { key: 'referral_id', label: 'Referral ID' },
  { key: 'referral_date', label: 'Referral Date' },
  { key: 'division', label: 'Division' },
  { key: 'episode_type', label: 'SOC / ROC' },
  { key: 'current_stage', label: 'Stage' },
  { key: 'priority', label: 'Priority' },
  { key: 'services', label: 'Services' },
  { key: 'intake_owner', label: 'Intake Owner' },
  { key: 'clinical_rn', label: 'Clinical RN Assigned' },
  { key: 'lead_created_by', label: 'Lead Submitted By' },
  { key: 'marketer', label: 'Marketer' },
  { key: 'facility', label: 'Facility' },
  { key: 'source', label: 'Referral Source' },
  { key: 'source_type', label: 'Source Type' },
  { key: 'source_entity', label: 'Source Entity' },
  { key: 'source_method', label: 'Source Default Method' },
  { key: 'physician', label: 'Physician' },
  { key: 'campaign', label: 'Campaign' },
  { key: 'created_at', label: 'Created' },
  { key: 'hchb_entry_at', label: 'HCHB Entered' },
  { key: 'days_to_hchb', label: 'Days Referral → HCHB' },
  { key: 'eligibility_at', label: 'Eligibility Completed' },
  { key: 'f2f_date', label: 'F2F Date' },
  { key: 'clinical_at', label: 'Clinical Completed' },
  { key: 'clinical_decision', label: 'Clinical Decision' },
  { key: 'auth_at', label: 'Auth Obtained' },
  { key: 'emr_at', label: 'EMR Onboarded' },
  { key: 'staffing_at', label: 'Staffing Confirmed' },
  { key: 'soc_scheduled_date', label: 'SOC Scheduled' },
  { key: 'soc_completed_date', label: 'SOC Completed' },
  { key: 'soc_done', label: 'SOC Done' },
  { key: 'days_referral_to_soc', label: 'Days Referral → SOC' },
  { key: 'days_since_soc', label: 'Days Since SOC' },
  { key: 'missing_list', label: 'Still Missing After SOC' },
  { key: 'hchb_entered_flag', label: 'HCHB Flag' },
  { key: 'pecos', label: 'PECOS' },
  { key: 'opra', label: 'OPRA' },
  { key: 'documentation_deferred', label: 'Docs Deferred' },
  { key: 'documentation_due_date', label: 'Docs Due' },
  { key: 'documentation_cleared_at', label: 'Docs Cleared' },
  { key: 'hold_reason', label: 'Hold Reason' },
  { key: 'ntuc_reason', label: 'NTUC Reason' },
  { key: 'updated_at', label: 'Last Updated' },
];

function cleanName(v) {
  const s = String(v || '').trim();
  if (!s || s === '-' || s === '\u2014') return '-';
  return s;
}

export function buildMasterPatientRow(referral, extras = {}) {
  const today = extras.today || new Date();
  const referralDate = referral.referral_date || referral.created_at || '';
  const hchbAt = hchbEntryAt(referral);
  const socDate = referral.soc_completed_date || '';
  const flags = missingDocFlags(referral, extras);
  const pid = Array.isArray(referral.patient_id) ? referral.patient_id[0] : referral.patient_id;
  const socDone = isSocCompletedReferral(referral);

  return {
    patient_id: pid || '-',
    patient_name: referral.__patient_name || '-',
    dob: referral.__patient_dob || '-',
    age: ageFromDob(referral.__patient_dob, today) ?? '-',
    gender: referral.__patient_gender || '-',
    phone: referral.__patient_phone || '-',
    address: referral.__patient_address || '-',
    medicaid: referral.__patient_medicaid || '-',
    medicare: referral.__patient_medicare || '-',
    insurance: referral.__patient_insplan || '-',
    referral_id: referral.id || '-',
    referral_date: referralDate || '-',
    division: referral.division || '-',
    episode_type: normalizeEpisodeType(referral),
    current_stage: referral.current_stage || '-',
    priority: referral.priority || '-',
    services: formatServices(referral.services_requested),
    intake_owner: referral.__intake_owner || '-',
    clinical_rn: cleanName(referral.__clinical_assigned),
    lead_created_by: referral.__lead_created_by || '-',
    marketer: cleanName(referral.__marketer_name),
    facility: cleanName(referral.__facility_name),
    source: cleanName(referral.__source_name),
    source_type: cleanName(referral.__source_type),
    source_entity: cleanName(referral.__source_entity),
    source_method: cleanName(referral.__source_method),
    physician: cleanName(referral.__physician_name),
    campaign: cleanName(referral.__campaign_name),
    created_at: referral.created_at || '-',
    hchb_entry_at: hchbAt || '-',
    days_to_hchb: dash(calendarDaysBetween(referralDate, hchbAt)),
    eligibility_at: referral.eligibility_completed_at || '-',
    f2f_date: referral.f2f_date || '-',
    clinical_at: referral.clinical_review_completed_at || '-',
    clinical_decision: referral.clinical_review_decision || '-',
    auth_at: referral.auth_obtained_at || '-',
    emr_at: referral.emr_onboarded_at || '-',
    staffing_at: referral.staffing_confirmed_at || '-',
    soc_scheduled_date: referral.soc_scheduled_date || '-',
    soc_completed_date: socDate || '-',
    soc_done: yesNo(socDone),
    days_referral_to_soc: dash(calendarDaysBetween(referralDate, socDate)),
    days_since_soc: socDone ? dash(calendarDaysBetween(socDate, today)) : '-',
    missing_list: socDone ? flags.missingList : '-',
    hchb_entered_flag: yesNo(isTruthyFlag(referral.hchb_entered) || !!hchbAt),
    pecos: yesNo(isTruthyFlag(referral.is_pecos_verified)),
    opra: yesNo(isTruthyFlag(referral.is_opra_verified)),
    documentation_deferred: yesNo(isTruthyFlag(referral.documentation_deferred)),
    documentation_due_date: referral.documentation_due_date || '-',
    documentation_cleared_at: referral.documentation_cleared_at || '-',
    hold_reason: referral.hold_reason || '-',
    ntuc_reason: referral.ntuc_reason || '-',
    updated_at: referral.updated_at || '-',
  };
}

export function buildMasterPatientRows(referrals, extras = {}) {
  return (referrals || [])
    .map((r) => buildMasterPatientRow(r, extras))
    .sort((a, b) => {
      const name = String(a.patient_name).localeCompare(String(b.patient_name), undefined, { sensitivity: 'base' });
      if (name !== 0) return name;
      return String(b.referral_date).localeCompare(String(a.referral_date));
    });
}

export function summarizeMasterPatient(rows) {
  return {
    kpis: [
      { label: 'Episodes', value: rows.length },
      { label: 'Patients', value: new Set(rows.map((r) => r.patient_id).filter((id) => id && id !== '-')).size },
      { label: 'SOC done', value: rows.filter((r) => r.soc_done === 'Yes').length },
      { label: 'HCHB entered', value: rows.filter((r) => r.hchb_entry_at && r.hchb_entry_at !== '-').length },
      { label: 'ALF', value: rows.filter((r) => r.division === 'ALF').length },
      { label: 'Special Needs', value: rows.filter((r) => r.division === 'Special Needs').length },
    ],
    note: 'One row per episode. Same patient can appear more than once (SOC then ROC). Blank date range = all time.',
  };
}
