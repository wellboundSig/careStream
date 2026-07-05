#!/usr/bin/env node
/**
 * Production invariant scan.
 *
 * Fetches Referrals + Conflicts + StageHistory from the live Airtable base and
 * runs `assertReferralInvariants` against every referral, printing a grouped
 * report of every record currently in an "impossible" state. Run it once for a
 * damage report, then nightly as a safety net for whatever the tests miss.
 *
 * Usage:
 *   AIRTABLE_TOKEN=pat... AIRTABLE_BASE_ID=app... node scripts/check-invariants.js
 *   # or rely on careStream/.env
 *
 * Flags:
 *   --errors-only   Only report 'error'-severity violations (skip warns).
 *   --json          Emit machine-readable JSON (for alerting pipelines).
 *
 * Exit code is non-zero when any 'error'-severity violation is found, so this
 * can gate a nightly CI job.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { findInvariantViolations } from '../src/engine/invariants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  try {
    const envPath = resolve(__dirname, '..', '.env');
    const lines = readFileSync(envPath, 'utf-8').split('\n');
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
// Post-Aurora-migration backend: wellbound-api /internal routes.
//   WB_API_URL=https://xxx.execute-api.us-east-2.amazonaws.com WB_INTERNAL_KEY=... node scripts/check-invariants.js
const API_URL = (process.env.WB_API_URL || process.env.VITE_API_URL || '').replace(/\/$/, '');
const INTERNAL_KEY = process.env.WB_INTERNAL_KEY || '';
const ERRORS_ONLY = process.argv.includes('--errors-only');
const AS_JSON = process.argv.includes('--json');

if (!(API_URL && INTERNAL_KEY) && !(TOKEN && BASE_ID)) {
  console.error('Missing backend config: set WB_API_URL + WB_INTERNAL_KEY (Aurora) or AIRTABLE_TOKEN + AIRTABLE_BASE_ID (legacy).');
  process.exit(1);
}

const USE_API = !!(API_URL && INTERNAL_KEY);
const DATA = USE_API ? `${API_URL}/internal` : `https://api.airtable.com/v0/${BASE_ID}`;
const HEADERS = USE_API
  ? { 'x-internal-key': INTERNAL_KEY, 'x-internal-caller': 'check-invariants' }
  : { Authorization: `Bearer ${TOKEN}` };

async function fetchAll(table) {
  const records = [];
  let offset = null;
  do {
    const url = new URL(`${DATA}/${encodeURIComponent(table)}`);
    if (offset) url.searchParams.set('offset', offset);
    url.searchParams.set('pageSize', '100');
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`Fetch ${table} failed ${res.status}: ${await res.text()}`);
    const data = await res.json();
    for (const r of data.records) records.push({ _id: r.id, ...r.fields });
    offset = data.offset || null;
  } while (offset);
  return records;
}

async function main() {
  if (!AS_JSON) console.log(`Scanning base ${BASE_ID} for invariant violations...\n`);

  const [referrals, conflicts, stageHistory] = await Promise.all([
    fetchAll('Referrals'),
    fetchAll('Conflicts'),
    fetchAll('StageHistory'),
  ]);

  const world = { referrals, conflicts, stageHistory };
  const offenders = findInvariantViolations(world, { minSeverity: ERRORS_ONLY ? 'error' : 'warn' });

  // Tally by violation code.
  const byCode = {};
  let errorCount = 0;
  for (const { violations } of offenders) {
    for (const v of violations) {
      byCode[v.code] = (byCode[v.code] || 0) + 1;
      if (v.severity === 'error') errorCount++;
    }
  }

  if (AS_JSON) {
    console.log(JSON.stringify({
      scannedReferrals: referrals.length,
      offendingReferrals: offenders.length,
      errorCount,
      byCode,
      offenders: offenders.map((o) => ({ id: o.referral.id, stage: o.referral.current_stage, violations: o.violations })),
    }, null, 2));
  } else {
    console.log(`Scanned ${referrals.length} referrals — ${offenders.length} with violations.\n`);
    if (Object.keys(byCode).length > 0) {
      console.log('By rule:');
      for (const [code, count] of Object.entries(byCode).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${count.toString().padStart(4)}  ${code}`);
      }
      console.log('');
    }
    for (const { referral, violations } of offenders) {
      console.log(`• ${referral.id || referral._id} (${referral.current_stage})`);
      for (const v of violations) {
        console.log(`    [${v.severity}] ${v.code}: ${v.message}`);
      }
    }
    console.log(`\nDone. ${errorCount} error-severity violation(s).`);
  }

  process.exit(errorCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('\nScan failed:', err.message);
  process.exit(1);
});
