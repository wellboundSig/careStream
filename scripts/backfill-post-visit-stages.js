#!/usr/bin/env node
/**
 * Backfill: sort existing post-SOC cases into the new post-visit stages.
 *
 * New stage model:
 *   'SOC Completed' (displayed "Visit Completed") is now transitional —
 *   normal cases finish in the new terminal 'Completed' stage; deferred-docs
 *   (rushed / no-docs / urgent care) cases work post-visit paperwork through
 *   'Post Visit Intake' ⇄ 'Post Visit Clinical Review' before 'Completed'.
 *
 * Mapping applied to rows whose visit already happened (soc_completed_date):
 *   1. Open post-SOC clinical work (in_clinical_review, or assigned RN with
 *      no completion stamp, or sitting in 'Clinical Intake RN Review')
 *        → 'Post Visit Clinical Review'
 *   2. Otherwise, open deferred-docs hold (documentation_deferred and not
 *      cleared) while in 'Intake' / 'F2F/MD Orders Pending' / 'SOC Completed'
 *        → 'Post Visit Intake'
 *   3. Otherwise, sitting in 'SOC Completed' with docs cleared or never
 *      deferred → 'Completed'
 *
 * Never touched: NTUC / Discarded Leads / Hold, anything without a
 * soc_completed_date, and post-SOC rows working in any other stage
 * (they are logged as skipped for manual review). Existing stage_history
 * rows are never modified — each move APPENDS a stage_history row with
 * reason "backfill: post-visit flow rollout" and changed_by_id "system".
 *
 * Usage:
 *   node scripts/backfill-post-visit-stages.js               # dry-run
 *   node scripts/backfill-post-visit-stages.js --confirm     # apply
 *   node scripts/backfill-post-visit-stages.js --limit 25    # cap moved rows
 *
 * Requires WB_CLUSTER_ARN + WB_SECRET_ARN (loads careStream/.env).
 * Target database via WB_DATABASE (default 'wellbound'; run against
 * 'wellbound_staging' first, review the per-patient report, then prod).
 *
 * IMPORTANT (rollout order): deploy the frontend/API that understands the
 * new stages BEFORE applying this backfill. See the rollout plan.
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

let client;
function getClient() {
  if (!client) client = new RDSDataClient({ region: process.env.AWS_REGION || 'us-east-2' });
  return client;
}

const BACKFILL_REASON = 'backfill: post-visit flow rollout';
const SYSTEM_ACTOR = 'system';

const NEVER_TOUCH = new Set(['NTUC', 'Discarded Leads', 'Hold']);
const POST_VISIT_INTAKE_SOURCE_STAGES = new Set(['Intake', 'F2F/MD Orders Pending', 'SOC Completed']);
const CLINICAL_SOURCE_STAGES = new Set(['Intake', 'F2F/MD Orders Pending', 'SOC Completed', 'Clinical Intake RN Review']);

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

/** Decide the destination stage for one post-SOC row (null = leave alone). */
export function classify(r) {
  const stage = r.current_stage || '';
  if (NEVER_TOUCH.has(stage)) return { to: null, why: 'never-touch stage' };
  if (!r.soc_completed_date) return { to: null, why: 'no soc_completed_date' };

  const openDocs = truthy(r.documentation_deferred) && !r.documentation_cleared_at;
  const openClinical = truthy(r.in_clinical_review)
    || (!!r.clinical_review_assigned_to_id && !r.clinical_review_completed_at)
    || stage === 'Clinical Intake RN Review';

  if (openClinical) {
    if (!CLINICAL_SOURCE_STAGES.has(stage)) {
      return { to: null, why: `open clinical but unexpected stage "${stage}" — review manually` };
    }
    return { to: 'Post Visit Clinical Review', why: 'open post-SOC clinical work' };
  }

  if (openDocs) {
    if (!POST_VISIT_INTAKE_SOURCE_STAGES.has(stage)) {
      return { to: null, why: `open deferred docs but unexpected stage "${stage}" — review manually` };
    }
    return { to: 'Post Visit Intake', why: 'open deferred-docs hold' };
  }

  if (stage === 'SOC Completed') {
    return { to: 'Completed', why: 'docs cleared or never deferred' };
  }

  return { to: null, why: `post-SOC but working in "${stage}" with no open post-visit hold — leaving as is` };
}

async function moveRow(r, toStage) {
  const now = new Date().toISOString();
  const shId = `sh_backfill_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const tx = await getClient().send(new BeginTransactionCommand({ resourceArn, secretArn, database }));
  const transactionId = tx.transactionId;
  try {
    // Guard on the stage we read so a concurrent live move is never clobbered.
    const upd = await exec(`
      UPDATE referrals
      SET current_stage = :to, updated_at = NOW()
      WHERE rec_id = :rec AND current_stage = :expected
    `, [
      { name: 'to', value: { stringValue: toStage } },
      { name: 'rec', value: { stringValue: r.rec_id } },
      { name: 'expected', value: { stringValue: r.current_stage } },
    ], transactionId);

    if ((upd.numberOfRecordsUpdated || 0) !== 1) {
      await getClient().send(new RollbackTransactionCommand({ resourceArn, secretArn, transactionId }));
      return { ok: false, reason: 'stage changed concurrently — skipped' };
    }

    await exec(`
      INSERT INTO stage_history (id, referral_id, from_stage, to_stage, changed_by_id, reason, timestamp)
      VALUES (:id, :ref, :from, :to, :actor, :reason, :ts::timestamptz)
    `, [
      { name: 'id', value: { stringValue: shId } },
      { name: 'ref', value: { stringValue: r.id } },
      { name: 'from', value: { stringValue: r.current_stage } },
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
  console.log(CONFIRM ? '=== CONFIRM MODE — writes will run ===' : '=== DRY RUN (pass --confirm to apply) ===');

  // Candidate pool: every row whose visit already happened, plus anything
  // still sitting in the (formerly terminal) SOC Completed stage.
  const rows = await query(`
    SELECT rec_id, id, patient_id, current_stage,
           soc_completed_date::text AS soc_completed_date,
           documentation_deferred,
           documentation_cleared_at::text AS documentation_cleared_at,
           in_clinical_review,
           clinical_review_assigned_to_id,
           clinical_review_completed_at::text AS clinical_review_completed_at
    FROM referrals
    WHERE (soc_completed_date IS NOT NULL OR current_stage = 'SOC Completed')
      AND current_stage NOT IN ('NTUC', 'Discarded Leads', 'Hold',
                                'Post Visit Intake', 'Post Visit Clinical Review', 'Completed')
    ORDER BY id
  `);

  const plan = [];
  const skipped = [];
  for (const r of rows) {
    const { to, why } = classify(r);
    if (to && to !== r.current_stage) plan.push({ ...r, to, why });
    else skipped.push({ ...r, why });
  }

  const moves = LIMIT ? plan.slice(0, LIMIT) : plan;

  console.log(`\nCandidates examined: ${rows.length}`);
  console.log(`Planned moves: ${plan.length}${LIMIT ? ` (applying ${moves.length} due to --limit)` : ''}`);
  const byDest = {};
  for (const m of plan) byDest[m.to] = (byDest[m.to] || 0) + 1;
  for (const [dest, n] of Object.entries(byDest)) console.log(`  → ${dest}: ${n}`);

  console.log('\nPer-patient plan:');
  for (const m of moves) {
    console.log(`  ${m.id}  "${m.current_stage}" → "${m.to}"  (${m.why})  soc=${(m.soc_completed_date || '').slice(0, 10)}`);
  }
  if (skipped.length) {
    console.log(`\nSkipped (${skipped.length}):`);
    for (const s of skipped) {
      console.log(`  ${s.id}  stays "${s.current_stage}"  (${s.why})`);
    }
  }

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
