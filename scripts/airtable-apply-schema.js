#!/usr/bin/env node
/**
 * Airtable Schema Apply Script (idempotent)
 *
 * Reads current schema from the Meta API, diffs against DESIRED_PLAN,
 * and applies only what's missing:
 *   - Creates tables that don't exist
 *   - Adds fields that don't exist on existing tables
 *   - Adds new choices to existing singleSelect fields (never removes)
 *   - Seeds Permissions rows whose `key` doesn't already exist
 *
 * Usage:
 *   AIRTABLE_TOKEN=pat... AIRTABLE_BASE_ID=app... node scripts/airtable-apply-schema.js
 *   # or just rely on careStream/.env and run `npm run schema:apply`
 *
 * Dry run (no writes, just prints plan):
 *   node scripts/airtable-apply-schema.js --dry-run
 *
 * Requires PAT scopes: schema.bases:read, schema.bases:write, data.records:read, data.records:write
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
const DRY_RUN = process.argv.includes('--dry-run');

if (!TOKEN || !BASE_ID) {
  console.error('Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID');
  process.exit(1);
}

// ---------- HTTP helpers ----------
const META = `https://api.airtable.com/v0/meta/bases/${BASE_ID}`;
const DATA = `https://api.airtable.com/v0/${BASE_ID}`;
const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
};

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function api(method, url, body) {
  if (DRY_RUN && method !== 'GET') {
    console.log(`[dry-run] ${method} ${url}`);
    if (body) console.log(`           body: ${JSON.stringify(body).slice(0, 300)}`);
    return { __dryRun: true };
  }
  const res = await fetch(url, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${url} -> ${res.status}: ${text}`);
  }
  await sleep(220); // keep under 5 req/sec
  return text ? JSON.parse(text) : {};
}

// ---------- Field helpers ----------
const DT_OPTS = {
  dateFormat: { name: 'iso', format: 'YYYY-MM-DD' },
  timeFormat: { name: '24hour', format: 'HH:mm' },
  timeZone: 'client',
};
const CHECK_OPTS = { icon: 'check', color: 'greenBright' };

const t = {
  text: (name) => ({ name, type: 'singleLineText' }),
  longText: (name) => ({ name, type: 'multilineText' }),
  email: (name) => ({ name, type: 'email' }),
  phone: (name) => ({ name, type: 'phoneNumber' }),
  dateTime: (name) => ({ name, type: 'dateTime', options: DT_OPTS }),
  check: (name) => ({ name, type: 'checkbox', options: CHECK_OPTS }),
  int: (name) => ({ name, type: 'number', options: { precision: 0 } }),
  single: (name, choices) => ({
    name,
    type: 'singleSelect',
    options: { choices: choices.map((c) => ({ name: c })) },
  }),
  multi: (name, choices) => ({
    name,
    type: 'multipleSelects',
    options: { choices: choices.map((c) => ({ name: c })) },
  }),
};

// ---------- Enums / constants ----------
const OPWDD_CASE_STATUS = [
  'not_started',
  'outreach_in_progress',
  'awaiting_initial_docs',
  'evaluations_pending',
  'packet_ready',
  'submitted_to_cco',
  'eligibility_determined',
  'monitoring_code_95',
  'code_95_received',
  'converted_to_intake',
  'closed',
  'cancelled',
];

const OPWDD_SUB_STATUS = [
  'pcg_not_interested',
  'aba_only_referral',
  'docs_incomplete',
  'awaiting_psych_eval',
  'awaiting_psychosocial',
  'awaiting_notice_letter',
  'awaiting_code_95',
  'none',
];

const OPWDD_CLOSED_REASON = [
  'converted_to_intake',
  'pcg_declined',
  'aba_only',
  'duplicate',
  'not_eligible',
  'lost_to_follow_up',
  'withdrawn',
  'other',
];

const EVAL_STATUS = ['not_needed', 'needed', 'scheduled', 'received', 'expired', 'accepted'];

const SUBMISSION_METHOD = ['email', 'portal', 'fax', 'other'];
const ELIGIBILITY_DETERMINATION = ['pending', 'eligible', 'ineligible', 'unknown'];
const NOTICE_METHOD = ['mail', 'email', 'upload', 'verbal', 'unknown'];

const SERVICE_TYPES_OPWDD = ['HHA', 'OT', 'PT', 'ST', 'SN'];

const REQUIREMENT_KEYS = [
  'previous_psychological_evaluation',
  'social_history_report',
  'iep_latest',
  'iep_prior',
  'early_intervention_documents',
  'specialist_letter',
  'medical_form',
  'insurance_card',
  'social_security_card',
  'birth_certificate',
  'passport',
  'state_id',
  'updated_psychological_evaluation',
  'updated_psychosocial_evaluation',
  'eligibility_notice_letter',
];

const CHECKLIST_STATUS = [
  'missing',
  'requested',
  'received',
  'under_review',
  'accepted',
  'rejected',
  'expired',
  'waived',
];

const OPWDD_HANDOFF_STATUS = ['not_applicable', 'in_progress', 'ready_for_intake', 'handed_off'];

const OPWDD_FILE_CATEGORIES = [
  'OPWDD',
  'OPWDD Evaluation',
  'OPWDD Identity',
  'OPWDD Insurance',
  'OPWDD Notice',
];

const OPWDD_TASK_TYPES = [
  'OPWDD Outreach',
  'OPWDD Missing Document',
  'OPWDD Evaluation',
  'OPWDD Submission',
  'OPWDD Code 95 Monitoring',
];

// ---------- Desired plan ----------
const DESIRED_TABLES = [
  {
    name: 'OPWDDEligibilityCases',
    description: 'One row per OPWDD eligibility attempt for a referral.',
    fields: [
      t.longText('id'), // primary
      t.text('patient_id'),
      t.text('referral_id'),
      t.single('status', OPWDD_CASE_STATUS),
      t.single('sub_status', OPWDD_SUB_STATUS),
      t.text('assigned_enrollment_specialist_id'),
      t.dateTime('opened_at'),
      t.dateTime('closed_at'),
      t.single('closed_reason', OPWDD_CLOSED_REASON),
      t.text('pcg_contact_name'),
      t.phone('pcg_contact_phone'),
      t.email('pcg_contact_email'),
      t.text('pcg_relationship_to_patient'),
      t.check('pcg_willing_to_apply'),
      t.check('pcg_interested_in_wellbound_services'),
      t.multi('interested_services', SERVICE_TYPES_OPWDD),
      t.check('aba_only_referral'),
      t.text('article16_clinic_name'),
      t.check('psychological_eval_required'),
      t.single('psychological_eval_status', EVAL_STATUS),
      t.dateTime('psychological_eval_scheduled_for'),
      t.dateTime('psychological_eval_received_at'),
      t.dateTime('psychological_eval_valid_through'),
      t.check('psychosocial_required'),
      t.single('psychosocial_status', EVAL_STATUS),
      t.dateTime('psychosocial_scheduled_for'),
      t.dateTime('psychosocial_received_at'),
      t.dateTime('psychosocial_valid_through'),
      t.text('cco_id'),
      t.text('cco_name_snapshot'),
      t.dateTime('submission_sent_at'),
      t.text('submission_sent_by_id'),
      t.single('submission_method', SUBMISSION_METHOD),
      t.text('submission_confirmation_number'),
      t.single('eligibility_determination', ELIGIBILITY_DETERMINATION),
      t.dateTime('eligibility_determined_at'),
      t.dateTime('notice_received_at'),
      t.single('notice_received_method', NOTICE_METHOD),
      t.dateTime('code_95_monitoring_started_at'),
      t.dateTime('expected_code_95_window_start'),
      t.dateTime('expected_code_95_window_end'),
      t.dateTime('code_95_received_at'),
      t.dateTime('converted_to_intake_at'),
      t.text('converted_by_id'),
      t.longText('intake_handoff_note'),
      t.single('latest_blocker', OPWDD_SUB_STATUS),
      t.longText('latest_blocker_note'),
      t.dateTime('created_at'),
      t.dateTime('updated_at'),
    ],
  },
  {
    name: 'OPWDDCaseChecklistItems',
    description: 'Per-requirement checklist rows for an OPWDD eligibility case.',
    fields: [
      t.longText('id'), // primary
      t.text('opwdd_case_id'),
      t.text('patient_id'),
      t.text('referral_id'),
      t.single('requirement_key', REQUIREMENT_KEYS),
      t.text('requirement_label'),
      t.check('is_required'),
      t.single('status', CHECKLIST_STATUS),
      t.dateTime('requested_at'),
      t.text('requested_by_id'),
      t.dateTime('received_at'),
      t.text('received_by_id'),
      t.dateTime('reviewed_at'),
      t.text('reviewed_by_id'),
      t.dateTime('expires_at'),
      t.check('is_current'),
      t.text('satisfying_file_id'),
      t.longText('notes'),
      t.int('sort_order'),
      t.dateTime('created_at'),
      t.dateTime('updated_at'),
    ],
  },
];

const DESIRED_NEW_FIELDS = {
  Referrals: [
    t.text('active_opwdd_case_id'),
    t.dateTime('opwdd_route_started_at'),
    t.text('opwdd_route_started_by_id'),
    t.check('opwdd_conversion_ready'),
    t.single('opwdd_handoff_status', OPWDD_HANDOFF_STATUS),
  ],
  Files: [
    t.text('opwdd_case_id'),
    t.single('document_subtype', REQUIREMENT_KEYS),
    t.dateTime('document_date'),
    t.dateTime('document_valid_through'),
    t.text('verified_current_by_id'),
    t.dateTime('verified_current_at'),
  ],
  Tasks: [
    t.text('opwdd_case_id'),
  ],
  ActivityLog: [
    t.text('opwdd_case_id'),
  ],
};

// NOTE: Airtable's Meta API does NOT allow updating singleSelect choices via PATCH
// (only `name` and `description` are mutable on existing fields). To add choices
// to an already-existing singleSelect, we use the "typecast trick": create a
// placeholder record with the new choice value and `typecast: true` (which
// auto-registers the new choice), then immediately delete the placeholder.
// For Permissions.category = 'OPWDD' we skip this because the real permission
// inserts below use typecast:true and will auto-create the choice on first use.
const DESIRED_CHOICE_EXTENSIONS = {
  Files: { category: OPWDD_FILE_CATEGORIES },
  Tasks: {
    type: OPWDD_TASK_TYPES,
    route_to_role: ['Enrollment'],
  },
};

const DESIRED_PERMISSIONS = [
  { id: 'perm_opwdd_case_view',          key: 'opwdd.case.view',           label: 'View OPWDD Case',                category: 'OPWDD', sort_order: 1,  description: 'See OPWDD eligibility cases and their progress.' },
  { id: 'perm_opwdd_case_create',        key: 'opwdd.case.create',         label: 'Create OPWDD Case',              category: 'OPWDD', sort_order: 2,  description: 'Open a new OPWDD eligibility case from a referral.' },
  { id: 'perm_opwdd_case_edit',          key: 'opwdd.case.edit',           label: 'Edit OPWDD Case',                category: 'OPWDD', sort_order: 3,  description: 'Modify OPWDD case fields and status.' },
  { id: 'perm_opwdd_case_assign',        key: 'opwdd.case.assign',         label: 'Assign OPWDD Case',              category: 'OPWDD', sort_order: 4,  description: 'Assign or reassign the enrollment specialist on an OPWDD case.' },
  { id: 'perm_opwdd_checklist_edit',     key: 'opwdd.checklist.edit',      label: 'Edit OPWDD Checklist',           category: 'OPWDD', sort_order: 5,  description: 'Update OPWDD case checklist item statuses.' },
  { id: 'perm_opwdd_file_upload',        key: 'opwdd.file.upload',         label: 'Upload OPWDD File',              category: 'OPWDD', sort_order: 6,  description: 'Upload documents to an OPWDD case.' },
  { id: 'perm_opwdd_file_verify',        key: 'opwdd.file.verify_current', label: 'Verify OPWDD Document Currency', category: 'OPWDD', sort_order: 7,  description: 'Verify an OPWDD document is current / not expired.' },
  { id: 'perm_opwdd_submit_packet',      key: 'opwdd.submit_packet',       label: 'Submit OPWDD Packet',            category: 'OPWDD', sort_order: 8,  description: 'Record submission of an OPWDD packet to the CCO.' },
  { id: 'perm_opwdd_record_notice',      key: 'opwdd.record_notice',       label: 'Record OPWDD Notice',            category: 'OPWDD', sort_order: 9,  description: 'Record receipt of the OPWDD eligibility notice letter.' },
  { id: 'perm_opwdd_mark_code95',        key: 'opwdd.mark_code95_received',label: 'Mark Code 95 Received',          category: 'OPWDD', sort_order: 10, description: 'Mark the OPWDD case as having received code 95.' },
  { id: 'perm_opwdd_convert_to_intake',  key: 'opwdd.convert_to_intake',   label: 'Convert OPWDD to Intake',        category: 'OPWDD', sort_order: 11, description: 'Hand an OPWDD case back to intake after code 95.' },
  { id: 'perm_opwdd_close_case',         key: 'opwdd.close_case',          label: 'Close OPWDD Case',               category: 'OPWDD', sort_order: 12, description: 'Close an OPWDD eligibility case.' },
];

// ---------- Operations ----------
async function fetchSchema() {
  const res = await fetch(`${META}/tables`, { headers: HEADERS });
  if (!res.ok) throw new Error(`Fetch schema failed ${res.status}: ${await res.text()}`);
  return res.json();
}

async function createTable(def) {
  console.log(`  + creating table: ${def.name}`);
  return api('POST', `${META}/tables`, def);
}

async function createField(tableId, def) {
  console.log(`    + adding field: ${def.name} (${def.type})`);
  return api('POST', `${META}/tables/${tableId}/fields`, def);
}

/**
 * Extends a singleSelect field's choices by creating placeholder records with
 * `typecast: true` (which auto-creates missing select options), then deleting
 * the placeholders. This is the only reliable way to add options to an
 * existing singleSelect field via the Airtable API.
 */
async function extendChoicesViaPlaceholders(tableId, tableName, field, newChoiceNames) {
  const existing = new Set((field.options?.choices || []).map((c) => c.name));
  const toAdd = newChoiceNames.filter((n) => !existing.has(n));
  if (toAdd.length === 0) return;
  console.log(`    ~ extending ${tableName}.${field.name} via typecast placeholders: ${toAdd.join(', ')}`);

  const recordsToCreate = toAdd.map((val) => ({ fields: { [field.name]: val } }));
  const createdIds = [];
  for (let i = 0; i < recordsToCreate.length; i += 10) {
    const batch = recordsToCreate.slice(i, i + 10);
    const res = await api('POST', `${DATA}/${tableId}`, { records: batch, typecast: true });
    if (res && res.records) for (const r of res.records) createdIds.push(r.id);
  }
  if (DRY_RUN) return;
  for (let i = 0; i < createdIds.length; i += 10) {
    const batch = createdIds.slice(i, i + 10);
    const params = batch.map((id) => `records[]=${encodeURIComponent(id)}`).join('&');
    await api('DELETE', `${DATA}/${tableId}?${params}`);
  }
}

async function getPermissionKeys(permissionsTableId) {
  if (DRY_RUN) return new Set();
  const keys = new Set();
  let offset;
  do {
    const url = new URL(`${DATA}/${permissionsTableId}`);
    url.searchParams.set('fields[]', 'key');
    url.searchParams.set('pageSize', '100');
    if (offset) url.searchParams.set('offset', offset);
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`Permissions list failed: ${await res.text()}`);
    const data = await res.json();
    for (const r of data.records) if (r.fields?.key) keys.add(r.fields.key);
    offset = data.offset;
    await sleep(220);
  } while (offset);
  return keys;
}

async function insertPermissions(permissionsTableId, rows) {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += 10) {
    const batch = rows.slice(i, i + 10);
    console.log(`  + seeding ${batch.length} permissions (${batch.map((r) => r.key).join(', ')})`);
    await api('POST', `${DATA}/${permissionsTableId}`, {
      records: batch.map((r) => ({ fields: r })),
      typecast: true,
    });
  }
}

// ---------- Main ----------
async function main() {
  console.log(`Target base: ${BASE_ID}`);
  if (DRY_RUN) console.log('(dry run — no writes)');

  let schema = await fetchSchema();
  const byName = () => Object.fromEntries(schema.tables.map((t) => [t.name, t]));

  // 1) Extend singleSelect choices FIRST (so new fields can reference categories if needed)
  console.log('\n== Extending singleSelect choices ==');
  for (const [tableName, fieldMap] of Object.entries(DESIRED_CHOICE_EXTENSIONS)) {
    const table = byName()[tableName];
    if (!table) { console.log(`  ! table not found: ${tableName} (skipping)`); continue; }
    for (const [fieldName, newChoices] of Object.entries(fieldMap)) {
      const field = table.fields.find((f) => f.name === fieldName);
      if (!field) { console.log(`    ! field not found: ${tableName}.${fieldName} (skipping)`); continue; }
      if (field.type !== 'singleSelect' && field.type !== 'multipleSelects') {
        console.log(`    ! ${tableName}.${fieldName} is not a select (type=${field.type}); skipping`);
        continue;
      }
      await extendChoicesViaPlaceholders(table.id, tableName, field, newChoices);
    }
  }

  // Refresh schema after PATCH
  if (!DRY_RUN) schema = await fetchSchema();

  // 2) Create new tables
  console.log('\n== Creating tables ==');
  for (const def of DESIRED_TABLES) {
    const existing = byName()[def.name];
    if (existing) {
      console.log(`  = table exists: ${def.name}`);
      continue;
    }
    await createTable(def);
  }

  if (!DRY_RUN) schema = await fetchSchema();

  // 3) Add missing fields to new tables (in case table existed but fields missing) + to existing tables
  console.log('\n== Adding fields ==');
  const allFieldTargets = {
    ...Object.fromEntries(DESIRED_TABLES.map((d) => [d.name, d.fields.slice(1)])), // skip primary
    ...DESIRED_NEW_FIELDS,
  };
  for (const [tableName, fields] of Object.entries(allFieldTargets)) {
    const table = byName()[tableName];
    if (!table) { console.log(`  ! table not found: ${tableName} (skipping)`); continue; }
    const existingNames = new Set(table.fields.map((f) => f.name));
    console.log(`  -> ${tableName}`);
    for (const f of fields) {
      if (existingNames.has(f.name)) continue;
      await createField(table.id, f);
    }
  }

  if (!DRY_RUN) schema = await fetchSchema();

  // 4) Seed Permissions rows (only those with key not already present)
  console.log('\n== Seeding Permissions ==');
  const permsTable = byName()['Permissions'];
  if (!permsTable) {
    console.log('  ! Permissions table not found; skipping seed');
  } else {
    const existingKeys = await getPermissionKeys(permsTable.id);
    const toInsert = DESIRED_PERMISSIONS.filter((p) => !existingKeys.has(p.key));
    if (toInsert.length === 0) {
      console.log('  = all desired permissions already present');
    } else {
      // Fill created_at
      const now = new Date().toISOString();
      await insertPermissions(permsTable.id, toInsert.map((p) => ({ ...p, created_at: now })));
    }
  }

  console.log('\nDone. Run `npm run schema` to refresh the snapshot.');
}

main().catch((err) => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
