#!/usr/bin/env node
/**
 * Seed historical SPN intake cases from the pre-CRM spreadsheet.
 *
 * Does NOT create marketers, payers, or referral-source directory rows.
 * Unmatched directory fields fall back to null / src_unknown, or the row
 * is dropped when required fields cannot be recovered cleanly.
 *
 * Usage:
 *   node scripts/seed-pre-crm-intake-cases.js [jsonPath]           # dry-run
 *   node scripts/seed-pre-crm-intake-cases.js [jsonPath] --confirm  # write
 *
 * Env: WB_CLUSTER_ARN, WB_SECRET_ARN, WB_DATABASE (default wellbound), AWS creds.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';
import zipcodes from 'zipcodes';
import { normalizePersonNameFields } from '../src/utils/personName.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  for (const line of readFileSync(resolve(__dirname, '..', '.env'), 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
} catch { /* no .env */ }

const CONFIRM = process.argv.includes('--confirm');
const jsonPath = process.argv.slice(2).find((a) => a && !a.startsWith('--'))
  || '/Users/RBaridesWellbound/Desktop/Carestream_case_upload_08.13.26.json';

const IMPORT_TAG = 'pre-crm-import-2026-08-13';
const UNKNOWN_SOURCE_ID = 'src_unknown';
const WB_ID = 'ent_001';
const WBII_ID = 'ent_002';
const WBII_ONLY = new Set(['Putnam', 'Westchester']);

const resourceArn = process.env.WB_CLUSTER_ARN;
const secretArn = process.env.WB_SECRET_ARN;
const database = process.env.WB_DATABASE || 'wellbound';
if (!resourceArn || !secretArn) {
  console.error('Set WB_CLUSTER_ARN and WB_SECRET_ARN');
  process.exit(1);
}

const client = new RDSDataClient({ region: process.env.AWS_REGION || 'us-east-2' });

async function exec(sql, parameters) {
  return client.send(new ExecuteStatementCommand({
    resourceArn, secretArn, database, sql, parameters, includeResultMetadata: true,
  }));
}

function rowsFrom(res) {
  const cols = (res.columnMetadata || []).map((c) => c.name);
  return (res.records || []).map((row) => {
    const o = {};
    row.forEach((c, i) => {
      o[cols[i]] = c.stringValue ?? c.longValue ?? c.booleanValue ?? c.doubleValue
        ?? (c.isNull ? null : JSON.stringify(c));
    });
    return o;
  });
}

function str(name, value) {
  if (value == null || value === '') return { name, value: { isNull: true } };
  return { name, value: { stringValue: String(value) } };
}
function bool(name, value) {
  if (value == null) return { name, value: { isNull: true } };
  return { name, value: { booleanValue: Boolean(value) } };
}

function rand(n = 4) {
  return Math.random().toString(36).slice(2, 2 + n);
}
function makeIds(prefix) {
  const stamp = Date.now();
  return {
    biz: `${prefix}_${stamp}_${rand(4)}`,
    rec: `rec${crypto.randomBytes(8).toString('hex')}`,
  };
}

function nk(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function compact(s) {
  return nk(s).replace(/\s+/g, '');
}

function titleStreet(raw) {
  let s = String(raw || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  s = s.replace(/,+\s*$/, '');
  return s.split(' ').map((tok) => {
    if (/^\d/.test(tok)) return tok.toUpperCase();
    const lower = tok.toLowerCase();
    if (['st', 'st.', 'ave', 'ave.', 'rd', 'rd.', 'blvd', 'blvd.', 'dr', 'dr.', 'ln', 'ln.', 'ct', 'pl', 'pkwy', 'fl', 'apt', 'unit'].includes(lower.replace(/\./g, ''))) {
      return lower.replace(/\./g, '').charAt(0).toUpperCase() + lower.replace(/\./g, '').slice(1);
    }
    if (/^(th|st|nd|rd)$/i.test(tok)) return tok.toLowerCase();
    return tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase();
  }).join(' ');
}

function parseName(raw) {
  let s = String(raw || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  let first;
  let last;
  if (s.includes(',')) {
    const [leftRaw, ...rest] = s.split(',');
    const left = leftRaw.trim();
    const right = rest.join(' ').replace(/,+$/g, '').trim();
    if (!left || !right) return null;
    const leftCaps = left === left.toUpperCase() && /[A-Z]/.test(left);
    // Mixed-case "Ava, Ianelli" is First, Last; ALL-CAPS "ANDERSON, ZAVION" is Last, First.
    if (!leftCaps && left.split(/\s+/).length === 1 && right.split(/\s+/).length === 1) {
      first = left;
      last = right;
    } else {
      last = left;
      first = right;
    }
  } else {
    const parts = s.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return null;
    last = parts.pop();
    first = parts.join(' ');
  }
  const named = normalizePersonNameFields({ first_name: first, last_name: last });
  if (!named.first_name || !named.last_name) return null;
  return named;
}

function ageGroup(raw) {
  const s = nk(raw);
  if (!s) return null;
  if (s === 'asn' || s === 'adult' || s.includes('adult')) return 'Adult';
  if (s === 'peds' || s === 'pediatric' || s.includes('ped')) return 'Pediatric';
  return null;
}

function flagOn(v) {
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  if (!s || s === 'null' || s === 'n' || s === 'no') return false;
  return true;
}

function servicesFrom(row) {
  const out = [];
  for (const svc of ['PT', 'OT', 'ST', 'HHA', 'ABA']) {
    if (flagOn(row[svc])) out.push(svc);
  }
  return out;
}

function zip5(raw) {
  if (raw == null || raw === '') return '';
  const s = String(raw).trim();
  if (s.toUpperCase() === 'NY') return '';
  const digits = s.replace(/\.0$/, '').replace(/\D/g, '');
  if (digits.length === 5) return digits;
  if (digits.length === 4) return digits.padStart(5, '0');
  return '';
}

function countyFromZip(zip, city) {
  const z = String(zip || '');
  const c = nk(city);
  if (z.startsWith('104') || c === 'bronx') return 'Bronx';
  if (z.startsWith('112') || c === 'brooklyn') return 'Kings';
  if (z.startsWith('103') || c.includes('staten')) return 'Richmond';
  if (z.startsWith('100') || z.startsWith('101') || z.startsWith('102')
    || c === 'manhattan' || c === 'new york') return 'New York';
  if (z.startsWith('111') || z.startsWith('113') || z.startsWith('114') || z.startsWith('116')
    || c === 'queens') return 'Queens';
  if (z.startsWith('115')) return 'Nassau';
  if (z.startsWith('117') || z.startsWith('118') || z.startsWith('119')) return 'Suffolk';
  if (z.startsWith('105') || z.startsWith('106') || z.startsWith('107') || z.startsWith('108')) {
    const putnam = new Set(['10509', '10512', '10516', '10524', '10537', '10541', '10542', '10579']);
    return putnam.has(z) ? 'Putnam' : 'Westchester';
  }
  return null;
}

function entityForCounty(county) {
  if (WBII_ONLY.has(county)) return WBII_ID;
  return WB_ID;
}

function resolveCityZip(row) {
  let zip = zip5(row.Zip);
  let sheetCity = String(row.City || '').replace(/\u00a0/g, ' ').trim();
  if (sheetCity === '#VALUE!' || /^ny$/i.test(sheetCity)) sheetCity = '';

  // 4923 8th Ave Brooklyn was typed as 10220 (invalid); 11220 is Sunset Park.
  if (zip === '10220' && /brooklyn/i.test(sheetCity || '')) zip = '11220';

  const looked = zip ? zipcodes.lookup(zip) : null;
  const cityFromZip = looked?.city || '';
  const state = looked?.state || 'NY';

  const junkCity = !sheetCity || /^(queens|bronx|brooklyn|manhattan|new york|long island|ny)$/i.test(sheetCity);
  const city = (!junkCity ? titleStreet(sheetCity) : null) || cityFromZip || titleStreet(sheetCity) || '';

  let street = titleStreet(row.Address);
  if (street && city) {
    const re = new RegExp(`,\\s*${city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    street = street.replace(re, '').trim();
  }

  const county = countyFromZip(zip, city || sheetCity);
  return { zip, city, state, street, county, zipKnown: Boolean(looked) };
}

const MCO_PAYERS = new Set([
  'Healthfirst', 'Fidelis Care', 'MetroPlus Health Plan', 'UnitedHealthcare Community Plan',
  'HIP', 'Molina Healthcare', 'Aetna Better Health', 'Anthem BCBS',
]);

function mapInsurance(raw) {
  const original = raw == null ? '' : String(raw).trim();
  if (!original) return { plans: [], note: null };
  let lower = nk(original);
  if (lower === 'pending') return { plans: [], note: 'Insurance listed as pending' };

  lower = lower
    .replace(/straight medicaid/g, 'medicaid')
    .replace(/health first/g, 'healthfirst')
    .replace(/united health care/g, 'uhc')
    .replace(/unitedhealthcare/g, 'uhc')
    .replace(/metro plus/g, 'metroplus')
    .replace(/group health/g, 'ghi')
    .replace(/3rd party/g, 'thirdparty')
    .replace(/third party/g, 'thirdparty')
    .replace(/no mcd/g, 'nomcd')
    .replace(/no medicaid/g, 'nomcd')
    .replace(/hip mmc/g, 'hip')
    .replace(/hip mcd/g, 'hip')
    .replace(/anthem hmo/g, 'anthem')
    .replace(/ebcb[- ]?hmo/g, 'empire');

  const parts = lower.split(/[^a-z0-9]+/).filter(Boolean);

  const plans = [];
  const skipNotes = [];
  let sawMedicaidCue = false;
  let sawNoMcd = false;

  for (const p of parts) {
    if (['inactive', 'nomcd'].includes(p)) {
      if (p === 'nomcd') sawNoMcd = true;
      continue;
    }
    if (['thirdparty', 'sm', '3rd'].includes(p)) {
      skipNotes.push(`unmapped fragment "${p}"`);
      continue;
    }
    if (['medicaid', 'mcd', 'medc'].includes(p)) {
      sawMedicaidCue = true;
      plans.push({ payer: 'Medicaid', category: 'medicaid' });
      continue;
    }
    if (['medicare', 'mdc'].includes(p)) {
      plans.push({ payer: 'Medicare', category: 'medicare' });
      continue;
    }
    if (['hf', 'healthfirst'].includes(p)) {
      plans.push({ payer: 'Healthfirst', category: 'medicaid_managed' });
      continue;
    }
    if (p === 'ghi') {
      plans.push({ payer: 'GHI', category: 'commercial' });
      continue;
    }
    if (p === 'anthem') {
      plans.push({ payer: 'Anthem BCBS', category: 'commercial' });
      continue;
    }
    if (p === 'aetna') {
      plans.push({ payer: 'Aetna', category: 'commercial' });
      continue;
    }
    if (p === 'empire') {
      plans.push({ payer: 'Empire BlueCross BlueShield', category: 'commercial' });
      continue;
    }
    if (p === 'hip') {
      plans.push({ payer: 'HIP', category: 'medicaid_managed' });
      continue;
    }
    if (p === 'metroplus' || p === 'metro') {
      plans.push({ payer: 'MetroPlus Health Plan', category: 'medicaid_managed' });
      continue;
    }
    if (p === 'molina') {
      plans.push({ payer: 'Molina Healthcare', category: 'medicaid_managed' });
      continue;
    }
    if (p === 'fidelis') {
      plans.push({ payer: 'Fidelis Care', category: 'medicaid_managed' });
      continue;
    }
    if (p === 'bcbs') {
      plans.push({ payer: 'Anthem BCBS', category: 'commercial' });
      continue;
    }
    if (p === 'cigna') {
      plans.push({ payer: 'Cigna', category: 'commercial' });
      continue;
    }
    if (p.includes('seiu')) {
      plans.push({ payer: '1199SEIU National Benefit Fund', category: 'commercial' });
      continue;
    }
    if (p === 'uhc' || p.includes('united')) {
      plans.push({ payer: 'UnitedHealthcare', category: 'commercial' });
      continue;
    }
    skipNotes.push(`unmapped fragment "${p}"`);
  }

  // Deduplicate by payer
  const seen = new Set();
  let out = [];
  for (const pl of plans) {
    if (seen.has(pl.payer)) continue;
    seen.add(pl.payer);
    out.push(pl);
  }

  // "Aetna / Medicaid" and "UHC / Medicaid" mean the MCO product, not two payers.
  if (sawMedicaidCue && !sawNoMcd) {
    out = out.map((pl) => {
      if (pl.payer === 'Aetna') return { payer: 'Aetna Better Health', category: 'medicaid_managed' };
      if (pl.payer === 'UnitedHealthcare') return { payer: 'UnitedHealthcare Community Plan', category: 'medicaid_managed' };
      if (pl.payer === 'Anthem BCBS') return { payer: 'Anthem BCBS', category: 'medicaid_managed' };
      return pl;
    });
    const hasMco = out.some((pl) => MCO_PAYERS.has(pl.payer));
    if (hasMco) out = out.filter((pl) => pl.payer !== 'Medicaid');
  }

  // Re-dedupe after MCO rewrite
  const seen2 = new Set();
  out = out.filter((pl) => {
    if (seen2.has(pl.payer)) return false;
    seen2.add(pl.payer);
    return true;
  });

  return {
    plans: out,
    note: skipNotes.length ? `Original insurance "${original}" (${skipNotes.join('; ')})` : null,
  };
}

const ORG_ALIASES = {
  'care design ny': 'Care Design NY',
  'care design': 'Care Design NY',
  'caredesign': 'Care Design NY',
  'care designs': 'Care Design NY',
  'care designs ny': 'Care Design NY',
  'aca': 'Advance Care Alliance',
  'advance care alliance': 'Advance Care Alliance',
  'advance care allaince': 'Advance Care Alliance',
  'advance care designs': 'Advance Care Alliance',
  'anchor hc': 'Anchor HC',
  'anchor home care': 'Anchor HC',
  'boulevard homecare associates': 'Boulevard Homecare Associates',
  'boulevard homecare': 'Boulevard Homecare Associates',
  'high standard home care': 'High Standard Home Care',
  'highstandard': 'High Standard Home Care',
  'human care': 'Human Care NY',
  'human care ny': 'Human Care NY',
  'tri county care': 'Tri-County Care',
  'tri county': 'Tri-County Care',
  'ez living hc': 'EZ Living Home Care',
  'ez living home care': 'EZ Living Home Care',
  'welcome care': 'Welcome Care',
  'parent to parent': 'Parent to Parent',
  'rebecca school': 'Rebecca School',
  'hamaspik hc': 'Hamaspik HC',
  'crown care hc': 'Crown Care HC',
  'nyhc': 'New York Health Care',
  'new york health care': 'New York Health Care',
  'wellbound roc': 'Wellbound (Readmit)',
  'wellbound readmit': 'Wellbound (Readmit)',
};

const METHOD_ALIASES = {
  'phone call': 'Call-In',
  'call in': 'Call-In',
  'callin': 'Call-In',
  'fax': 'Fax',
  'web': 'Website',
  'web lead': 'Website',
  'website': 'Website',
  'wellbound email submission': 'Email',
  'call in word of mouth': 'Word of Mouth',
  'word of mouth': 'Word of Mouth',
};

const CONTACT_TYPOS = {
  'michlle lovell': 'michelle lovell',
  'stella eseele': 'stella esele',
  'gabriela burgos': 'gabriella burgos',
  'afriye scott': 'afriyie scott',
};

function cleanPersonLabel(raw) {
  let s = String(raw || '').replace(/\u00a0/g, ' ');
  s = s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, ' ');
  s = s.replace(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, ' ');
  s = s.replace(/[\n\r]+/g, ' ');
  s = s.replace(/[,/]+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function firstToken(s) {
  return nk(s).split(' ')[0] || '';
}

function matchSource({ orgRaw, contactRaw, sources }) {
  const notes = [];
  const orgNk = nk(orgRaw);
  const contactClean = cleanPersonLabel(contactRaw);
  const contactNk = nk(CONTACT_TYPOS[nk(contactClean)] || contactClean);

  const methodFromOrg = METHOD_ALIASES[orgNk] || null;
  const methodFromContact = METHOD_ALIASES[nk(contactClean)] || null;
  const method = methodFromOrg || methodFromContact || '';

  let orgCanonical = ORG_ALIASES[orgNk] || null;
  if (!orgCanonical && orgNk) {
    // Direct equality against known source_entity values
    const entHit = sources.find((s) => nk(s.source_entity) === orgNk);
    if (entHit) orgCanonical = entHit.source_entity;
  }

  // Person stuffed into the org column (Cheyenne Wilson, Gabrielle Allen, David K)
  let personFromOrg = '';
  if (!orgCanonical && !methodFromOrg && orgRaw) {
    const personish = cleanPersonLabel(String(orgRaw).split(',')[0]);
    if (personish && personish.split(' ').length <= 4 && /[a-z]/i.test(personish)) {
      personFromOrg = personish;
    }
  }

  const contact = contactNk && !METHOD_ALIASES[contactNk] && !['mom called', 'brooklyn contacts', 'noelia', 'david k'].includes(contactNk)
    ? contactNk
    : '';
  const personQuery = contact || nk(personFromOrg);

  const orgPool = orgCanonical
    ? sources.filter((s) => nk(s.source_entity) === nk(orgCanonical) || ORG_ALIASES[nk(s.source_entity)] === orgCanonical)
    : sources;

  function pickByName(pool, q) {
    if (!q) return [];
    const exact = pool.filter((s) => nk(s.name) === q);
    if (exact.length) return exact;
    // Unique first-name within pool (GAIL, JINELL, MARIA)
    if (q.split(' ').length === 1) {
      const fn = pool.filter((s) => firstToken(s.name) === q);
      return fn;
    }
    // Starts-with first+last
    const parts = q.split(' ');
    if (parts.length >= 2) {
      const hits = pool.filter((s) => {
        const sn = nk(s.name);
        return sn.startsWith(q) || q.startsWith(sn);
      });
      if (hits.length) return hits;
    }
    return [];
  }

  if (personQuery) {
    const scoped = pickByName(orgCanonical ? orgPool : sources, personQuery);
    if (scoped.length === 1) {
      return { id: scoped[0].id, method, label: `${scoped[0].name} @ ${scoped[0].source_entity || '—'}`, notes };
    }
    if (scoped.length > 1) {
      const withOrg = orgCanonical
        ? scoped.filter((s) => nk(s.source_entity) === nk(orgCanonical))
        : scoped.filter((s) => s.source_entity);
      const pool = withOrg.length ? withOrg : scoped;
      const uniqueNames = new Set(pool.map((s) => nk(s.name)));
      if (uniqueNames.size === 1) {
        const active = pool.find((s) => String(s.is_active).toUpperCase() === 'TRUE') || pool[0];
        return { id: active.id, method, label: `${active.name} @ ${active.source_entity || '—'}`, notes };
      }
      if (pool.length === 1) {
        return { id: pool[0].id, method, label: `${pool[0].name} @ ${pool[0].source_entity || '—'}`, notes };
      }
      notes.push(`ambiguous contact "${contactRaw || orgRaw}"`);
      return { id: UNKNOWN_SOURCE_ID, method, label: 'Unknown', notes };
    }
    // Try global if we scoped to org and missed
    if (orgCanonical) {
      const global = pickByName(sources, personQuery);
      if (global.length === 1) {
        return { id: global[0].id, method, label: `${global[0].name} @ ${global[0].source_entity || '—'}`, notes };
      }
    }
    notes.push(`unmatched contact "${contactRaw || personFromOrg}"`);
  }

  // Event rows stored as the source name (Manhattan ddc 2026)
  if (orgNk && !methodFromOrg) {
    const byName = sources.filter((s) => nk(s.name) === orgNk);
    if (byName.length >= 1) {
      const active = byName.find((s) => String(s.is_active).toUpperCase() === 'TRUE' || s.is_active === true) || byName[0];
      return { id: active.id, method, label: active.name, notes };
    }
    if (/ddc|dd council|brooklyn contacts/i.test(orgRaw || '')) {
      const brooklyn = sources.find((s) => /brooklyn dd council/i.test(s.source_entity || ''));
      if (brooklyn && /brooklyn/i.test(orgRaw)) {
        return { id: brooklyn.id, method, label: `${brooklyn.name} @ ${brooklyn.source_entity}`, notes };
      }
      notes.push(`unmatched event "${orgRaw}"`);
    }
  }

  if (orgCanonical && !personQuery) {
    notes.push(`org "${orgCanonical}" with no contact — using Unknown`);
  } else if (orgRaw && !orgCanonical && !methodFromOrg && !personFromOrg) {
    notes.push(`unmatched org "${orgRaw}"`);
  }

  return { id: UNKNOWN_SOURCE_ID, method, label: 'Unknown', notes };
}

function matchMarketer(raw, marketers) {
  const s = nk(raw);
  if (!s || s === 'adult transition' || s === 'mom call directly') return { id: null, label: null };
  const hits = marketers.filter((m) => {
    const full = nk(`${m.first_name} ${m.last_name}`);
    const first = nk(m.first_name);
    const last = nk(m.last_name);
    if (s === full || s === `${first} ${last.charAt(0)}`) return true;
    if (s === first || s.startsWith(first + ' ')) return true;
    if (s === last) return true;
    return false;
  });
  // Prefer SN marketers when first-name only (David, Janay, Noelia)
  if (hits.length === 1) return { id: hits[0].id, label: `${hits[0].first_name} ${hits[0].last_name}` };
  if (hits.length > 1) {
    const sn = hits.filter((m) => (m.division || '') === 'SN');
    if (sn.length === 1) return { id: sn[0].id, label: `${sn[0].first_name} ${sn[0].last_name}` };
  }
  return { id: null, label: null, unmatched: raw };
}

function matchOwner(raw, users) {
  const s = nk(raw);
  if (!s) return null;
  const hits = users.filter((u) => nk(`${u.first_name} ${u.last_name}`) === s);
  if (hits.length === 1) return hits[0];
  const loose = users.filter((u) => compact(`${u.first_name}${u.last_name}`) === compact(s));
  if (loose.length === 1) return loose[0];
  return null;
}

async function main() {
  const sheet = JSON.parse(readFileSync(jsonPath, 'utf8'));
  console.log(`Sheet: ${jsonPath} (${sheet.length} rows)`);

  const marketers = rowsFrom(await exec(
    `SELECT id, first_name, last_name, status, division FROM marketers WHERE status ILIKE 'active'`,
  ));
  const users = rowsFrom(await exec(
    `SELECT id, first_name, last_name, status FROM users`,
  ));
  const sources = rowsFrom(await exec(
    `SELECT id, name, type, COALESCE(source_entity,'') AS source_entity, is_active FROM referral_sources`,
  ));
  const existingPats = rowsFrom(await exec(
    `SELECT id, rec_id, first_name, last_name, address_zip FROM patients`,
  ));

  const keep = [];
  const drop = [];
  const seenKeys = new Set();

  sheet.forEach((row, index) => {
    const named = parseName(row.Name);
    if (!named) {
      drop.push({ index, name: row.Name, reason: 'unparseable name' });
      return;
    }

    const snAge = ageGroup(row['CASE TYPE']);
    if (!snAge) {
      drop.push({ index, name: row.Name, reason: 'missing/unmapped case type (need Adult vs Pediatric)' });
      return;
    }

    const geo = resolveCityZip(row);
    if (row.Zip && zip5(row.Zip) && !geo.zipKnown && zip5(row.Zip) !== '10220') {
      drop.push({ index, name: row.Name, reason: `unknown zip ${row.Zip}` });
      return;
    }
    if (!geo.county) {
      drop.push({ index, name: row.Name, reason: 'could not derive county' });
      return;
    }

    const owner = matchOwner(row['Intake Coordinator'], users);
    if (!owner) {
      drop.push({ index, name: row.Name, reason: `unmatched intake coordinator "${row['Intake Coordinator']}"` });
      return;
    }

    const key = `${compact(named.first_name)}|${compact(named.last_name)}|${geo.zip || ''}`;
    const nameKey = `${compact(named.first_name)}|${compact(named.last_name)}`;
    const dup = existingPats.filter((p) => (
      compact(p.first_name) === compact(named.first_name)
      && compact(p.last_name) === compact(named.last_name)
      && (!geo.zip || !p.address_zip || String(p.address_zip) === geo.zip)
    ));
    if (dup.length) {
      drop.push({
        index, name: row.Name, reason: `already in CRM (${dup.map((d) => d.id).join(', ')})`,
      });
      return;
    }
    if (seenKeys.has(nameKey)) {
      drop.push({ index, name: row.Name, reason: 'duplicate name in this sheet' });
      return;
    }
    seenKeys.add(nameKey);

    const mkt = matchMarketer(row.Marketer, marketers);
    // Never create marketers. Unknown labels stay null rather than dropping the case.

    const src = matchSource({
      orgRaw: row['Referral source'],
      contactRaw: row['Referral Contact'],
      sources,
    });

    const ins = mapInsurance(row.Insurance);
    const services = servicesFrom(row);
    const date = String(row.Date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      drop.push({ index, name: row.Name, reason: `bad referral date "${row.Date}"` });
      return;
    }

    const episodeType = /roc/i.test(String(row['Referral source'] || '')) ? 'ROC' : 'SOC';
    const entityId = entityForCounty(geo.county);

    const noteBits = [
      `[[${IMPORT_TAG}]] Historical intake import from pre-CRM log.`,
      `Original referral date: ${date}.`,
    ];
    if (src.notes.length) noteBits.push(`Source notes: ${src.notes.join('; ')}.`);
    if (row['Referral source'] && src.id === UNKNOWN_SOURCE_ID) {
      noteBits.push(`Original referral entity: ${row['Referral source']}.`);
    }
    if (row['Referral Contact'] && src.id === UNKNOWN_SOURCE_ID) {
      noteBits.push(`Original referral contact: ${row['Referral Contact']}.`);
    }
    if (ins.note) noteBits.push(ins.note + '.');
    if (row.Insurance && !ins.plans.length) {
      noteBits.push(`Original insurance (not mapped): ${row.Insurance}.`);
    }

    keep.push({
      index,
      originalName: row.Name,
      first_name: named.first_name,
      last_name: named.last_name,
      sn_age_group: snAge,
      date,
      street: geo.street,
      city: geo.city,
      state: geo.state,
      zip: geo.zip || null,
      county: geo.county,
      entity_id: entityId,
      entity_label: entityId === WBII_ID ? 'WBII' : 'WB',
      marketer_id: mkt.id,
      marketer_label: mkt.label,
      intake_owner_id: owner.id,
      intake_owner_label: `${owner.first_name} ${owner.last_name}`.replace(/\s+/g, ' '),
      referral_source_id: src.id,
      source_label: src.label,
      referral_method: src.method || null,
      episode_type: episodeType,
      services,
      plans: ins.plans,
      note: noteBits.join(' '),
      sheet: {
        insurance: row.Insurance,
        org: row['Referral source'],
        contact: row['Referral Contact'],
        marketer: row.Marketer,
      },
    });
  });

  const preview = {
    keepCount: keep.length,
    dropCount: drop.length,
    drop,
    keep: keep.map((k) => ({
      name: `${k.first_name} ${k.last_name}`,
      from: k.originalName,
      age: k.sn_age_group,
      date: k.date,
      city: k.city,
      zip: k.zip,
      county: k.county,
      entity: k.entity_label,
      marketer: k.marketer_label,
      owner: k.intake_owner_label,
      source: k.source_label,
      method: k.referral_method,
      episode: k.episode_type,
      services: k.services,
      plans: k.plans.map((p) => p.payer),
      unknownSource: k.referral_source_id === UNKNOWN_SOURCE_ID,
    })),
  };

  const outPath = resolve(__dirname, 'seed-pre-crm-intake-preview.json');
  writeFileSync(outPath, JSON.stringify(preview, null, 2));

  console.log(`\nKeep ${keep.length}  |  Drop ${drop.length}`);
  console.log('\n── Drops ──');
  drop.forEach((d) => console.log(`  [${String(d.index).padStart(3)}] ${d.name}  —  ${d.reason}`));

  const byOwner = {};
  const byMkt = {};
  const bySrcUnknown = keep.filter((k) => k.referral_source_id === UNKNOWN_SOURCE_ID).length;
  const byInsEmpty = keep.filter((k) => !k.plans.length).length;
  const byEntity = {};
  keep.forEach((k) => {
    byOwner[k.intake_owner_label] = (byOwner[k.intake_owner_label] || 0) + 1;
    byMkt[k.marketer_label || '(none)'] = (byMkt[k.marketer_label || '(none)'] || 0) + 1;
    byEntity[k.entity_label] = (byEntity[k.entity_label] || 0) + 1;
  });
  console.log('\n── Keep summary ──');
  console.log('  entity', byEntity);
  console.log('  owners', byOwner);
  console.log('  marketers', byMkt);
  console.log(`  unknown source: ${bySrcUnknown}`);
  console.log(`  no insurance mapped: ${byInsEmpty}`);
  console.log(`  adult: ${keep.filter((k) => k.sn_age_group === 'Adult').length}  peds: ${keep.filter((k) => k.sn_age_group === 'Pediatric').length}`);
  console.log(`  ROC: ${keep.filter((k) => k.episode_type === 'ROC').length}`);
  console.log(`\nWrote ${outPath}`);

  if (!CONFIRM) {
    console.log('\nDry-run only. Re-run with --confirm to insert.');
    return;
  }

  console.log(`\nInserting ${keep.length} patients + referrals into ${database} …`);
  let ok = 0;
  let fail = 0;
  for (const k of keep) {
    const now = new Date().toISOString();
    const referralTs = `${k.date}T16:00:00.000Z`;
    const pat = makeIds('pat');
    await new Promise((r) => setTimeout(r, 3));
    const ref = makeIds('ref');
    const servicesSql = k.services.length
      ? `ARRAY[${k.services.map((s) => `'${s}'`).join(',')}]::text[]`
      : 'NULL';
    const plansJson = JSON.stringify(k.plans.map((p) => p.payer));

    try {
      await exec(
        `INSERT INTO patients (
           rec_id, id, first_name, last_name, division,
           address_street, address_city, address_state, address_zip, county,
           insurance_plan, insurance_plans, is_active, created_at, updated_at
         ) VALUES (
           :rec_id, :id, :first_name, :last_name, 'Special Needs',
           :street, :city, :state, :zip, :county,
           :insurance_plan, CAST(:insurance_plans AS jsonb), 'TRUE',
           CAST(:created_at AS timestamptz), CAST(:updated_at AS timestamptz)
         )`,
        [
          str('rec_id', pat.rec), str('id', pat.biz),
          str('first_name', k.first_name), str('last_name', k.last_name),
          str('street', k.street), str('city', k.city), str('state', k.state),
          str('zip', k.zip), str('county', k.county),
          str('insurance_plan', k.plans[0]?.payer || null),
          str('insurance_plans', k.plans.length ? plansJson : null),
          str('created_at', now), str('updated_at', now),
        ],
      );

      await exec(
        `INSERT INTO referrals (
           rec_id, id, patient_id, current_stage, division, priority, episode_type,
           marketer_id, referral_source_id, referral_method, entity_id, sn_age_group,
           services_requested, intake_owner_id, intake_owner_changed_at, intake_owner_changed_by_id,
           lead_created_by_id, referral_date, created_at, updated_at
         ) VALUES (
           :rec_id, :id, :patient_id, 'Intake', 'Special Needs', 'Normal', :episode_type,
           :marketer_id, :referral_source_id, :referral_method, :entity_id, :sn_age_group,
           ${servicesSql}, :intake_owner_id, CAST(:owner_at AS timestamptz), :intake_owner_id,
           :intake_owner_id, CAST(:referral_date AS timestamptz),
           CAST(:created_at AS timestamptz), CAST(:updated_at AS timestamptz)
         )`,
        [
          str('rec_id', ref.rec), str('id', ref.biz), str('patient_id', pat.biz),
          str('episode_type', k.episode_type),
          str('marketer_id', k.marketer_id),
          str('referral_source_id', k.referral_source_id),
          str('referral_method', k.referral_method),
          str('entity_id', k.entity_id),
          str('sn_age_group', k.sn_age_group),
          str('intake_owner_id', k.intake_owner_id),
          str('owner_at', referralTs),
          str('referral_date', referralTs),
          str('created_at', now), str('updated_at', now),
        ],
      );

      const sh = makeIds('sh');
      await exec(
        `INSERT INTO stage_history (
           rec_id, id, referral_id, from_stage, to_stage, changed_by_id, timestamp, created_at, updated_at
         ) VALUES (
           :rec_id, :id, :referral_id, NULL, 'Intake', :changed_by,
           CAST(:ts AS timestamptz), CAST(:created_at AS timestamptz), CAST(:updated_at AS timestamptz)
         )`,
        [
          str('rec_id', sh.rec), str('id', sh.biz), str('referral_id', ref.biz),
          str('changed_by', k.intake_owner_id),
          str('ts', now), str('created_at', now), str('updated_at', now),
        ],
      );

      const ranks = ['primary', 'secondary', 'tertiary'];
      for (let i = 0; i < k.plans.length; i++) {
        const ins = makeIds('ins');
        const pl = k.plans[i];
        await exec(
          `INSERT INTO patient_insurances (
             rec_id, id, patient_id, payer_display_name, insurance_category, plan_name,
             order_rank, entered_from, is_active_raw, created_at, updated_at
           ) VALUES (
             :rec_id, :id, :patient_id, :payer, :category, :plan_name,
             :rank, :entered_from, TRUE,
             CAST(:created_at AS timestamptz), CAST(:updated_at AS timestamptz)
           )`,
          [
            str('rec_id', ins.rec), str('id', ins.biz), str('patient_id', pat.rec),
            str('payer', pl.payer), str('category', pl.category), str('plan_name', pl.payer),
            str('rank', ranks[i] || 'tertiary'),
            str('entered_from', IMPORT_TAG),
            str('created_at', now), str('updated_at', now),
          ],
        );
      }

      const note = makeIds('note');
      await exec(
        `INSERT INTO notes (
           rec_id, id, patient_id, referral_id, author_id, content, is_pinned, created_at, updated_at
         ) VALUES (
           :rec_id, :id, :patient_id, :referral_id, :author_id, :content, FALSE,
           CAST(:created_at AS timestamptz), CAST(:updated_at AS timestamptz)
         )`,
        [
          str('rec_id', note.rec), str('id', note.biz),
          str('patient_id', pat.biz), str('referral_id', ref.biz),
          str('author_id', k.intake_owner_id),
          str('content', k.note),
          str('created_at', now), str('updated_at', now),
        ],
      );

      ok += 1;
      if (ok % 25 === 0) console.log(`  … ${ok}/${keep.length}`);
    } catch (err) {
      fail += 1;
      console.error(`  FAIL ${k.first_name} ${k.last_name}: ${err.message}`);
    }
  }

  console.log(`\nDone. inserted=${ok} failed=${fail} dropped=${drop.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
