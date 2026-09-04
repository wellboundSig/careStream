/**
 * HCHB logship SOC/ROC visit check proxy.
 * Hashes CareStream scheduled visits, sends a visit_check job over the same
 * closet-PC bridge as duplicate checks, polls for match flags.
 *
 * Never returns names / SSN / MRN / DOB from HCHB — only token, match status,
 * visit date, visit kind, and service code.
 */

import { hashVisitName, hashVisitNameDob, normalizeDob, normalizeName } from './hchbHash.js';

const POLL_MS = 1200;
const POLL_MAX = 18;
const CHUNK = 150;

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

function sanitizeMatch(raw, token) {
  if (!raw || typeof raw !== 'object') {
    return {
      token,
      matched: false,
      status: 'no_match',
      confidence: null,
      visit_kind: null,
      visit_date: null,
      visit_type: null,
      day_offset: null,
    };
  }
  const status = String(raw.status || '').toLowerCase() || (raw.matched ? 'match' : 'no_match');
  const conf = String(raw.confidence || '').toLowerCase();
  const kind = String(raw.visit_kind || '').toUpperCase();
  const vdate = String(raw.visit_date || '').slice(0, 10);
  const offset = Number(raw.day_offset);
  return {
    token: String(raw.token || token),
    matched: status === 'match' && !!raw.matched,
    status,
    confidence: conf === 'strong' || conf === 'soft' ? conf : null,
    visit_kind: kind === 'SOC' || kind === 'ROC' ? kind : null,
    visit_date: /^\d{4}-\d{2}-\d{2}$/.test(vdate) ? vdate : null,
    visit_type: String(raw.visit_type || '').slice(0, 40) || null,
    day_offset: Number.isFinite(offset) ? offset : null,
  };
}

function hashCandidate(pepper, input) {
  const token = String(input.token || '').trim();
  const first = String(input.first_name || '').trim();
  const last = String(input.last_name || '').trim();
  const dob = String(input.dob || '').trim();
  const visitKind = String(input.visit_kind || '').toUpperCase().trim();
  const scheduled = String(input.scheduled_date || '').slice(0, 10);
  if (!token || !/^[A-Za-z0-9._:-]{1,80}$/.test(token)) return null;
  if (visitKind !== 'SOC' && visitKind !== 'ROC') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduled)) return null;
  const hmac_name = hashVisitName(pepper, last, first);
  const hmac_name_dob = dob ? hashVisitNameDob(pepper, last, first, dob) : '';
  if (!hmac_name && !hmac_name_dob) return null;
  return {
    token,
    visit_kind: visitKind,
    scheduled_date: scheduled,
    ...(hmac_name ? { hmac_name } : {}),
    ...(hmac_name_dob ? { hmac_name_dob } : {}),
    _checked: {
      first_name: normalizeName(first),
      last_name: normalizeName(last),
      dob: dob ? normalizeDob(dob) : null,
    },
  };
}

async function runChunk(candidates, { pepper, bridgeUrl, token }) {
  const hashed = [];
  const skipped = [];
  for (const c of candidates) {
    const row = hashCandidate(pepper, c);
    if (!row) {
      skipped.push({
        token: String(c?.token || ''),
        matched: false,
        status: 'skipped',
        confidence: null,
        visit_kind: null,
        visit_date: null,
        visit_type: null,
        day_offset: null,
        reason: 'missing_identity',
      });
      continue;
    }
    hashed.push(row);
  }

  if (!hashed.length) {
    return { ok: true, results: skipped };
  }

  const body = {
    kind: 'visit_check',
    candidates: hashed.map(({ _checked, ...rest }) => rest),
  };
  const job = await bridgeFetch('/jobs', { method: 'POST', token, bridgeUrl, body });
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
      const byToken = new Map();
      for (const m of status.matches || []) {
        const tok = String(m.token || '');
        if (tok) byToken.set(tok, sanitizeMatch(m, tok));
      }
      const results = hashed.map((c) => byToken.get(c.token) || sanitizeMatch(null, c.token));
      return { ok: true, job_id: jobId, results: [...results, ...skipped] };
    }
  }

  return {
    ok: false,
    job_id: jobId,
    error: 'Timed out waiting for on-prem HCHB agent. Try again in a moment.',
  };
}

/**
 * @param {{ candidates?: Array<{ token: string, first_name?: string, last_name?: string, dob?: string, visit_kind?: string, scheduled_date?: string }> }} input
 */
export async function runHchbVisitCheck(input = {}) {
  const { pepper, bridgeUrl, token } = envConfig();
  if (!pepper || !bridgeUrl || !token) {
    return {
      ok: false,
      configured: false,
      error: 'HCHB visit check is not configured on the server',
    };
  }

  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  if (!candidates.length) {
    return { ok: false, error: 'candidates are required' };
  }
  if (candidates.length > 400) {
    return { ok: false, error: 'Too many candidates (max 400)' };
  }

  const all = [];
  let lastJob = null;
  for (let i = 0; i < candidates.length; i += CHUNK) {
    const part = await runChunk(candidates.slice(i, i + CHUNK), { pepper, bridgeUrl, token });
    if (!part.ok) return part;
    lastJob = part.job_id || lastJob;
    all.push(...(part.results || []));
  }
  return { ok: true, job_id: lastJob, results: all };
}
