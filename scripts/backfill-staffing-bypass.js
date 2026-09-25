#!/usr/bin/env node
/**
 * Backfill: move referrals out of Staffing Feasibility when their visit is
 * already scheduled or completed (staffing bypass rollout).
 *
 * Rule (mirrors resolveStaffingBypass in src/utils/stageTransitions.js):
 *   - visit completed + all paperwork/clinical closed  → 'Completed'
 *   - visit completed + paperwork still open           → 'Intake'
 *   - visit scheduled, not yet happened                → 'SOC Scheduled'
 *   - neither                                          → left alone
 *
 * Each move appends a stage_history row (changed_by_id 'system', reason
 * 'backfill: staffing bypass, visit already scheduled/completed') and guards
 * on the stage it read, so a concurrent live move is never clobbered.
 *
 * Usage:
 *   node scripts/backfill-staffing-bypass.js               # dry-run
 *   node scripts/backfill-staffing-bypass.js --confirm     # apply
 *   node scripts/backfill-staffing-bypass.js --limit 10    # cap moves
 *
 * Requires WB_CLUSTER_ARN + WB_SECRET_ARN (loads careStream/.env).
 * WB_DATABASE selects the target (default 'wellbound').
 *
 * Rollout order: deploy the frontend with the engine-level bypass FIRST (or
 * immediately after), otherwise live flows can keep pushing new cases into
 * Staffing after this backfill runs.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RDSDataClient,
  ExecuteStatementCommand,
  BeginTransactionCommand,
  CommitTransactionCommand,
  RollbackTransactionCommand,
} from '@aws-sdk/client-rds-data';

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

const resourceArn = process.env.WB_CLUSTER_ARN;
const secretArn = process.env.WB_SECRET_ARN;
const database = process.env.WB_DATABASE || 'wellbound';

const BACKFILL_REASON = 'backfill: staffing bypass, visit already scheduled/completed';
const SYSTEM_ACTOR = 'system';

let client;
function getClient() {
  if (!client) client = new RDSDataClient({ region: process.env.AWS_REGION || 'us-east-2' });
  return client;
}

async function exec(sql, parameters, transactionId) {
  return getClient().send(new ExecuteStatementCommand({
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

function truthy(v) {
  return v === true || v === 'true' || v === 't' || v === 'TRUE' || v === 1;
}

/** Mirror of legacyVisitPaperworkOpen (src/data/stageConfig.js). */
export function paperworkOpen(r) {
  const openDocs = truthy(r.documentation_deferred) && !r.documentation_cleared_at;
  const clinicalDone = !!r.clinical_review_completed_at || !!r.clinical_review_decision;
  return openDocs || !clinicalDone;
}

/** Mirror of resolveStaffingBypass (src/utils/stageTransitions.js). */
export function classify(r) {
  const visitDone = !!r.soc_completed_date;
  const visitScheduled = !!r.soc_scheduled_date;
  if (!visitDone && !visitScheduled) return { to: null, why: 'no visit scheduled or completed' };
  if (visitDone) {
    return paperworkOpen(r)
      ? { to: 'Intake', why: 'visit completed, paperwork still open' }
      : { to: 'Completed', why: 'visit completed and all paperwork closed' };
  }
  return { to: 'SOC Scheduled', why: 'visit already scheduled, staffing already secured' };
}

async function moveRow(r, toStage) {
  const now = new Date().toISOString();
  const shId = `sh_backfill_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const tx = await getClient().send(new BeginTransactionCommand({ resourceArn, secretArn, database }));
  const transactionId = tx.transactionId;
  try {
    const upd = await exec(`
      UPDATE referrals
      SET current_stage = :to, updated_at = NOW()
      WHERE rec_id = :rec AND current_stage = 'Staffing Feasibility'
    `, [
      { name: 'to', value: { stringValue: toStage } },
      { name: 'rec', value: { stringValue: r.rec_id } },
    ], transactionId);

    if ((upd.numberOfRecordsUpdated || 0) !== 1) {
      await getClient().send(new RollbackTransactionCommand({ resourceArn, secretArn, transactionId }));
      return { ok: false, reason: 'stage changed concurrently, skipped' };
    }

    await exec(`
      INSERT INTO stage_history (id, referral_id, from_stage, to_stage, changed_by_id, reason, timestamp)
      VALUES (:id, :ref, 'Staffing Feasibility', :to, :actor, :reason, :ts::timestamptz)
    `, [
      { name: 'id', value: { stringValue: shId } },
      { name: 'ref', value: { stringValue: r.id } },
      { name: 'to', value: { stringValue: toStage } },
      { name: 'actor', value: { stringValue: SYSTEM_ACTOR } },
      { name: 'reason', value: { stringValue: BACKFILL_REASON } },
      { name: 'ts', value: { stringValue: now } },
    ], transactionId);

    await getClient().send(new CommitTransactionCommand({ resourceArn, secretArn, transactionId }));
    return { ok: true };
  } catch (err) {
    try {
      await getClient().send(new RollbackTransactionCommand({ resourceArn, secretArn, transactionId }));
    } catch { /* already rolled back */ }
    return { ok: false, reason: err?.message || String(err) };
  }
}

async function main() {
  if (limitIdx >= 0 && (!Number.isFinite(LIMIT) || LIMIT <= 0)) {
    console.error('--limit requires a positive number');
    process.exit(1);
  }
  if (!resourceArn || !secretArn) {
    console.error('Set WB_CLUSTER_ARN and WB_SECRET_ARN');
    process.exit(1);
  }
  console.log(`Database: ${database}`);
  console.log(CONFIRM ? '=== CONFIRM MODE, writes will run ===' : '=== DRY RUN (pass --confirm to apply) ===');

  const rows = await query(`
    SELECT r.rec_id, r.id, r.current_stage,
           p.first_name, p.last_name,
           r.soc_scheduled_date::text AS soc_scheduled_date,
           r.soc_completed_date::text AS soc_completed_date,
           r.documentation_deferred,
           r.documentation_cleared_at::text AS documentation_cleared_at,
           r.clinical_review_completed_at::text AS clinical_review_completed_at,
           r.clinical_review_decision
    FROM referrals r
    LEFT JOIN patients p ON p.id = r.patient_id
    WHERE r.current_stage = 'Staffing Feasibility'
      AND (r.soc_scheduled_date IS NOT NULL OR r.soc_completed_date IS NOT NULL)
    ORDER BY r.id
  `);

  const plan = [];
  const skipped = [];
  for (const r of rows) {
    const { to, why } = classify(r);
    if (to) plan.push({ ...r, to, why });
    else skipped.push({ ...r, why });
  }

  const moves = LIMIT ? plan.slice(0, LIMIT) : plan;

  console.log(`\nCandidates in Staffing with a scheduled/completed visit: ${rows.length}`);
  console.log(`Planned moves: ${plan.length}${LIMIT ? ` (applying ${moves.length} due to --limit)` : ''}`);
  const byDest = {};
  for (const m of plan) byDest[m.to] = (byDest[m.to] || 0) + 1;
  for (const [dest, n] of Object.entries(byDest)) console.log(`  → ${dest}: ${n}`);

  console.log('\nPer-patient plan:');
  for (const m of moves) {
    const who = `${m.first_name || ''} ${m.last_name || ''}`.trim() || m.id;
    console.log(`  ${m.id}  ${who}  → "${m.to}"  (${m.why})  scheduled=${(m.soc_scheduled_date || '').slice(0, 10) || 'n/a'}`);
  }
  for (const s of skipped) console.log(`  SKIP ${s.id} (${s.why})`);

  if (!moves.length) {
    console.log('\nNothing to move.');
    return;
  }
  if (!CONFIRM) {
    console.log('\nRe-run with --confirm to apply.');
    return;
  }

  let ok = 0;
  let failed = 0;
  for (const m of moves) {
    const res = await moveRow(m, m.to);
    if (res.ok) {
      ok += 1;
      console.log(`  MOVED ${m.id} → ${m.to}`);
    } else {
      failed += 1;
      console.log(`  FAILED ${m.id}: ${res.reason}`);
    }
  }
  console.log(`\nDone. Moved ${ok}, failed ${failed}.`);
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
