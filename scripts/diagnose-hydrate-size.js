#!/usr/bin/env node
/** READ-ONLY: row counts + estimated JSON payload per hydrated table. */
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
    if (!process.env[k]) process.env[k] = t.slice(eq + 1).trim();
  }
} catch { /* no .env */ }

const client = new RDSDataClient({ region: process.env.AWS_REGION || 'us-east-2' });
const cfg = {
  resourceArn: process.env.WB_CLUSTER_ARN,
  secretArn: process.env.WB_SECRET_ARN,
  database: process.env.WB_DATABASE || 'wellbound',
};

async function query(sql) {
  const res = await client.send(new ExecuteStatementCommand({ ...cfg, sql, includeResultMetadata: true }));
  const cols = (res.columnMetadata || []).map((c) => c.name);
  return (res.records || []).map((row) => {
    const o = {};
    row.forEach((c, i) => { o[cols[i]] = c.stringValue ?? c.longValue ?? c.doubleValue ?? null; });
    return o;
  });
}

const tables = await query(`
  SELECT table_name FROM information_schema.tables
  WHERE table_schema = 'public' ORDER BY table_name
`);

const rows = [];
for (const t of tables) {
  const name = t.table_name;
  try {
    const [r] = await query(`
      SELECT COUNT(*) AS n,
             COALESCE(SUM(pg_column_size(x.*)), 0) AS bytes
      FROM "${name}" x
    `);
    rows.push({ name, n: Number(r.n), bytes: Number(r.bytes) });
  } catch { /* skip */ }
}

rows.sort((a, b) => b.bytes - a.bytes);
let total = 0;
console.log('table | rows | approx size');
for (const r of rows) {
  total += r.bytes;
  console.log(`${r.name} | ${r.n} | ${(r.bytes / 1024 / 1024).toFixed(2)} MB`);
}
console.log(`\nTOTAL (raw row bytes): ${(total / 1024 / 1024).toFixed(2)} MB`);
console.log('(JSON wire format is typically 1.5–3x raw row bytes)');
