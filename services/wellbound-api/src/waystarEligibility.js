/**
 * Waystar (ZirMed) RealTime Eligibility gateway — X12 270/271.
 *
 * Gateway: POST https://eligibilityapi.zirmed.com/1.0/Rest/Gateway/GatewayAsync.ashx
 * Auth:    UserID + Password sent as POST form fields alongside the payload
 *          (not headers). Bad credentials return "Authentication Failure".
 *
 * Request contract (Waystar dev portal "Insurance Verification", confirmed
 * live 2026-09-04). POST form fields:
 *   UserID / Password  — RealTime API pair (portal Settings → Key/Pass).
 *   CustID             — optional Waystar account id (Wellbound LLC = 227980).
 *   DataFormat         — 'X12' (270) or 'SF1' (Waystar simplified format).
 *   Data               — the inquiry payload itself.
 *   ResponseType       — HTML (default) | TEXT | 271 | JSON | FullJSON |
 *                        X12definedXML. We use 271 and parse EB segments.
 * Errors: 401 bad user/pass, 403 account not set up for Eligibility,
 * 400 invalid data / payer not set up, 504 payer timeout.
 * Test payers (validate only, never sent to a payer): 11111 (4010 check),
 * 22222 (5010 check), 33333 simulated Medicare, 55555 simulated Medicaid,
 * 66666 simulated commercial.
 * Waystar enforces an IP allowlist (portal Settings → Key/Pass → IP
 * Addresses) — the Lambda's egress IP must be allowlisted (static IP
 * requires VPC + NAT).
 *
 * Env:
 *   WAYSTAR_API_USERID / WAYSTAR_API_PASSWORD
 *   WAYSTAR_GATEWAY_URL      (default the ZirMed gateway above)
 *   WAYSTAR_CUST_ID          (Waystar account id, e.g. 227980)
 *   WAYSTAR_RESPONSE_TYPE    (default "271")
 *   WAYSTAR_SENDER_ID        (ISA06/GS02 sender; default the UserID)
 *   WAYSTAR_PROVIDER_NPI / WAYSTAR_PROVIDER_NAME (fall back to OPTUM_* / Wellbound)
 */

const DEFAULT_GATEWAY = 'https://eligibilityapi.zirmed.com/1.0/Rest/Gateway/GatewayAsync.ashx';

function pushLog(logs, level, message, data) {
  logs.push({ at: new Date().toISOString(), level, message, ...(data !== undefined ? { data } : {}) });
}

function digitsOnly(v, max) {
  const d = String(v || '').replace(/\D/g, '');
  return max ? d.slice(0, max) : d;
}

function yyyymmdd(raw) {
  if (!raw) return '';
  const m = String(raw).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}${m[2]}${m[3]}`;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return digitsOnly(raw, 8);
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** Build a minimal 005010X279A1 270 (eligibility inquiry). */
export function buildX12_270({ senderId, payerId, payerName, orgName, npi, memberId, firstName, lastName, dob, dateOfService, serviceTypeCode = '30' }) {
  const now = new Date();
  const yymmdd = now.toISOString().slice(2, 10).replace(/-/g, '');
  const ymd = now.toISOString().slice(0, 10).replace(/-/g, '');
  const hhmm = `${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}`;
  const ctrl9 = String(Date.now()).slice(-9);
  const pad15 = (s) => String(s || '').slice(0, 15).padEnd(15, ' ');

  const seg = [];
  seg.push(`ISA*00*          *00*          *ZZ*${pad15(senderId)}*ZZ*${pad15('WAYSTAR')}*${yymmdd}*${hhmm}*^*00501*${ctrl9}*0*P*:`);
  seg.push(`GS*HS*${senderId}*WAYSTAR*${ymd}*${hhmm}*${ctrl9}*X*005010X279A1`);
  seg.push('ST*270*0001*005010X279A1');
  seg.push(`BHT*0022*13*${ctrl9}*${ymd}*${hhmm}`);
  seg.push('HL*1**20*1');
  seg.push(`NM1*PR*2*${payerName || 'PAYER'}*****PI*${payerId}`);
  seg.push('HL*2*1*21*1');
  seg.push(`NM1*1P*2*${orgName}*****XX*${npi}`);
  seg.push('HL*3*2*22*0');
  seg.push(`TRN*1*${ctrl9}*9${npi}`);
  seg.push(`NM1*IL*1*${lastName}*${firstName}****MI*${memberId}`);
  seg.push(`DMG*D8*${dob}`);
  seg.push(`DTP*291*D8*${dateOfService}`);
  seg.push(`EQ*${serviceTypeCode}`);
  // SE count = segments from ST through SE inclusive
  const stIndex = 2;
  const count = seg.length - stIndex + 1; // + the SE itself
  seg.push(`SE*${count}*0001`);
  seg.push(`GE*1*${ctrl9}`);
  seg.push(`IEA*1*${ctrl9}`);
  return seg.join('~') + '~';
}

/** Pull EB (eligibility/benefit) codes out of a raw 271. */
function summarize271(raw) {
  const text = String(raw || '');
  if (/authentication failure/i.test(text)) {
    return {
      suggestedStatus: 'unable_to_verify',
      authFailure: true,
      plainEnglish: 'Waystar rejected the credentials (Authentication Failure). UserID/Password must be a Waystar web user with eligibility access; also confirm the IP allowlist in the portal.',
    };
  }
  // Waystar 271s may use `*` or `|` as the element separator — X12 defines it
  // as the character immediately after "ISA".
  const sep = text.startsWith('ISA') && text[3] ? text[3] : '*';
  const esc = sep.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ebRe = new RegExp(`(?:^|~)EB${esc}([^${esc}~]+)`, 'g');
  const aaaRe = new RegExp(`(?:^|~)AAA${esc}[^${esc}~]*${esc}[^${esc}~]*${esc}([^${esc}~]+)`, 'g');
  const ebCodes = [...text.matchAll(ebRe)].map((m) => m[1]);
  const aaa = [...text.matchAll(aaaRe)].map((m) => m[1]);
  const active = ebCodes.includes('1');
  const inactive = ebCodes.includes('6');

  let suggestedStatus = 'unable_to_verify';
  let plainEnglish = null;
  if (active && !inactive) { suggestedStatus = 'confirmed_active'; plainEnglish = 'Payer reported active coverage.'; }
  else if (inactive && !active) { suggestedStatus = 'confirmed_inactive'; plainEnglish = 'Payer reported inactive coverage.'; }
  else if (ebCodes.length) { suggestedStatus = 'partial'; plainEnglish = `Payer returned benefit segments (EB codes: ${ebCodes.join(', ')}).`; }
  else if (aaa.length) { plainEnglish = `Payer returned AAA rejection code(s): ${aaa.join(', ')}.`; }
  else { plainEnglish = 'No recognizable 271 content in the Waystar response — review the raw response.'; }

  return {
    suggestedStatus,
    activeCoverage: active,
    inactiveCoverage: inactive,
    benefitCount: ebCodes.length,
    aaaErrorCount: aaa.length,
    plainEnglish,
  };
}

/**
 * Run a real-time eligibility check through Waystar's gateway.
 * @param {object} input — { patient, insurance, payerId, payerName, providerNpi, providerName, dateOfService }
 */
export async function runWaystarEligibilityCheck(input = {}) {
  const logs = [];
  const started = Date.now();
  const patient = input.patient || {};
  const insurance = input.insurance || {};

  try {
    const userId = process.env.WAYSTAR_API_USERID || '';
    const password = process.env.WAYSTAR_API_PASSWORD || '';
    if (!userId || !password) throw new Error('WAYSTAR_API_USERID / WAYSTAR_API_PASSWORD not configured on API');

    const gateway = process.env.WAYSTAR_GATEWAY_URL || DEFAULT_GATEWAY;
    const senderId = process.env.WAYSTAR_SENDER_ID || userId;
    const custId = process.env.WAYSTAR_CUST_ID || '';
    const responseType = process.env.WAYSTAR_RESPONSE_TYPE || '271';

    const payerId = String(input.payerId || insurance.waystar_payer_id || '').trim();
    if (!payerId) throw new Error('No Waystar payerId. Map this payer in payerRouting or pass payerId.');

    const npi = digitsOnly(input.providerNpi || process.env.WAYSTAR_PROVIDER_NPI || process.env.OPTUM_PROVIDER_NPI || '1518305572', 10);
    const orgName = String(input.providerName || process.env.WAYSTAR_PROVIDER_NAME || process.env.OPTUM_PROVIDER_NAME || 'WELLBOUND LLC').trim();
    const memberId = String(insurance.member_id || input.memberId || '').trim();
    const firstName = String(patient.first_name || '').trim().toUpperCase();
    const lastName = String(patient.last_name || '').trim().toUpperCase();
    const dob = yyyymmdd(patient.dob || patient.date_of_birth);
    if (!firstName || !lastName) throw new Error('Patient first and last name are required.');
    if (dob.length !== 8) throw new Error('Patient DOB is required (YYYY-MM-DD).');
    if (!memberId) throw new Error('Insurance member ID is required for a Waystar check.');

    const dateOfService = digitsOnly(input.dateOfService, 8) || yyyymmdd(new Date().toISOString());

    const x12 = buildX12_270({
      senderId, payerId, payerName: input.payerName || insurance.payer_display_name || '',
      orgName, npi, memberId, firstName, lastName, dob, dateOfService,
    });

    pushLog(logs, 'info', 'Submitting Waystar 270', { gateway, payerId, npi, memberId });
    pushLog(logs, 'debug', 'X12 270 payload', x12);

    const form = new URLSearchParams({
      UserID: userId,
      Password: password,
      DataFormat: 'X12',
      ResponseType: responseType,
      Data: x12,
    });
    if (custId) form.set('CustID', custId);

    const res = await fetch(gateway, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const text = await res.text();

    pushLog(logs, res.ok ? 'ok' : 'error', `Waystar gateway HTTP ${res.status}`, { status: res.status });
    pushLog(logs, 'debug', 'Raw Waystar response', text.slice(0, 4000));

    const summary = summarize271(text);
    pushLog(logs, 'info', 'Parsed Waystar summary', summary);

    return {
      ok: res.ok && !summary.authFailure,
      clearinghouse: 'waystar',
      httpStatus: res.status,
      elapsedMs: Date.now() - started,
      request: { gateway, payerId, npi, memberId },
      response: text.slice(0, 20000),
      summary,
      logs,
      payerId,
    };
  } catch (err) {
    pushLog(logs, 'error', err.message || 'Waystar check failed');
    return {
      ok: false,
      clearinghouse: 'waystar',
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
