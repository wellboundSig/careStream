/**
 * HCHB logship duplicate check proxy.
 * Hashes identifiers with HCHB_LINK_PEPPER (Lambda env), calls the AWS bridge,
 * polls until the on-prem agent returns soft/strong flags plus latest-episode
 * case facts (status + dates). Does not return names, SSN, MRN, or DOB from HCHB.
 *
 * Env:
 *   HCHB_LINK_PEPPER
 *   HCHB_DUP_BRIDGE_URL   e.g. https://xxx.execute-api.us-east-2.amazonaws.com/prod
 *   HCHB_DUP_CARESTREAM_TOKEN
 */

import { createHmac } from 'node:crypto';

const POLL_MS = 1200;
const POLL_MAX = 18; // stay under typical 30s Lambda timeout (~22s)

function normalizeName(value) {
  if (!value) return '';
  return String(value)
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeDob(value) {
  if (!value) return '';
  const s = String(value).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) {
    const mm = String(m2[1]).padStart(2, '0');
    const dd = String(m2[2]).padStart(2, '0');
    return `${m2[3]}-${mm}-${dd}`;
  }
  const digits = s.replace(/\D+/g, '');
  if (digits.length >= 8) {
    const d = digits.slice(0, 8);
    return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  }
  return '';
}

function hmacHex(pepper, material) {
  return createHmac('sha256', pepper).update(material, 'utf8').digest('hex');
}

function hashName(pepper, last, first) {
  const l = normalizeName(last);
  const f = normalizeName(first);
  if (!l || !f) return '';
  return hmacHex(pepper, `NAME|${l}|${f}`);
}

function hashNameDob(pepper, last, first, dob) {
  const l = normalizeName(last);
  const f = normalizeName(first);
  const d = normalizeDob(dob);
  if (!l || !f || !d) return '';
  return hmacHex(pepper, `NAMEDOB|${l}|${f}|${d}`);
}

function sanitizeHchbCase(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      case_status: null,
      episode_status: null,
      episode_start: null,
      discharged_on: null,
      has_active_episode: false,
      episode_count: 0,
    };
  }
  const caseStatus = String(raw.case_status || '').trim().toLowerCase();
  const allowed = new Set(['active', 'discharged', 'non_admit', 'other', 'unknown']);
  const start = String(raw.episode_start || '').slice(0, 10);
  const dc = String(raw.discharged_on || '').slice(0, 10);
  const count = Number(raw.episode_count);
  return {
    case_status: allowed.has(caseStatus) ? caseStatus : null,
    episode_status: String(raw.episode_status || '').trim() || null,
    episode_start: /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : null,
    discharged_on: /^\d{4}-\d{2}-\d{2}$/.test(dc) ? dc : null,
    has_active_episode: raw.has_active_episode === true || raw.has_active_episode === 'true',
    episode_count: Number.isFinite(count) ? count : 0,
  };
}

function envConfig() {
  const pepper = process.env.HCHB_LINK_PEPPER || '';
  const bridgeUrl = (process.env.HCHB_DUP_BRIDGE_URL || '').replace(/\/$/, '');
  const token = process.env.HCHB_DUP_CARESTREAM_TOKEN || '';
  return { pepper, bridgeUrl, token };
}

async function bridgeFetch(path, { method = 'GET', body, token, bridgeUrl }) {
  const res = await fetch(`${bridgeUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(data?.error || `Bridge ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/**
 * @param {{ first_name?: string, last_name?: string, dob?: string }} input
 */
export async function runHchbDupCheck(input = {}) {
  const { pepper, bridgeUrl, token } = envConfig();
  if (!pepper || !bridgeUrl || !token) {
    return {
      ok: false,
      configured: false,
      error: 'HCHB duplicate check is not configured on the server',
    };
  }

  const first = String(input.first_name || '').trim();
  const last = String(input.last_name || '').trim();
  const dob = String(input.dob || '').trim();
  if (!first || !last) {
    return { ok: false, error: 'first_name and last_name are required' };
  }

  const hmac_name = hashName(pepper, last, first);
  const hmac_name_dob = dob ? hashNameDob(pepper, last, first, dob) : '';
  if (!hmac_name) {
    return { ok: false, error: 'Could not normalize name for matching' };
  }

  const job = await bridgeFetch('/jobs', {
    method: 'POST',
    token,
    bridgeUrl,
    body: {
      hmac_name,
      ...(hmac_name_dob ? { hmac_name_dob } : {}),
    },
  });

  const jobId = job?.job_id;
  if (!jobId) {
    return { ok: false, error: 'Bridge did not return a job_id' };
  }

  for (let i = 0; i < POLL_MAX; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 400 : POLL_MS));
    const status = await bridgeFetch(`/jobs/${jobId}`, { token, bridgeUrl });
    if (status?.status === 'done' || status?.status === 'error') {
      if (status.status === 'error') {
        return {
          ok: false,
          job_id: jobId,
          error: status.error || 'On-prem agent reported an error',
        };
      }
      const confidence = status.confidence || null;
      const strong = confidence === 'strong' || status.duplicate === true || status.former_patient === true;
      const soft = confidence === 'soft' || (!strong && status.possible_match === true);
      const hchbCase = sanitizeHchbCase(status.hchb_case);
      const hasCaseFacts = !!(hchbCase.case_status || hchbCase.episode_status);
      const hasActive = hchbCase.has_active_episode === true
        || (!hasCaseFacts && status.duplicate === true);
      const former = !!(status.former_patient || (strong && hchbCase.case_status && !hasActive));
      return {
        ok: true,
        job_id: jobId,
        checked: {
          first_name: normalizeName(first),
          last_name: normalizeName(last),
          dob: dob ? normalizeDob(dob) : null,
          mode: hmac_name_dob ? 'name_dob' : 'name',
        },
        duplicate: !!(strong && hasActive),
        possible_match: soft || strong,
        former_patient: former,
        confidence: strong ? 'strong' : soft ? 'soft' : null,
        match_type: status.match_type || null,
        allow_override: !!(strong && hasActive),
        hchb_case: hchbCase,
        hchb_details_available: !!(hchbCase.case_status || hchbCase.episode_status),
      };
    }
  }

  return {
    ok: false,
    job_id: jobId,
    error: 'Timed out waiting for on-prem HCHB agent. Try again in a moment.',
  };
}
