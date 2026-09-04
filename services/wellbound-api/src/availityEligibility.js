/**
 * Availity Coverages API (X12 270/271 wrapper, REST).
 *
 * Docs: developer.availity.com — "Coverages 1.0.0".
 *   Token:    POST {base}/v1/token           (OAuth2 client credentials, scope=hipaa, 5-min tokens)
 *   Inquiry:  POST {base}/v1/coverages       (form-urlencoded; async — poll until Complete)
 *   Poll:     GET  {base}/v1/coverages/{id}
 *
 * Env:
 *   AVAILITY_CLIENT_ID / AVAILITY_CLIENT_SECRET
 *   AVAILITY_ENV = production | qua   (qua = Availity test region, default production)
 *   AVAILITY_PROVIDER_NPI (falls back to OPTUM_PROVIDER_NPI, then Wellbound LLC NPI)
 */

const TOKEN_TTL_MS = 4 * 60 * 1000; // Availity tokens last 5 minutes
let cachedToken = null; // { token, at, env }

const POLL_ATTEMPTS = 6;
const POLL_DELAY_MS = 700;

function base(env) {
  return env === 'qua'
    ? 'https://qua.api.availity.com/availity'
    : 'https://api.availity.com/availity';
}

function pushLog(logs, level, message, data) {
  logs.push({ at: new Date().toISOString(), level, message, ...(data !== undefined ? { data } : {}) });
}

function isoDate(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function getAccessToken(logs) {
  const env = (process.env.AVAILITY_ENV || 'production').toLowerCase() === 'qua' ? 'qua' : 'production';
  const clientId = process.env.AVAILITY_CLIENT_ID || '';
  const clientSecret = process.env.AVAILITY_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) {
    throw new Error('AVAILITY_CLIENT_ID / AVAILITY_CLIENT_SECRET not configured on API');
  }

  if (cachedToken && cachedToken.env === env && Date.now() - cachedToken.at < TOKEN_TTL_MS) {
    pushLog(logs, 'info', 'Reusing cached Availity bearer token', { env });
    return { token: cachedToken.token, env };
  }

  const url = `${base(env)}/v1/token`;
  pushLog(logs, 'info', 'Requesting Availity OAuth token', { env, url, clientIdPrefix: clientId.slice(0, 6) + '…' });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'hipaa',
    }).toString(),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }

  if (!res.ok || !body.access_token) {
    pushLog(logs, 'error', 'Availity token request failed', { status: res.status, body });
    throw new Error(`Availity auth failed (${res.status}): ${body.error_description || body.error || text.slice(0, 200)}`);
  }

  cachedToken = { token: body.access_token, at: Date.now(), env };
  pushLog(logs, 'ok', 'Availity bearer token obtained', { env, expiresIn: body.expires_in });
  return { token: body.access_token, env };
}

/** Collect status strings from the (loosely typed) coverage resource. */
function collectStatuses(coverage) {
  const out = [];
  const push = (v) => { if (v && typeof v === 'string') out.push(v); };
  push(coverage?.status);
  push(coverage?.planStatus);
  const plans = Array.isArray(coverage?.plans) ? coverage.plans : [];
  for (const p of plans) {
    push(p?.status);
    push(p?.statusCode);
  }
  return out;
}

function summarizeCoverage(coverage) {
  const statuses = collectStatuses(coverage);
  const joined = statuses.join(' | ');
  const active = /active/i.test(joined) && !/inactive/i.test(joined);
  const inactive = /inactive|expired|cancell?ed|terminated/i.test(joined);

  let suggestedStatus = 'unable_to_verify';
  let plainEnglish = null;
  if (active && !inactive) {
    suggestedStatus = 'confirmed_active';
    plainEnglish = 'Payer reported active coverage.';
  } else if (inactive && !active) {
    suggestedStatus = 'confirmed_inactive';
    plainEnglish = 'Payer reported inactive coverage.';
  } else if (statuses.length) {
    suggestedStatus = 'partial';
    plainEnglish = `Payer returned: ${joined}. Review the full response.`;
  } else {
    plainEnglish = 'No plan status in the Availity response — review the full response.';
  }

  const plans = Array.isArray(coverage?.plans) ? coverage.plans : [];
  return {
    suggestedStatus,
    activeCoverage: active,
    inactiveCoverage: inactive,
    planLabel: plans[0]?.plan || plans[0]?.planName || coverage?.plan || null,
    benefitCount: plans.length,
    aaaErrorCount: Array.isArray(coverage?.validationMessages) ? coverage.validationMessages.length : 0,
    plainEnglish,
    subscriberName: [coverage?.subscriber?.firstName, coverage?.subscriber?.lastName].filter(Boolean).join(' ') || null,
    payerName: coverage?.payer?.name || null,
    statuses,
  };
}

/**
 * Run a real-time coverage check through Availity.
 * @param {object} input
 * @param {object} input.patient    { first_name, last_name, dob, gender }
 * @param {object} input.insurance  { member_id, payer_display_name, ... }
 * @param {string} input.payerId    Availity payer ID (required)
 * @param {string} [input.providerNpi]
 * @param {string} [input.asOfDate]
 */
export async function runAvailityEligibilityCheck(input = {}) {
  const logs = [];
  const started = Date.now();
  const patient = input.patient || {};
  const insurance = input.insurance || {};

  try {
    const { token, env } = await getAccessToken(logs);

    const payerId = String(input.payerId || insurance.availity_payer_id || '').trim();
    if (!payerId) throw new Error('No Availity payerId. Map this payer in payerRouting or pass payerId.');

    const npi = String(input.providerNpi || process.env.AVAILITY_PROVIDER_NPI || process.env.OPTUM_PROVIDER_NPI || '1518305572').replace(/\D/g, '').slice(0, 10);
    const memberId = String(insurance.member_id || input.memberId || '').trim();
    const firstName = String(patient.first_name || '').trim();
    const lastName = String(patient.last_name || '').trim();
    const dob = isoDate(patient.dob || patient.date_of_birth);
    if (!firstName || !lastName) throw new Error('Patient first and last name are required.');
    if (!dob) throw new Error('Patient DOB is required (YYYY-MM-DD).');
    if (!memberId) throw new Error('Insurance member ID is required for an Availity check.');

    const asOfDate = isoDate(input.asOfDate) || new Date().toISOString().slice(0, 10);

    const form = new URLSearchParams({
      payerId,
      memberId,
      providerNpi: npi,
      patientFirstName: firstName,
      patientLastName: lastName,
      patientBirthDate: dob,
      asOfDate,
    });
    if (input.serviceType) form.set('serviceType', String(input.serviceType));

    const url = `${base(env)}/v1/coverages`;
    pushLog(logs, 'info', 'Submitting Availity coverage inquiry', {
      env, url, payerId, npi, memberId, subscriber: { firstName, lastName, dob }, asOfDate,
    });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: form.toString(),
    });
    const text = await res.text();
    let coverage;
    try { coverage = JSON.parse(text); } catch { coverage = { raw: text }; }

    pushLog(logs, res.ok ? 'ok' : 'error', `Availity coverages HTTP ${res.status}`, { status: res.status });
    pushLog(logs, 'debug', 'Initial Availity response', coverage);

    if (!res.ok) {
      const msg = coverage?.userMessage || coverage?.message
        || (Array.isArray(coverage?.errors) && coverage.errors.map((e) => e.errorMessage || e.message).filter(Boolean).join('; '))
        || text.slice(0, 300);
      throw new Error(`Availity coverage request failed (${res.status}): ${msg}`);
    }

    // The initial POST may return a list wrapper or the coverage resource, and
    // may still be In Progress — poll by id until Complete.
    let resource = Array.isArray(coverage?.coverages) ? coverage.coverages[0] : coverage;
    let attempts = 0;
    while (resource?.id && /in ?progress|pending/i.test(String(resource?.status || '')) && attempts < POLL_ATTEMPTS) {
      attempts += 1;
      await sleep(POLL_DELAY_MS);
      const pollRes = await fetch(`${base(env)}/v1/coverages/${encodeURIComponent(resource.id)}`, {
        headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
      });
      const pollText = await pollRes.text();
      try { resource = JSON.parse(pollText); } catch { break; }
      pushLog(logs, 'info', `Polled coverage ${resource?.id} (attempt ${attempts})`, { status: resource?.status });
    }

    const summary = summarizeCoverage(resource || {});
    pushLog(logs, 'info', 'Parsed Availity summary', summary);

    return {
      ok: true,
      clearinghouse: 'availity',
      env,
      httpStatus: res.status,
      elapsedMs: Date.now() - started,
      request: Object.fromEntries(form),
      response: resource,
      summary,
      logs,
      payerId,
    };
  } catch (err) {
    pushLog(logs, 'error', err.message || 'Availity check failed');
    return {
      ok: false,
      clearinghouse: 'availity',
      env: (process.env.AVAILITY_ENV || 'production').toLowerCase(),
      httpStatus: 0,
      elapsedMs: Date.now() - started,
      request: null,
      response: null,
      summary: { suggestedStatus: 'unable_to_verify', error: err.message },
      logs,
      error: err.message,
    };
  }
}
