#!/usr/bin/env node
/**
 * Backfill: urgent care cases report at High priority.
 *
 * Any referral with requires_urgent_care = TRUE whose priority is not already
 * High/Critical gets priority = 'High'. Never downgrades High/Critical, never
 * touches non-urgent cases. Safe to run at any time (old UI already renders
 * the priority field).
 *
 * Usage:
 *   node scripts/backfill-urgent-priority.js               # dry-run
 *   node scripts/backfill-urgent-priority.js --confirm     # apply
 *   node scripts/backfill-urgent-priority.js --limit 50    # cap affected rows
 *
 * Requires WB_CLUSTER_ARN + WB_SECRET_ARN (loads careStream/.env).
 * Target database via WB_DATABASE (default 'wellbound'; use 'wellbound_staging' first).
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
const limitIdx = process.argv.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? Number(process.argv[limitIdx + 1]) : null;
if (limitIdx >= 0 && (!Number.isFinite(LIMIT) || LIMIT <= 0)) {
  console.error('--limit requires a positive number');
  process.exit(1);
}

const resourceArn = process.env.WB_CLUSTER_ARN;
const secretArn = process.env.WB_SECRET_ARN;
const database = process.env.WB_DATABASE || 'wellbound';
if (!resourceArn || !secretArn) {
  console.error('Set WB_CLUSTER_ARN and WB_SECRET_ARN');
  process.exit(1);
}

const client = new RDSDataClient({ region: process.env.AWS_REGION || 'us-east-2' });

async function exec(sql, parameters, transactionId) {
  return client.send(new ExecuteStatementCommand({
    resourceArn, secretArn, database, sql, parameters, includeResultMetadata: true,
    ...(transactionId ? { transactionId } : {}),
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

async function main() {
  console.log(`Database: ${database}`);
  console.log(CONFIRM ? '=== CONFIRM MODE — writes will run ===' : '=== DRY RUN (pass --confirm to apply) ===');

  const rows = await query(`
    SELECT rec_id, id, patient_id, current_stage,
           COALESCE(priority, '') AS priority,
           COALESCE(urgent_care_type, '') AS urgent_care_type
    FROM referrals
    WHERE requires_urgent_care IS TRUE
      AND COALESCE(TRIM(priority), '') NOT IN ('High', 'Critical')
    ORDER BY id
    ${LIMIT ? `LIMIT ${LIMIT}` : ''}
  `);

  console.log(`\nUrgent care referrals below High priority: ${rows.length}`);
  for (const r of rows) {
    console.log(`  ${r.id}  stage="${r.current_stage}"  priority="${r.priority || '(blank)'}" → High  type="${r.urgent_care_type}"`);
  }

  if (!rows.length) {
    console.log('\nNothing to do.');
    return;
  }

  if (!CONFIRM) {
    console.log('\nRe-run with --confirm to apply.');
    return;
  }

  let updated = 0;
  for (const r of rows) {
    const upd = await exec(`
      UPDATE referrals
      SET priority = 'High', updated_at = NOW()
      WHERE rec_id = :rec
        AND requires_urgent_care IS TRUE
        AND COALESCE(TRIM(priority), '') NOT IN ('High', 'Critical')
    `, [{ name: 'rec', value: { stringValue: r.rec_id } }]);
    updated += upd.numberOfRecordsUpdated || 0;
  }
  console.log(`\nUpdated ${updated} referral(s) to priority = High.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
