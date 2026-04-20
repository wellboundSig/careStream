#!/usr/bin/env node
/**
 * Insurance data health check.
 *
 * Prints counts + any invariant violations for:
 *   - Patients with insurance_plans JSON but no PatientInsurances rows
 *   - Patients with PatientInsurances rows but no insurance_plans JSON
 *   - Patients where the JSON plan count != PatientInsurances row count
 *   - EligibilityVerifications pointing at a non-existent PatientInsurances row
 *   - PatientInsurancePlans (dead table) row count
 *
 * Usage:
 *   node scripts/check-insurance-invariants.js
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
function loadEnv() {
  try {
    const envPath = resolve(__dirname, '..', '.env');
    const lines = readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i === -1) continue;
      const k = t.slice(0, i).trim();
      const v = t.slice(i + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
  } catch { /* ignore */ }
}
loadEnv();
const TOKEN = process.env.AIRTABLE_TOKEN || process.env.VITE_AIRTABLE_TOKEN;
const BASE_ID = process.env.AIRTABLE_BASE_ID || process.env.VITE_AIRTABLE_BASE_ID;
const BASE = `https://api.airtable.com/v0/${BASE_ID}`;
const HEADERS = { Authorization: `Bearer ${TOKEN}` };

async function fetchAll(table) {
  const out = [];
  let offset = '';
  do {
    const url = new URL(`${BASE}/${encodeURIComponent(table)}`);
    if (offset) url.searchParams.set('offset', offset);
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) { console.error(`${table}: ${res.status}`); return []; }
    const j = await res.json();
    out.push(...(j.records || []));
    offset = j.offset || '';
  } while (offset);
  return out;
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

async function main() {
  console.log('Insurance Invariant Report');
  console.log('===========================\n');

  const [patients, insurances, verifications, legacy] = await Promise.all([
    fetchAll('Patients'),
    fetchAll('PatientInsurances'),
    fetchAll('EligibilityVerifications'),
    fetchAll('PatientInsurancePlans'),
  ]);

  console.log(`Patients                  : ${patients.length}`);
  console.log(`PatientInsurances         : ${insurances.length}`);
  console.log(`EligibilityVerifications  : ${verifications.length}`);
  console.log(`PatientInsurancePlans     : ${legacy.length}  ← should be 0 after cleanup\n`);

  const insByPatient = new Map();
  for (const r of insurances) {
    const pid = Array.isArray(r.fields.patient_id) ? r.fields.patient_id[0] : r.fields.patient_id;
    if (!pid) continue;
    if (!insByPatient.has(pid)) insByPatient.set(pid, []);
    insByPatient.get(pid).push(r);
  }

  const missing = [];
  const orphanJson = [];
  const mismatch = [];
  for (const p of patients) {
    const plans = safeParse(p.fields.insurance_plans) || [];
    const count = Array.isArray(plans) ? plans.length : 0;
    const rows = insByPatient.get(p.id) || [];
    const label = `${p.fields.first_name || ''} ${p.fields.last_name || ''}`.trim() || p.id;
    if (count > 0 && rows.length === 0) missing.push(`${label} (${p.id})  JSON has ${count}, rows=0`);
    else if (count === 0 && rows.length === 0 && p.fields.insurance_plan) orphanJson.push(`${label}  legacy insurance_plan="${p.fields.insurance_plan}"`);
    else if (count > 0 && rows.length !== count) mismatch.push(`${label}  JSON=${count}, rows=${rows.length}`);
  }

  if (missing.length) {
    console.log(`\nMISSING (JSON has plans, no PatientInsurances rows): ${missing.length}`);
    for (const m of missing) console.log('  ' + m);
    console.log('  → Run: node scripts/migrate-insurance-to-patient-insurances.js --execute');
  }
  if (mismatch.length) {
    console.log(`\nMISMATCHED COUNTS: ${mismatch.length}`);
    for (const m of mismatch) console.log('  ' + m);
  }
  if (orphanJson.length) {
    console.log(`\nLEGACY single-field insurance (no JSON, no rows): ${orphanJson.length}`);
    for (const m of orphanJson) console.log('  ' + m);
  }

  // Orphan EligibilityVerifications
  const insIds = new Set(insurances.map((r) => r.id));
  const orphanVer = [];
  for (const v of verifications) {
    const link = Array.isArray(v.fields.insurance_id) ? v.fields.insurance_id[0] : v.fields.insurance_id;
    if (link && !insIds.has(link) && !String(link).startsWith('demo:')) orphanVer.push(v.id);
  }
  if (orphanVer.length) {
    console.log(`\nORPHAN EligibilityVerifications (insurance_id points nowhere): ${orphanVer.length}`);
    for (const id of orphanVer) console.log('  ' + id);
  }

  if (legacy.length) {
    console.log(`\nDEAD TABLE PatientInsurancePlans still has rows (${legacy.length}). Delete after reviewing:`);
    for (const r of legacy) console.log('  ' + r.id + '  ' + (r.fields?.plan_name || '(no plan)'));
  }

  const clean = missing.length + mismatch.length + orphanVer.length === 0 && legacy.length === 0;
  console.log('\n' + (clean ? '✓ All invariants hold.' : '⚠ Invariants violated — see above.'));
  process.exit(clean ? 0 : 1);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(2); });
