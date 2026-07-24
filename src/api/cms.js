// CMS provider-verification lookups (NPI / PECOS / Order & Referring).
//
// Both upstreams are FREE and require NO API key. They don't send browser CORS
// headers, so:
//   - In dev,  we go through Vite's proxy (/cms-proxy/* → CMS) — see vite.config.js
//   - In prod, we go through the Cloudflare worker (VITE_CMS_WORKER_URL = worker-cms)
//
// Endpoints:
//   NPPES NPI Registry:        GET /npi/?version=2.1&number={npi}
//                             GET /npi/?version=2.1&first_name=&last_name=&state=
//   Order & Referring dataset: GET /data/dataset/{id}/data?filter[...]=NPI={npi}

import { normalizePhysicianTitle } from '../utils/physicianName.js';

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

function titleCaseName(s) {
  return String(s || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function pickLocationAddress(result) {
  const addrs = result?.addresses || [];
  return addrs.find((a) => a.address_purpose === 'LOCATION') || addrs[0] || {};
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

/**
 * NPPES name search (individuals). Returns up to `limit` compact result cards
 * for the create-physician wizard.
 */
export async function searchNpiProviders({ firstName, lastName, state = 'NY', limit = 12 } = {}) {
  const first = String(firstName || '').trim();
  const last = String(lastName || '').trim();
  if (!last || last.length < 2) {
    throw new Error('Enter at least a last name (2+ characters) to search NPPES.');
  }
  const params = new URLSearchParams({
    version: '2.1',
    last_name: last,
    limit: String(Math.min(Math.max(limit, 1), 50)),
    enumeration_type: 'NPI-1',
  });
  if (first) params.set('first_name', first);
  const st = String(state || '').trim().toUpperCase();
  if (st.length === 2) params.set('state', st);

  const res = await fetch(`${BASE}/npi/?${params.toString()}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`NPPES search failed (${res.status})`);
  const body = await res.json();
  const results = body?.results || [];
  return results.map((result) => {
    const basic = result.basic || {};
    const loc = pickLocationAddress(result);
    const title = normalizePhysicianTitle(basic.credential);
    const first_name = titleCaseName(basic.first_name);
    const last_name = titleCaseName(basic.last_name);
    return {
      npi: String(result.number || ''),
      first_name,
      last_name,
      title,
      label: [first_name, last_name].filter(Boolean).join(' ') + (title ? `, ${title}` : ''),
      city: titleCaseName(loc.city) || '',
      state: String(loc.state || '').toUpperCase(),
      taxonomy: (result.taxonomies || []).find((t) => t.primary)?.desc
        || (result.taxonomies || [])[0]?.desc
        || '',
    };
  });
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
    // Raw NPPES result kept for seed builders (addresses live here).
    _result: result,
  };
}

/**
 * Full create-form seed from CMS: NPPES identity/address/phone + PECOS/OPRA.
 * Used by the Physicians directory "Add" wizard.
 *
 * @returns form fields ready to merge into AddPhysicianModal state, plus
 *          verification fields to persist on create.
 */
export async function buildPhysicianSeedFromNpi(npi) {
  const verified = await verifyPhysicianNpi(npi);
  if (verified.npiStatus === 'not_found' || !verified._result) {
    throw new Error(`No NPPES record found for NPI ${verified.npi}.`);
  }
  const result = verified._result;
  const basic = result.basic || {};
  const loc = pickLocationAddress(result);
  const title = normalizePhysicianTitle(basic.credential || verified.details?.credential);
  const phone = String(loc.telephone_number || '').replace(/\D/g, '').slice(0, 10);
  const fax = String(loc.fax_number || '').replace(/\D/g, '').slice(0, 10);
  const zip = String(loc.postal_code || '').replace(/\D/g, '').slice(0, 5);
  const taxonomy = (result.taxonomies || []).find((t) => t.primary)?.desc
    || (result.taxonomies || [])[0]?.desc
    || '';

  return {
    form: {
      first_name: titleCaseName(basic.first_name),
      last_name: titleCaseName(basic.last_name),
      title,
      npi: verified.npi,
      phone,
      fax,
      address_street: titleCaseName(loc.address_1),
      address_city: titleCaseName(loc.city),
      address_state: String(loc.state || '').toUpperCase(),
      address_zip: zip,
      is_pecos_enrolled: !!verified.pecosEnrolled,
      is_opra_enrolled: !!verified.opraEligible,
    },
    verification: {
      npi_status: verified.npiStatus,
      npi_checked_at: verified.checkedAt,
      npi_provider_name: verified.providerName || '',
      npi_details: verified.details ? JSON.stringify(verified.details) : '',
      is_pecos_enrolled: verified.pecosEnrolled ? true : null,
      pecos_last_checked: verified.checkedAt,
      is_opra_enrolled: verified.opraEligible ? true : null,
      opra_last_checked: verified.checkedAt,
      order_refer_flags: JSON.stringify(verified.flags || {}),
      verification_last_run_at: verified.checkedAt,
    },
    meta: {
      npiStatus: verified.npiStatus,
      pecosEnrolled: verified.pecosEnrolled,
      opraEligible: verified.opraEligible,
      taxonomy,
      providerName: verified.providerName,
      checkedAt: verified.checkedAt,
    },
  };
}
