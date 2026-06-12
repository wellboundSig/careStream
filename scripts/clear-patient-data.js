#!/usr/bin/env node
/**
 * Clear patient-attached data from the live Airtable base.
 *
 * Deletes ALL records from the explicit patient-transactional tables below
 * (patients + everything that hangs off them). It operates on a hardcoded
 * ALLOWLIST only — it can never touch a directory/reference table (Users,
 * Physicians, Marketers, Facilities, insurance catalog, ticketing, etc.).
 *
 * SAFETY: dry-run by default (lists counts, deletes nothing). Pass --confirm
 * to actually delete. This is irreversible.
 *
 * Usage:
 *   node scripts/clear-patient-data.js            # dry run (no writes)
 *   node scripts/clear-patient-data.js --confirm  # ACTUALLY DELETE
 *
 * Note: deleting Files rows does NOT remove the underlying R2 objects (those
 * become harmless orphans); this only clears the Airtable records.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  try {
    const lines = readFileSync(resolve(__dirname, '..', '.env'), 'utf-8').split('\n');
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      const v = t.slice(eq + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
  } catch { /* no .env */ }
}
loadEnv();

const TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN;
const BASE_ID = process.env.AIRTABLE_BASE_ID || process.env.VITE_AIRTABLE_BASE_ID;
const CONFIRM = process.argv.includes('--confirm');

if (!TOKEN || !BASE_ID) {
  console.error('Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID (set in env or careStream/.env).');
  process.exit(1);
}

// ── The ONLY tables this script will ever delete from ───────────────────────
const CLEAR_TABLES = [
  'Patients',
  'Referrals',
  'StageHistory',
  'Notes',
  'Files',
  'InsuranceChecks',
  'Conflicts',
  'Authorizations',
  'Tasks',
  'Episodes',
  'TriageAdult',
  'TriagePediatric',
  'TriageALF',
  'PatientInsurances',
  'EligibilityVerifications',
  'DisenrollmentAssistanceFlags',
  'CursoryReview',
  'ClinicalReview',
  'OPWDDEligibilityCases',
  'OPWDDCaseChecklistItems',
  'ActivityLog',
  'Calls',
];

const DATA = `https://api.airtable.com/v0/${BASE_ID}`;
const HEADERS = { Authorization: `Bearer ${TOKEN}` };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchAllIds(table) {
  const ids = [];
  let offset = null;
  do {
    const url = new URL(`${DATA}/${encodeURIComponent(table)}`);
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`Fetch ${table} failed ${res.status}: ${await res.text()}`);
    const data = await res.json();
    for (const r of data.records) ids.push(r.id);
    offset = data.offset || null;
    await sleep(220); // keep under 5 req/sec
  } while (offset);
  return ids;
}

async function deleteIds(table, ids) {
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10);
    const qs = batch.map((id) => `records[]=${encodeURIComponent(id)}`).join('&');
    const res = await fetch(`${DATA}/${encodeURIComponent(table)}?${qs}`, { method: 'DELETE', headers: HEADERS });
    if (!res.ok) throw new Error(`Delete from ${table} failed ${res.status}: ${await res.text()}`);
    await sleep(220);
  }
}

async function main() {
  console.log(`Base: ${BASE_ID}`);
  console.log(CONFIRM ? '\n*** --confirm set: records WILL be permanently deleted ***\n' : '\n(dry run — no deletes; pass --confirm to delete)\n');

  let grandTotal = 0;
  const plan = [];
  for (const table of CLEAR_TABLES) {
    let ids = [];
    try {
      ids = await fetchAllIds(table);
    } catch (err) {
      console.log(`  ! ${table}: could not read (${err.message}) — skipping`);
      continue;
    }
    plan.push({ table, count: ids.length, ids });
    grandTotal += ids.length;
    console.log(`  ${String(ids.length).padStart(5)}  ${table}`);
  }

  console.log(`\nTotal records ${CONFIRM ? 'to delete' : 'that would be deleted'}: ${grandTotal}`);

  if (!CONFIRM) {
    console.log('\nDry run complete. Re-run with --confirm to delete.');
    return;
  }

  console.log('\nDeleting...');
  for (const { table, ids } of plan) {
    if (ids.length === 0) continue;
    process.stdout.write(`  ${table} (${ids.length})... `);
    await deleteIds(table, ids);
    console.log('done');
  }
  console.log('\nAll patient-attached records cleared. Directories/config untouched.');
}

main().catch((err) => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
