#!/usr/bin/env node
/**
 * Normalize patients.first_name / last_name to Title Case.
 *
 * LIVE DATA — defaults to dry-run. Review the plan carefully before confirming.
 * By default emergency_contact_name is LEFT ALONE (often facility acronyms like
 * ACPG / ADMIN). Pass --with-emergency to clean those too (acronym-safe).
 *
 * Rules (same as src/utils/personName.js):
 *  - Collapse whitespace, Title Case each word
 *  - Preserve hyphens and apostrophes (Mary-Jane, O'Brien)
 *  - Mc* → McDonald-style
 *  - Never blank out a name; only rewrite when normalized differs
 *
 * Usage:
 *   node scripts/cleanup-patient-names.js              # dry-run (safe)
 *   node scripts/cleanup-patient-names.js --confirm    # apply UPDATE
 *   node scripts/cleanup-patient-names.js --limit=50   # preview first N changes
 *
 * Requires WB_CLUSTER_ARN + WB_SECRET_ARN (reads careStream/.env if present).
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';
import { normalizePersonNamePart, normalizeContactName } from '../src/utils/personName.js';

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

const CONFIRM = process.argv.includes('--confirm');
const WITH_EMERGENCY = process.argv.includes('--with-emergency');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const PREVIEW_LIMIT = limitArg ? Math.max(1, parseInt(limitArg.split('=')[1], 10) || 40) : 40;

const resourceArn = process.env.WB_CLUSTER_ARN;
const secretArn = process.env.WB_SECRET_ARN;
const database = process.env.WB_DATABASE || 'wellbound';
if (!resourceArn || !secretArn) {
  console.error('Set WB_CLUSTER_ARN and WB_SECRET_ARN (or add them to careStream/.env)');
  process.exit(1);
}

const client = new RDSDataClient({ region: process.env.AWS_REGION || 'us-east-2' });

async function exec(sql, parameters) {
  return client.send(new ExecuteStatementCommand({
    resourceArn, secretArn, database, sql, parameters, includeResultMetadata: true,
  }));
}

async function query(sql, parameters) {
  const res = await exec(sql, parameters);
  const cols = (res.columnMetadata || []).map((c) => c.name);
  return (res.records || []).map((row) => {
    const o = {};
    row.forEach((c, i) => {
      o[cols[i]] = c.stringValue ?? c.longValue ?? c.booleanValue ?? c.doubleValue ?? null;
    });
    return o;
  });
}

function maybePatch(current, normalize) {
  const raw = current ?? '';
  const next = normalize(raw);
  if (next === raw) return undefined;
  // Never blank a previously non-empty value
  if (!next && String(raw).trim()) return undefined;
  return next;
}

function planRow(row) {
  const first = row.first_name ?? '';
  const last = row.last_name ?? '';
  const emergency = row.emergency_contact_name ?? '';

  if (!String(first).trim() && !String(last).trim()) {
    return null;
  }

  const patch = {};
  const nf = maybePatch(first, normalizePersonNamePart);
  const nl = maybePatch(last, normalizePersonNamePart);
  if (nf !== undefined) patch.first_name = nf;
  if (nl !== undefined) patch.last_name = nl;
  if (WITH_EMERGENCY) {
    const ne = maybePatch(emergency, normalizeContactName);
    if (ne !== undefined) patch.emergency_contact_name = ne;
  }

  if (Object.keys(patch).length === 0) return null;
  return { row, patch };
}

function fmtName(r) {
  return `${r.first_name || ''} ${r.last_name || ''}`.trim() || '(no name)';
}

async function main() {
  console.log(CONFIRM
    ? '⚠  CONFIRM mode — will UPDATE live patients rows'
    : 'Dry-run — no writes. Pass --confirm to apply.');
  console.log('');

  const rows = await query(`
    SELECT rec_id, id, first_name, last_name, emergency_contact_name
    FROM patients
    ORDER BY id
  `);

  const changes = [];
  for (const row of rows) {
    const planned = planRow(row);
    if (planned) changes.push(planned);
  }

  console.log(`Patients scanned: ${rows.length}`);
  console.log(`Rows needing rename: ${changes.length}`);
  console.log('');

  const sample = changes.slice(0, PREVIEW_LIMIT);
  console.log(`── Sample changes (showing ${sample.length} of ${changes.length}) ──`);
  for (const { row, patch } of sample) {
    const before = fmtName(row);
    const after = fmtName({
      first_name: patch.first_name ?? row.first_name,
      last_name: patch.last_name ?? row.last_name,
    });
    const bits = [];
    if (patch.first_name != null) bits.push(`first: "${row.first_name}" → "${patch.first_name}"`);
    if (patch.last_name != null) bits.push(`last: "${row.last_name}" → "${patch.last_name}"`);
    if (patch.emergency_contact_name != null) {
      bits.push(`emergency: "${row.emergency_contact_name}" → "${patch.emergency_contact_name}"`);
    }
    console.log(`  ${row.id || row.rec_id}: ${before}  ⇒  ${after}`);
    console.log(`      ${bits.join('; ')}`);
  }
  if (changes.length > sample.length) {
    console.log(`  … ${changes.length - sample.length} more`);
  }

  if (!CONFIRM) {
    console.log('\nDry-run complete. Re-run with --confirm to apply these updates.');
    return;
  }

  let updated = 0;
  let failed = 0;
  for (const { row, patch } of changes) {
    const sets = [];
    const params = [{ name: 'rec_id', value: { stringValue: row.rec_id } }];
    for (const [key, val] of Object.entries(patch)) {
      sets.push(`"${key}" = :${key}`);
      params.push({ name: key, value: { stringValue: String(val) } });
    }
    sets.push('"updated_at" = NOW()');
    try {
      await exec(
        `UPDATE patients SET ${sets.join(', ')} WHERE rec_id = :rec_id`,
        params,
      );
      updated += 1;
    } catch (err) {
      failed += 1;
      console.error(`  FAILED ${row.id || row.rec_id}:`, err.message);
    }
  }

  console.log(`\nDone — updated ${updated}, failed ${failed}, unchanged ${rows.length - changes.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
