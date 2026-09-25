#!/usr/bin/env node
/**
 * Backfill: original-marketer attribution + NTUC outcome dates (migration 0040).
 *
 * Part A — referrals.original_marketer_id
 *   Incentive credit belongs to the ORIGINALLY assigned marketer even after
 *   reassignment. Every reassignment writes an activity_log row with
 *   action='marketer_changed' and metadata { previousMarketerId, newMarketerId },
 *   so the true original is recoverable:
 *     - chronological chain of (previous → new) per referral; the original is
 *       the FIRST non-empty assignee in that chain
 *     - referrals with no marketer_changed activity: original = current marketer_id
 *   Rows where an existing original_marketer_id disagrees with the computed
 *   value are corrected and reported (e.g. the interim changeMarketer stamp).
 *
 * Part B — referrals.ntuc_date (only rows currently in NTUC with a NULL ntuc_date)
 *   Outcome date so NTUC is credited to the period it was resolved in.
 *   Source order (rows using a fallback are flagged in the report):
 *     1. stage_history row with to_stage='NTUC' (latest — re-NTUC restamps);
 *        includes legacy rows whose linkage was folded into metadata JSON
 *     2. ntuc_requested_at (text; parsed)
 *     3. updated_at (last resort — may land in the wrong quarter, review!)
 *
 * Usage:
 *   node scripts/backfill-marketer-attribution.js               # dry-run
 *   node scripts/backfill-marketer-attribution.js --confirm     # apply
 *   node scripts/backfill-marketer-attribution.js --limit 25    # cap writes
 *
 * Requires WB_CLUSTER_ARN + WB_SECRET_ARN (loads careStream/.env).
 * Target database via WB_DATABASE (default 'wellbound'; run against
 * 'wellbound_staging' first, review the report, then prod).
 *
 * Rollout order: apply migration 0040 and deploy the API (registry) BEFORE
 * running this. Safe to re-run — it is idempotent and self-correcting.
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

const resourceArn = process.env.WB_CLUSTER_ARN;
const secretArn = process.env.WB_SECRET_ARN;
const database = process.env.WB_DATABASE || 'wellbound';

let client;
function getClient() {
  if (!client) client = new RDSDataClient({ region: process.env.AWS_REGION || 'us-east-2' });
  return client;
}

async function exec(sql, parameters) {
  return getClient().send(new ExecuteStatementCommand({
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

const clean = (v) => {
  const s = String(v ?? '').trim();
  return s && s !== 'null' && s !== 'undefined' ? s : null;
};

/** Original marketer from a referral's chronological marketer_changed chain. */
export function resolveOriginalMarketer(currentMarketerId, changes) {
  if (!changes || changes.length === 0) return clean(currentMarketerId);
  const sorted = [...changes].sort(
    (a, b) => new Date(a.ts || 0).getTime() - new Date(b.ts || 0).getTime(),
  );
  // The chain, oldest first: prev1, new1, prev2, new2… The original is the
  // first non-empty assignee (prev1 unless the referral started unassigned).
  for (const c of sorted) {
    if (clean(c.prev)) return clean(c.prev);
    if (clean(c.next)) return clean(c.next);
  }
  return clean(currentMarketerId);
}

/** Pick the ntuc_date for one NTUC referral. Returns { ts, source }. */
export function resolveNtucDate(referral, historyTimestamps) {
  const valid = (v) => {
    if (!v) return null;
    const d = new Date(v);
    const y = d.getFullYear();
    return !Number.isNaN(d.getTime()) && y >= 1990 && y <= 2100 ? d.toISOString() : null;
  };
  const fromHistory = (historyTimestamps || [])
    .map(valid)
    .filter(Boolean)
    .sort()
    .pop();
  if (fromHistory) return { ts: fromHistory, source: 'stage_history' };
  const fromRequested = valid(referral.ntuc_requested_at);
  if (fromRequested) return { ts: fromRequested, source: 'ntuc_requested_at (FLAG: request time, review)' };
  const fromUpdated = valid(referral.updated_at);
  if (fromUpdated) return { ts: fromUpdated, source: 'updated_at (FLAG: may be wrong period, review)' };
  return { ts: null, source: 'none' };
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

  // ── Part A: original_marketer_id ──────────────────────────────────────────
  const referrals = await query(`
    SELECT rec_id, id, marketer_id, original_marketer_id
    FROM referrals
    ORDER BY id
  `);

  const activity = await query(`
    SELECT referral_id,
           metadata->>'previousMarketerId' AS prev,
           metadata->>'newMarketerId'      AS next,
           COALESCE(timestamp, created_at)::text AS ts
    FROM activity_log
    WHERE action = 'marketer_changed' AND referral_id IS NOT NULL
  `);

  const changesByReferral = {};
  for (const a of activity) {
    (changesByReferral[a.referral_id] ||= []).push(a);
  }

  const planA = [];
  let alreadyCorrect = 0;
  let noMarketerAtAll = 0;
  for (const r of referrals) {
    const changes = changesByReferral[r.id] || [];
    const original = resolveOriginalMarketer(r.marketer_id, changes);
    const existing = clean(r.original_marketer_id);
    if (!original) { noMarketerAtAll += 1; continue; }
    if (existing === original) { alreadyCorrect += 1; continue; }
    planA.push({
      rec_id: r.rec_id,
      id: r.id,
      original,
      note: existing
        ? `CORRECTION: had "${existing}"`
        : (changes.length ? `from ${changes.length} reassignment(s)` : 'copy of current marketer_id'),
    });
  }

  // ── Part B: ntuc_date ─────────────────────────────────────────────────────
  const ntucRows = await query(`
    SELECT rec_id, id, current_stage,
           ntuc_requested_at,
           updated_at::text AS updated_at
    FROM referrals
    WHERE current_stage = 'NTUC' AND ntuc_date IS NULL
    ORDER BY id
  `);

  // to_stage='NTUC' history, including legacy rows whose linkage was folded
  // into metadata JSON by the recordTransition fallback.
  const ntucHistory = await query(`
    SELECT COALESCE(referral_id, metadata->>'referral_id') AS ref,
           timestamp::text AS ts
    FROM stage_history
    WHERE to_stage = 'NTUC' OR metadata->>'to_stage' = 'NTUC'
  `);
  const historyByReferral = {};
  for (const h of ntucHistory) {
    if (!h.ref) continue;
    (historyByReferral[h.ref] ||= []).push(h.ts);
  }

  const planB = [];
  const unresolvable = [];
  for (const r of ntucRows) {
    const { ts, source } = resolveNtucDate(r, historyByReferral[r.id]);
    if (!ts) { unresolvable.push(r); continue; }
    planB.push({ rec_id: r.rec_id, id: r.id, ts, source });
  }

  // ── Report ────────────────────────────────────────────────────────────────
  console.log(`\n── Part A: original_marketer_id ──`);
  console.log(`Referrals examined: ${referrals.length}`);
  console.log(`Already correct/stamped: ${alreadyCorrect} · never had a marketer: ${noMarketerAtAll}`);
  console.log(`Planned writes: ${planA.length}`);
  for (const p of planA.slice(0, LIMIT || planA.length)) {
    console.log(`  ${p.id}  original_marketer_id → "${p.original}"  (${p.note})`);
  }

  console.log(`\n── Part B: ntuc_date ──`);
  console.log(`NTUC rows missing ntuc_date: ${ntucRows.length}`);
  console.log(`Planned writes: ${planB.length} · unresolvable: ${unresolvable.length}`);
  const flagged = planB.filter((p) => p.source.includes('FLAG'));
  for (const p of planB.slice(0, LIMIT || planB.length)) {
    console.log(`  ${p.id}  ntuc_date → ${p.ts.slice(0, 10)}  [${p.source}]`);
  }
  if (flagged.length) {
    console.log(`\n⚠ ${flagged.length} row(s) used a fallback source — spot-check before trusting historical quarters.`);
  }
  for (const u of unresolvable) console.log(`  UNRESOLVABLE ${u.id} — no usable timestamp, left NULL`);

  const writesA = LIMIT ? planA.slice(0, LIMIT) : planA;
  const writesB = LIMIT ? planB.slice(0, LIMIT) : planB;

  if (!writesA.length && !writesB.length) {
    console.log('\nNothing to write.');
    return;
  }
  if (!CONFIRM) {
    console.log('\nRe-run with --confirm to apply.');
    return;
  }

  let ok = 0;
  let failed = 0;
  for (const p of writesA) {
    try {
      await exec(
        'UPDATE referrals SET original_marketer_id = :val WHERE rec_id = :rec',
        [
          { name: 'val', value: { stringValue: p.original } },
          { name: 'rec', value: { stringValue: p.rec_id } },
        ],
      );
      ok += 1;
    } catch (err) {
      failed += 1;
      console.log(`  FAILED (A) ${p.id}: ${err?.message || err}`);
    }
  }
  for (const p of writesB) {
    try {
      // Guard on stage so a concurrently re-opened case is never stamped.
      await exec(
        `UPDATE referrals SET ntuc_date = :ts::timestamptz
         WHERE rec_id = :rec AND current_stage = 'NTUC' AND ntuc_date IS NULL`,
        [
          { name: 'ts', value: { stringValue: p.ts } },
          { name: 'rec', value: { stringValue: p.rec_id } },
        ],
      );
      ok += 1;
    } catch (err) {
      failed += 1;
      console.log(`  FAILED (B) ${p.id}: ${err?.message || err}`);
    }
  }
  console.log(`\nDone. Wrote ${ok}, failed ${failed}.`);
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
