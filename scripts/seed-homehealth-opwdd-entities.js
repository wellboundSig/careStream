#!/usr/bin/env node
/**
 * Seed homehealth_opwdd_entities from
 * scripts/data/opwdd_packet_submission_partners.csv (2026-08-26 OPWDD revamp).
 *
 * The table drives the searchable "submitted to" dropdown in the revamped
 * OPWDD workspace (Phase 2 · Step 4 — submit packet to a health home).
 *
 * Idempotent: rows are matched by name; existing rows are skipped, so the
 * script can be re-run safely. Ids are sequential `hhoe_NNN`, continuing
 * from the highest already in the table.
 *
 * Usage (from careStream/):
 *   node scripts/seed-homehealth-opwdd-entities.js           # dry-run
 *   node scripts/seed-homehealth-opwdd-entities.js --apply   # write
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
      const key = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = v;
    }
  } catch { /* missing file */ }
}

const APPLY = process.argv.includes('--apply');
const CSV_PATH = resolve(__dirname, 'data', 'opwdd_packet_submission_partners.csv');

const resourceArn = process.env.WB_CLUSTER_ARN;
const secretArn = process.env.WB_SECRET_ARN;
const database = process.env.WB_DATABASE || 'wellbound';

let client = null;
function getClient() {
  if (!resourceArn || !secretArn) {
    console.error('Set WB_CLUSTER_ARN and WB_SECRET_ARN (or add them to careStream/.env)');
    process.exit(1);
  }
  if (!client) client = new RDSDataClient({ region: process.env.AWS_REGION || 'us-east-2' });
  return client;
}

async function exec(sql, parameters) {
  return getClient().send(new ExecuteStatementCommand({
    resourceArn, secretArn, database, sql, parameters, includeResultMetadata: true,
  }));
}

// ── Minimal RFC-4180 CSV parser (handles quoted fields with commas/newlines) ─
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

const COUNTY_COLUMNS = [
  ['Bronx', 'Bronx'],
  ['Brooklyn (Kings)', 'Brooklyn'],
  ['Manhattan (New York)', 'Manhattan'],
  ['Queens', 'Queens'],
  ['Staten Island (Richmond)', 'Staten Island'],
  ['Nassau', 'Nassau'],
  ['Suffolk', 'Suffolk'],
  ['Westchester', 'Westchester'],
];

export function rowsToEntities(rows) {
  const header = rows[0].map((h) => h.trim());
  const idx = (name) => header.indexOf(name);
  const get = (row, name) => {
    const i = idx(name);
    return i >= 0 ? String(row[i] || '').trim() : '';
  };
  return rows.slice(1).map((row) => ({
    name: get(row, 'Organization'),
    tier: get(row, 'Tier'),
    category: get(row, 'Category'),
    submission_status: get(row, 'Submission status'),
    direct_authority_basis: get(row, 'Direct authority / basis'),
    population: get(row, 'Population'),
    counties: COUNTY_COLUMNS
      .filter(([col]) => /^yes$/i.test(get(row, col)))
      .map(([, label]) => label),
    phone: get(row, 'Phone'),
    email: get(row, 'Email'),
    address: get(row, 'Address'),
    next_step: get(row, 'Next step / question'),
    source_url: get(row, 'Source URL'),
    verification_notes: get(row, 'Verification notes'),
  })).filter((e) => e.name);
}

function cell(c) {
  if (!c || c.isNull) return null;
  if (c.arrayValue) return (c.arrayValue.stringValues || []);
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

const str = (v) => (v ? { stringValue: v } : { isNull: true });

async function main() {
  console.log(APPLY ? 'APPLY mode — will write Aurora' : 'DRY RUN — pass --apply to write');
  console.log(`Database: ${database}\n`);

  const entities = rowsToEntities(parseCsv(readFileSync(CSV_PATH, 'utf8')));
  console.log(`CSV entities: ${entities.length}`);

  const existing = await query('SELECT id, name FROM homehealth_opwdd_entities');
  const existingNames = new Set(existing.map((r) => (r.name || '').toLowerCase()));
  let maxId = 0;
  for (const r of existing) {
    const m = (r.id || '').match(/^hhoe_(\d+)$/);
    if (m) maxId = Math.max(maxId, parseInt(m[1], 10));
  }

  let inserted = 0;
  for (const e of entities) {
    if (existingNames.has(e.name.toLowerCase())) {
      console.log(`  = ${e.name}: already present`);
      continue;
    }
    maxId += 1;
    const id = `hhoe_${String(maxId).padStart(3, '0')}`;
    console.log(`  + ${id}  ${e.name}  [${e.counties.join(', ') || 'no counties'}]`);
    if (APPLY) {
      const now = new Date().toISOString();
      const countiesLiteral = e.counties.length
        ? `ARRAY[${e.counties.map((c) => `'${c.replace(/'/g, "''")}'`).join(',')}]::text[]`
        : 'NULL';
      await exec(
        `INSERT INTO homehealth_opwdd_entities
           (id, name, tier, category, submission_status, direct_authority_basis,
            population, counties, phone, email, address, next_step, source_url,
            verification_notes, is_active, created_at, updated_at)
         VALUES
           (:id, :name, :tier, :category, :sub_status, :basis,
            :population, ${countiesLiteral}, :phone, :email, :address, :next_step, :source_url,
            :notes, true, CAST(:now AS timestamptz), CAST(:now AS timestamptz))`,
        [
          { name: 'id', value: { stringValue: id } },
          { name: 'name', value: { stringValue: e.name } },
          { name: 'tier', value: str(e.tier) },
          { name: 'category', value: str(e.category) },
          { name: 'sub_status', value: str(e.submission_status) },
          { name: 'basis', value: str(e.direct_authority_basis) },
          { name: 'population', value: str(e.population) },
          { name: 'phone', value: str(e.phone) },
          { name: 'email', value: str(e.email) },
          { name: 'address', value: str(e.address) },
          { name: 'next_step', value: str(e.next_step) },
          { name: 'source_url', value: str(e.source_url) },
          { name: 'notes', value: str(e.verification_notes) },
          { name: 'now', value: { stringValue: now } },
        ],
      );
    }
    inserted += 1;
  }

  console.log(`\n${APPLY ? 'Inserted' : 'Would insert'}: ${inserted} entities (${existing.length} already in table).`);
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
