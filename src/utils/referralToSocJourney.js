/**
 * Referral → Initial HCHB → full EMR onboard → SOC scheduled → SOC completed.
 * Timing, drop-off, stuck waits, and outliers for the Data Tools view.
 */

import { parseCalendarDate } from './dateFormat.js';
import { isSocCompletedReferral } from '../data/stageConfig.js';
import {
  AGING_BUCKETS,
  agingBucket,
  calendarDaysBetween,
  formatServices,
  hchbEntryAt,
} from './operationalReports.js';

export const HCHB_OPEN_TARGET_DAYS = 1;
export const HCHB_EXTREME_MIN_DAYS = 3;
export const HOP_OUTLIER_MIN_DAYS = 7;
export const SOC_OUTLIER_MIN_DAYS = 14;
export const STUCK_OUTLIER_MIN_DAYS = 14;

export const JOURNEY_MILESTONES = [
  { key: 'referral', label: 'Referral', short: 'Referral' },
  { key: 'initial_emr', label: 'Initial HCHB', short: 'HCHB' },
  { key: 'full_emr', label: 'EMR Onboarded', short: 'EMR' },
  { key: 'soc_scheduled', label: 'SOC Scheduled', short: 'Scheduled' },
  { key: 'soc_completed', label: 'SOC Completed', short: 'SOC' },
];

export const JOURNEY_HOPS = [
  { key: 'referral_to_hchb', from: 'referral', to: 'initial_emr', label: 'Referral → Initial HCHB', targetDays: HCHB_OPEN_TARGET_DAYS },
  { key: 'hchb_to_emr', from: 'initial_emr', to: 'full_emr', label: 'Initial HCHB → Full EMR' },
  { key: 'emr_to_scheduled', from: 'full_emr', to: 'soc_scheduled', label: 'EMR → SOC Scheduled' },
  { key: 'scheduled_to_soc', from: 'soc_scheduled', to: 'soc_completed', label: 'Scheduled → SOC Completed' },
];

export const OVERALL_HOP = {
  key: 'referral_to_soc',
  from: 'referral',
  to: 'soc_completed',
  label: 'Referral → SOC Completed',
};

export const DATE_BASIS = [
  { key: 'referral', label: 'Referral date' },
  { key: 'hchb', label: 'HCHB entered' },
  { key: 'emr', label: 'EMR onboarded' },
  { key: 'soc', label: 'SOC completed' },
];

export const HCHB_DAY_BUCKETS = [
  { key: '0', label: '0d', min: 0, max: 0 },
  { key: '1', label: '1d', min: 1, max: 1 },
  { key: '2', label: '2d', min: 2, max: 2 },
  { key: '3-7', label: '3-7d', min: 3, max: 7 },
  { key: '8-14', label: '8-14d', min: 8, max: 14 },
  { key: '15+', label: '15+d', min: 15, max: Infinity },
];

export const SOC_DAY_BUCKETS = [
  { key: '0-2', label: '0-2d', min: 0, max: 2 },
  { key: '3-7', label: '3-7d', min: 3, max: 7 },
  { key: '8-14', label: '8-14d', min: 8, max: 14 },
  { key: '15-21', label: '15-21d', min: 15, max: 21 },
  { key: '22-30', label: '22-30d', min: 22, max: 30 },
  { key: '31-45', label: '31-45d', min: 31, max: 45 },
  { key: '46+', label: '46+d', min: 46, max: Infinity },
];

export const JOURNEY_EXPORT_COLUMNS = [
  { key: 'patient_name', label: 'Patient' },
  { key: 'division', label: 'Division' },
  { key: 'current_stage', label: 'Stage' },
  { key: 'priority', label: 'Priority' },
  { key: 'status', label: 'Status' },
  { key: 'referral_date', label: 'Referral Date' },
  { key: 'hchb_at', label: 'Initial HCHB' },
  { key: 'days_to_hchb', label: 'Days Referral → HCHB' },
  { key: 'hchb_on_time', label: 'HCHB Within 1 Day' },
  { key: 'emr_at', label: 'EMR Onboarded' },
  { key: 'days_hchb_to_emr', label: 'Days HCHB → EMR' },
  { key: 'scheduled_at', label: 'SOC Scheduled' },
  { key: 'days_emr_to_scheduled', label: 'Days EMR → Scheduled' },
  { key: 'soc_at', label: 'SOC Completed' },
  { key: 'days_scheduled_to_soc', label: 'Days Scheduled → SOC' },
  { key: 'days_to_soc', label: 'Days Referral → SOC' },
  { key: 'current_wait', label: 'Current Wait (days)' },
  { key: 'aging_bucket', label: 'Aging' },
  { key: 'stuck_label', label: 'Stuck At' },
  { key: 'eligibility_at', label: 'Eligibility' },
  { key: 'f2f_at', label: 'F2F' },
  { key: 'clinical_at', label: 'Clinical Review' },
  { key: 'staffing_at', label: 'Staffing' },
  { key: 'intake_owner', label: 'Intake Owner' },
  { key: 'clinical_rn', label: 'Clinical RN' },
  { key: 'marketer', label: 'Marketer' },
  { key: 'facility', label: 'Facility' },
  { key: 'source', label: 'Source' },
  { key: 'services', label: 'Services' },
  { key: 'outlier_reason', label: 'Outlier' },
];

const TERMINAL_LEFT = new Set(['NTUC', 'Discarded Leads']);

export function firstId(raw) {
  if (raw == null || raw === '') return '';
  if (Array.isArray(raw)) return raw[0] != null ? String(raw[0]).trim() : '';
  return String(raw).trim();
}

export function cleanName(v) {
  const s = String(v || '').trim();
  if (!s || s === '-' || s === '\u2014') return '-';
  return s;
}

export function dash(v) {
  if (v == null || v === '') return '-';
  return v;
}

export function percentile(values, p) {
  const nums = (values || []).filter((n) => n != null && Number.isFinite(n)).slice().sort((a, b) => a - b);
  if (!nums.length) return null;
  if (nums.length === 1) return nums[0];
  const idx = (p / 100) * (nums.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return nums[lo];
  return nums[lo] + (nums[hi] - nums[lo]) * (idx - lo);
}

export function median(values) {
  const n = percentile(values, 50);
  return n == null ? null : Math.round(n * 10) / 10;
}

export function rounded(n, digits = 1) {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function journeyStamps(referral) {
  const referralAt = referral?.referral_date || referral?.created_at || '';
  const fullEmrAt = referral?.emr_onboarded_at || '';
  const initialAt = referral?.emr_initial_onboarded_at || fullEmrAt || '';
  const scheduledAt = referral?.soc_scheduled_date || referral?.soc_scheduled_at || '';
  const socAt = referral?.soc_completed_date || '';
  return { referralAt, initialAt, fullEmrAt, scheduledAt, socAt };
}

export function stampForDateBasis(referral, basis) {
  if (basis === 'hchb') return hchbEntryAt(referral);
  if (basis === 'emr') return referral?.emr_onboarded_at || '';
  if (basis === 'soc') return referral?.soc_completed_date || '';
  return referral?.referral_date || referral?.created_at || '';
}

export function filterReferralsByDateBasis(referrals, { days = null, basis = 'referral', now = new Date() } = {}) {
  const list = referrals || [];
  if (days == null) {
    if (basis === 'referral') return list;
    return list.filter((r) => !!stampForDateBasis(r, basis));
  }
  const end = now instanceof Date ? new Date(now) : parseCalendarDate(now) || new Date();
  const cutoff = new Date(end);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffMs = cutoff.getTime();
  return list.filter((r) => {
    const d = parseCalendarDate(stampForDateBasis(r, basis));
    return d && d.getTime() >= cutoffMs;
  });
}

function resolveName(resolver, rawId) {
  if (typeof resolver !== 'function') return '-';
  const id = firstId(rawId);
  if (!id) return '-';
  return cleanName(resolver(id));
}

function clinicalRnId(referral) {
  return firstId(referral?.clinical_review_assigned_to_id)
    || firstId(referral?.clinical_review_completed_by_id)
    || firstId(referral?.clinical_review_by)
    || firstId(referral?.reviewed_by);
}

export function journeyStatus(referral) {
  if (TERMINAL_LEFT.has(referral?.current_stage)) return 'ntuc';
  if (isSocCompletedReferral(referral)) return 'completed';
  if (referral?.current_stage === 'Hold') return 'hold';
  return 'active';
}

export function inferReached(referral, stamps) {
  const socDone = isSocCompletedReferral(referral);
  const soc = socDone;
  const scheduled = soc || !!stamps.scheduledAt;
  const full = scheduled || !!stamps.fullEmrAt;
  const initial = full || !!stamps.initialAt;
  const referralReached = initial || !!stamps.referralAt;
  return {
    referral: referralReached,
    initial_emr: initial,
    full_emr: full,
    soc_scheduled: scheduled,
    soc_completed: soc,
  };
}

export function stuckHopFor(referral, stamps) {
  const status = journeyStatus(referral);
  if (status === 'completed' || status === 'ntuc') return null;
  if (!stamps.initialAt) return 'referral_to_hchb';
  if (!stamps.fullEmrAt) return 'hchb_to_emr';
  if (!stamps.scheduledAt) return 'emr_to_scheduled';
  return 'scheduled_to_soc';
}

export function lastReachedStamp(stamps) {
  return stamps.scheduledAt || stamps.fullEmrAt || stamps.initialAt || stamps.referralAt || '';
}

function hopLabel(key) {
  return JOURNEY_HOPS.find((h) => h.key === key)?.label || key || '-';
}

function bucketCount(values, buckets) {
  const counts = buckets.map((b) => ({ ...b, count: 0 }));
  for (const v of values || []) {
    if (v == null || !Number.isFinite(v)) continue;
    const hit = counts.find((b) => v >= b.min && v <= b.max);
    if (hit) hit.count += 1;
  }
  return counts;
}

function emptyHopStat(hop) {
  return {
    key: hop.key,
    label: hop.label,
    targetDays: hop.targetDays ?? null,
    n: 0,
    median: null,
    p75: null,
    p90: null,
    max: null,
    stuck: 0,
    stuckMedian: null,
    score: 0,
  };
}

export function computeHopStats(rows) {
  const stats = {};
  for (const hop of JOURNEY_HOPS) {
    const days = rows.map((r) => r.hop_days[hop.key]).filter((n) => n != null && Number.isFinite(n));
    const stuckWaits = rows
      .filter((r) => r.stuck_hop === hop.key)
      .map((r) => r.current_wait)
      .filter((n) => n != null && Number.isFinite(n));
    const max = days.length ? Math.max(...days) : null;
    stats[hop.key] = {
      ...emptyHopStat(hop),
      n: days.length,
      median: median(days),
      p75: rounded(percentile(days, 75)),
      p90: rounded(percentile(days, 90)),
      max,
      stuck: rows.filter((r) => r.stuck_hop === hop.key).length,
      stuckMedian: median(stuckWaits),
    };
  }
  const overallDays = rows.map((r) => r.days_to_soc).filter((n) => n != null && Number.isFinite(n));
  stats[OVERALL_HOP.key] = {
    ...emptyHopStat(OVERALL_HOP),
    n: overallDays.length,
    median: median(overallDays),
    p75: rounded(percentile(overallDays, 75)),
    p90: rounded(percentile(overallDays, 90)),
    max: overallDays.length ? Math.max(...overallDays) : null,
  };
  return stats;
}

function outlierCut(p90, minDays, n, smallSampleFloor) {
  if ((n || 0) >= 5 && p90 != null) return Math.max(minDays, p90);
  return Math.max(minDays, smallSampleFloor);
}

function outlierReason({ row, hopStats, missedHchb }) {
  const reasons = [];
  const hchb = hopStats.referral_to_hchb;
  const soc = hopStats.referral_to_soc;
  if (row.days_to_hchb != null && row.days_to_hchb > HCHB_OPEN_TARGET_DAYS) {
    if (missedHchb) reasons.push('HCHB after 1 day');
    const extremeCut = outlierCut(hchb?.p90, HCHB_EXTREME_MIN_DAYS, hchb?.n, HCHB_EXTREME_MIN_DAYS);
    if (row.days_to_hchb >= extremeCut) reasons.push('Slow HCHB open');
  }
  if (row.days_to_soc != null) {
    const cut = outlierCut(soc?.p90, SOC_OUTLIER_MIN_DAYS, soc?.n, 21);
    if (row.days_to_soc >= cut) reasons.push('Long referral to SOC');
  }
  if (row.current_wait != null && row.current_wait >= STUCK_OUTLIER_MIN_DAYS) {
    reasons.push(`Waiting ${row.current_wait}d`);
  }
  for (const hop of JOURNEY_HOPS) {
    const days = row.hop_days[hop.key];
    const stat = hopStats[hop.key];
    if (days == null) continue;
    const cut = outlierCut(stat?.p90, HOP_OUTLIER_MIN_DAYS, stat?.n, 14);
    if (days >= cut) reasons.push(`${hop.label} ${days}d`);
  }
  return reasons;
}

export function annotateJourneyOutliers(rows, hopStats = computeHopStats(rows)) {
  return (rows || []).map((row) => {
    const reasons = outlierReason({ row, hopStats, missedHchb: false });
    const missed = row.days_to_hchb != null && row.days_to_hchb > HCHB_OPEN_TARGET_DAYS;
    const missedReasons = outlierReason({ row, hopStats, missedHchb: true });
    const extreme = reasons.length > 0;
    return {
      ...row,
      is_outlier: extreme,
      missed_hchb_target: missed,
      outlier_reason: extreme ? missedReasons.filter((r, i, a) => a.indexOf(r) === i).join('; ') : '-',
    };
  });
}

export function buildJourneyRow(referral, extras = {}) {
  const today = extras.today || new Date();
  const resolve = extras.resolve || {};
  const stamps = journeyStamps(referral);
  const status = journeyStatus(referral);
  const reached = inferReached(referral, stamps);
  const stuckHop = stuckHopFor(referral, stamps);
  const lastStamp = lastReachedStamp(stamps);
  const daysToHchb = calendarDaysBetween(stamps.referralAt, stamps.initialAt);
  const daysHchbToEmr = calendarDaysBetween(stamps.initialAt, stamps.fullEmrAt);
  const daysEmrToSched = calendarDaysBetween(stamps.fullEmrAt, stamps.scheduledAt);
  const daysSchedToSoc = calendarDaysBetween(stamps.scheduledAt, stamps.socAt);
  const daysToSoc = calendarDaysBetween(stamps.referralAt, stamps.socAt);
  const currentWait = (status === 'completed' || status === 'ntuc')
    ? null
    : calendarDaysBetween(lastStamp, today);
  const hopDays = {
    referral_to_hchb: daysToHchb,
    hchb_to_emr: daysHchbToEmr,
    emr_to_scheduled: daysEmrToSched,
    scheduled_to_soc: daysSchedToSoc,
    referral_to_soc: daysToSoc,
  };
  const patientName = cleanName(
    referral.patientName
    || referral.__patient_name
    || resolveName(resolve.patient, referral.patient_id),
  );

  return {
    id: referral._id || referral.id,
    patient_name: patientName || '-',
    division: referral.division || '-',
    current_stage: referral.current_stage || '-',
    priority: referral.priority || 'Normal',
    status,
    services: formatServices(referral.services_requested),
    referral_date: stamps.referralAt || '-',
    hchb_at: stamps.initialAt || '-',
    emr_at: stamps.fullEmrAt || '-',
    scheduled_at: stamps.scheduledAt || '-',
    soc_at: stamps.socAt || '-',
    eligibility_at: referral.eligibility_completed_at || '-',
    f2f_at: referral.f2f_date || '-',
    clinical_at: referral.clinical_review_completed_at || '-',
    staffing_at: referral.staffing_confirmed_at || '-',
    days_to_hchb: daysToHchb,
    days_hchb_to_emr: daysHchbToEmr,
    days_emr_to_scheduled: daysEmrToSched,
    days_scheduled_to_soc: daysSchedToSoc,
    days_to_soc: daysToSoc,
    current_wait: currentWait,
    aging_bucket: agingBucket(currentWait),
    stuck_hop: stuckHop,
    stuck_label: stuckHop ? hopLabel(stuckHop) : '-',
    hchb_on_time: daysToHchb == null ? 'Not entered' : (daysToHchb <= HCHB_OPEN_TARGET_DAYS ? 'Yes' : 'No'),
    intake_owner: resolveName(resolve.user, referral.intake_owner_id),
    clinical_rn: resolveName(resolve.user, clinicalRnId(referral)),
    marketer: resolveName(resolve.marketer, referral.marketer_id),
    facility: resolveName(resolve.facility, referral.facility_id),
    source: resolveName(resolve.source, referral.referral_source_id),
    reached,
    hop_days: hopDays,
    is_outlier: false,
    missed_hchb_target: daysToHchb != null && daysToHchb > HCHB_OPEN_TARGET_DAYS,
    outlier_reason: '-',
  };
}

export function buildJourneyRows(referrals, extras = {}) {
  return (referrals || []).map((r) => buildJourneyRow(r, extras));
}

function matchesQuery(val, q) {
  if (!q) return true;
  return String(val || '').toLowerCase().includes(String(q).toLowerCase());
}

export function applyJourneyFilters(rows, filters = {}) {
  let list = rows || [];
  const {
    cohort = 'all',
    stuckHop = '',
    reachedMilestone = '',
    droppedBefore = '',
    outliersOnly = false,
    missedHchbTarget = false,
    hchbNotEntered = false,
    patient = '',
    facility = '',
    marketer = '',
    source = '',
    intakeOwner = '',
    clinicalRn = '',
    stage = '',
    service = '',
    aging = '',
    priority = '',
    minDays = '',
    maxDays = '',
    hchbMinDays = '',
    hchbMaxDays = '',
  } = filters;

  if (cohort === 'active') list = list.filter((r) => r.status === 'active' || r.status === 'hold');
  else if (cohort === 'soc') list = list.filter((r) => r.status === 'completed');
  else if (cohort === 'ntuc') list = list.filter((r) => r.status === 'ntuc');
  else if (cohort === 'hold') list = list.filter((r) => r.status === 'hold');
  else if (cohort === 'open') list = list.filter((r) => r.status !== 'completed' && r.status !== 'ntuc');

  if (stuckHop) list = list.filter((r) => r.stuck_hop === stuckHop);
  if (reachedMilestone) list = list.filter((r) => r.reached?.[reachedMilestone]);
  if (droppedBefore) {
    const idx = JOURNEY_MILESTONES.findIndex((m) => m.key === droppedBefore);
    const prev = idx > 0 ? JOURNEY_MILESTONES[idx - 1].key : null;
    list = list.filter((r) => {
      if (r.reached?.[droppedBefore]) return false;
      if (prev && !r.reached?.[prev]) return false;
      return true;
    });
  }
  if (outliersOnly) list = list.filter((r) => r.is_outlier);
  if (missedHchbTarget) list = list.filter((r) => r.missed_hchb_target);
  if (hchbNotEntered) list = list.filter((r) => r.days_to_hchb == null && r.status !== 'completed');

  list = list.filter((r) => (
    matchesQuery(r.patient_name, patient)
    && matchesQuery(r.facility, facility)
    && matchesQuery(r.marketer, marketer)
    && matchesQuery(r.source, source)
    && matchesQuery(r.intake_owner, intakeOwner)
    && matchesQuery(r.clinical_rn, clinicalRn)
  ));

  if (stage) list = list.filter((r) => r.current_stage === stage);
  if (priority) list = list.filter((r) => r.priority === priority);
  if (aging) list = list.filter((r) => r.aging_bucket === aging);
  if (service) {
    list = list.filter((r) => String(r.services || '').split(',').map((s) => s.trim()).includes(service));
  }

  const min = minDays === '' || minDays == null ? null : Number(minDays);
  const max = maxDays === '' || maxDays == null ? null : Number(maxDays);
  if (min != null && Number.isFinite(min)) {
    list = list.filter((r) => {
      const n = r.status === 'completed' ? r.days_to_soc : r.current_wait;
      return n != null && n >= min;
    });
  }
  if (max != null && Number.isFinite(max)) {
    list = list.filter((r) => {
      const n = r.status === 'completed' ? r.days_to_soc : r.current_wait;
      return n != null && n <= max;
    });
  }

  const hMin = hchbMinDays === '' || hchbMinDays == null ? null : Number(hchbMinDays);
  const hMax = hchbMaxDays === '' || hchbMaxDays == null ? null : Number(hchbMaxDays);
  if (hMin != null && Number.isFinite(hMin)) {
    list = list.filter((r) => r.days_to_hchb != null && r.days_to_hchb >= hMin);
  }
  if (hMax != null && Number.isFinite(hMax)) {
    list = list.filter((r) => r.days_to_hchb != null && r.days_to_hchb <= hMax);
  }

  return list;
}

function hopScore(stat, missedHchb = 0) {
  const waitWeight = (stat.stuck || 0) * (stat.stuckMedian ?? 0) * 2;
  const cycleWeight = (stat.n || 0) * (stat.median ?? 0);
  const targetBoost = stat.key === 'referral_to_hchb' ? missedHchb * 3 : 0;
  return waitWeight + cycleWeight + targetBoost;
}

export function summarizeJourney(rows) {
  const list = rows || [];
  const total = list.length;
  const soc = list.filter((r) => r.status === 'completed');
  const ntuc = list.filter((r) => r.status === 'ntuc');
  const active = list.filter((r) => r.status === 'active' || r.status === 'hold');
  const open = list.filter((r) => r.status !== 'completed' && r.status !== 'ntuc');
  const hchbEntered = list.filter((r) => r.days_to_hchb != null);
  const hchbOnTime = hchbEntered.filter((r) => r.days_to_hchb <= HCHB_OPEN_TARGET_DAYS);
  const missedHchb = hchbEntered.filter((r) => r.days_to_hchb > HCHB_OPEN_TARGET_DAYS);
  const emrOnboarded = list.filter((r) => r.emr_at && r.emr_at !== '-');
  const hopStats = computeHopStats(list);

  for (const hop of JOURNEY_HOPS) {
    hopStats[hop.key].score = hopScore(hopStats[hop.key], missedHchb.length);
  }

  const ranked = JOURNEY_HOPS
    .map((h) => hopStats[h.key])
    .filter((s) => (s.n || 0) + (s.stuck || 0) > 0)
    .sort((a, b) => b.score - a.score);
  const bottleneck = ranked[0] || null;

  const funnel = JOURNEY_MILESTONES.map((m, i) => {
    const count = list.filter((r) => r.reached?.[m.key]).length;
    const prev = i === 0 ? total : list.filter((r) => r.reached?.[JOURNEY_MILESTONES[i - 1].key]).length;
    return {
      ...m,
      count,
      pctOfTotal: total ? Math.round((count / total) * 100) : 0,
      pctOfPrev: prev ? Math.round((count / prev) * 100) : 0,
      dropFromPrev: prev ? Math.max(0, prev - count) : 0,
    };
  });

  const largestDrop = funnel.slice(1).reduce((best, step) => {
    if (!best || step.dropFromPrev > best.dropFromPrev) return step;
    return best;
  }, null);

  const agingOpen = Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0]));
  for (const r of open) {
    if (agingOpen[r.aging_bucket] != null) agingOpen[r.aging_bucket] += 1;
  }

  return {
    total,
    socCount: soc.length,
    ntucCount: ntuc.length,
    activeCount: active.length,
    openCount: open.length,
    conversion: total ? (soc.length / total) * 100 : 0,
    hchbEntered: hchbEntered.length,
    hchbOnTime: hchbOnTime.length,
    hchbOnTimePct: hchbEntered.length ? (hchbOnTime.length / hchbEntered.length) * 100 : 0,
    missedHchb: missedHchb.length,
    medianToHchb: hopStats.referral_to_hchb.median,
    p90ToHchb: hopStats.referral_to_hchb.p90,
    emrOnboarded: emrOnboarded.length,
    medianToSoc: hopStats.referral_to_soc.median,
    p90ToSoc: hopStats.referral_to_soc.p90,
    stuckCount: open.length,
    stuckOver7: open.filter((r) => (r.current_wait ?? 0) >= 7).length,
    stuckOver14: open.filter((r) => (r.current_wait ?? 0) >= 14).length,
    outlierCount: list.filter((r) => r.is_outlier).length,
    hchbMissing: list.filter((r) => r.days_to_hchb == null && r.status !== 'completed').length,
    funnel,
    hops: JOURNEY_HOPS.map((h) => hopStats[h.key]),
    overall: hopStats.referral_to_soc,
    bottleneck,
    largestDrop,
    hchbHistogram: bucketCount(hchbEntered.map((r) => r.days_to_hchb), HCHB_DAY_BUCKETS),
    socHistogram: bucketCount(soc.map((r) => r.days_to_soc), SOC_DAY_BUCKETS),
    agingOpen,
    hopStats,
  };
}

export function bottleneckCopy(summary) {
  const b = summary?.bottleneck;
  if (!b) return 'Not enough stamped cases to rank a bottleneck.';
  const parts = [`Largest hold-up: ${b.label}.`];
  if (b.stuck) {
    parts.push(`${b.stuck} still waiting${b.stuckMedian != null ? `, median wait ${b.stuckMedian}d` : ''}.`);
  }
  if (b.n && b.median != null) {
    parts.push(`Completed cases: median ${b.median}d${b.p90 != null ? `, p90 ${b.p90}d` : ''}.`);
  }
  if (b.key === 'referral_to_hchb' && summary.missedHchb) {
    parts.push(`${summary.missedHchb} missed the 1-day HCHB open target.`);
  }
  const drop = summary.largestDrop;
  if (drop && drop.dropFromPrev >= 3 && drop.pctOfPrev < 80) {
    parts.push(`Biggest drop-off before ${drop.label}: ${drop.dropFromPrev} cases (${100 - drop.pctOfPrev}% did not reach it).`);
  }
  return parts.join(' ');
}

function weekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + mondayOffset);
  return d;
}

export function buildWeeklyJourneySeries(rows, nWeeks = 12, today = new Date()) {
  const end = weekStart(today);
  const weeks = Array.from({ length: nWeeks }, (_, i) => {
    const start = new Date(end);
    start.setDate(end.getDate() - (nWeeks - 1 - i) * 7);
    const label = `${start.getMonth() + 1}/${start.getDate()}`;
    return {
      start,
      end: new Date(start.getTime() + 7 * 86400000),
      label,
      referrals: 0,
      hchb: 0,
      soc: 0,
      daysToHchb: [],
      daysToSoc: [],
    };
  });

  const place = (raw, fn) => {
    const d = parseCalendarDate(raw);
    if (!d) return;
    const wk = weeks.find((w) => d >= w.start && d < w.end);
    if (wk) fn(wk);
  };

  for (const r of rows || []) {
    place(r.referral_date === '-' ? '' : r.referral_date, (w) => { w.referrals += 1; });
    place(r.hchb_at === '-' ? '' : r.hchb_at, (w) => {
      w.hchb += 1;
      if (r.days_to_hchb != null) w.daysToHchb.push(r.days_to_hchb);
    });
    place(r.soc_at === '-' ? '' : r.soc_at, (w) => {
      w.soc += 1;
      if (r.days_to_soc != null) w.daysToSoc.push(r.days_to_soc);
    });
  }

  return weeks.map((w) => ({
    label: w.label,
    referrals: w.referrals,
    hchb: w.hchb,
    soc: w.soc,
    medianToHchb: median(w.daysToHchb),
    medianToSoc: median(w.daysToSoc),
  }));
}

export function uniqueSorted(rows, key) {
  const set = new Set();
  for (const r of rows || []) {
    const v = r[key];
    if (v && v !== '-') set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

export { AGING_BUCKETS };
