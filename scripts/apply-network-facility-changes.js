#!/usr/bin/env node
/**
 * Apply Facility List changes.csv → network_facilities + marketer_facilities.
 *
 * CSV (no header): name, region, marketerName | "Delete"
 *
 * For keep rows:
 *   - match network_facilities by normalized name
 *   - update region (UPPER) + marketer_id
 *   - sync primary in marketer_facilities (is_primary) to the same marketer
 *
 * For Delete:
 *   - only if no referrals reference the facility
 *   - remove marketer_facilities + coc_nurse_facilities links, then facility row
 *
 * Usage:
 *   node scripts/apply-network-facility-changes.js [csvPath]           # dry-run
 *   node scripts/apply-network-facility-changes.js [csvPath] --confirm
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';
import crypto from 'node:crypto';

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
const csvPath = process.argv.slice(2).find((a) => a && !a.startsWith('--'))
  || resolve(process.env.HOME || '', 'Desktop', 'Facility List changes.csv');

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
async function query(sql, parameters) {
  const res = await exec(sql, parameters);
  const cols = (res.columnMetadata || []).map((c) => c.name);
  return (res.records || []).map((row) => {
    const o = {};
    row.forEach((c, i) => {
      o[cols[i]] = c.stringValue ?? c.longValue ?? c.booleanValue ?? c.doubleValue ?? null;
    });
    return o;
  });
}

function normName(s) {
  return String(s || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function str(v) {
  return { stringValue: String(v) };
}
function nul() {
  return { isNull: true };
}

/** Resolve marketer id from CSV name (handles Deutch→Deutsch). */
function resolveMarketer(csvName, marketers) {
  const raw = String(csvName || '').trim();
  if (!raw || /^delete$/i.test(raw)) return null;

  const aliases = {
    'nissan deutch': 'nissan deutsch',
    'mordy slomovics': 'mordy slomovics',
    'alexander joseph': 'alexander joseph',
  };
  const want = aliases[raw.toLowerCase()] || raw.toLowerCase().replace(/\s+/g, ' ');

  const hit = marketers.find((m) => {
    const full = `${m.first_name || ''} ${m.last_name || ''}`.trim().toLowerCase().replace(/\s+/g, ' ');
    return full === want;
  });
  return hit || null;
}

function parseCsv(filePath) {
  // No header — three columns: name, region, marketer|Delete
  // Facility names in this sheet have no embedded commas.
  const text = readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(',').map((p) => p.trim());
      if (parts.length < 3) return null;
      const marketerRaw = parts[parts.length - 1];
      const region = parts[parts.length - 2];
      const name = parts.slice(0, parts.length - 2).join(',').trim();
      return {
        name,
        region: region.toUpperCase(),
        marketerRaw,
        isDelete: /^delete$/i.test(marketerRaw),
      };
    })
    .filter((r) => r && r.name);
}

async function main() {
  console.log(`Network facility changes → ${database}`);
  console.log(CONFIRM ? 'MODE: CONFIRM' : 'MODE: dry-run (pass --confirm to apply)');
  console.log(`CSV: ${csvPath}`);

  const csvRows = parseCsv(csvPath);
  const facilities = await query(`
    SELECT id, name, region, marketer_id, entity_id, type
    FROM network_facilities ORDER BY name`);
  const marketers = await query(`
    SELECT id, first_name, last_name, status FROM marketers`);
  const links = await query(`
    SELECT id, marketer_id, facility_id, is_primary FROM marketer_facilities`);
  const refCounts = await query(`
    SELECT facility_id, COUNT(*)::int AS n
    FROM referrals WHERE facility_id IS NOT NULL GROUP BY 1`);
  const cocCounts = await query(`
    SELECT facility_id, COUNT(*)::int AS n FROM coc_nurse_facilities GROUP BY 1`);

  const facByNorm = new Map();
  for (const f of facilities) {
    const key = normName(f.name);
    if (!facByNorm.has(key)) facByNorm.set(key, f);
  }
  const refsByFac = Object.fromEntries(refCounts.map((r) => [r.facility_id, r.n]));
  const cocByFac = Object.fromEntries(cocCounts.map((r) => [r.facility_id, r.n]));
  const linksByFac = {};
  for (const l of links) {
    if (!linksByFac[l.facility_id]) linksByFac[l.facility_id] = [];
    linksByFac[l.facility_id].push(l);
  }
  const primaryOf = (facilityId) => {
    const list = linksByFac[facilityId] || [];
    return list.find((l) => l.is_primary === true || l.is_primary === 'true') || null;
  };

  const plan = {
    update: [],
    deleteOk: [],
    deleteBlocked: [],
    unmatchedCsv: [],
    marketerMissing: [],
  };
  const matchedIds = new Set();

  for (const row of csvRows) {
    const fac = facByNorm.get(normName(row.name));
    if (!fac) {
      plan.unmatchedCsv.push(row);
      continue;
    }
    matchedIds.add(fac.id);

    if (row.isDelete) {
      const nRefs = refsByFac[fac.id] || 0;
      if (nRefs > 0) plan.deleteBlocked.push({ row, fac, nRefs });
      else plan.deleteOk.push({ row, fac, nCoc: cocByFac[fac.id] || 0, nLinks: (linksByFac[fac.id] || []).length });
      continue;
    }

    const mkt = resolveMarketer(row.marketerRaw, marketers);
    if (!mkt) {
      plan.marketerMissing.push({ row, fac });
      continue;
    }

    const curPrimary = primaryOf(fac.id);
    const regionChange = (fac.region || '').toUpperCase() !== row.region;
    const nfMarketerChange = (fac.marketer_id || '').replace(/\n/g, '') !== mkt.id;
    const joinPrimaryChange = !curPrimary || (curPrimary.marketer_id || '').replace(/\n/g, '') !== mkt.id;
    const nameTrim = fac.name !== fac.name.trim();

    plan.update.push({
      row, fac, mkt,
      regionChange, nfMarketerChange, joinPrimaryChange, nameTrim,
      fromRegion: fac.region,
      fromNfMarketer: fac.marketer_id,
      fromJoinPrimary: curPrimary?.marketer_id || null,
    });
  }

  const orphanDb = facilities.filter((f) => !matchedIds.has(f.id));

  console.log('\n── Plan ──');
  console.log(`CSV rows: ${csvRows.length}`);
  console.log(`Updates: ${plan.update.length}`);
  console.log(`Deletes OK: ${plan.deleteOk.length}`);
  console.log(`Deletes BLOCKED (has referrals): ${plan.deleteBlocked.length}`);
  console.log(`Unmatched CSV: ${plan.unmatchedCsv.length}`);
  console.log(`Unknown marketer: ${plan.marketerMissing.length}`);
  console.log(`DB facilities not in CSV (left alone): ${orphanDb.length}`);

  console.log('\nUpdates:');
  for (const u of plan.update) {
    const bits = [];
    if (u.regionChange) bits.push(`region ${u.fromRegion} → ${u.row.region}`);
    if (u.nfMarketerChange) bits.push(`nf.marketer ${u.fromNfMarketer} → ${u.mkt.id}`);
    if (u.joinPrimaryChange) bits.push(`primary ${u.fromJoinPrimary || '—'} → ${u.mkt.id} (${u.mkt.first_name} ${u.mkt.last_name})`);
    if (u.nameTrim) bits.push('trim name');
    if (!bits.length) bits.push('already in sync');
    console.log(`  ${u.fac.id}  ${u.fac.name.trim()}`);
    console.log(`    ${bits.join(' · ')}`);
  }

  console.log('\nDeletes:');
  for (const d of plan.deleteOk) {
    console.log(`  ${d.fac.id}  ${d.fac.name.trim()}  (links=${d.nLinks}, coc=${d.nCoc})`);
  }
  for (const d of plan.deleteBlocked) {
    console.log(`  BLOCKED ${d.fac.id}  ${d.fac.name.trim()}  refs=${d.nRefs}`);
  }
  if (plan.unmatchedCsv.length) {
    console.log('\nUnmatched CSV names:');
    for (const r of plan.unmatchedCsv) console.log(`  ${r.name}`);
  }
  if (plan.marketerMissing.length) {
    console.log('\nUnknown marketers:');
    for (const r of plan.marketerMissing) console.log(`  ${r.row.name} → ${r.row.marketerRaw}`);
  }
  if (orphanDb.length) {
    console.log('\nDB not in CSV (unchanged):');
    for (const f of orphanDb) console.log(`  ${f.id}  ${f.name}`);
  }

  if (!CONFIRM) {
    console.log('\nDry-run only. Re-run with --confirm to apply.');
    return;
  }

  if (plan.deleteBlocked.length || plan.unmatchedCsv.length || plan.marketerMissing.length) {
    console.error('\nAborting apply: resolve blocked/unmatched/unknown marketer rows first.');
    process.exit(1);
  }

  let updated = 0;
  let deleted = 0;

  for (const u of plan.update) {
    if (!u.regionChange && !u.nfMarketerChange && !u.joinPrimaryChange && !u.nameTrim) {
      console.log(`  · skip ${u.fac.id} (already in sync)`);
      continue;
    }
    const mktId = u.mkt.id.replace(/\n/g, '');
    const facId = u.fac.id;
    const cleanName = u.fac.name.trim();

    await exec(
      `UPDATE network_facilities
       SET name = :name,
           region = :region,
           marketer_id = :marketer_id,
           updated_at = NOW()
       WHERE id = :id`,
      [
        { name: 'name', value: str(cleanName) },
        { name: 'region', value: str(u.row.region) },
        { name: 'marketer_id', value: str(mktId) },
        { name: 'id', value: str(facId) },
      ],
    );

    // Clear all primaries for this facility
    await exec(
      `UPDATE marketer_facilities
       SET is_primary = FALSE, updated_at = NOW()
       WHERE facility_id = :facility_id`,
      [{ name: 'facility_id', value: str(facId) }],
    );

    const existing = (linksByFac[facId] || []).find(
      (l) => (l.marketer_id || '').replace(/\n/g, '') === mktId,
    );

    if (existing) {
      await exec(
        `UPDATE marketer_facilities
         SET is_primary = TRUE, updated_at = NOW()
         WHERE id = :id`,
        [{ name: 'id', value: str(existing.id.replace(/\n/g, '')) }],
      );
    } else {
      const biz = `mf_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`;
      const rec = `rec${crypto.randomBytes(8).toString('hex')}`;
      const now = new Date().toISOString();
      await exec(
        `INSERT INTO marketer_facilities
          (rec_id, id, marketer_id, facility_id, is_primary, assigned_date, created_at, updated_at)
         VALUES
          (:rec_id, :id, :marketer_id, :facility_id, TRUE,
           CAST(:now AS timestamptz), CAST(:now AS timestamptz), CAST(:now AS timestamptz))`,
        [
          { name: 'rec_id', value: str(rec) },
          { name: 'id', value: str(biz) },
          { name: 'marketer_id', value: str(mktId) },
          { name: 'facility_id', value: str(facId) },
          { name: 'now', value: str(now) },
        ],
      );
    }
    updated += 1;
    console.log(`  ✓ update ${facId} → ${u.mkt.first_name} ${u.mkt.last_name} / ${u.row.region}`);
  }

  for (const d of plan.deleteOk) {
    const facId = d.fac.id;
    await exec(`DELETE FROM marketer_facilities WHERE facility_id = :id`, [{ name: 'id', value: str(facId) }]);
    await exec(`DELETE FROM coc_nurse_facilities WHERE facility_id = :id`, [{ name: 'id', value: str(facId) }]);
    await exec(`DELETE FROM network_facilities WHERE id = :id`, [{ name: 'id', value: str(facId) }]);
    deleted += 1;
    console.log(`  ✓ deleted ${facId} ${d.fac.name.trim()}`);
  }

  // Verify sync
  const after = await query(`
    SELECT nf.id, nf.name, nf.region, nf.marketer_id AS nf_mkt,
           mf.marketer_id AS primary_mkt
    FROM network_facilities nf
    LEFT JOIN marketer_facilities mf
      ON mf.facility_id = nf.id AND mf.is_primary = TRUE
    ORDER BY nf.name`);
  const drift = after.filter((r) => (r.nf_mkt || '').replace(/\n/g, '') !== (r.primary_mkt || '').replace(/\n/g, ''));
  console.log(`\n── Done ── updated=${updated} deleted=${deleted} remaining=${after.length}`);
  if (drift.length) {
    console.log(`⚠ marketer drift remaining: ${drift.length}`);
    for (const r of drift) console.log(`  ${r.id} nf=${r.nf_mkt} primary=${r.primary_mkt}`);
  } else {
    console.log('Primary marketer sync: OK (network_facilities.marketer_id = marketer_facilities.is_primary)');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
