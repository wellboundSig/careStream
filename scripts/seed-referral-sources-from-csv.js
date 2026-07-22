#!/usr/bin/env node
/**
 * Seed CareStream referral_sources from marketing CSV.
 *
 * Mapping:
 *   CSV "Referral source"  → organization/channel → source_entity + type
 *   CSV "Referral Contact" → PERSON               → name (+ phone/email)
 *
 * Usage:
 *   node scripts/seed-referral-sources-from-csv.js [csvPath]           # dry-run
 *   node scripts/seed-referral-sources-from-csv.js [csvPath] --confirm
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIRM = process.argv.includes('--confirm');
const csvPath = process.argv.slice(2).find((a) => a && !a.startsWith('--'))
  || path.join(process.env.HOME || '', 'Desktop', 'referal sources.csv');

const resourceArn = process.env.WB_CLUSTER_ARN;
const secretArn = process.env.WB_SECRET_ARN;
const database = process.env.WB_DATABASE || 'wellbound';
if (!resourceArn || !secretArn) {
  console.error('Set WB_CLUSTER_ARN and WB_SECRET_ARN');
  process.exit(1);
}

const client = new RDSDataClient({ region: process.env.AWS_REGION || 'us-east-2' });
async function exec(sql, parameters) {
  return client.send(new ExecuteStatementCommand({
    resourceArn, secretArn, database, sql, parameters, includeResultMetadata: true,
  }));
}

function normKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function detectParser(filePath) {
  const head = fs.readFileSync(filePath, 'utf8').slice(0, 400).toLowerCase();
  if (head.includes('facility') && head.includes('email address')) {
    return path.join(__dirname, 'parse-contact-list-csv.py');
  }
  return path.join(__dirname, 'parse-referral-sources-csv.py');
}

function parseViaPython(filePath) {
  const py = detectParser(filePath);
  console.log(`Parser: ${path.basename(py)}`);
  const res = spawnSync('python3', [py, filePath], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (res.status !== 0) {
    console.error(res.stderr || res.error);
    process.exit(1);
  }
  // stdout may include trailing comment lines — take JSON object only
  const start = res.stdout.indexOf('{');
  const end = res.stdout.lastIndexOf('}');
  if (start < 0 || end < 0) {
    console.error('Parser returned no JSON');
    process.exit(1);
  }
  return JSON.parse(res.stdout.slice(start, end + 1));
}

async function main() {
  if (!fs.existsSync(csvPath)) {
    console.error('CSV not found:', csvPath);
    process.exit(1);
  }
  console.log(`Reading ${csvPath}`);
  const { sources, skipped } = parseViaPython(csvPath);
  console.log(`Parsed ${sources.length} unique contacts (${skipped.length} rows skipped)`);

  const existingRes = await exec(
    `SELECT id, name, type, COALESCE(source_entity,''), COALESCE(email,''), COALESCE(phone,'')
     FROM referral_sources`,
  );
  const existing = (existingRes.records || []).map((r) => ({
    id: r[0]?.stringValue || '',
    name: r[1]?.stringValue || '',
    type: r[2]?.stringValue || '',
    source_entity: r[3]?.stringValue || '',
    email: r[4]?.stringValue || '',
    phone: r[5]?.stringValue || '',
  }));
  const existingKeys = new Set(existing.map((e) => `${normKey(e.name)}|${normKey(e.source_entity)}`));

  const toInsert = [];
  const toSkipDup = [];
  for (const s of sources) {
    const key = `${normKey(s.name)}|${normKey(s.source_entity)}`;
    if (existingKeys.has(key)) toSkipDup.push(s);
    else toInsert.push(s);
  }

  const byType = {};
  const byEntity = {};
  for (const s of toInsert) {
    byType[s.type] = (byType[s.type] || 0) + 1;
    const e = s.source_entity || '(none)';
    byEntity[e] = (byEntity[e] || 0) + 1;
  }

  console.log('\n── Preview ──');
  console.log(`New: ${toInsert.length}  |  Dup skip: ${toSkipDup.length}  |  Already in DB: ${existing.length}`);
  console.log('\nBy type:');
  Object.entries(byType).sort((a, b) => b[1] - a[1]).forEach(([t, n]) => console.log(`  ${String(n).padStart(3)}  ${t}`));
  console.log('\nTop entities:');
  Object.entries(byEntity).sort((a, b) => b[1] - a[1]).slice(0, 25)
    .forEach(([e, n]) => console.log(`  ${String(n).padStart(3)}  ${e}`));
  console.log('\nSample:');
  toInsert.slice(0, 30).forEach((s) => {
    console.log(`  ${s.name} | ${s.type} | ${s.source_entity || '—'} | ${s.email || '—'} | ${s.phone || '—'}`);
  });

  const outPath = path.join(__dirname, `seed-referral-sources-preview.json`);
  fs.writeFileSync(outPath, JSON.stringify({ toInsert, toSkipDup, skipped: skipped.slice(0, 100) }, null, 2));
  console.log(`\nWrote ${outPath}`);

  if (!CONFIRM) {
    console.log('\nDry-run only. Re-run with --confirm to insert.');
    return;
  }

  console.log(`\nInserting ${toInsert.length} into ${database}.referral_sources …`);
  let ok = 0;
  let fail = 0;
  for (const s of toInsert) {
    const recId = `rec${crypto.randomBytes(8).toString('hex')}`;
    const now = new Date().toISOString();
    try {
      await exec(
        `INSERT INTO referral_sources
          (rec_id, id, name, type, source_entity, phone, email, is_active, created_at, updated_at)
         VALUES
          (:rec_id, :id, :name, :type, :source_entity, :phone, :email, :is_active,
           CAST(:created_at AS timestamptz), CAST(:updated_at AS timestamptz))`,
        [
          { name: 'rec_id', value: { stringValue: recId } },
          { name: 'id', value: { stringValue: s.id } },
          { name: 'name', value: { stringValue: s.name } },
          { name: 'type', value: { stringValue: s.type } },
          { name: 'source_entity', value: s.source_entity ? { stringValue: s.source_entity } : { isNull: true } },
          { name: 'phone', value: s.phone ? { stringValue: s.phone } : { isNull: true } },
          { name: 'email', value: s.email ? { stringValue: s.email } : { isNull: true } },
          { name: 'is_active', value: { stringValue: 'TRUE' } },
          { name: 'created_at', value: { stringValue: now } },
          { name: 'updated_at', value: { stringValue: now } },
        ],
      );
      ok += 1;
    } catch (err) {
      fail += 1;
      console.error(`  FAIL ${s.name} (${s.id}):`, err.message);
    }
  }
  console.log(`Done — inserted ${ok}, failed ${fail}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
