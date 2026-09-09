#!/usr/bin/env node
/**
 * Reassign intake owners from "Case Distribution 9.8.csv".
 *
 * Maps CSV first names:
 *   Noemi   → Noemi Martinez
 *   Sandy   → Sandy Grounon
 *   Vanessa → Vanessa Villa
 *
 * Usage (from careStream/):
 *   node scripts/reassign-from-distribution-csv.js
 *   node scripts/reassign-from-distribution-csv.js --confirm
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
const CSV_PATH = process.argv.find((a) => a.endsWith('.csv'))
  || '/Users/RBaridesWellbound/Desktop/Case Distribution 9.8.csv';

const resourceArn = process.env.WB_CLUSTER_ARN;
const secretArn = process.env.WB_SECRET_ARN;
const database = process.env.WB_DATABASE || 'wellbound';
if (!resourceArn || !secretArn) {
  console.error('Set WB_CLUSTER_ARN and WB_SECRET_ARN');
  process.exit(1);
}

const client = new RDSDataClient({ region: process.env.AWS_REGION || 'us-east-2' });

const OWNER_MAP = {
  noemi: { first: 'noemi', last: 'martinez' },
  sandy: { first: 'sandy', last: 'grounon' },
  vanessa: { first: 'vanessa', last: 'villa' },
};

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

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokens(s) {
  return norm(s).split(' ').filter(Boolean);
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => t(l));
  function t(s) { return String(s || '').trim(); }
  const header = lines[0].split(',').map((h) => t(h).toLowerCase());
  const pi = header.findIndex((h) => h.startsWith('patient'));
  const di = header.findIndex((h) => h.startsWith('division'));
  const ri = header.findIndex((h) => h.includes('referral'));
  const oi = header.findIndex((h) => h.includes('owner'));
  const rows = [];
  for (const line of lines.slice(1)) {
    // Simple CSV: no quoted commas in this file.
    const cols = line.split(',');
    const patient = t(cols[pi]);
    const owner = t(cols[oi]);
    if (!patient || !owner) continue;
    rows.push({
      patient,
      division: t(cols[di]),
      referralDate: t(cols[ri]),
      ownerKey: norm(owner).split(' ')[0],
    });
  }
  return rows;
}

function nameScore(csvName, first, last) {
  const csv = tokens(csvName);
  const db = tokens(`${first} ${last}`);
  if (!csv.length || !db.length) return 0;
  const csvJoin = csv.join(' ');
  const dbJoin = db.join(' ');
  if (csvJoin === dbJoin) return 100;
  // last-name token match is required
  const csvLast = csv[csv.length - 1];
  const dbLast = db[db.length - 1];
  const lastOk = csvLast === dbLast
    || csvJoin.replace(/\s/g, '') === dbJoin.replace(/\s/g, '')
    || dbJoin.replace(/\s/g, '').includes(csvLast)
    || csvJoin.replace(/\s/g, '').includes(dbLast);
  if (!lastOk) return 0;
  const csvFirst = csv[0];
  const dbFirst = db[0];
  if (csvFirst !== dbFirst) return 0;
  const csvSet = new Set(csv);
  const overlap = db.filter((t) => csvSet.has(t)).length;
  const compactEq = csvJoin.replace(/\s/g, '') === dbJoin.replace(/\s/g, '');
  if (compactEq) return 95;
  return 70 + overlap;
}

function pickReferral(cands, csvDate) {
  if (!cands.length) return null;
  const closed = new Set(['Completed', 'NTUC', 'Discarded Leads']);
  const open = cands.filter((r) => !closed.has(r.current_stage));
  const pool = open.length ? open : cands;
  if (pool.length === 1) return pool[0];
  if (csvDate) {
    const target = Date.parse(csvDate);
    if (!Number.isNaN(target)) {
      let best = pool[0];
      let bestDiff = Infinity;
      for (const r of pool) {
        const d = Date.parse(r.referral_date || '');
        const diff = Number.isNaN(d) ? Infinity : Math.abs(d - target);
        if (diff < bestDiff) { best = r; bestDiff = diff; }
      }
      return best;
    }
  }
  return pool.sort((a, b) => String(b.referral_date || '').localeCompare(String(a.referral_date || '')))[0];
}

async function findUser(first, last) {
  return query(
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
}

function nid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

async function main() {
  console.log(`Database: ${database}`);
  console.log(`CSV: ${CSV_PATH}`);
  console.log(CONFIRM ? '=== CONFIRM MODE — writes will run ===' : '=== DRY RUN (pass --confirm to apply) ===');

  const csvRows = parseCsv(readFileSync(CSV_PATH, 'utf8'));
  console.log(`CSV rows: ${csvRows.length}`);

  const usersByKey = {};
  for (const [key, spec] of Object.entries(OWNER_MAP)) {
    const hits = await findUser(spec.first, spec.last);
    if (!hits.length) {
      console.error(`User not found: ${spec.first} ${spec.last}`);
      process.exit(1);
    }
    usersByKey[key] = hits[0];
    console.log(`  ${key}: ${hits[0].first_name} ${hits[0].last_name} (${hits[0].id}) status=${hits[0].status || 'Active'}`);
  }

  const actorHits = await findUser('rafi', 'barides');
  const actor = actorHits[0];
  if (!actor) {
    console.error('Actor Rafi Barides not found');
    process.exit(1);
  }
  console.log(`Actor: ${actor.first_name} ${actor.last_name} (${actor.id})`);

  const referrals = await query(
    `SELECT r.rec_id, r.id, r.patient_id, r.current_stage, r.division, r.intake_owner_id,
            r.referral_date::text AS referral_date,
            p.first_name, p.last_name,
            concat_ws(' ', p.first_name, p.last_name) AS patient_name,
            concat_ws(' ', u.first_name, u.last_name) AS current_owner
     FROM referrals r
     LEFT JOIN patients p ON p.id = r.patient_id
     LEFT JOIN users u ON u.id = r.intake_owner_id
     ORDER BY r.id`,
  );
  console.log(`Referrals loaded: ${referrals.length}`);

  const plan = [];
  const unmatched = [];
  const already = [];
  const ambiguous = [];

  for (const row of csvRows) {
    const targetUser = usersByKey[row.ownerKey];
    if (!targetUser) {
      unmatched.push({ ...row, reason: `unknown owner key "${row.ownerKey}"` });
      continue;
    }

    const scored = [];
    for (const r of referrals) {
      const score = nameScore(row.patient, r.first_name, r.last_name);
      if (score < 70) continue;
      scored.push({ r, score });
    }

    if (!scored.length) {
      unmatched.push({ ...row, reason: 'no patient name match' });
      continue;
    }

    const bestScore = Math.max(...scored.map((s) => s.score));
    const top = scored.filter((s) => s.score === bestScore);
    const chosen = pickReferral(top.map((s) => s.r), row.referralDate);
    if (!chosen) {
      unmatched.push({ ...row, reason: 'matched patient but no referral' });
      continue;
    }

    const closed = new Set(['Completed', 'NTUC', 'Discarded Leads']);
    const openTop = top.filter((s) => !closed.has(s.r.current_stage));
    const openPatients = [...new Set(openTop.map((s) => s.r.patient_id).filter(Boolean))];
    if (openPatients.length > 1) {
      ambiguous.push({
        ...row,
        reason: `multiple open patients: ${openTop.map((s) => `${s.r.patient_name} (${s.r.id} ${s.r.current_stage})`).join('; ')}`,
      });
      continue;
    }

    if (chosen.intake_owner_id === targetUser.id) {
      already.push({ row, chosen, targetUser });
      continue;
    }

    plan.push({ row, chosen, targetUser, score: bestScore });
  }

  const byOwner = {};
  for (const p of plan) {
    const k = `${p.targetUser.first_name} ${p.targetUser.last_name}`;
    byOwner[k] = (byOwner[k] || 0) + 1;
  }

  console.log(`\nAlready correct: ${already.length}`);
  for (const a of already) {
    console.log(`  OK    ${a.row.patient}  [${a.chosen.current_stage}]  already ${a.targetUser.first_name}`);
  }

  console.log(`\nREASSIGN: ${plan.length}`);
  for (const [k, n] of Object.entries(byOwner)) console.log(`  → ${k}: ${n}`);
  for (const p of plan) {
    console.log(
      `  MOVE  ${p.chosen.patient_name}  [${p.chosen.current_stage}]  `
      + `${p.chosen.current_owner || p.chosen.intake_owner_id || '—'} → ${p.targetUser.first_name} ${p.targetUser.last_name}  `
      + `${p.chosen.id}  score=${p.score}`,
    );
  }

  if (ambiguous.length) {
    console.log(`\nAMBIGUOUS (skipped): ${ambiguous.length}`);
    for (const a of ambiguous) console.log(`  ?  ${a.patient} → ${a.ownerKey}: ${a.reason}`);
  }
  if (unmatched.length) {
    console.log(`\nUNMATCHED: ${unmatched.length}`);
    for (const u of unmatched) console.log(`  ✗  ${u.patient} → ${u.ownerKey}: ${u.reason}`);
  }

  if (!CONFIRM) {
    console.log('\nDry run complete. No writes.');
    if (unmatched.length || ambiguous.length) process.exitCode = 2;
    return;
  }

  if (unmatched.length || ambiguous.length) {
    console.error('\nAborting apply: resolve unmatched/ambiguous rows first.');
    process.exit(1);
  }
  if (!plan.length) {
    console.log('\nNothing to apply.');
    return;
  }

  const now = new Date().toISOString();
  let moved = 0;
  let notes = 0;
  let logs = 0;
  const movedBy = {};

  for (const p of plan) {
    const fromLabel = p.chosen.current_owner || p.chosen.intake_owner_id || 'Unassigned';
    const toLabel = `${p.targetUser.first_name} ${p.targetUser.last_name}`;
    const detail = `Intake owner changed: ${fromLabel} → ${toLabel} (case distribution 9.8)`;
    const tx = await client.send(new BeginTransactionCommand({ resourceArn, secretArn, database }));
    const transactionId = tx.transactionId;
    try {
      const upd = await exec(
        `UPDATE referrals
         SET intake_owner_id = :to,
             intake_owner_changed_at = CAST(:now AS timestamptz),
             intake_owner_changed_by_id = :actor,
             updated_at = CAST(:now AS timestamptz)
         WHERE rec_id = :rec`,
        [
          { name: 'to', value: { stringValue: p.targetUser.id } },
          { name: 'now', value: { stringValue: now } },
          { name: 'actor', value: { stringValue: actor.id } },
          { name: 'rec', value: { stringValue: p.chosen.rec_id } },
        ],
        transactionId,
      );
      if ((upd.numberOfRecordsUpdated || 0) !== 1) {
        await client.send(new RollbackTransactionCommand({ resourceArn, secretArn, transactionId }));
        console.warn(`  skip ${p.chosen.id}: update did not apply`);
        continue;
      }

      await exec(
        `INSERT INTO notes (id, patient_id, referral_id, author_id, content, is_pinned, created_at, updated_at)
         VALUES (:id, :pid, :rid, :author, :content, false, CAST(:now AS timestamptz), CAST(:now AS timestamptz))`,
        [
          { name: 'id', value: { stringValue: nid('note') } },
          { name: 'pid', value: p.chosen.patient_id ? { stringValue: p.chosen.patient_id } : { isNull: true } },
          { name: 'rid', value: p.chosen.id ? { stringValue: p.chosen.id } : { isNull: true } },
          { name: 'author', value: { stringValue: actor.id } },
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
          { name: 'actor', value: { stringValue: actor.id } },
          { name: 'pid', value: p.chosen.patient_id ? { stringValue: p.chosen.patient_id } : { isNull: true } },
          { name: 'rid', value: p.chosen.id ? { stringValue: p.chosen.id } : { isNull: true } },
          { name: 'detail', value: { stringValue: detail } },
          { name: 'meta', value: { stringValue: JSON.stringify({
            previousOwnerId: p.chosen.intake_owner_id,
            newOwnerId: p.targetUser.id,
            previousOwnerName: fromLabel,
            newOwnerName: toLabel,
            reason: 'case distribution 9.8',
          }) } },
          { name: 'now', value: { stringValue: now } },
        ],
        transactionId,
      );
      logs += 1;

      await client.send(new CommitTransactionCommand({ resourceArn, secretArn, transactionId }));
      moved += 1;
      const k = toLabel;
      movedBy[k] = (movedBy[k] || 0) + 1;
    } catch (err) {
      try {
        await client.send(new RollbackTransactionCommand({ resourceArn, secretArn, transactionId }));
      } catch { /* already rolled back */ }
      console.error(`  FAIL ${p.chosen.id} ${p.chosen.patient_name}: ${err?.message || err}`);
    }
  }

  const notifNow = new Date().toISOString();
  for (const [key, user] of Object.entries(usersByKey)) {
    const n = movedBy[`${user.first_name} ${user.last_name}`] || 0;
    if (!n) continue;
    await exec(
      `INSERT INTO notifications (id, recipient_user_id, actor_user_id, type, entity_type, title, body, is_read, created_at, updated_at)
       VALUES (:id, :to, :actor, 'intake_owner_assigned', 'referral', :title, :body, false, CAST(:now AS timestamptz), CAST(:now AS timestamptz))`,
      [
        { name: 'id', value: { stringValue: nid('notif') } },
        { name: 'to', value: { stringValue: user.id } },
        { name: 'actor', value: { stringValue: actor.id } },
        { name: 'title', value: { stringValue: 'Intake cases assigned to you' } },
        { name: 'body', value: { stringValue: `${actor.first_name} ${actor.last_name} assigned you ${n} case(s) from the 9.8 distribution.` } },
        { name: 'now', value: { stringValue: notifNow } },
      ],
    );
  }

  console.log(`\nApplied: ${moved}/${plan.length} referrals, notes=${notes}, activity=${logs}`);
  for (const [k, n] of Object.entries(movedBy)) console.log(`  ${k}: ${n}`);
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
