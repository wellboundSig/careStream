#!/usr/bin/env node
/**
 * Reclassify method-like referral_sources (Word of Mouth, Website, Fax, …)
 * into referral_method on linked referrals, reassign those referrals to
 * src_unknown, and deactivate the method-as-source rows.
 *
 * Also backfills referral_method from a source's default method when blank.
 *
 * Usage:
 *   node scripts/cleanup-referral-methods.js           # dry-run
 *   node scripts/cleanup-referral-methods.js --confirm
 *
 * Requires WB_CLUSTER_ARN + WB_SECRET_ARN (loads careStream/.env).
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';

const __dirname = dirname(fileURLToPath(import.meta.url));
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

const CONFIRM = process.argv.includes('--confirm');
const UNKNOWN_ID = 'src_unknown';

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

function cell(c) {
  if (!c || c.isNull) return null;
  return c.stringValue ?? c.longValue ?? c.booleanValue ?? c.doubleValue ?? null;
}

async function query(sql, parameters) {
  const res = await exec(sql, parameters);
  const cols = (res.columnMetadata || []).map((c) => c.name);
  return (res.records || []).map((row) => {
    const o = {};
    row.forEach((c, i) => { o[cols[i]] = cell(c); });
    return o;
  });
}

/** Same aliases as sourceConstants.normalizeReferralMethod */
function inferMethod(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  const key = s.toLowerCase().replace(/\s+/g, ' ');
  const aliases = {
    'word of mouth': 'Word of Mouth',
    'wom': 'Word of Mouth',
    'call-in / word of mouth': 'Word of Mouth',
    'call in / word of mouth': 'Word of Mouth',
    'facebook': 'Facebook Ads',
    'facebook ad': 'Facebook Ads',
    'facebook ads': 'Facebook Ads',
    'fb ads': 'Facebook Ads',
    'self referral': 'Patient Self-Referral',
    'self-referral': 'Patient Self-Referral',
    'patient self referral': 'Patient Self-Referral',
    'patient self-referral': 'Patient Self-Referral',
    'self': 'Patient Self-Referral',
    'web': 'Website',
    'website': 'Website',
    'web lead': 'Website',
    'fax': 'Fax',
    'email': 'Email',
    'e-mail': 'Email',
    'wellbound email submission': 'Email',
    'call-in': 'Call-In',
    'call in': 'Call-In',
    'allscripts': 'Allscripts',
    'readmit': 'Readmit',
    're-admit': 'Readmit',
    'roc': 'Readmit',
    'wellbound (readmit)': 'Readmit',
  };
  return aliases[key] || '';
}

function isMethodLikeSource(row) {
  const nameMethod = inferMethod(row.name);
  const entityMethod = inferMethod(row.source_entity);
  if (nameMethod) return nameMethod;
  if (entityMethod && (!row.name || inferMethod(row.name) || /^(general|n\/a|na|—|-)$/i.test(String(row.name || '').trim()))) {
    return entityMethod;
  }
  // Name is purely a channel phrase even if alias missed
  if (/^(fax|email|website|web|word of mouth|call[- ]?in|allscripts|readmit|facebook)/i.test(String(row.name || '').trim())) {
    return inferMethod(row.name) || 'Other';
  }
  return '';
}

async function main() {
  console.log(CONFIRM ? '=== CONFIRM MODE — writes will run ===' : '=== DRY RUN (pass --confirm to apply) ===');

  // Ensure Unknown exists (migration should have created it)
  const unknown = await query(`SELECT id, name, is_system FROM referral_sources WHERE id = :id`, [
    { name: 'id', value: { stringValue: UNKNOWN_ID } },
  ]);
  if (!unknown.length) {
    console.error(`Missing ${UNKNOWN_ID}. Run db:migrate (0021_referral_method) first.`);
    process.exit(1);
  }
  console.log(`Unknown source: ${unknown[0].name} (is_system=${unknown[0].is_system})`);

  const sources = await query(`
    SELECT r.rec_id, r.id, r.name, COALESCE(r.type,'') AS type,
           COALESCE(r.source_entity,'') AS source_entity,
           COALESCE(r.method,'') AS method,
           COALESCE(r.is_active,'') AS is_active,
           (SELECT COUNT(*)::int FROM referrals ref WHERE ref.referral_source_id = r.id) AS ref_count
    FROM referral_sources r
    WHERE COALESCE(TRIM(r.id), '') <> :unknown
    ORDER BY r.name
  `, [{ name: 'unknown', value: { stringValue: UNKNOWN_ID } }]);

  const methodRows = [];
  for (const s of sources) {
    const method = isMethodLikeSource(s);
    if (method) methodRows.push({ ...s, inferredMethod: method });
  }

  console.log(`\nMethod-as-source rows: ${methodRows.length}`);
  for (const s of methodRows) {
    console.log(`  ${s.id}  "${s.name}" / entity="${s.source_entity}" → method=${s.inferredMethod}  refs=${s.ref_count}`);
  }

  let referralUpdates = 0;
  let deactivated = 0;
  let backfilledFromDefault = 0;

  if (CONFIRM) {
    for (const s of methodRows) {
      // Stamp method + reassign to Unknown when referral_method empty or matching cleanup
      const upd = await exec(`
        UPDATE referrals
        SET referral_method = CASE
              WHEN COALESCE(TRIM(referral_method), '') = '' THEN :method
              ELSE referral_method
            END,
            referral_source_id = :unknown,
            updated_at = NOW()
        WHERE referral_source_id = :sid
      `, [
        { name: 'method', value: { stringValue: s.inferredMethod } },
        { name: 'unknown', value: { stringValue: UNKNOWN_ID } },
        { name: 'sid', value: { stringValue: s.id } },
      ]);
      referralUpdates += upd.numberOfRecordsUpdated || 0;

      await exec(`
        UPDATE referral_sources
        SET is_active = 'FALSE',
            method = COALESCE(NULLIF(TRIM(method), ''), :method),
            updated_at = NOW()
        WHERE id = :sid
      `, [
        { name: 'method', value: { stringValue: s.inferredMethod } },
        { name: 'sid', value: { stringValue: s.id } },
      ]);
      deactivated += 1;
    }

    // Backfill blank referral_method from source.default method for remaining active people
    const backfill = await exec(`
      UPDATE referrals r
      SET referral_method = s.method,
          updated_at = NOW()
      FROM referral_sources s
      WHERE r.referral_source_id = s.id
        AND COALESCE(TRIM(r.referral_method), '') = ''
        AND COALESCE(TRIM(s.method), '') <> ''
        AND COALESCE(UPPER(s.is_active), 'TRUE') = 'TRUE'
    `);
    backfilledFromDefault = backfill.numberOfRecordsUpdated || 0;
  } else {
    for (const s of methodRows) referralUpdates += Number(s.ref_count) || 0;
    const wouldBackfill = await query(`
      SELECT COUNT(*)::int AS n
      FROM referrals r
      JOIN referral_sources s ON r.referral_source_id = s.id
      WHERE COALESCE(TRIM(r.referral_method), '') = ''
        AND COALESCE(TRIM(s.method), '') <> ''
        AND COALESCE(UPPER(s.is_active), 'TRUE') = 'TRUE'
    `);
    backfilledFromDefault = wouldBackfill[0]?.n || 0;
  }

  console.log(`\nReferrals reassigned → ${UNKNOWN_ID} (method stamped): ${referralUpdates}`);
  console.log(`Sources deactivated: ${deactivated || methodRows.length}`);
  console.log(`Referrals backfilled from source.method: ${backfilledFromDefault}`);
  if (!CONFIRM) console.log('\nRe-run with --confirm to apply.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
