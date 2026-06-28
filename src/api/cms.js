// CMS provider-verification lookups (NPI / PECOS / Order & Referring).
//
// Both upstreams are FREE and require NO API key. They don't send browser CORS
// headers, so:
//   - In dev,  we go through Vite's proxy (/cms-proxy/* → CMS) — see vite.config.js
//   - In prod, we go through the Cloudflare worker (VITE_CMS_WORKER_URL = worker-cms)
//
// Endpoints:
//   NPPES NPI Registry:        GET /npi/?version=2.1&number={npi}
//   Order & Referring dataset: GET /data/dataset/{id}/data?filter[...]=NPI={npi}

const BASE = import.meta.env.DEV ? '/cms-proxy' : import.meta.env.VITE_CMS_WORKER_URL;

// CMS "Order and Referring" public dataset (Medicare providers eligible to
// order/refer — the PECOS-derived list). https://data.cms.gov/provider-characteristics
const ORDER_REFERRING_DATASET = 'c99b5865-1119-4436-bb80-c5af2773ea1f';

const ORDER_REFER_FLAG_KEYS = ['PARTB', 'DME', 'HHA', 'HOSPICE', 'PMD'];

function normalizeNpi(npi) {
  return String(npi || '').replace(/\D/g, '');
}

function isTruthyFlag(v) {
  if (v === true) return true;
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'y' || s === 'yes' || s === 'true' || s === '1';
}

/** Raw NPPES lookup. Returns the parsed NPPES response ({ result_count, results }). */
export async function lookupNpi(npi) {
  const clean = normalizeNpi(npi);
  const res = await fetch(`${BASE}/npi/?version=2.1&number=${clean}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`NPPES lookup failed (${res.status})`);
  return res.json();
}

/** Raw Order & Referring dataset lookup by NPI. Returns an array of matching rows. */
export async function lookupOrderRefer(npi) {
  const clean = normalizeNpi(npi);
  const params = new URLSearchParams();
  params.set('filter[condition][path]', 'NPI');
  params.set('filter[condition][operator]', '=');
  params.set('filter[condition][value]', clean);
  const res = await fetch(`${BASE}/data/dataset/${ORDER_REFERRING_DATASET}/data?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Order & Referring lookup failed (${res.status})`);
  const body = await res.json();
  return Array.isArray(body) ? body : (body?.data || []);
}

/**
 * One-click verification: runs both lookups and returns a normalized status
 * object. Pure data — the caller persists it to the Physician record.
 *
 * @returns {{
 *   npi: string, npiStatus: 'active'|'deactivated'|'not_found',
 *   providerName: string, pecosEnrolled: boolean, opraEligible: boolean,
 *   flags: Record<string, boolean>, details: object|null, checkedAt: string
 * }}
 */
export async function verifyPhysicianNpi(npi) {
  const clean = normalizeNpi(npi);
  if (clean.length !== 10) {
    throw new Error('A valid 10-digit NPI is required to run verification.');
  }

  const [npiData, orRows] = await Promise.all([
    lookupNpi(clean),
    lookupOrderRefer(clean).catch(() => []), // dataset hiccup shouldn't kill the NPI result
  ]);

  // ── NPI status (NPPES) ────────────────────────────────────────────────────
  const result = npiData?.results?.[0] || null;
  const basic = result?.basic || {};
  const found = (npiData?.result_count || 0) > 0 && !!result;
  const deactivated = !!basic.deactivation_date && !basic.reactivation_date;
  const npiStatus = !found ? 'not_found' : deactivated ? 'deactivated' : 'active';
  const providerName = result
    ? (basic.organization_name
        || [basic.first_name, basic.last_name].filter(Boolean).join(' ')
        || '')
    : '';

  // Expandable NPPES record detail (surfaced in the verification panel).
  const details = result ? {
    number: result.number || clean,
    enumeration_type: result.enumeration_type || '',   // NPI-1 (individual) / NPI-2 (org)
    first_name: basic.first_name || '',
    last_name: basic.last_name || '',
    organization_name: basic.organization_name || '',
    credential: basic.credential || '',
    gender: basic.gender || '',
    status: basic.status || '',                         // A (active) / D (deactivated)
    enumeration_date: basic.enumeration_date || '',
    last_updated: basic.last_updated || '',
    sole_proprietor: basic.sole_proprietor || '',
  } : null;

  // ── PECOS / Order & Referring (data.cms.gov) ──────────────────────────────
  const row = orRows[0] || null;
  const pecosEnrolled = orRows.length > 0; // present in the Medicare order/refer file
  const flags = {};
  if (row) for (const k of ORDER_REFER_FLAG_KEYS) flags[k] = isTruthyFlag(row[k]);
  const opraEligible = Object.values(flags).some(Boolean); // eligible to order/refer

  return {
    npi: clean,
    npiStatus,
    providerName,
    pecosEnrolled,
    opraEligible,
    flags,
    details,
    checkedAt: new Date().toISOString(),
  };
}
