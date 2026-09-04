#!/usr/bin/env node
/**
 * Audit duplicate / split facility records across facilities + network_facilities.
 * Read-only.
 *
 * Usage (from careStream/):
 *   node scripts/audit-facility-duplicates.js
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  for (const name of ['.env.local', '.env']) {
    try {
      for (const line of readFileSync(resolve(__dirname, '..', name), 'utf8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq < 0) continue;
        const k = t.slice(0, eq).trim();
        const v = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
        if (!process.env[k]) process.env[k] = v;
      }
    } catch { /* missing */ }
  }
} catch { /* ignore */ }

const resourceArn = process.env.WB_CLUSTER_ARN;
const secretArn = process.env.WB_SECRET_ARN;
const database = process.env.WB_DATABASE || 'wellbound';
if (!resourceArn || !secretArn) {
  console.error('Set WB_CLUSTER_ARN and WB_SECRET_ARN');
  process.exit(1);
}

const client = new RDSDataClient({ region: process.env.AWS_REGION || 'us-east-2' });

function cell(c) {
  if (!c || c.isNull) return null;
  return c.stringValue ?? c.longValue ?? c.booleanValue ?? c.doubleValue ?? null;
}

async function query(sql, parameters) {
  const res = await client.send(new ExecuteStatementCommand({
    resourceArn, secretArn, database, sql, parameters, includeResultMetadata: true,
  }));
  const cols = (res.columnMetadata || []).map((c) => c.name);
  return (res.records || []).map((row) => {
    const o = {};
    row.forEach((c, i) => { o[cols[i]] = cell(c); });
    return o;
  });
}

function normName(s) {
  return String(s || '')
    .replace(/\u00a0/g, ' ')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\b(THE|OF|AT|AND|&)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  const [legacy, network, refs, mf, coc] = await Promise.all([
    query(`SELECT id, name, type, region, address_street, address_city, address_zip::text AS address_zip, is_active
           FROM facilities ORDER BY name`),
    query(`SELECT id, name, type, region, address_street, zipcode, entity_id, marketer_id
           FROM network_facilities ORDER BY name`),
    query(`SELECT id, facility_id, patient_id, current_stage, division
           FROM referrals WHERE facility_id IS NOT NULL AND trim(facility_id) <> ''`),
    query(`SELECT id, facility_id, marketer_id, is_primary::text AS is_primary FROM marketer_facilities`),
    query(`SELECT id, facility_id, user_id FROM coc_nurse_facilities`),
  ]);

  const refByFac = {};
  for (const r of refs) {
    const fid = String(r.facility_id || '').trim();
    if (!fid) continue;
    if (!refByFac[fid]) refByFac[fid] = [];
    refByFac[fid].push(r);
  }
  const mfByFac = {};
  for (const row of mf) {
    const fid = String(row.facility_id || '').trim();
    if (!mfByFac[fid]) mfByFac[fid] = [];
    mfByFac[fid].push(row);
  }
  const cocByFac = {};
  for (const row of coc) {
    const fid = String(row.facility_id || '').trim();
    if (!cocByFac[fid]) cocByFac[fid] = [];
    cocByFac[fid].push(row);
  }

  const legacyIds = new Set(legacy.map((f) => f.id));
  const netIds = new Set(network.map((f) => f.id));

  let refsOnLegacy = 0;
  let refsOnNetwork = 0;
  let refsOnUnknown = 0;
  for (const r of refs) {
    const fid = String(r.facility_id || '').trim();
    if (netIds.has(fid)) refsOnNetwork += 1;
    else if (legacyIds.has(fid)) refsOnLegacy += 1;
    else refsOnUnknown += 1;
  }

  function attach(f, source) {
    const refsHere = refByFac[f.id] || [];
    return {
      source,
      id: f.id,
      name: f.name,
      region: f.region,
      type: f.type,
      street: f.address_street,
      zip: f.zipcode || f.address_zip,
      entity_id: f.entity_id || null,
      marketer_id: f.marketer_id || null,
      is_active: f.is_active ?? null,
      referral_count: refsHere.length,
      distinct_patients: new Set(refsHere.map((r) => r.patient_id).filter(Boolean)).size,
      stages: Object.fromEntries(
        Object.entries(refsHere.reduce((acc, r) => {
          const s = r.current_stage || '—';
          acc[s] = (acc[s] || 0) + 1;
          return acc;
        }, {})).sort((a, b) => b[1] - a[1]),
      ),
      marketer_links: (mfByFac[f.id] || []).length,
      coc_links: (cocByFac[f.id] || []).length,
    };
  }

  const amber = [
    ...legacy.filter((f) => /amber|westbury|adrods/i.test(f.name || '')).map((f) => attach(f, 'facilities')),
    ...network.filter((f) => /amber|westbury|adrods/i.test(f.name || '')).map((f) => attach(f, 'network_facilities')),
  ];

  function groupBy(list, keyFn) {
    const map = new Map();
    for (const item of list) {
      const k = keyFn(item);
      if (!k) continue;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(item);
    }
    return [...map.entries()].filter(([, rows]) => rows.length > 1);
  }

  const exactLegacy = groupBy(legacy, (f) => String(f.name || '').trim().toUpperCase());
  const exactNet = groupBy(network, (f) => String(f.name || '').trim().toUpperCase());
  const fuzzyLegacy = groupBy(legacy, (f) => normName(f.name));
  const fuzzyNet = groupBy(network, (f) => normName(f.name));

  const legacyByNorm = new Map();
  for (const f of legacy) {
    const k = normName(f.name);
    if (!k) continue;
    if (!legacyByNorm.has(k)) legacyByNorm.set(k, []);
    legacyByNorm.get(k).push(f);
  }
  const cross = [];
  const seenCross = new Set();
  for (const f of network) {
    const k = normName(f.name);
    if (!k) continue;
    const hits = legacyByNorm.get(k);
    if (!hits?.length) continue;
    const token = k;
    if (seenCross.has(token)) continue;
    seenCross.add(token);
    const netSiblings = network.filter((n) => normName(n.name) === k);
    cross.push({
      normalized: k,
      network: netSiblings.map((n) => attach(n, 'network_facilities')),
      legacy: hits.map((l) => attach(l, 'facilities')),
    });
  }

  function printGroups(title, groups, source) {
    console.log(`\n=== ${title} (${groups.length}) ===`);
    if (!groups.length) {
      console.log('  (none)');
      return;
    }
    for (const [name, rows] of groups.sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) {
      console.log(`\n  "${name}" × ${rows.length}`);
      for (const f of rows) {
        const a = attach(f, source);
        console.log(
          `    ${a.id}  refs=${a.referral_count} patients=${a.distinct_patients} mktLinks=${a.marketer_links} coc=${a.coc_links}`
          + `  region=${a.region || '—'} zip=${a.zip || '—'} street=${a.street || '—'}`,
        );
      }
    }
  }

  console.log('COUNTS');
  console.log(`  facilities (legacy): ${legacy.length}`);
  console.log(`  network_facilities:  ${network.length}`);
  console.log(`  referrals with facility_id: ${refs.length}`);
  console.log(`    → on network_facilities id: ${refsOnNetwork}`);
  console.log(`    → on facilities id:         ${refsOnLegacy}`);
  console.log(`    → unknown id:               ${refsOnUnknown}`);

  console.log('\n=== AMBER / WESTBURY MATCHES ===');
  for (const a of amber) {
    console.log(
      `  [${a.source}] ${a.id}  "${a.name}"  refs=${a.referral_count} patients=${a.distinct_patients}`
      + `  region=${a.region || '—'} zip=${a.zip || '—'} street=${a.street || '—'} entity=${a.entity_id || '—'}`,
    );
    if (a.referral_count) console.log(`           stages=${JSON.stringify(a.stages)}`);
  }

  printGroups('EXACT duplicate names in network_facilities', exactNet, 'network_facilities');
  printGroups('EXACT duplicate names in facilities (legacy)', exactLegacy, 'facilities');
  printGroups('FUZZY duplicate names in network_facilities', fuzzyNet, 'network_facilities');
  printGroups('FUZZY duplicate names in facilities (legacy)', fuzzyLegacy, 'facilities');

  console.log(`\n=== SAME NORMALIZED NAME IN BOTH TABLES (${cross.length}) ===`);
  for (const g of cross.sort((a, b) => a.normalized.localeCompare(b.normalized))) {
    const netRefs = g.network.reduce((n, r) => n + r.referral_count, 0);
    const legRefs = g.legacy.reduce((n, r) => n + r.referral_count, 0);
    console.log(`\n  ${g.normalized}  (network refs=${netRefs}, legacy refs=${legRefs})`);
    for (const a of [...g.network, ...g.legacy]) {
      console.log(
        `    [${a.source}] ${a.id}  "${a.name}"  refs=${a.referral_count} patients=${a.distinct_patients}`
        + `  zip=${a.zip || '—'} street=${a.street || '—'}`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
