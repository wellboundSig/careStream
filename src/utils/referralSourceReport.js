/**
 * Referral Sources canned report.
 * One row per directory source (including sources with zero patients),
 * plus a patient-level sheet for Excel.
 */

import { isSocCompletedReferral } from '../data/stageConfig.js';
import { normalizeEpisodeType } from './episodeType.js';

function firstId(v) {
  if (v == null || v === '') return '';
  if (Array.isArray(v)) return v[0] ? String(v[0]).trim() : '';
  return String(v).trim();
}

function yesNo(v) {
  if (v === true || v === 'true' || v === 'TRUE') return 'Yes';
  if (v === false || v === 'false' || v === 'FALSE') return 'No';
  return '';
}

function blank(v) {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s || s === '—') return '';
  return s;
}

function personName(rec) {
  if (!rec) return '';
  return `${rec.first_name || ''} ${rec.last_name || ''}`.trim();
}

function dateOnly(v) {
  if (!v) return '';
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function uniqueValues(map) {
  const seen = new Set();
  const out = [];
  for (const rec of Object.values(map || {})) {
    const key = rec?.id || rec?._id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(rec);
  }
  return out;
}

function emptyStats() {
  return {
    patientIds: new Set(),
    methods: new Set(),
    facilities: new Set(),
    campaigns: new Set(),
    referrals: 0,
    alf: 0,
    specialNeeds: 0,
    activePipeline: 0,
    socCompleted: 0,
    ntuc: 0,
    discarded: 0,
    hold: 0,
    firstReferral: null,
    lastReferral: null,
  };
}

function bumpDate(stats, date) {
  if (!date) return;
  const d = String(date);
  if (!stats.firstReferral || d < stats.firstReferral) stats.firstReferral = d;
  if (!stats.lastReferral || d > stats.lastReferral) stats.lastReferral = d;
}

function applyReferral(stats, row) {
  stats.referrals += 1;
  const pid = firstId(row.patient_id);
  if (pid) stats.patientIds.add(pid);
  if (row.division === 'ALF') stats.alf += 1;
  else if (row.division === 'Special Needs') stats.specialNeeds += 1;
  const stage = row.current_stage || '';
  if (stage === 'NTUC') stats.ntuc += 1;
  else if (stage === 'Discarded Leads') stats.discarded += 1;
  else if (stage === 'Hold') stats.hold += 1;
  else if (isSocCompletedReferral(row)) stats.socCompleted += 1;
  else stats.activePipeline += 1;
  const method = blank(row.referral_method);
  if (method) stats.methods.add(method);
  const facility = blank(row.__facility_name);
  if (facility) stats.facilities.add(facility);
  const campaign = blank(row.__campaign_name);
  if (campaign) stats.campaigns.add(campaign);
  bumpDate(stats, row.referral_date);
}

function joinSet(set) {
  return [...set].filter(Boolean).sort((a, b) => a.localeCompare(b)).join(', ');
}

function pct(part, whole) {
  if (!whole) return '';
  return `${Math.round((part / whole) * 100)}%`;
}

function marketerLabel(marketers, marketerId) {
  const id = firstId(marketerId);
  if (!id) return '';
  const rec = marketers[id];
  return personName(rec) || id;
}

export const SOURCE_CATALOG_COLUMNS = [
  { key: 'name', label: 'Contact / source' },
  { key: 'type', label: 'Type' },
  { key: 'entity', label: 'Entity' },
  { key: 'method', label: 'Default method' },
  { key: 'methodsSeen', label: 'Methods on referrals' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'marketer', label: 'Marketer' },
  { key: 'active', label: 'Active' },
  { key: 'system', label: 'System source' },
  { key: 'sourceId', label: 'Source ID' },
  { key: 'createdAt', label: 'Created' },
  { key: 'firstReferral', label: 'First referral' },
  { key: 'lastReferral', label: 'Last referral' },
  { key: 'referrals', label: 'Referrals' },
  { key: 'patients', label: 'Patients' },
  { key: 'alf', label: 'ALF' },
  { key: 'specialNeeds', label: 'Special Needs' },
  { key: 'activePipeline', label: 'In pipeline' },
  { key: 'socCompleted', label: 'SOC/ROC completed' },
  { key: 'ntuc', label: 'NTUC' },
  { key: 'discarded', label: 'Discarded' },
  { key: 'hold', label: 'Hold' },
  { key: 'socRate', label: 'SOC rate' },
  { key: 'facilities', label: 'Facilities' },
  { key: 'campaigns', label: 'Campaigns' },
];

export const SOURCE_PATIENT_COLUMNS = [
  { key: 'sourceName', label: 'Source' },
  { key: 'sourceType', label: 'Type' },
  { key: 'entity', label: 'Entity' },
  { key: 'defaultMethod', label: 'Source default method' },
  { key: 'referralMethod', label: 'Referral method' },
  { key: 'patientName', label: 'Patient' },
  { key: 'patientId', label: 'Patient ID' },
  { key: 'dob', label: 'DOB' },
  { key: 'phone', label: 'Patient phone' },
  { key: 'insurance', label: 'Insurance' },
  { key: 'county', label: 'County' },
  { key: 'division', label: 'Division' },
  { key: 'episodeType', label: 'SOC / ROC' },
  { key: 'stage', label: 'Stage' },
  { key: 'referralDate', label: 'Referral date' },
  { key: 'facility', label: 'Facility' },
  { key: 'marketer', label: 'Marketer' },
  { key: 'intakeOwner', label: 'Intake owner' },
  { key: 'campaign', label: 'Campaign' },
  { key: 'socCompletedDate', label: 'SOC/ROC completed' },
  { key: 'ntucReason', label: 'NTUC reason' },
];

function catalogRow(source, stats, marketers) {
  const s = stats || emptyStats();
  return {
    name: blank(source.name),
    type: blank(source.type),
    entity: blank(source.source_entity),
    method: blank(source.method),
    methodsSeen: joinSet(s.methods),
    phone: blank(source.phone),
    email: blank(source.email),
    marketer: marketerLabel(marketers, source.marketer_id),
    active: yesNo(source.is_active),
    system: yesNo(source.is_system),
    sourceId: blank(source.id),
    createdAt: dateOnly(source.created_at),
    firstReferral: dateOnly(s.firstReferral),
    lastReferral: dateOnly(s.lastReferral),
    referrals: s.referrals,
    patients: s.patientIds.size,
    alf: s.alf,
    specialNeeds: s.specialNeeds,
    activePipeline: s.activePipeline,
    socCompleted: s.socCompleted,
    ntuc: s.ntuc,
    discarded: s.discarded,
    hold: s.hold,
    socRate: pct(s.socCompleted, s.referrals),
    facilities: joinSet(s.facilities),
    campaigns: joinSet(s.campaigns),
  };
}

function patientRow(row, source, patients) {
  const pid = firstId(row.patient_id);
  const patient = (pid && patients[pid]) || {};
  return {
    sourceName: blank(source?.name) || blank(row.__source_name),
    sourceType: blank(source?.type) || blank(row.__source_type),
    entity: blank(source?.source_entity),
    defaultMethod: blank(source?.method),
    referralMethod: blank(row.referral_method),
    patientName: blank(row.__patient_name) || personName(patient),
    patientId: pid,
    dob: dateOnly(row.__patient_dob || patient.dob),
    phone: blank(row.__patient_phone) || blank(patient.phone_primary),
    insurance: blank(row.__patient_insplan) || blank(patient.insurance_plan),
    county: blank(patient.county) || blank(row.patient_county),
    division: blank(row.division),
    episodeType: normalizeEpisodeType(row) || '',
    stage: blank(row.current_stage),
    referralDate: dateOnly(row.referral_date),
    facility: blank(row.__facility_name),
    marketer: blank(row.__marketer_name),
    intakeOwner: blank(row.__intake_owner),
    campaign: blank(row.__campaign_name),
    socCompletedDate: dateOnly(row.soc_completed_date),
    ntucReason: blank(row.ntuc_reason),
  };
}

/**
 * @param {{
 *   sources: object[],
 *   marketers?: Record<string, object>,
 *   referrals: object[],
 *   patients?: Record<string, object>,
 * }} args
 */
export function buildReferralSourceReport({
  sources = [],
  marketers = {},
  referrals = [],
  patients = {},
}) {
  const byId = {};
  for (const src of sources) {
    if (!src?.id) continue;
    byId[src.id] = src;
  }

  const statsById = {};
  const orphans = {};

  for (const row of referrals) {
    const sid = firstId(row.referral_source_id);
    if (sid && byId[sid]) {
      if (!statsById[sid]) statsById[sid] = emptyStats();
      applyReferral(statsById[sid], row);
      continue;
    }
    const key = sid || '__none__';
    if (!orphans[key]) {
      orphans[key] = {
        source: {
          id: sid || '',
          name: sid ? `Missing from directory (${sid})` : 'No source',
          type: '',
          source_entity: '',
          method: '',
        },
        stats: emptyStats(),
      };
    }
    applyReferral(orphans[key].stats, row);
  }

  const catalogRows = sources
    .filter((s) => s?.id)
    .map((s) => catalogRow(s, statsById[s.id], marketers));

  for (const orphan of Object.values(orphans)) {
    catalogRows.push(catalogRow(orphan.source, orphan.stats, marketers));
  }

  catalogRows.sort((a, b) => {
    if (b.referrals !== a.referrals) return b.referrals - a.referrals;
    return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
  });

  const patientRows = referrals.map((row) => {
    const sid = firstId(row.referral_source_id);
    const source = (sid && byId[sid]) || orphans[sid || '__none__']?.source || {};
    return patientRow(row, source, patients);
  });

  patientRows.sort((a, b) => {
    const src = (a.sourceName || '').localeCompare(b.sourceName || '', undefined, { sensitivity: 'base' });
    if (src) return src;
    return (a.patientName || '').localeCompare(b.patientName || '', undefined, { sensitivity: 'base' });
  });

  const directoryIds = new Set(sources.filter((s) => s?.id).map((s) => s.id));
  const directoryCount = directoryIds.size;
  const withReferrals = catalogRows.filter((r) => r.referrals > 0 && directoryIds.has(r.sourceId)).length;
  const entities = new Set(catalogRows.map((r) => r.entity).filter(Boolean));
  const uniquePatients = new Set();
  for (const s of Object.values(statsById)) {
    for (const pid of s.patientIds) uniquePatients.add(pid);
  }
  for (const o of Object.values(orphans)) {
    for (const pid of o.stats.patientIds) uniquePatients.add(pid);
  }

  const byType = {};
  const referralsByType = {};
  const referralsByMethod = {};
  for (const row of catalogRows) {
    const type = row.type || '(blank)';
    byType[type] = (byType[type] || 0) + (row.sourceId ? 1 : 0);
    referralsByType[type] = (referralsByType[type] || 0) + row.referrals;
  }
  for (const row of patientRows) {
    const method = row.referralMethod || row.defaultMethod || '(blank)';
    referralsByMethod[method] = (referralsByMethod[method] || 0) + 1;
  }

  const top = (map, n = 12) => Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);

  const typeSeries = top(referralsByType);
  const methodSeries = top(referralsByMethod);
  const sourceTypeSeries = top(byType);

  return {
    rows: catalogRows,
    columns: SOURCE_CATALOG_COLUMNS,
    extraSheets: [
      { name: 'Patients', columns: SOURCE_PATIENT_COLUMNS, rows: patientRows },
    ],
    summary: {
      total: catalogRows.length,
      kpis: [
        { label: 'Sources in directory', value: directoryCount },
        { label: 'Sources with referrals', value: withReferrals },
        { label: 'Sources with no referrals', value: Math.max(0, directoryCount - withReferrals) },
        { label: 'Entities', value: entities.size },
        { label: 'Referrals in range', value: referrals.length },
        { label: 'Patients in range', value: uniquePatients.size },
      ],
      charts: [
        {
          title: 'Sources by type',
          type: 'bar',
          labels: sourceTypeSeries.map(([k]) => k),
          datasets: [{
            label: 'Sources',
            data: sourceTypeSeries.map(([, v]) => v),
            backgroundColor: '#C41E6ACC',
            borderColor: '#C41E6A',
            borderWidth: 1,
          }],
        },
        {
          title: 'Referrals by source type',
          type: 'bar',
          labels: typeSeries.map(([k]) => k),
          datasets: [{
            label: 'Referrals',
            data: typeSeries.map(([, v]) => v),
            backgroundColor: '#2563EBCC',
            borderColor: '#2563EB',
            borderWidth: 1,
          }],
        },
        {
          title: 'Referrals by method',
          type: 'doughnut',
          labels: methodSeries.map(([k]) => k),
          datasets: [{
            data: methodSeries.map(([, v]) => v),
            backgroundColor: ['#C41E6A', '#2563EB', '#059669', '#EA580C', '#7C3AED', '#0F766E', '#B45309', '#6B7280'],
          }],
        },
      ],
    },
  };
}

export function uniqueLookupRecords(map) {
  return uniqueValues(map);
}
