#!/usr/bin/env node
/**
 * import-postgres.js — Phase 5 step 2: load db/export/*.ndjson into Aurora.
 *
 * Single pass: link-field columns already contain Airtable rec ids, and we
 * store rec ids verbatim in `rec_id` — so FK references resolve by value with
 * no topological ordering (FKs are not DB-enforced in v1; see the plan).
 *
 * Value shaping mirrors services/wellbound-api/src/records.js (registry-driven):
 *   jsonString → ::jsonb, textArray → text[], linkArray → first element,
 *   checkbox → boolean, timestamps → timestamptz, date → date.
 *
 * Idempotent: rows are upserted ON CONFLICT (rec_id) DO UPDATE, so the final
 * delta pass during the cutover write-freeze just re-runs this script.
 *
 * Env: WB_CLUSTER_ARN, WB_SECRET_ARN, WB_DATABASE (default wellbound)
 * Usage: node db/import-postgres.js [--table TableName] [--dry-run]
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
const DRY = process.argv.includes('--dry-run');
const ONLY = process.argv.includes('--table') ? process.argv[process.argv.indexOf('--table') + 1] : null;

if (!DRY && (!resourceArn || !secretArn)) {
  console.error('Set WB_CLUSTER_ARN and WB_SECRET_ARN (or use --dry-run).');
  process.exit(1);
}

const client = DRY ? null : new RDSDataClient({ region: process.env.AWS_REGION || 'us-east-2' });

async function exec(sql, parameters) {
  if (DRY) return { numberOfRecordsUpdated: 1 };
  return client.send(new ExecuteStatementCommand({ resourceArn, secretArn, database, sql, parameters }));
}

function shapeValue(fieldDef, value) {
  if (value === null || value === undefined) return null;
  switch (fieldDef.wire) {
    case 'checkbox':   return { type: 'bool', v: value === true };
    case 'jsonString': return { type: 'jsonb', v: typeof value === 'string' ? value : JSON.stringify(value) };
    case 'jsonRaw':    return { type: 'jsonb', v: JSON.stringify(value) };
    case 'linkArray':  return { type: 'text', v: Array.isArray(value) ? (value[0] ?? null) : String(value) };
    case 'textArray':  return { type: 'textArray', v: JSON.stringify(Array.isArray(value) ? value : [value]) };
    case 'timestamp':  return { type: 'timestamptz', v: String(value) };
    case 'date':       return { type: 'date', v: String(value).slice(0, 10) };
    case 'int':        return { type: 'bigint', v: String(value) };
    case 'float':      return { type: 'float', v: String(value) };
    default:           return { type: 'text', v: String(value) };
  }
}

async function importTable(tableName) {
  const def = REGISTRY[tableName];
  const file = path.join(EXPORT_DIR, `${tableName}.ndjson`);
  if (!fs.existsSync(file)) return { skipped: true };

  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  let upserted = 0;

  for (const line of lines) {
    const record = JSON.parse(line);
    const cols = ['"rec_id"'];
    const exprs = [];
    const parameters = [];
    let p = 0;
    const P = (name, value) => { parameters.push({ name, ...value }); return `:${name}`; };

    parameters.push({ name: 'rec_id', value: { stringValue: record.id } });
    exprs.push(':rec_id');

    // createdTime → created_at unless the table has its own created_at field value.
    const fieldsIn = { ...record.fields };
    if (!fieldsIn.created_at && record.createdTime) fieldsIn.created_at = record.createdTime;

    for (const [airtableName, value] of Object.entries(fieldsIn)) {
      const f = def.fields[airtableName];
      if (!f) continue; // field removed from schema — drop silently, noted in reconcile
      const shaped = shapeValue(f, value);
      if (shaped === null) continue;
      const name = `p${++p}`;
      cols.push(`"${f.column}"`);
      switch (shaped.type) {
        case 'bool':        exprs.push(P(name, { value: { booleanValue: shaped.v } })); break;
        case 'jsonb':       exprs.push(`${P(name, { value: { stringValue: shaped.v } })}::jsonb`); break;
        case 'textArray':   exprs.push(`(SELECT coalesce(array_agg(x), '{}') FROM jsonb_array_elements_text(${P(name, { value: { stringValue: shaped.v } })}::jsonb) AS t(x))`); break;
        case 'timestamptz': exprs.push(`${P(name, { value: { stringValue: shaped.v } })}::timestamptz`); break;
        case 'date':        exprs.push(`${P(name, { value: { stringValue: shaped.v } })}::date`); break;
        case 'bigint':      exprs.push(`${P(name, { value: { stringValue: shaped.v } })}::bigint`); break;
        case 'float':       exprs.push(`${P(name, { value: { stringValue: shaped.v } })}::double precision`); break;
        default:            exprs.push(P(name, { value: { stringValue: shaped.v } }));
      }
    }

    const updates = cols.slice(1).map((c) => `${c} = EXCLUDED.${c}`);
    const sql = `INSERT INTO "${def.pgTable}" (${cols.join(', ')}) VALUES (${exprs.join(', ')})
      ON CONFLICT (rec_id) DO UPDATE SET ${updates.length ? updates.join(', ') : '"rec_id" = EXCLUDED."rec_id"'}`;
    await exec(sql, parameters);
    upserted++;
  }
  return { upserted, source: lines.length };
}

const summary = {};
for (const tableName of Object.keys(REGISTRY)) {
  if (ONLY && tableName !== ONLY) continue;
  process.stdout.write(`Importing ${tableName} … `);
  try {
    const r = await importTable(tableName);
    summary[tableName] = r;
    console.log(r.skipped ? 'SKIP (no export file)' : `${r.upserted}/${r.source} upserted`);
  } catch (err) {
    summary[tableName] = { error: err.message };
    console.error(`FAILED: ${err.message}`);
    process.exitCode = 1;
  }
}

fs.writeFileSync(path.join(EXPORT_DIR, '_import-summary.json'), JSON.stringify(summary, null, 2));
console.log('\nDone. Summary: db/export/_import-summary.json — now run db/reconcile.js');
