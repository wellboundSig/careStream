/**
 * Optum Medical Network Eligibility v3 (270/271 via JSON).
 *
 * Env:
 *   OPTUM_CLIENT_ID / OPTUM_CLIENT_SECRET
 *   OPTUM_ENV = sandbox | production  (default production)
 *   OPTUM_PROVIDER_NPI / OPTUM_PROVIDER_NAME  (defaults; request may override)
 */

const TOKEN_TTL_MS = 50 * 60 * 1000; // refresh before 60m expiry
let cachedToken = null; // { token, at, env }

function baseUrls(env) {
  const sandbox = env === 'sandbox';
  return {
    token: sandbox
      ? 'https://sandbox-apigw.optum.com/apip/auth/v2/token'
      : 'https://apigw.optum.com/apip/auth/v2/token',
    eligibility: sandbox
      ? 'https://sandbox-apigw.optum.com/medicalnetwork/eligibility/v3/'
      : 'https://apigw.optum.com/medicalnetwork/eligibility/v3/',
  };
}

function pushLog(logs, level, message, data) {
  logs.push({
    at: new Date().toISOString(),
    level,
    message,
    ...(data !== undefined ? { data } : {}),
  });
}

function digitsOnly(v, max) {
  const d = String(v || '').replace(/\D/g, '');
  return max ? d.slice(0, max) : d;
}

function yyyymmdd(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return digitsOnly(s, 8);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function genderCode(raw) {
  const g = String(raw || '').trim().toLowerCase();
  if (g.startsWith('m')) return 'M';
  if (g.startsWith('f')) return 'F';
  return undefined;
}

function controlNumber() {
  // Optum wants up to 9 digits
  return String(Date.now()).slice(-9);
}

export function guessTradingPartnerServiceId(insurance = {}) {
  const explicit = String(
    insurance.trading_partner_service_id
      || insurance.payer_id
      || insurance.clearinghouse_payer_id
      || '',
  ).trim();
  if (explicit) return explicit;

  const cat = String(insurance.insurance_category || '').toLowerCase();
  const name = String(insurance.payer_display_name || insurance.plan_name || '').toLowerCase();

  if (cat.includes('medicare') || /\bmedicare\b/.test(name) || /\bmcare\b/.test(name)) return 'CMS';
  if (cat.includes('medicaid') || /medicaid|epaces|emedny|ny medicaid/.test(name)) return 'MCDNY';
  if (/united|uhc|optum/.test(name)) return '87726';
  if (/aetna/.test(name)) return '60054';
  if (/elder.?serve|riverspring/.test(name)) return '05178';
  if (/fidelis/.test(name)) return '11315';
  if (/healthfirst|hfny/.test(name)) return '80141';
  if (/empire|anthem|bcbs|blue cross|blue shield/.test(name)) return '00303';
  return '';
}

async function getAccessToken(logs) {
  const env = (process.env.OPTUM_ENV || 'production').toLowerCase() === 'sandbox' ? 'sandbox' : 'production';
  const clientId = process.env.OPTUM_CLIENT_ID || '';
  const clientSecret = process.env.OPTUM_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) {
    throw new Error('OPTUM_CLIENT_ID / OPTUM_CLIENT_SECRET not configured on API');
  }

  if (cachedToken && cachedToken.env === env && Date.now() - cachedToken.at < TOKEN_TTL_MS) {
    pushLog(logs, 'info', 'Reusing cached Optum bearer token', { env, ageSec: Math.round((Date.now() - cachedToken.at) / 1000) });
    return { token: cachedToken.token, env };
  }

  const urls = baseUrls(env);
  pushLog(logs, 'info', 'Requesting Optum OAuth token', { env, url: urls.token, clientIdPrefix: clientId.slice(0, 6) + '…' });

  const res = await fetch(urls.token, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: '*/*' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }

  if (!res.ok || !body.access_token) {
    pushLog(logs, 'error', 'Optum token request failed', { status: res.status, body });
    throw new Error(`Optum auth failed (${res.status}): ${body.error_description || body.error || text.slice(0, 200)}`);
  }

  cachedToken = { token: body.access_token, at: Date.now(), env };
  pushLog(logs, 'ok', 'Optum bearer token obtained', {
    env,
    expiresIn: body.expires_in,
    tokenType: body.token_type,
    products: body.api_product_list || body.api_product_list_json || undefined,
  });
  return { token: body.access_token, env };
}

function summarizeEligibility(response) {
  const benefits = Array.isArray(response?.benefitsInformation) ? response.benefitsInformation : [];
  const active = benefits.some((b) => String(b.code || '') === '1' || /active/i.test(b.name || ''));
  const inactive = benefits.some((b) => String(b.code || '') === '6' || /inactive/i.test(b.name || ''));
  const aaa = Array.isArray(response?.subscriber?.aaaErrors)
    ? response.subscriber.aaaErrors
    : (Array.isArray(response?.errors) ? response.errors : []);

  // AAA*41 at Loop 2000A = provider/vendor not enrolled to query that payer.
  // That is NOT "patient denied" — do not suggest denied_not_found.
  const enrollmentBlock = aaa.some((e) => {
    const code = String(e.code || '');
    const loc = String(e.location || '');
    const desc = String(e.description || '');
    return code === '41'
      || /authorization\/access restrictions/i.test(desc)
      || /enrollment issue/i.test(String(e.possibleResolutions || ''))
      || /2000A/i.test(loc);
  });

  let suggestedStatus = 'unable_to_verify';
  let plainEnglish = null;
  if (enrollmentBlock) {
    suggestedStatus = 'unable_to_verify';
    plainEnglish = 'Optum/Medicare rejected the query: Wellbound is not enrolled (or not authorized) to run eligibility for this payer yet. This does not mean the patient is inactive — keep using Waystar/manual check until Optum enrollment for CMS is complete.';
  } else if (aaa.length) {
    suggestedStatus = 'unable_to_verify';
    plainEnglish = aaa.map((e) => e.description || e.code).filter(Boolean).join('; ')
      || 'Payer returned an AAA error — eligibility could not be confirmed.';
  } else if (active && !inactive) {
    suggestedStatus = 'confirmed_active';
    plainEnglish = 'Payer reported active coverage.';
  } else if (inactive && !active) {
    suggestedStatus = 'confirmed_inactive';
    plainEnglish = 'Payer reported inactive coverage.';
  } else if (benefits.length) {
    suggestedStatus = 'partial';
    plainEnglish = 'Partial benefit data returned — review the full response.';
  }

  const plan = response?.planStatus?.[0]?.statusDescription
    || response?.planInformation?.planNumber
    || (response?.payer?.name && response.payer.name !== 'Unknown' ? response.payer.name : null)
    || null;

  return {
    suggestedStatus,
    activeCoverage: active,
    inactiveCoverage: inactive,
    planLabel: plan,
    benefitCount: benefits.length,
    aaaErrorCount: aaa.length,
    enrollmentBlock,
    plainEnglish,
    aaaErrors: aaa.map((e) => ({
      code: e.code || null,
      description: e.description || null,
      location: e.location || null,
      followupAction: e.followupAction || null,
      possibleResolutions: e.possibleResolutions || null,
    })),
    subscriberName: [response?.subscriber?.firstName, response?.subscriber?.lastName].filter(Boolean).join(' ') || null,
    payerName: response?.payer?.name || null,
  };
}

/**
 * Run a real-time eligibility check.
 * @param {object} input
 * @param {object} input.patient
 * @param {object} input.insurance
 * @param {string} [input.tradingPartnerServiceId]
 * @param {string} [input.providerNpi]
 * @param {string} [input.providerName]
 * @param {string[]} [input.serviceTypeCodes]
 */
export async function runOptumEligibilityCheck(input = {}) {
  const logs = [];
  const started = Date.now();
  const patient = input.patient || {};
  const insurance = input.insurance || {};

  try {
    const { token, env } = await getAccessToken(logs);
    const urls = baseUrls(env);

    const tradingPartnerServiceId = String(
      input.tradingPartnerServiceId || guessTradingPartnerServiceId(insurance) || '',
    ).trim();
    if (!tradingPartnerServiceId) {
      throw new Error('No tradingPartnerServiceId (payer ID). Enter one manually (e.g. CMS, MCDNY, 87726).');
    }

    // Default: Wellbound LLC NPI (CMS NPPES). Override via env or request.
    const npi = digitsOnly(input.providerNpi || process.env.OPTUM_PROVIDER_NPI || '1518305572', 10);
    if (npi.length !== 10) {
      throw new Error('Provider NPI must be 10 digits. Set OPTUM_PROVIDER_NPI or pass providerNpi.');
    }

    const orgName = String(input.providerName || process.env.OPTUM_PROVIDER_NAME || 'WELLBOUND LLC').trim();
    let memberId = String(insurance.member_id || input.memberId || '').trim();
    if (!memberId) {
      const cat = String(insurance.insurance_category || '').toLowerCase();
      const pname = String(insurance.payer_display_name || '').toLowerCase();
      const medicaid = String(patient.medicaid_number || '').trim();
      const medicare = String(patient.medicare_number || '').trim();
      if ((cat.includes('medicaid') || /medicaid/.test(pname)) && medicaid) memberId = medicaid;
      else if ((cat.includes('medicare') || /medicare/.test(pname)) && medicare) memberId = medicare;
      else memberId = medicaid || medicare;
    }
    if (!memberId) throw new Error('Insurance member ID is required for an Optum check.');

    const firstName = String(patient.first_name || '').trim();
    const lastName = String(patient.last_name || '').trim();
    if (!firstName || !lastName) throw new Error('Patient first and last name are required.');

    const dob = yyyymmdd(patient.dob || patient.date_of_birth);
    if (dob.length !== 8) throw new Error('Patient DOB is required (YYYY-MM-DD).');

    const serviceTypeCodes = Array.isArray(input.serviceTypeCodes) && input.serviceTypeCodes.length
      ? input.serviceTypeCodes
      : ['30']; // Health Benefit Plan Coverage

    // Optum prod requires a single dateOfService (or a begin/end range).
    const today = new Date();
    const yyyy = today.getUTCFullYear();
    const mm = String(today.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(today.getUTCDate()).padStart(2, '0');
    const dateOfService = String(input.dateOfService || `${yyyy}${mm}${dd}`).replace(/\D/g, '').slice(0, 8);

    const payload = {
      controlNumber: controlNumber(),
      tradingPartnerServiceId,
      provider: {
        organizationName: orgName,
        npi,
      },
      subscriber: {
        memberId,
        firstName,
        lastName,
        dateOfBirth: dob,
        ...(genderCode(patient.gender) ? { gender: genderCode(patient.gender) } : {}),
      },
      encounter: {
        serviceTypeCodes,
        dateOfService,
      },
    };

    pushLog(logs, 'info', 'Built Optum eligibility request', {
      env,
      url: urls.eligibility,
      tradingPartnerServiceId,
      npi,
      orgName,
      memberId,
      subscriber: { firstName, lastName, dateOfBirth: dob },
      serviceTypeCodes,
    });
    pushLog(logs, 'debug', 'Full request payload', payload);

    const res = await fetch(urls.eligibility, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text }; }

    pushLog(logs, res.ok ? 'ok' : 'error', `Optum eligibility HTTP ${res.status}`, {
      status: res.status,
      statusText: res.statusText,
      ms: Date.now() - started,
    });
    pushLog(logs, 'debug', 'Full Optum response body', body);

    const summary = res.ok ? summarizeEligibility(body) : {
      suggestedStatus: 'unable_to_verify',
      activeCoverage: false,
      inactiveCoverage: false,
      planLabel: null,
      benefitCount: 0,
      aaaErrorCount: 0,
      httpError: true,
    };
    pushLog(logs, 'info', 'Parsed eligibility summary', summary);

    return {
      ok: res.ok,
      env,
      httpStatus: res.status,
      elapsedMs: Date.now() - started,
      request: payload,
      response: body,
      summary,
      logs,
      tradingPartnerServiceId,
    };
  } catch (err) {
    pushLog(logs, 'error', err.message || 'Optum check failed');
    return {
      ok: false,
      env: (process.env.OPTUM_ENV || 'production').toLowerCase(),
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
