#!/usr/bin/env node
/**
 * Migrate legacy demographic insurance data into the PatientInsurances table.
 *
 * Sources (legacy, to be deprecated):
 *   - Patients.insurance_plans         (JSON array of plan name strings)
 *   - Patients.insurance_plan_details  (JSON object keyed by plan name)
 *   - Patients.insurance_plan          (legacy single plan name)
 *   - Patients.insurance_id            (legacy single member id)
 *
 * Target:
 *   - PatientInsurances table, one row per patient x plan.
 *
 * Usage:
 *   node scripts/migrate-insurance-to-patient-insurances.js --dry-run
 *   node scripts/migrate-insurance-to-patient-insurances.js --execute
 *
 * Safety:
 *   - Idempotent: reads existing PatientInsurances rows for each patient
 *     and skips plans already present (matched by payer_display_name,
 *     case-insensitive).
 *   - Dry-run mode prints every intended write. No Airtable mutations.
 *   - Batched writes (10 per call). Rate-limit aware (429 retry).
 *   - Prints per-patient summary + any orphan rows in PatientInsurancePlans
 *     so they're visible before that table is deleted.
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
  } catch { /* no .env — rely on env */ }
}
loadEnv();

const TOKEN   = process.env.AIRTABLE_TOKEN   || process.env.VITE_AIRTABLE_TOKEN;
const BASE_ID = process.env.AIRTABLE_BASE_ID || process.env.VITE_AIRTABLE_BASE_ID;
if (!TOKEN || !BASE_ID) {
  console.error('Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID. Set them in .env or env.');
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');
const EXECUTE = process.argv.includes('--execute');
if (DRY_RUN === EXECUTE) {
  console.error('Specify exactly one of --dry-run or --execute');
  process.exit(1);
}

const BASE = `https://api.airtable.com/v0/${BASE_ID}`;
const HEADERS = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function http(url, opts = {}) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { ...opts, headers: { ...HEADERS, ...(opts.headers || {}) } });
    if (res.status === 429) {
      const wait = Math.min(1000 * 2 ** attempt, 10000);
      console.error(`  rate limited; sleeping ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} ${text.slice(0, 400)}`);
    }
    return res.json();
  }
  throw new Error('rate limit retries exceeded');
}

async function fetchAll(table, params = {}) {
  const out = [];
  let offset = '';
  do {
    const url = new URL(`${BASE}/${encodeURIComponent(table)}`);
    if (offset) url.searchParams.set('offset', offset);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const json = await http(url.toString());
    out.push(...(json.records || []));
    offset = json.offset || '';
  } while (offset);
  return out;
}

function safeParse(str) {
  if (!str) return null;
  try { return JSON.parse(str); } catch { return null; }
}

// Lightweight payer-category inference. Intentionally conservative — anything
// not obvious goes to `unknown` so staff can correct it.
function inferCategory(label) {
  if (!label || typeof label !== 'string') return 'unknown';
  const s = label.toLowerCase();
  const hasMedicare   = /\bmedicare\b/.test(s);
  const hasMedicaid   = /\bmedicaid\b/.test(s);
  const hasManaged    = /\b(managed|advantage|hmo|ppo|mco|mltc)\b/.test(s);
  const hasCommercial = /\b(aetna|cigna|united|uhc|anthem|blue ?cross|bcbs|emblem|oscar|humana|healthfirst|molina|fidelis|metroplus|wellcare|oxford|excellus|empire|ghi|hip)\b/.test(s);
  if (hasMedicare && hasMedicaid) return 'unknown';
  if (hasMedicare)   return hasManaged ? 'medicare_managed' : 'medicare';
  if (hasMedicaid)   return hasManaged ? 'medicaid_managed' : 'medicaid';
  if (hasCommercial) return 'commercial';
  if (/\b(ltc|workers ?comp|no[- ]?fault|private pay|liability|auto)\b/.test(s)) return 'third_party';
  return 'unknown';
}

function rankFor(index) {
  return ['primary', 'secondary', 'tertiary'][index] || 'unknown';
}

function buildInsuranceRows(patientRec) {
  const f = patientRec.fields || {};
  const plans = (() => {
    const arr = safeParse(f.insurance_plans);
    if (Array.isArray(arr)) return arr.filter(Boolean);
    if (typeof f.insurance_plan === 'string' && f.insurance_plan.trim()) return [f.insurance_plan.trim()];
    return [];
  })();
  if (plans.length === 0) return [];

  const details = safeParse(f.insurance_plan_details) || {};
  return plans.map((plan, idx) => {
    const d = (details && typeof details === 'object' && details[plan]) || {};
    return {
      fields: {
        patient_id: [patientRec.id],
        payer_display_name: String(plan),
        insurance_category: inferCategory(plan),
        plan_name: d.plan_name || d.planName || '',
        commercial_plan_name: d.commercial_plan_name || '',
        third_party_descriptor: d.third_party_descriptor || '',
        member_id: d.member_id || d.memberId || (idx === 0 ? (f.insurance_id || '') : ''),
        group_number: d.group_number || d.groupNumber || '',
        subscriber_name: d.subscriber_name || d.subscriberName || '',
        subscriber_relationship: d.subscriber_relationship || d.subscriberRelationship || '',
        effective_date: d.effective_date || d.effectiveStart || '',
        termination_date: d.termination_date || d.effectiveEnd || '',
        order_rank: rankFor(idx),
        entered_from: 'import',
        is_active_raw: d.is_active_raw === false ? false : true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    };
  });
}

async function createBatch(table, records) {
  // 10-record batches per Airtable spec
  const out = [];
  for (let i = 0; i < records.length; i += 10) {
    const chunk = records.slice(i, i + 10);
    const json = await http(`${BASE}/${encodeURIComponent(table)}`, {
      method: 'POST',
      body: JSON.stringify({ records: chunk }),
    });
    out.push(...json.records);
  }
  return out;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN (no writes)' : 'EXECUTE (will write)'}\n`);

  console.log('Fetching Patients...');
  const patients = await fetchAll('Patients');
  console.log(`  ${patients.length} patients\n`);

  console.log('Fetching existing PatientInsurances for idempotency...');
  const existingRows = await fetchAll('PatientInsurances');
  console.log(`  ${existingRows.length} existing rows\n`);

  const existingByPatient = new Map();
  for (const row of existingRows) {
    const f = row.fields || {};
    const patientLink = Array.isArray(f.patient_id) ? f.patient_id[0] : f.patient_id;
    if (!patientLink) continue;
    const name = (f.payer_display_name || '').toLowerCase().trim();
    if (!existingByPatient.has(patientLink)) existingByPatient.set(patientLink, new Set());
    existingByPatient.get(patientLink).add(name);
  }

  let plannedCreate = 0;
  let skipped = 0;
  let patientsMigrated = 0;
  let patientsFullyCovered = 0;
  const toCreate = [];

  const report = [];

  for (const p of patients) {
    const rows = buildInsuranceRows(p);
    if (rows.length === 0) { skipped++; continue; }

    const existing = existingByPatient.get(p.id) || new Set();
    const newRows = rows.filter((r) => !existing.has((r.fields.payer_display_name || '').toLowerCase().trim()));

    if (newRows.length === 0) { patientsFullyCovered++; continue; }

    patientsMigrated++;
    plannedCreate += newRows.length;
    toCreate.push(...newRows);

    const name = `${p.fields.first_name || ''} ${p.fields.last_name || ''}`.trim() || p.id;
    report.push({
      patient: name,
      patientId: p.id,
      plans: newRows.map((r) => ({
        payer: r.fields.payer_display_name,
        category: r.fields.insurance_category,
        order: r.fields.order_rank,
        memberId: r.fields.member_id || '(none)',
      })),
    });
  }

  // Orphan check on PatientInsurancePlans — just report, don't touch.
  console.log('Checking PatientInsurancePlans (dead table) for orphans...');
  try {
    const orphans = await fetchAll('PatientInsurancePlans');
    if (orphans.length > 0) {
      console.log(`  Found ${orphans.length} row(s) in PatientInsurancePlans — this table is unused in code.`);
      for (const o of orphans) {
        console.log(`    ${o.id}  ${o.fields?.plan_name || '(no plan)'}  patient ${o.fields?.patient_id || '(none)'}`);
      }
      console.log('  After migration, delete the PatientInsurancePlans table in Airtable.');
    } else {
      console.log('  PatientInsurancePlans is empty. Safe to delete.');
    }
  } catch (e) {
    console.log(`  Could not read PatientInsurancePlans: ${e.message}`);
  }
  console.log();

  console.log('── Migration Plan ──');
  console.log(`Patients with insurance JSON            : ${patients.length - skipped}`);
  console.log(`Patients already fully migrated         : ${patientsFullyCovered}`);
  console.log(`Patients needing migration              : ${patientsMigrated}`);
  console.log(`Total new PatientInsurances rows to add : ${plannedCreate}\n`);

  for (const r of report) {
    console.log(`• ${r.patient}  (${r.patientId})`);
    for (const p of r.plans) {
      console.log(`    + ${p.payer.padEnd(30)}  cat=${p.category.padEnd(18)} order=${p.order.padEnd(10)} member=${p.memberId}`);
    }
  }
  console.log();

  if (DRY_RUN) {
    console.log('DRY-RUN complete. No writes performed. Re-run with --execute to apply.');
    return;
  }

  if (toCreate.length === 0) {
    console.log('Nothing to write.');
    return;
  }

  console.log(`Writing ${toCreate.length} rows in batches of 10...`);
  const created = await createBatch('PatientInsurances', toCreate);
  console.log(`Done. ${created.length} rows created.`);
}

main().catch((e) => {
  console.error('\nFAILED:', e.message);
  process.exit(1);
});
