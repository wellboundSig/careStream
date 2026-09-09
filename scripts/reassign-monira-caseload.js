#!/usr/bin/env node
/**
 * Reassign Monira Begum's active intake caseload to Mia Esbri.
 *
 * Touches:
 *   - referrals.intake_owner_id on cases that are still in-pipeline
 *   - open tasks assigned to Monira (Pending / In Progress)
 *   - open inbound submissions assigned to her
 *
 * Does NOT touch (credit preservation):
 *   - Completed / fully-finished cases (Completed module)
 *   - NTUC / Discarded Leads (closed outcomes stay hers)
 *   - lead_created_by_id
 *   - completed / cancelled tasks (assigned_to_id + completed_by_id stay)
 *   - historical notes, activity_log actors, eligibility/clinical completed_by
 *
 * Usage (from careStream/):
 *   node scripts/reassign-monira-caseload.js            # dry-run
 *   node scripts/reassign-monira-caseload.js --confirm   # apply
 *
 * Requires WB_CLUSTER_ARN + WB_SECRET_ARN (loads careStream/.env).
 * Target database via WB_DATABASE (default 'wellbound').
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
const resourceArn = process.env.WB_CLUSTER_ARN;
const secretArn = process.env.WB_SECRET_ARN;
const database = process.env.WB_DATABASE || 'wellbound';
if (!resourceArn || !secretArn) {
  console.error('Set WB_CLUSTER_ARN and WB_SECRET_ARN');
  process.exit(1);
}

const client = new RDSDataClient({ region: process.env.AWS_REGION || 'us-east-2' });

const FROM_NAME = { first: 'monira', last: 'begum' };
const TO_NAME = { first: 'mia', last: 'esbri' };
const ACTOR_NAME = { first: 'rafi', last: 'barides' };

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

async function query(sql, parameters, transactionId) {
  const res = await exec(sql, parameters, transactionId);
  const cols = (res.columnMetadata || []).map((c) => c.name);
  return (res.records || []).map((row) => {
    const o = {};
    row.forEach((c, i) => { o[cols[i]] = cell(c); });
    return o;
  });
}

function truthy(v) {
  return v === true || v === 'true' || v === 't' || v === 'TRUE' || v === 1 || v === '1';
}

/** Mirrors src/data/stageConfig.js isFullyFinishedReferral. */
function isFullyFinishedReferral(r) {
  const stage = r.current_stage;
  if (stage === 'NTUC' || stage === 'Discarded Leads' || stage === 'Hold') return false;
  if (stage === 'Completed') return true;
  if (stage !== 'SOC Completed' && stage !== 'Post Visit Intake') return false;
  const openDocs = truthy(r.documentation_deferred) && !r.documentation_cleared_at;
  const clinicalDone = !!r.clinical_review_completed_at || !!r.clinical_review_decision;
  return !(openDocs || !clinicalDone);
}

function isClosedOutcome(r) {
  return r.current_stage === 'NTUC' || r.current_stage === 'Discarded Leads';
}

function shouldReassignReferral(r) {
  if (isFullyFinishedReferral(r)) return false;
  if (isClosedOutcome(r)) return false;
  return true;
}

async function findUser(first, last) {
  const hits = await query(
    `SELECT rec_id, id, first_name, last_name, status, email
     FROM users
     WHERE lower(trim(both from coalesce(first_name,''))) = :fn
       AND lower(trim(both from coalesce(last_name,''))) = :ln
     ORDER BY CASE WHEN coalesce(status,'Active') = 'Active' THEN 0 ELSE 1 END`,
    [
      { name: 'fn', value: { stringValue: first } },
      { name: 'ln', value: { stringValue: last } },
    ],
  );
  return hits;
}

function nid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

async function main() {
  console.log(`Database: ${database}`);
  console.log(CONFIRM ? '=== CONFIRM MODE — writes will run ===' : '=== DRY RUN (pass --confirm to apply) ===');

  const fromHits = await findUser(FROM_NAME.first, FROM_NAME.last);
  const toHits = await findUser(TO_NAME.first, TO_NAME.last);
  const actorHits = await findUser(ACTOR_NAME.first, ACTOR_NAME.last);

  if (!fromHits.length) {
    console.error('Monira Begum not found in users');
    process.exit(1);
  }
  if (!toHits.length) {
    console.error('Mia Esbri not found in users');
    process.exit(1);
  }

  const fromUser = fromHits[0];
  const toUser = toHits[0];
  const actorUser = actorHits[0] || toUser;

  console.log(`From: ${fromUser.first_name} ${fromUser.last_name} (${fromUser.id}) status=${fromUser.status || 'Active'}`);
  if (fromHits.length > 1) console.warn(`  ⚠ ${fromHits.length} Monira rows — using ${fromUser.id}`);
  console.log(`To:   ${toUser.first_name} ${toUser.last_name} (${toUser.id}) status=${toUser.status || 'Active'}`);
  console.log(`Actor stamps: ${actorUser.first_name} ${actorUser.last_name} (${actorUser.id})`);

  const referrals = await query(
    `SELECT r.rec_id, r.id, r.patient_id, r.current_stage, r.division, r.intake_owner_id,
            r.lead_created_by_id, r.hold_owner_id, r.clinical_review_assigned_to_id,
            r.documentation_deferred,
            r.documentation_cleared_at::text AS documentation_cleared_at,
            r.clinical_review_completed_at::text AS clinical_review_completed_at,
            r.clinical_review_decision,
            concat_ws(' ', p.first_name, p.last_name) AS patient_name
     FROM referrals r
     LEFT JOIN patients p ON p.id = r.patient_id
     WHERE r.intake_owner_id = :uid
     ORDER BY r.current_stage, r.id`,
    [{ name: 'uid', value: { stringValue: fromUser.id } }],
  );

  const byStage = {};
  const reassign = [];
  const keep = [];
  for (const r of referrals) {
    byStage[r.current_stage || '(blank)'] = (byStage[r.current_stage || '(blank)'] || 0) + 1;
    if (shouldReassignReferral(r)) reassign.push(r);
    else keep.push(r);
  }

  console.log(`\nReferrals currently owned by Monira: ${referrals.length}`);
  for (const [stage, n] of Object.entries(byStage).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(4)}  ${stage}`);
  }

  console.log(`\nKEEP (credit / closed): ${keep.length}`);
  for (const r of keep) {
    const why = isFullyFinishedReferral(r) ? 'completed' : r.current_stage;
    console.log(`  KEEP  ${r.id}  ${r.patient_name || r.patient_id || '—'}  [${r.current_stage}]  (${why})`);
  }

  console.log(`\nREASSIGN intake owner → Mia: ${reassign.length}`);
  for (const r of reassign) {
    console.log(`  MOVE  ${r.id}  ${r.patient_name || r.patient_id || '—'}  [${r.current_stage}]  ${r.division || ''}`);
  }

  const openTasks = await query(
    `SELECT t.rec_id, t.id, t.title, t.status, t.referral_id, t.patient_id, t.assigned_to_id,
            concat_ws(' ', p.first_name, p.last_name) AS patient_name
     FROM tasks t
     LEFT JOIN patients p ON p.id = t.patient_id
     WHERE t.assigned_to_id = :uid
       AND t.status IN ('Pending', 'In Progress')
     ORDER BY t.status, t.id`,
    [{ name: 'uid', value: { stringValue: fromUser.id } }],
  );
  const closedTaskCounts = await query(
    `SELECT status, count(*)::int AS n
     FROM tasks
     WHERE assigned_to_id = :uid
     GROUP BY status
     ORDER BY 1`,
    [{ name: 'uid', value: { stringValue: fromUser.id } }],
  );
  console.log(`\nOpen tasks assigned to Monira (will reassign): ${openTasks.length}`);
  for (const t of openTasks) {
    console.log(`  TASK  ${t.id}  [${t.status}]  ${t.title || '—'}  ${t.patient_name || t.patient_id || ''}`);
  }
  console.log('Task assignment totals (completed/cancelled stay hers):');
  for (const row of closedTaskCounts) console.log(`  ${row.n}  ${row.status || '(null)'}`);

  let inbound = [];
  try {
    inbound = await query(
      `SELECT rec_id, id, status, assigned_to_id, subject
       FROM inbound_submissions
       WHERE assigned_to_id = :uid
         AND coalesce(status,'') NOT IN ('Converted', 'Closed', 'Discarded', 'Rejected')
       ORDER BY id`,
      [{ name: 'uid', value: { stringValue: fromUser.id } }],
    );
  } catch (err) {
    console.warn('inbound_submissions query skipped:', err?.message || err);
  }
  console.log(`\nOpen inbound submissions assigned to Monira (will reassign): ${inbound.length}`);
  for (const s of inbound) {
    console.log(`  INB   ${s.id}  [${s.status}]  ${s.subject || '—'}`);
  }

  const extraClinical = await query(
    `SELECT r.id, r.current_stage, concat_ws(' ', p.first_name, p.last_name) AS patient_name
     FROM referrals r
     LEFT JOIN patients p ON p.id = r.patient_id
     WHERE r.clinical_review_assigned_to_id = :uid
       AND r.clinical_review_completed_at IS NULL
     ORDER BY r.id`,
    [{ name: 'uid', value: { stringValue: fromUser.id } }],
  );
  if (extraClinical.length) {
    console.log(`\nOpen clinical-review assignments (NOT reassigned — not intake owner): ${extraClinical.length}`);
    for (const r of extraClinical) {
      console.log(`  CLIN  ${r.id}  ${r.patient_name || '—'}  [${r.current_stage}]`);
    }
  }

  const extraHold = await query(
    `SELECT r.id, r.current_stage, r.intake_owner_id,
            concat_ws(' ', p.first_name, p.last_name) AS patient_name
     FROM referrals r
     LEFT JOIN patients p ON p.id = r.patient_id
     WHERE r.hold_owner_id = :uid`,
    [{ name: 'uid', value: { stringValue: fromUser.id } }],
  );
  if (extraHold.length) {
    console.log(`\nHold owner on ${extraHold.length} referral(s) (not auto-changed unless also reassigned as intake):`);
    for (const r of extraHold) {
      console.log(`  HOLD  ${r.id}  ${r.patient_name || '—'}  [${r.current_stage}]  intake=${r.intake_owner_id}`);
    }
  }

  if (!CONFIRM) {
    console.log('\nDry run complete. No writes.');
    return;
  }

  if (!reassign.length && !openTasks.length && !inbound.length) {
    console.log('\nNothing to apply.');
    return;
  }

  const now = new Date().toISOString();
  const fromLabel = `${fromUser.first_name} ${fromUser.last_name}`;
  const toLabel = `${toUser.first_name} ${toUser.last_name}`;
  const detail = `Intake owner changed: ${fromLabel} → ${toLabel} (team transfer)`;
  let moved = 0;
  let notes = 0;
  let logs = 0;
  let tasksMoved = 0;
  let inboundMoved = 0;

  for (const r of reassign) {
    const tx = await client.send(new BeginTransactionCommand({ resourceArn, secretArn, database }));
    const transactionId = tx.transactionId;
    try {
      const upd = await exec(
        `UPDATE referrals
         SET intake_owner_id = :to,
             intake_owner_changed_at = CAST(:now AS timestamptz),
             intake_owner_changed_by_id = :actor,
             updated_at = CAST(:now AS timestamptz)
         WHERE rec_id = :rec
           AND intake_owner_id = :from`,
        [
          { name: 'to', value: { stringValue: toUser.id } },
          { name: 'now', value: { stringValue: now } },
          { name: 'actor', value: { stringValue: actorUser.id } },
          { name: 'rec', value: { stringValue: r.rec_id } },
          { name: 'from', value: { stringValue: fromUser.id } },
        ],
        transactionId,
      );
      if ((upd.numberOfRecordsUpdated || 0) !== 1) {
        await client.send(new RollbackTransactionCommand({ resourceArn, secretArn, transactionId }));
        console.warn(`  skip ${r.id}: intake_owner changed concurrently`);
        continue;
      }

      await exec(
        `INSERT INTO notes (id, patient_id, referral_id, author_id, content, is_pinned, created_at, updated_at)
         VALUES (:id, :pid, :rid, :author, :content, false, CAST(:now AS timestamptz), CAST(:now AS timestamptz))`,
        [
          { name: 'id', value: { stringValue: nid('note') } },
          { name: 'pid', value: r.patient_id ? { stringValue: r.patient_id } : { isNull: true } },
          { name: 'rid', value: r.id ? { stringValue: r.id } : { isNull: true } },
          { name: 'author', value: { stringValue: actorUser.id } },
          { name: 'content', value: { stringValue: detail } },
          { name: 'now', value: { stringValue: now } },
        ],
        transactionId,
      );
      notes += 1;

      await exec(
        `INSERT INTO activity_log (id, actor_id, patient_id, referral_id, action, detail, metadata, timestamp, created_at, updated_at)
         VALUES (:id, :actor, :pid, :rid, 'intake_owner_changed', :detail, CAST(:meta AS jsonb), CAST(:now AS timestamptz), CAST(:now AS timestamptz), CAST(:now AS timestamptz))`,
        [
          { name: 'id', value: { stringValue: nid('act') } },
          { name: 'actor', value: { stringValue: actorUser.id } },
          { name: 'pid', value: r.patient_id ? { stringValue: r.patient_id } : { isNull: true } },
          { name: 'rid', value: r.id ? { stringValue: r.id } : { isNull: true } },
          { name: 'detail', value: { stringValue: detail } },
          { name: 'meta', value: { stringValue: JSON.stringify({
            previousOwnerId: fromUser.id,
            newOwnerId: toUser.id,
            previousOwnerName: fromLabel,
            newOwnerName: toLabel,
            reason: 'team transfer',
          }) } },
          { name: 'now', value: { stringValue: now } },
        ],
        transactionId,
      );
      logs += 1;

      await client.send(new CommitTransactionCommand({ resourceArn, secretArn, transactionId }));
      moved += 1;
    } catch (err) {
      try {
        await client.send(new RollbackTransactionCommand({ resourceArn, secretArn, transactionId }));
      } catch { /* already rolled back */ }
      console.error(`  FAIL ${r.id}: ${err?.message || err}`);
    }
  }

  for (const t of openTasks) {
    const upd = await exec(
      `UPDATE tasks
       SET assigned_to_id = :to, updated_at = CAST(:now AS timestamptz)
       WHERE rec_id = :rec
         AND assigned_to_id = :from
         AND status IN ('Pending', 'In Progress')`,
      [
        { name: 'to', value: { stringValue: toUser.id } },
        { name: 'now', value: { stringValue: now } },
        { name: 'rec', value: { stringValue: t.rec_id } },
        { name: 'from', value: { stringValue: fromUser.id } },
      ],
    );
    if ((upd.numberOfRecordsUpdated || 0) === 1) tasksMoved += 1;
    else console.warn(`  skip task ${t.id}`);
  }

  for (const s of inbound) {
    const upd = await exec(
      `UPDATE inbound_submissions
       SET assigned_to_id = :to, updated_at = CAST(:now AS timestamptz)
       WHERE rec_id = :rec AND assigned_to_id = :from`,
      [
        { name: 'to', value: { stringValue: toUser.id } },
        { name: 'now', value: { stringValue: now } },
        { name: 'rec', value: { stringValue: s.rec_id } },
        { name: 'from', value: { stringValue: fromUser.id } },
      ],
    );
    if ((upd.numberOfRecordsUpdated || 0) === 1) inboundMoved += 1;
    else console.warn(`  skip inbound ${s.id}`);
  }

  if (moved > 0) {
    await exec(
      `INSERT INTO notifications (id, recipient_user_id, actor_user_id, type, entity_type, title, body, is_read, created_at, updated_at)
       VALUES (:id, :to, :actor, 'intake_owner_assigned', 'referral', :title, :body, false, CAST(:now AS timestamptz), CAST(:now AS timestamptz))`,
      [
        { name: 'id', value: { stringValue: nid('notif') } },
        { name: 'to', value: { stringValue: toUser.id } },
        { name: 'actor', value: { stringValue: actorUser.id } },
        { name: 'title', value: { stringValue: 'Intake caseload transferred to you' } },
        { name: 'body', value: { stringValue: `${actorUser.first_name} ${actorUser.last_name} reassigned ${moved} active case(s) from ${fromLabel} to you (team transfer).` } },
        { name: 'now', value: { stringValue: now } },
      ],
    );
  }

  const remaining = await query(
    `SELECT current_stage, count(*)::int AS n
     FROM referrals
     WHERE intake_owner_id = :uid
     GROUP BY current_stage
     ORDER BY 1`,
    [{ name: 'uid', value: { stringValue: fromUser.id } }],
  );
  const remainingOpenTasks = await query(
    `SELECT count(*)::int AS n FROM tasks
     WHERE assigned_to_id = :uid AND status IN ('Pending', 'In Progress')`,
    [{ name: 'uid', value: { stringValue: fromUser.id } }],
  );

  console.log(`\nApplied:`);
  console.log(`  referrals moved: ${moved}/${reassign.length}`);
  console.log(`  timeline notes:  ${notes}`);
  console.log(`  activity logs:   ${logs}`);
  console.log(`  open tasks moved:${tasksMoved}/${openTasks.length}`);
  console.log(`  inbound moved:   ${inboundMoved}/${inbound.length}`);
  console.log('\nMonira remaining intake ownership by stage:');
  for (const row of remaining) console.log(`  ${row.n}  ${row.current_stage}`);
  console.log(`Monira remaining open tasks: ${remainingOpenTasks[0]?.n ?? 0}`);
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
