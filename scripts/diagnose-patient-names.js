#!/usr/bin/env node
/**
 * READ-ONLY diagnostic: verify recent referrals join to patient rows with names.
 * No writes of any kind.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';

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

const resourceArn = process.env.WB_CLUSTER_ARN;
const secretArn = process.env.WB_SECRET_ARN;
const database = process.env.WB_DATABASE || 'wellbound';
if (!resourceArn || !secretArn) {
  console.error('Missing WB_CLUSTER_ARN / WB_SECRET_ARN');
  process.exit(1);
}

const client = new RDSDataClient({ region: process.env.AWS_REGION || 'us-east-2' });

async function query(sql) {
  const res = await client.send(new ExecuteStatementCommand({
    resourceArn, secretArn, database, sql, includeResultMetadata: true,
  }));
  const cols = (res.columnMetadata || []).map((c) => c.name);
  return (res.records || []).map((row) => {
    const o = {};
    row.forEach((c, i) => {
      o[cols[i]] = c.stringValue ?? c.longValue ?? c.booleanValue ?? c.doubleValue ?? (c.isNull ? null : null);
    });
    return o;
  });
}

const refs = await query(`
  SELECT id, patient_id, current_stage, division, referral_date, created_at
    FROM referrals
   ORDER BY created_at DESC NULLS LAST
   LIMIT 12
`);
console.log('=== 12 most recent referrals ===');
for (const r of refs) {
  console.log(`${r.id} | patient_id=${JSON.stringify(r.patient_id)} | ${r.current_stage} | ${r.created_at}`);
}

const ids = [...new Set(refs.map((r) => String(r.patient_id || '').trim()).filter(Boolean))];
if (ids.length) {
  const inList = ids.map((i) => `'${i.replace(/'/g, "''")}'`).join(',');
  const pats = await query(`
    SELECT id, rec_id, first_name, last_name, division, created_at
      FROM patients
     WHERE TRIM(id) IN (${inList}) OR TRIM(rec_id) IN (${inList})
  `);
  console.log('\n=== matching patient rows ===');
  for (const p of pats) {
    console.log(`${p.id} | rec=${p.rec_id} | name="${p.first_name} ${p.last_name}" | ${p.created_at}`);
  }
  const found = new Set(pats.flatMap((p) => [String(p.id || '').trim(), String(p.rec_id || '').trim()]));
  const missing = ids.filter((i) => !found.has(i));
  console.log('\n=== referral patient_ids with NO patient row ===');
  console.log(missing.length ? missing.join('\n') : '(none — all joins OK)');
}

const counts = await query(`
  SELECT
    (SELECT COUNT(*) FROM patients) AS patients,
    (SELECT COUNT(*) FROM referrals) AS referrals,
    (SELECT COUNT(*) FROM patients WHERE COALESCE(TRIM(first_name),'') = '' AND COALESCE(TRIM(last_name),'') = '') AS nameless_patients
`);
console.log('\n=== totals ===', counts[0]);
