#!/usr/bin/env node
/**
 * Look up NPIs via CMS NPPES (+ Order & Referring), insert/update physicians,
 * and backfill title from npi_details.credential for rows that already have it.
 *
 * Usage:
 *   node scripts/seed-physicians-from-npi.js              # dry-run
 *   node scripts/seed-physicians-from-npi.js --confirm
 *
 * Env: WB_CLUSTER_ARN, WB_SECRET_ARN, WB_DATABASE (default wellbound)
 */

import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const CONFIRM = process.argv.includes('--confirm');

// Load .env if present
try {
  for (const line of readFileSync(resolve(__dirname, '../.env'), 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
} catch { /* optional */ }

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

function str(v) {
  return v == null || v === '' ? { isNull: true } : { stringValue: String(v) };
}
function bool(v) {
  if (v == null) return { isNull: true };
  return { booleanValue: !!v };
}

function normalizeTitle(raw) {
  if (raw == null) return '';
  let s = String(raw).trim().replace(/\./g, '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s
    .split(/([\s/-]+)/)
    .map((part) => (/^[\s/-]+$/.test(part) ? part : part.toUpperCase()))
    .join('');
}

function titleCaseName(s) {
  return String(s || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const ORDER_REFERRING_DATASET = 'c99b5865-1119-4436-bb80-c5af2773ea1f';
const ORDER_REFER_FLAG_KEYS = ['PARTB', 'DME', 'HHA', 'HOSPICE', 'PMD'];

function isTruthyFlag(v) {
  if (v === true) return true;
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'y' || s === 'yes' || s === 'true' || s === '1';
}

async function lookupNpi(npi) {
  const url = `https://npiregistry.cms.hhs.gov/api/?version=2.1&number=${npi}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`NPPES ${npi}: ${res.status}`);
  return res.json();
}

async function lookupOrderRefer(npi) {
  const params = new URLSearchParams();
  params.set('filter[condition][path]', 'NPI');
  params.set('filter[condition][operator]', '=');
  params.set('filter[condition][value]', npi);
  const url = `https://data.cms.gov/data-api/v1/dataset/${ORDER_REFERRING_DATASET}/data?${params}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return [];
  const body = await res.json();
  return Array.isArray(body) ? body : (body?.data || []);
}

async function buildFromNpi(npi, preferredFirst) {
  const [npiData, orRows] = await Promise.all([
    lookupNpi(npi),
    lookupOrderRefer(npi).catch(() => []),
  ]);
  const result = npiData?.results?.[0];
  if (!result) throw new Error(`NPI not found: ${npi}`);
  const basic = result.basic || {};
  const addrs = result.addresses || [];
  const loc = addrs.find((a) => a.address_purpose === 'LOCATION') || addrs[0] || {};
  const title = normalizeTitle(basic.credential);
  const first = titleCaseName(preferredFirst || basic.first_name);
  const last = titleCaseName(basic.last_name);
  const checkedAt = new Date().toISOString();
  const deactivated = !!basic.deactivation_date && !basic.reactivation_date;
  const npiStatus = deactivated ? 'deactivated' : 'active';
  const providerName = [basic.first_name, basic.last_name].filter(Boolean).join(' ');
  const details = {
    number: result.number || npi,
    enumeration_type: result.enumeration_type || '',
    first_name: basic.first_name || '',
    last_name: basic.last_name || '',
    organization_name: basic.organization_name || '',
    credential: basic.credential || '',
    gender: basic.gender || '',
    status: basic.status || '',
    enumeration_date: basic.enumeration_date || '',
    last_updated: basic.last_updated || '',
    sole_proprietor: basic.sole_proprietor || '',
  };
  const row = orRows[0] || null;
  const pecosEnrolled = orRows.length > 0;
  const flags = {};
  if (row) for (const k of ORDER_REFER_FLAG_KEYS) flags[k] = isTruthyFlag(row[k]);
  const opraEligible = Object.values(flags).some(Boolean);
  const phone = (loc.telephone_number || '').replace(/\D/g, '');
  const fax = (loc.fax_number || '').replace(/\D/g, '');
  const zip = String(loc.postal_code || '').replace(/\D/g, '').slice(0, 5);

  return {
    first_name: first,
    last_name: last,
    title,
    npi,
    phone: phone || null,
    fax: fax || null,
    address_street: titleCaseName(loc.address_1) || null,
    address_city: titleCaseName(loc.city) || null,
    address_state: (loc.state || '').toUpperCase() || null,
    address_zip: zip || null,
    is_pecos_enrolled: pecosEnrolled || null,
    is_opra_enrolled: opraEligible || null,
    pecos_last_checked: checkedAt,
    opra_last_checked: checkedAt,
    npi_status: npiStatus,
    npi_checked_at: checkedAt,
    npi_provider_name: providerName,
    npi_details: JSON.stringify(details),
    order_refer_flags: JSON.stringify(flags),
    verification_last_run_at: checkedAt,
    is_active: 'Active',
  };
}

/** Hand-picked NPIs from NPPES name search (NY / matching credential). */
const SEED_NPIS = [
  { npi: '1407163306', preferredFirst: 'Neidra' },       // Neidra Walker NP
  { npi: '1083057897', preferredFirst: 'Maxime' },       // Maxime Toussaint NP
  { npi: '1285458539', preferredFirst: 'Arielle' },      // Arielle M Williams NP (NY)
  { npi: '1477931814', preferredFirst: 'Sarah' },        // Sarah Jane Sankey NP-C
];

async function main() {
  console.log(CONFIRM ? 'CONFIRM mode — will write' : 'Dry-run — no writes');

  // ── Backfill titles for physicians that already have npi_details.credential ─
  const existingRes = await exec(`
    SELECT id, first_name, last_name, npi, title,
           COALESCE(npi_details->>'credential', '') AS cred
    FROM physicians
    WHERE npi_details IS NOT NULL
      AND COALESCE(npi_details->>'credential', '') <> ''
      AND (title IS NULL OR title = '')
  `);
  const toBackfill = (existingRes.records || []).map((r) => ({
    id: r[0]?.stringValue,
    first: r[1]?.stringValue,
    last: r[2]?.stringValue,
    npi: r[3]?.stringValue,
    title: normalizeTitle(r[5]?.stringValue),
  })).filter((x) => x.id && x.title);

  console.log(`\nBackfill candidates (have NPPES credential, empty title): ${toBackfill.length}`);
  toBackfill.slice(0, 15).forEach((x) => console.log(`  ${x.first} ${x.last} → ${x.title} (${x.npi || '—'})`));
  if (toBackfill.length > 15) console.log(`  … +${toBackfill.length - 15} more`);

  // ── Build seed rows from NPPES ────────────────────────────────────────────
  const seeds = [];
  for (const item of SEED_NPIS) {
    const row = await buildFromNpi(item.npi, item.preferredFirst);
    seeds.push(row);
    console.log(`\nNPPES ${item.npi}: ${row.first_name} ${row.last_name}, ${row.title || '—'} | ${row.address_city}, ${row.address_state} | PECOS=${!!row.is_pecos_enrolled} OPRA=${!!row.is_opra_enrolled}`);
  }

  // Dup check by NPI
  const npiList = seeds.map((s) => s.npi);
  const dupRes = await exec(
    `SELECT id, npi, first_name, last_name FROM physicians WHERE npi = ANY(string_to_array(:npis, ','))`,
    [{ name: 'npis', value: { stringValue: npiList.join(',') } }],
  );
  // string_to_array may not work well with RDS params — fallback per-npi
  const existingByNpi = new Map();
  for (const npi of npiList) {
    const r = await exec(`SELECT id, first_name, last_name FROM physicians WHERE npi = :npi LIMIT 1`, [
      { name: 'npi', value: { stringValue: npi } },
    ]);
    const rec = r.records?.[0];
    if (rec) {
      existingByNpi.set(npi, {
        id: rec[0]?.stringValue,
        first: rec[1]?.stringValue,
        last: rec[2]?.stringValue,
      });
    }
  }
  void dupRes;

  if (!CONFIRM) {
    console.log('\nDry-run only. Re-run with --confirm to apply backfill + inserts.');
    for (const s of seeds) {
      const ex = existingByNpi.get(s.npi);
      console.log(ex ? `  UPDATE existing ${ex.id} (${ex.first} ${ex.last})` : `  INSERT ${s.first_name} ${s.last_name}`);
    }
    return;
  }

  let backfilled = 0;
  for (const x of toBackfill) {
    await exec(
      `UPDATE physicians SET title = :title, updated_at = CAST(:now AS timestamptz) WHERE id = :id`,
      [
        { name: 'title', value: str(x.title) },
        { name: 'now', value: str(new Date().toISOString()) },
        { name: 'id', value: str(x.id) },
      ],
    );
    backfilled += 1;
  }
  console.log(`\nBackfilled title on ${backfilled} physicians`);

  let inserted = 0;
  let updated = 0;
  for (const s of seeds) {
    const now = new Date().toISOString();
    const existing = existingByNpi.get(s.npi);
    if (existing) {
      await exec(
        `UPDATE physicians SET
           first_name = :first_name, last_name = :last_name, title = :title,
           phone = :phone, fax = :fax,
           address_street = :address_street, address_city = :address_city,
           address_state = :address_state, address_zip = :address_zip,
           is_pecos_enrolled = :is_pecos_enrolled, is_opra_enrolled = :is_opra_enrolled,
           pecos_last_checked = CAST(:pecos_last_checked AS timestamptz),
           opra_last_checked = CAST(:opra_last_checked AS timestamptz),
           npi_status = :npi_status,
           npi_checked_at = CAST(:npi_checked_at AS timestamptz),
           npi_provider_name = :npi_provider_name,
           npi_details = CAST(:npi_details AS jsonb),
           order_refer_flags = CAST(:order_refer_flags AS jsonb),
           verification_last_run_at = CAST(:verification_last_run_at AS timestamptz),
           is_active = :is_active,
           updated_at = CAST(:updated_at AS timestamptz)
         WHERE id = :id`,
        [
          { name: 'id', value: str(existing.id) },
          { name: 'first_name', value: str(s.first_name) },
          { name: 'last_name', value: str(s.last_name) },
          { name: 'title', value: str(s.title) },
          { name: 'phone', value: str(s.phone) },
          { name: 'fax', value: str(s.fax) },
          { name: 'address_street', value: str(s.address_street) },
          { name: 'address_city', value: str(s.address_city) },
          { name: 'address_state', value: str(s.address_state) },
          { name: 'address_zip', value: str(s.address_zip) },
          { name: 'is_pecos_enrolled', value: bool(s.is_pecos_enrolled) },
          { name: 'is_opra_enrolled', value: bool(s.is_opra_enrolled) },
          { name: 'pecos_last_checked', value: str(s.pecos_last_checked) },
          { name: 'opra_last_checked', value: str(s.opra_last_checked) },
          { name: 'npi_status', value: str(s.npi_status) },
          { name: 'npi_checked_at', value: str(s.npi_checked_at) },
          { name: 'npi_provider_name', value: str(s.npi_provider_name) },
          { name: 'npi_details', value: str(s.npi_details) },
          { name: 'order_refer_flags', value: str(s.order_refer_flags) },
          { name: 'verification_last_run_at', value: str(s.verification_last_run_at) },
          { name: 'is_active', value: str(s.is_active) },
          { name: 'updated_at', value: str(now) },
        ],
      );
      updated += 1;
      console.log(`  Updated ${existing.id}: ${s.first_name} ${s.last_name}, ${s.title}`);
    } else {
      const id = `phy_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
      const recId = `rec${crypto.randomBytes(8).toString('hex')}`;
      await exec(
        `INSERT INTO physicians (
           rec_id, id, first_name, last_name, title, npi, phone, fax,
           address_street, address_city, address_state, address_zip,
           is_pecos_enrolled, is_opra_enrolled, pecos_last_checked, opra_last_checked,
           npi_status, npi_checked_at, npi_provider_name, npi_details, order_refer_flags,
           verification_last_run_at, is_active, created_at, updated_at
         ) VALUES (
           :rec_id, :id, :first_name, :last_name, :title, :npi, :phone, :fax,
           :address_street, :address_city, :address_state, :address_zip,
           :is_pecos_enrolled, :is_opra_enrolled,
           CAST(:pecos_last_checked AS timestamptz), CAST(:opra_last_checked AS timestamptz),
           :npi_status, CAST(:npi_checked_at AS timestamptz), :npi_provider_name,
           CAST(:npi_details AS jsonb), CAST(:order_refer_flags AS jsonb),
           CAST(:verification_last_run_at AS timestamptz), :is_active,
           CAST(:created_at AS timestamptz), CAST(:updated_at AS timestamptz)
         )`,
        [
          { name: 'rec_id', value: str(recId) },
          { name: 'id', value: str(id) },
          { name: 'first_name', value: str(s.first_name) },
          { name: 'last_name', value: str(s.last_name) },
          { name: 'title', value: str(s.title) },
          { name: 'npi', value: str(s.npi) },
          { name: 'phone', value: str(s.phone) },
          { name: 'fax', value: str(s.fax) },
          { name: 'address_street', value: str(s.address_street) },
          { name: 'address_city', value: str(s.address_city) },
          { name: 'address_state', value: str(s.address_state) },
          { name: 'address_zip', value: str(s.address_zip) },
          { name: 'is_pecos_enrolled', value: bool(s.is_pecos_enrolled) },
          { name: 'is_opra_enrolled', value: bool(s.is_opra_enrolled) },
          { name: 'pecos_last_checked', value: str(s.pecos_last_checked) },
          { name: 'opra_last_checked', value: str(s.opra_last_checked) },
          { name: 'npi_status', value: str(s.npi_status) },
          { name: 'npi_checked_at', value: str(s.npi_checked_at) },
          { name: 'npi_provider_name', value: str(s.npi_provider_name) },
          { name: 'npi_details', value: str(s.npi_details) },
          { name: 'order_refer_flags', value: str(s.order_refer_flags) },
          { name: 'verification_last_run_at', value: str(s.verification_last_run_at) },
          { name: 'is_active', value: str(s.is_active) },
          { name: 'created_at', value: str(now) },
          { name: 'updated_at', value: str(now) },
        ],
      );
      inserted += 1;
      console.log(`  Inserted ${id}: ${s.first_name} ${s.last_name}, ${s.title}`);
      // small delay so ids from Date.now() don't collide if clock same ms
      await new Promise((r) => setTimeout(r, 5));
    }
  }

  console.log(`\nDone — inserted ${inserted}, updated ${updated}, backfilled ${backfilled}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
