/**
 * Client → wellbound-api Optum eligibility proxy.
 * Secrets never leave the Lambda.
 */

const API_URL = import.meta.env.VITE_API_URL || '';

/** Wellbound LLC (primary) / Wellbound II LLC — CMS NPPES. */
export const WELLBOUND_ORG = Object.freeze({
  primary: { npi: '1518305572', name: 'WELLBOUND LLC' },
  wbii:    { npi: '1689308728', name: 'WELLBOUND II LLC' },
});

async function authHeader() {
  try {
    const token = typeof window !== 'undefined' && window.Clerk?.session
      ? await window.Clerk.session.getToken()
      : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

/**
 * @param {object} body - { patient, insurance, tradingPartnerServiceId?, providerNpi?, providerName?, serviceTypeCodes? }
 */
export async function runOptumEligibilityCheck(body) {
  if (!API_URL) throw new Error('VITE_API_URL is not configured');
  const headers = {
    'Content-Type': 'application/json',
    ...(await authHeader()),
  };
  const res = await fetch(`${API_URL}/eligibility/optum-check`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  // API returns 502 with a full result payload when Optum rejects — still useful.
  if (data && (data.logs || data.response || data.request)) return data;
  if (!res.ok) {
    throw new Error(data?.error?.message || `Optum check failed (${res.status})`);
  }
  return data;
}

export function guessPayerIdFromInsurance(insurance = {}) {
  const explicit = String(
    insurance.trading_partner_service_id
      || insurance.payer_id
      || insurance.clearinghouse_payer_id
      || '',
  ).trim();
  if (explicit) return explicit;
  const cat = String(insurance.insurance_category || '').toLowerCase();
  const name = String(insurance.payer_display_name || insurance.plan_name || insurance.commercial_plan_name || '').toLowerCase();
  if (cat.includes('medicare') || /\bmedicare\b/.test(name)) return 'CMS';
  if (cat.includes('medicaid') || /medicaid|epaces|emedny/.test(name)) return 'MCDNY';
  if (/united|uhc|optum/.test(name)) return '87726';
  if (/aetna/.test(name)) return '60054';
  if (/elder.?serve|riverspring/.test(name)) return '05178';
  if (/fidelis/.test(name)) return '11315';
  if (/healthfirst|hfny/.test(name)) return '80141';
  if (/empire|anthem|bcbs|blue cross|blue shield/.test(name)) return '00303';
  if (/cigna/.test(name)) return '62308';
  if (/humana/.test(name)) return '61101';
  return '';
}

/**
 * Member ID for the 270: insurance row first, then patient medicaid/medicare
 * numbers when the category matches.
 */
export function resolveMemberId({ insurance = {}, patient = {} } = {}) {
  const fromIns = String(insurance.member_id || '').trim();
  if (fromIns) return { memberId: fromIns, source: 'insurance.member_id' };

  const cat = String(insurance.insurance_category || '').toLowerCase();
  const name = String(insurance.payer_display_name || insurance.plan_name || '').toLowerCase();
  const medicaid = String(patient.medicaid_number || '').trim();
  const medicare = String(patient.medicare_number || '').trim();

  if ((cat.includes('medicaid') || /medicaid|epaces|emedny/.test(name)) && medicaid) {
    return { memberId: medicaid, source: 'patient.medicaid_number' };
  }
  if ((cat.includes('medicare') || /\bmedicare\b/.test(name)) && medicare) {
    return { memberId: medicare, source: 'patient.medicare_number' };
  }
  // Last resort: whichever patient ID we have
  if (medicaid) return { memberId: medicaid, source: 'patient.medicaid_number' };
  if (medicare) return { memberId: medicare, source: 'patient.medicare_number' };
  return { memberId: '', source: null };
}

/**
 * Pick Wellbound / Wellbound II NPI from referral division when present.
 * localStorage override wins if set (staff preference).
 */
export function resolveProviderOrg({ referral } = {}) {
  const storedNpi = typeof localStorage !== 'undefined'
    ? String(localStorage.getItem('wb_optum_provider_npi') || '').replace(/\D/g, '').slice(0, 10)
    : '';
  const storedName = typeof localStorage !== 'undefined'
    ? String(localStorage.getItem('wb_optum_provider_name') || '').trim()
    : '';

  const div = String(referral?.division || referral?.facility_setting || '').toLowerCase();
  const isWbii = /wbii|wellbound\s*ii|wellbound\s*2/.test(div);
  const org = isWbii ? WELLBOUND_ORG.wbii : WELLBOUND_ORG.primary;

  return {
    npi: storedNpi.length === 10 ? storedNpi : org.npi,
    name: storedName || org.name,
    defaultOrg: org,
    fromLocalStorage: storedNpi.length === 10,
  };
}

/** Build the full prefilled payload used by the Auto Check panel. */
export function buildOptumPrefill({ patient, insurance, referral } = {}) {
  const { memberId, source: memberSource } = resolveMemberId({ insurance, patient });
  const payerId = guessPayerIdFromInsurance(insurance);
  const provider = resolveProviderOrg({ referral });
  const firstName = String(patient?.first_name || '').trim();
  const lastName = String(patient?.last_name || '').trim();
  const dob = String(patient?.dob || patient?.date_of_birth || '').trim();
  const gender = String(patient?.gender || '').trim();

  const missing = [];
  if (!firstName || !lastName) missing.push('patient name');
  if (!dob) missing.push('DOB');
  if (!memberId) missing.push('member ID');
  if (!payerId) missing.push('payer / trading partner ID');
  if (!provider.npi || provider.npi.length !== 10) missing.push('provider NPI');

  return {
    payerId,
    memberId,
    memberSource,
    providerNpi: provider.npi,
    providerName: provider.name,
    firstName,
    lastName,
    dob,
    gender,
    groupNumber: String(insurance?.group_number || '').trim(),
    payerDisplayName: String(insurance?.payer_display_name || insurance?.plan_name || '').trim(),
    ready: missing.length === 0,
    missing,
  };
}
