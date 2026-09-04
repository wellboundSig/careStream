/**
 * Client helpers for the HCHB SOC/ROC visit-check tool.
 * Identity hashing happens on the API. This file only shapes CareStream rows.
 */
import { normalizeEpisodeType } from './episodeType.js';
import { toCalendarDateString } from './dateFormat.js';

export const VISIT_DATE_WINDOW_DAYS = 1;

export function isPendingScheduledVisit(referral) {
  if (!referral) return false;
  const completed = referral.soc_completed_date;
  if (completed != null && completed !== '' && completed !== false) return false;
  const scheduled = toCalendarDateString(referral.soc_scheduled_date);
  return /^\d{4}-\d{2}-\d{2}$/.test(scheduled);
}

export function patientNameParts(referral) {
  const p = referral?.patient || {};
  let first = String(p.first_name || '').trim();
  let last = String(p.last_name || '').trim();
  if ((!first || !last) && referral?.patientName) {
    const bits = String(referral.patientName).trim().split(/\s+/);
    if (bits.length >= 2) {
      first = first || bits.slice(0, -1).join(' ');
      last = last || bits[bits.length - 1];
    }
  }
  return { first_name: first, last_name: last, dob: p.dob || referral?.patientDob || '' };
}

export function buildVisitCheckCandidate(referral) {
  if (!isPendingScheduledVisit(referral)) return null;
  const names = patientNameParts(referral);
  if (!names.first_name || !names.last_name) return null;
  return {
    token: String(referral._id || referral.id || ''),
    first_name: names.first_name,
    last_name: names.last_name,
    dob: names.dob || undefined,
    visit_kind: normalizeEpisodeType(referral),
    scheduled_date: toCalendarDateString(referral.soc_scheduled_date),
  };
}

export function collectVisitCheckCandidates(referrals) {
  const out = [];
  const seen = new Set();
  for (const r of referrals || []) {
    const c = buildVisitCheckCandidate(r);
    if (!c?.token || seen.has(c.token)) continue;
    seen.add(c.token);
    out.push(c);
  }
  return out;
}

export function defaultChecked(match) {
  return !!(match && match.matched && match.confidence === 'strong');
}

export function statusLabel(match) {
  if (!match) return 'Not checked';
  if (match.status === 'match' && match.confidence === 'strong') return 'HCHB visit found';
  if (match.status === 'match' && match.confidence === 'soft') return 'Possible name match';
  if (match.status === 'kind_mismatch') {
    return match.visit_kind ? `Found ${match.visit_kind}, expected different type` : 'Visit type mismatch';
  }
  if (match.status === 'skipped') return 'Missing name / DOB';
  return 'No matching HCHB visit';
}

export function mergeVisitCheckRows(referrals, apiResults) {
  const byToken = new Map();
  for (const m of apiResults || []) {
    if (m?.token) byToken.set(String(m.token), m);
  }
  return (referrals || [])
    .filter(isPendingScheduledVisit)
    .map((referral) => {
      const token = String(referral._id || referral.id || '');
      const match = byToken.get(token) || null;
      return {
        referral,
        token,
        match,
        selected: defaultChecked(match),
      };
    });
}
