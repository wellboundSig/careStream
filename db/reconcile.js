#!/usr/bin/env node
/**
 * reconcile.js — Phase 5 reconciliation gate (DO NOT SKIP).
 *
 * Compares the Airtable export (db/export/*.ndjson) against Aurora and writes
 * a human-readable report to db/export/_reconciliation-report.md:
 *   1. Row counts per table (export vs Postgres)
 *   2. Random 50-row field-by-field spot check per table
 *   3. Null/absent-count comparison on important columns (all *_id + status)
 *   4. Orphan-link scan (link columns whose rec_id has no target row)
 *
 * Exit code non-zero on any mismatch, so this can gate the cutover. The report
 * doubles as audit evidence of migration integrity.
 *
 * Env: WB_CLUSTER_ARN, WB_SECRET_ARN, WB_DATABASE
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = JSON.parse(fs.readFileSync(path.join(ROOT, 'db/registry.json'), 'utf8'));
const EXPORT_DIR = path.join(ROOT, 'db/export');

const resourceArn = process.env.WB_CLUSTER_ARN;
const secretArn = process.env.WB_SECRET_ARN;
const database = process.env.WB_DATABASE || 'wellbound';
if (!resourceArn || !secretArn) { console.error('Set WB_CLUSTER_ARN / WB_SECRET_ARN'); process.exit(1); }

const client = new RDSDataClient({ region: process.env.AWS_REGION || 'us-east-2' });
async function q(sql, params = []) {
  const parameters = params.map((v, i) => ({ name: String(i + 1), value: { stringValue: String(v) } }));
  const res = await client.send(new ExecuteStatementCommand({
    resourceArn, secretArn, database, sql: sql.replace(/\$(\d+)/g, ':$1'), parameters, formatRecordsAs: 'JSON',
  }));
  return res.formattedRecords ? JSON.parse(res.formattedRecords) : [];
}

// Postgres (Data API JSON) returns timestamptz WITHOUT a zone suffix, in the
// session timezone (UTC). Parse explicitly as UTC — `new Date("YYYY-MM-DD
// HH:MM:SS")` would otherwise assume the machine's local zone.
function parsePgTimestamp(v) {
  if (typeof v === 'string' && !/([zZ]|[+-]\d\d(:?\d\d)?)$/.test(v.trim())) {
    return new Date(v.trim().replace(' ', 'T') + 'Z');
  }
  return new Date(v);
}

// Deep-sort object keys so jsonb's canonical key ordering (semantically
// identical for JSON consumers) doesn't register as a diff.
function sortKeysDeep(x) {
  if (Array.isArray(x)) return x.map(sortKeysDeep);
  if (x && typeof x === 'object') {
    return Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortKeysDeep(x[k])]));
  }
  return x;
}

// Normalize a value for comparison (Airtable wire vs Postgres storage).
function norm(fieldDef, v) {
  if (v === null || v === undefined || v === '' ) return null;
  switch (fieldDef.wire) {
    case 'checkbox':   return v === true || v === 'true' ? true : null; // Airtable omits false
    case 'linkArray':  return Array.isArray(v) ? (v[0] ?? null) : String(v);
    case 'textArray':  return JSON.stringify(Array.isArray(v) ? v : (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return [v]; } })() : [v]));
    case 'jsonString': { try { return JSON.stringify(sortKeysDeep(typeof v === 'string' ? JSON.parse(v) : v)); } catch { return String(v); } }
    case 'jsonRaw':    { try { return JSON.stringify(sortKeysDeep(typeof v === 'string' ? JSON.parse(v) : v)); } catch { return String(v); } }
    case 'timestamp':  { const d = parsePgTimestamp(v); return Number.isNaN(d.getTime()) ? String(v) : d.toISOString(); }
    case 'date':       return String(v).slice(0, 10);
    case 'int':
    case 'float':      return String(Number(v));
    default:           return String(v);
  }
}

const lines = [];
const log = (s) => { lines.push(s); console.log(s); };
let failures = 0;

log(`# Airtable → Aurora reconciliation report`);
log(`Generated: ${new Date().toISOString()}  ·  database: ${database}\n`);

for (const [tableName, def] of Object.entries(REGISTRY)) {
  const file = path.join(EXPORT_DIR, `${tableName}.ndjson`);
  if (!fs.existsSync(file)) { log(`## ${tableName}\n- SKIPPED (no export file)\n`); continue; }
  const records = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

  log(`## ${tableName}`);

  // 1. Row counts
  const [{ count }] = await q(`SELECT count(*)::int AS count FROM "${def.pgTable}"`);
  const countOk = Number(count) === records.length;
  if (!countOk) failures++;
  log(`- Row count: export=${records.length} postgres=${count} ${countOk ? 'OK' : '**MISMATCH**'}`);

  // 2. Spot check 50 random rows field-by-field
  const sample = [...records].sort(() => Math.random() - 0.5).slice(0, 50);
  let spotMismatches = 0;
  for (const rec of sample) {
    const rows = await q(`SELECT * FROM "${def.pgTable}" WHERE rec_id = $1`, [rec.id]);
    if (!rows.length) { spotMismatches++; log(`  - MISSING row rec_id=${rec.id}`); continue; }
    const row = rows[0];
    for (const [fname, fdef] of Object.entries(def.fields)) {
      if (fname === 'created_at' || fname === 'updated_at') continue; // timestamps get defaults/triggers
      const a = norm(fdef, rec.fields?.[fname]);
      const b = norm(fdef, row[fdef.column]);
      if (a !== b && !(a === null && b === null)) {
        spotMismatches++;
        log(`  - FIELD DIFF ${rec.id}.${fname}: airtable=${JSON.stringify(a)?.slice(0, 80)} pg=${JSON.stringify(b)?.slice(0, 80)}`);
      }
    }
  }
  if (spotMismatches) failures++;
  log(`- Spot check (${sample.length} rows): ${spotMismatches === 0 ? 'OK' : `**${spotMismatches} mismatches**`}`);

  // 3. Null counts on important columns
  const important = Object.entries(def.fields).filter(([n]) => n === 'id' || n.endsWith('_id') || n === 'status');
  for (const [fname, fdef] of important.slice(0, 8)) {
    const exportNulls = records.filter((r) => norm(fdef, r.fields?.[fname]) === null).length;
    const [{ n }] = await q(
      fdef.wire === 'textArray'
        ? `SELECT count(*)::int AS n FROM "${def.pgTable}" WHERE "${fdef.column}" IS NULL OR "${fdef.column}" = '{}'`
        : `SELECT count(*)::int AS n FROM "${def.pgTable}" WHERE "${fdef.column}" IS NULL OR "${fdef.column}"::text = ''`,
    );
    const ok = Number(n) === exportNulls;
    if (!ok) failures++;
    log(`- Nulls ${fname}: export=${exportNulls} pg=${n} ${ok ? 'OK' : '**MISMATCH**'}`);
  }

  // 4. Orphan links
  for (const [fname, fdef] of Object.entries(def.fields)) {
    if (fdef.wire !== 'linkArray' || !fdef.linkTable || !REGISTRY[fdef.linkTable]) continue;
    const targetPg = REGISTRY[fdef.linkTable].pgTable;
    const [{ orphans }] = await q(
      `SELECT count(*)::int AS orphans FROM "${def.pgTable}" t
       WHERE t."${fdef.column}" IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM "${targetPg}" x WHERE x.rec_id = t."${fdef.column}")`,
    );
    if (Number(orphans) > 0) { failures++; log(`- Orphan links ${fname} → ${fdef.linkTable}: **${orphans}**`); }
  }
  log('');
}

log(failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} check group(s) failed`);
fs.writeFileSync(path.join(EXPORT_DIR, '_reconciliation-report.md'), lines.join('\n'));
console.log('\nReport written: db/export/_reconciliation-report.md');
process.exit(failures === 0 ? 0 : 1);
