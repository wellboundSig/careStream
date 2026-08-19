/**
 * Display helpers for HCHB duplicate-check results.
 * Case facts (status + dates) come from the closet agent; names/MRN never do.
 */
import { fmtCalendarDate } from './dateFormat.js';

export function hchbCase(result) {
  return result?.hchb_case && typeof result.hchb_case === 'object'
    ? result.hchb_case
    : {};
}

export function hchbTone(result) {
  if (!result) return null;
  if (result.ok === false && result.configured === false) return null;
  if (result.ok === false) return 'error';

  const facts = hchbCase(result);
  const strong = !!(
    result.confidence === 'strong'
    || result.duplicate === true
    || result.former_patient === true
  );
  const active = facts.has_active_episode === true
    || facts.case_status === 'active'
    || result.duplicate === true;
  const former = !!(
    result.former_patient
    || facts.case_status === 'discharged'
    || facts.case_status === 'non_admit'
    || (strong && !active)
  );

  if (strong && active) return 'strong';
  if (strong && former) return 'former';
  if (result.confidence === 'soft' || result.possible_match) return 'soft';
  return 'clear';
}

export function hchbCaseLines(result) {
  const facts = hchbCase(result);
  if (!facts.case_status && !facts.episode_status && !facts.discharged_on) return [];

  const lines = [];
  const status = facts.episode_status || (facts.case_status === 'discharged' ? 'DISCHARGED' : '');
  const started = facts.episode_start ? fmtCalendarDate(facts.episode_start, '') : '';
  const discharged = facts.discharged_on ? fmtCalendarDate(facts.discharged_on, '') : '';

  if (facts.has_active_episode || facts.case_status === 'active') {
    let line = `Latest episode: ${status || 'active'}`;
    if (started) line += ` · started ${started}`;
    lines.push(line);
  } else if (facts.case_status === 'discharged' || discharged) {
    let line = discharged ? `Discharged ${discharged}` : 'Discharged';
    if (status && status !== 'DISCHARGED') line = `${status} · ${line}`;
    if (started) line += ` · episode started ${started}`;
    lines.push(line);
  } else if (facts.case_status === 'non_admit') {
    lines.push(status ? `Latest episode: ${status}` : 'Non-admit in HCHB');
  } else if (status) {
    let line = `Latest episode: ${status}`;
    if (started) line += ` · started ${started}`;
    if (discharged) line += ` · ${discharged}`;
    lines.push(line);
  }

  if (facts.episode_count > 1) {
    lines.push(`${facts.episode_count} episodes on file`);
  }
  return lines;
}

export function hchbTitle(tone, { display = '', withDob = false, caseStatus = '' } = {}) {
  if (tone === 'strong') return 'Active case in HCHB';
  if (tone === 'former') {
    if (caseStatus === 'non_admit') return 'HCHB chart found: not admitted';
    return 'Former HCHB patient: discharged';
  }
  if (tone === 'soft') {
    return withDob ? 'Same name in HCHB, different date of birth' : 'Name found in HCHB';
  }
  if (tone === 'clear') {
    return display ? `${display} is not in HCHB` : 'Not in HCHB';
  }
  return '';
}

export function hchbBody(tone, { display = '', withDob = false } = {}) {
  if (tone === 'strong') {
    return `${display || 'This patient'} has an active HCHB case. Confirm there before creating a new chart.`;
  }
  if (tone === 'former') {
    return `${display || 'This patient'} is in HCHB but not currently active. Confirm in HCHB before opening a new episode.`;
  }
  if (tone === 'soft') {
    return withDob
      ? `${display} is an HCHB name, but not with this date of birth. Confirm in HCHB if you are unsure.`
      : `${display} matches an HCHB patient name. Add a date of birth to confirm, or look them up in HCHB.`;
  }
  if (tone === 'clear') return 'No matching HCHB chart.';
  return '';
}
