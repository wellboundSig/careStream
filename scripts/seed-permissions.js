#!/usr/bin/env node
//
// seed-permissions.js
// Creates the Permissions, PermissionPresets, and UserPermissions tables in
// Airtable and populates them with initial data. Run once during setup.
//
// Usage:
//   node scripts/seed-permissions.js
//
// Requires VITE_AIRTABLE_TOKEN and VITE_AIRTABLE_BASE_ID in ../.env
// (or set as environment variables directly).

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load .env manually (no dotenv dependency) ────────────────────────────────

function loadEnv() {
  try {
    const envPath = resolve(__dirname, '..', '.env');
    const lines = readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch { /* ignore */ }
}
loadEnv();

const TOKEN   = process.env.VITE_AIRTABLE_TOKEN;
const BASE_ID = process.env.VITE_AIRTABLE_BASE_ID;

if (!TOKEN || !BASE_ID) {
  console.error('Missing VITE_AIRTABLE_TOKEN or VITE_AIRTABLE_BASE_ID');
  process.exit(1);
}

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
};

// ── Permission data (mirrored from src/data/permissionKeys.js) ───────────────

const PERMISSION_CATALOG = [
  { key: 'division.alf',             label: 'Access ALF division data',              category: 'Division Access',  description: 'See patients, referrals, and pipeline data tagged ALF', sort: 1 },
  { key: 'division.sn',              label: 'Access Special Needs division data',    category: 'Division Access',  description: 'See patients, referrals, and pipeline data tagged Special Needs', sort: 2 },
  { key: 'referral.create',          label: 'Create new referrals',                  category: 'Referrals',        description: 'Open the New Referral form and submit', sort: 10 },
  { key: 'referral.view',            label: 'View referral details',                 category: 'Referrals',        description: 'See referral cards, drawers, and detail panels', sort: 11 },
  { key: 'referral.edit',            label: 'Edit referral fields',                  category: 'Referrals',        description: 'Modify referral data in the overview tab', sort: 12 },
  { key: 'referral.transition',      label: 'Move referrals between stages',         category: 'Referrals',        description: 'Advance or regress referrals in the pipeline', sort: 13 },
  { key: 'referral.hold',            label: 'Place referrals on Hold',               category: 'Referrals',        description: 'Move any active referral to Hold stage', sort: 14 },
  { key: 'referral.ntuc',            label: 'Move referrals to NTUC',                category: 'Referrals',        description: 'Move referrals to Unable to Convert (terminal)', sort: 15 },
  { key: 'patient.view',             label: 'View patient records',                  category: 'Patients',         description: 'See patient list, drawer, and details', sort: 20 },
  { key: 'patient.edit',             label: 'Edit patient information',              category: 'Patients',         description: 'Modify demographics, contacts, and insurance', sort: 21 },
  { key: 'clinical.triage',          label: 'Submit triage assessments',             category: 'Clinical',         description: 'Fill or edit adult/pediatric triage forms', sort: 30 },
  { key: 'clinical.rn_review',       label: 'Perform Clinical RN review',            category: 'Clinical',         description: 'Approve or route from Clinical Intake RN Review stage', sort: 31 },
  { key: 'clinical.f2f',             label: 'Log Face-to-Face documents',            category: 'Clinical',         description: 'Record F2F received dates and expiration', sort: 32 },
  { key: 'clinical.eligibility',     label: 'Run eligibility checks',               category: 'Clinical',         description: 'Log insurance/eligibility verification results', sort: 33 },
  { key: 'auth.submit',              label: 'Submit prior authorizations',           category: 'Authorization',    description: 'Create authorization records for managed care', sort: 40 },
  { key: 'auth.decide',              label: 'Record auth approval or denial',        category: 'Authorization',    description: 'Mark authorizations as approved or denied', sort: 41 },
  { key: 'task.view',                label: 'View tasks',                            category: 'Tasks',            description: 'See task lists and details', sort: 50 },
  { key: 'task.create',              label: 'Create tasks',                          category: 'Tasks',            description: 'Create new tasks from drawers or pages', sort: 51 },
  { key: 'task.assign',              label: 'Assign tasks to other users',           category: 'Tasks',            description: 'Pick an assignee when creating or editing tasks', sort: 52 },
  { key: 'task.complete',            label: 'Complete tasks',                        category: 'Tasks',            description: 'Mark tasks as completed', sort: 53 },
  { key: 'file.upload',              label: 'Upload documents',                      category: 'Documents',        description: 'Upload patient files to R2 storage', sort: 60 },
  { key: 'file.upload_f2f',          label: 'Upload F2F / MD order documents',       category: 'Documents',        description: 'Upload Face-to-Face and physician order files', sort: 61 },
  { key: 'note.create',              label: 'Create notes',                          category: 'Notes',            description: 'Add freeform notes to patient records', sort: 70 },
  { key: 'note.pin',                 label: 'Pin / unpin notes',                     category: 'Notes',            description: 'Toggle pinned status on notes', sort: 71 },
  { key: 'conflict.flag',            label: 'Flag conflicts',                        category: 'Conflicts',        description: 'Create conflict records on referrals', sort: 80 },
  { key: 'conflict.resolve',         label: 'Resolve conflicts',                     category: 'Conflicts',        description: 'Mark conflicts as resolved or waived', sort: 81 },
  { key: 'scheduling.staffing',      label: 'Staffing feasibility actions',          category: 'Scheduling',       description: 'Work the Staffing Feasibility module', sort: 90 },
  { key: 'scheduling.admin_confirm', label: 'Admin Confirmation stage actions',      category: 'Scheduling',       description: 'Confirm patients in Admin Confirmation', sort: 91 },
  { key: 'scheduling.soc_schedule',  label: 'Schedule Start of Care',               category: 'Scheduling',       description: 'Set SOC dates and create episodes', sort: 92 },
  { key: 'scheduling.soc_complete',  label: 'Mark SOC completed',                   category: 'Scheduling',       description: 'Finalize SOC and generate EMR packets', sort: 93 },
  { key: 'report.view',              label: 'View reports',                          category: 'Reports',          description: 'Access the Reports page', sort: 100 },
  { key: 'report.export',            label: 'Export reports & data',                 category: 'Reports',          description: 'Download CSV/PDF exports', sort: 101 },
  { key: 'directory.view',           label: 'View directory pages',                  category: 'Directory',        description: 'Browse marketers, facilities, physicians, etc.', sort: 110 },
  { key: 'directory.edit',           label: 'Edit directory entries',                category: 'Directory',        description: 'Modify existing directory records', sort: 111 },
  { key: 'directory.create',         label: 'Create directory entries',              category: 'Directory',        description: 'Add new physicians, facilities, etc.', sort: 112 },
  { key: 'admin.user_management',    label: 'Access User Management',               category: 'Administration',   description: 'View and edit users, roles, and statuses', sort: 120 },
  { key: 'admin.permissions',        label: 'Manage user permissions',               category: 'Administration',   description: 'Open permission modals and edit presets', sort: 121 },
  { key: 'admin.data_tools',         label: 'Access Data Tools',                     category: 'Administration',   description: 'Use raw data inspection and admin utilities', sort: 122 },
  { key: 'admin.settings',           label: 'Access system Settings',                category: 'Administration',   description: 'Modify app-wide settings and preferences', sort: 123 },
];

const ALL_KEYS = PERMISSION_CATALOG.map((p) => p.key);

const DEFAULT_PRESETS = [
  { id: 'preset_admin',       name: 'Administrator / CEO',    description: 'Full unrestricted access to every feature and data set.', is_system: true, permissions: ALL_KEYS },
  { id: 'preset_intake',      name: 'Intake Coordinator',     description: 'Front-line referral intake, eligibility, and patient onboarding.', is_system: true, permissions: ['division.alf','division.sn','referral.create','referral.view','referral.edit','referral.transition','referral.hold','patient.view','patient.edit','clinical.eligibility','task.view','task.create','task.complete','file.upload','note.create','note.pin','conflict.flag','report.view','directory.view'] },
  { id: 'preset_clinical_rn', name: 'Clinical RN',            description: 'Clinical intake review, triage, F2F management, and conflict resolution.', is_system: true, permissions: ['division.alf','division.sn','referral.view','referral.transition','referral.hold','patient.view','clinical.triage','clinical.rn_review','clinical.f2f','clinical.eligibility','task.view','task.create','task.complete','file.upload','file.upload_f2f','note.create','note.pin','conflict.flag','conflict.resolve','report.view','directory.view'] },
  { id: 'preset_marketer',    name: 'Marketer',               description: 'Referral creation and patient visibility. Division access per marketer assignment.', is_system: true, permissions: ['referral.create','referral.view','patient.view','task.view','note.create','file.upload','directory.view'] },
  { id: 'preset_scheduler',   name: 'Scheduler',              description: 'Staffing, SOC scheduling, and post-admission workflow.', is_system: true, permissions: ['division.alf','division.sn','referral.view','referral.transition','patient.view','scheduling.staffing','scheduling.admin_confirm','scheduling.soc_schedule','scheduling.soc_complete','task.view','task.create','task.assign','task.complete','note.create','report.view','directory.view'] },
  { id: 'preset_finance',     name: 'Finance / Authorization', description: 'Insurance eligibility, prior auth management, and financial reporting.', is_system: true, permissions: ['division.alf','division.sn','referral.view','patient.view','clinical.eligibility','auth.submit','auth.decide','task.view','task.create','note.create','report.view','report.export','directory.view'] },
  { id: 'preset_field_nurse', name: 'Field Nurse',            description: 'Patient-facing clinical documentation and triage.', is_system: true, permissions: ['referral.view','patient.view','clinical.triage','note.create','file.upload','directory.view'] },
];

// ── Airtable helpers ─────────────────────────────────────────────────────────

const META_URL = `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables`;
const DATA_URL = `https://api.airtable.com/v0/${BASE_ID}`;

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function getTableId(name) {
  const res = await fetch(META_URL, { headers: HEADERS });
  if (!res.ok) return null;
  const data = await res.json();
  const table = (data.tables || []).find((t) => t.name === name);
  return table || null;
}

async function addFieldToTable(tableId, field) {
  const url = `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${tableId}/fields`;
  const res = await fetch(url, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(field),
  });
  if (!res.ok) {
    const body = await res.text();
    if (body.includes('DUPLICATE_FIELD_NAME') || body.includes('already exists')) return false;
    console.log(`    ⚠ Could not add field "${field.name}": ${body}`);
    return false;
  }
  return true;
}

async function ensureFields(tableMeta, desiredFields) {
  const existingNames = new Set((tableMeta.fields || []).map((f) => f.name));
  for (const field of desiredFields) {
    if (!existingNames.has(field.name)) {
      console.log(`    Adding missing field "${field.name}" to "${tableMeta.name}"...`);
      const added = await addFieldToTable(tableMeta.id, field);
      if (added) console.log(`    ✓ Added "${field.name}"`);
      await sleep(250);
    }
  }
}

async function createTable(name, fields, description) {
  console.log(`  Creating table "${name}"...`);
  const res = await fetch(META_URL, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ name, description, fields }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (body.includes('DUPLICATE_TABLE_NAME') || body.includes('already exists')) {
      console.log(`  ⚠ Table "${name}" already exists — ensuring fields are present...`);
      const existing = await getTableId(name);
      if (existing) await ensureFields(existing, fields);
      return null;
    }
    throw new Error(`Failed to create table "${name}": ${res.status} ${body}`);
  }
  const data = await res.json();
  console.log(`  ✓ Table "${name}" created (${data.id})`);
  await sleep(300);
  return data;
}

async function createRecordsBatch(table, records) {
  const batches = [];
  for (let i = 0; i < records.length; i += 10) {
    batches.push(records.slice(i, i + 10));
  }
  let total = 0;
  for (const batch of batches) {
    const res = await fetch(`${DATA_URL}/${encodeURIComponent(table)}`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({
        records: batch.map((fields) => ({ fields })),
        typecast: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Failed to create records in "${table}": ${res.status} ${body}`);
    }
    const data = await res.json();
    total += data.records.length;
    await sleep(250);
  }
  return total;
}

async function fetchAllRecords(table) {
  const records = [];
  let offset;
  do {
    const url = new URL(`${DATA_URL}/${encodeURIComponent(table)}`);
    if (offset) url.searchParams.set('offset', offset);
    const res = await fetch(url.toString(), { headers: HEADERS });
    if (!res.ok) throw new Error(`Fetch ${table}: ${res.status}`);
    const data = await res.json();
    records.push(...data.records);
    offset = data.offset;
    await sleep(250);
  } while (offset);
  return records;
}

// ── Role name → preset mapping ───────────────────────────────────────────────

function roleToPreset(roleName, scope) {
  if (scope === 'DevNurse') return 'preset_admin';
  const n = (roleName || '').toLowerCase();
  if (/admin|ceo|developer|dev/.test(n))     return 'preset_admin';
  if (/market/.test(n))                       return 'preset_marketer';
  if (/intake|coordinator/.test(n))           return 'preset_intake';
  if (/clinical|nurse|\brn\b|\blpn\b/.test(n)) return 'preset_clinical_rn';
  if (/schedul/.test(n))                      return 'preset_scheduler';
  if (/financ|billing|auth/.test(n))          return 'preset_finance';
  return 'preset_admin'; // safe default
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🔑 CareStream Permission Seeder\n');
  console.log(`Base: ${BASE_ID}`);
  console.log(`Token: ${TOKEN.slice(0, 8)}...${TOKEN.slice(-4)}\n`);

  // 1. Create tables
  console.log('Step 1: Creating tables...\n');

  await createTable('Permissions', [
    { name: 'id',          type: 'singleLineText' },
    { name: 'key',         type: 'singleLineText' },
    { name: 'label',       type: 'singleLineText' },
    { name: 'category',    type: 'singleLineText' },
    { name: 'description', type: 'multilineText' },
    { name: 'sort_order',  type: 'number', options: { precision: 0 } },
    { name: 'created_at',  type: 'singleLineText' },
  ], 'Static catalog of all permission keys the system recognises.');

  await createTable('PermissionPresets', [
    { name: 'id',          type: 'singleLineText' },
    { name: 'name',        type: 'singleLineText' },
    { name: 'description', type: 'multilineText' },
    { name: 'permissions', type: 'multilineText' },
    { name: 'is_system',   type: 'checkbox', options: { icon: 'check', color: 'greenBright' } },
    { name: 'created_at',  type: 'singleLineText' },
    { name: 'updated_at',  type: 'singleLineText' },
  ], 'Role "packets" — admin-editable templates that pre-fill a user\'s permissions.');

  await createTable('UserPermissions', [
    { name: 'id',             type: 'singleLineText' },
    { name: 'user_id',        type: 'singleLineText' },
    { name: 'permissions',    type: 'multilineText' },
    { name: 'last_preset_id', type: 'singleLineText' },
    { name: 'updated_at',     type: 'singleLineText' },
    { name: 'updated_by',     type: 'singleLineText' },
  ], 'Flat per-user permission record. One row per user.');

  // 1b. Ensure the category single-select has all required options
  console.log('  Ensuring Permissions.category select options...');
  const permTable = await getTableId('Permissions');
  if (permTable) {
    const catField = (permTable.fields || []).find((f) => f.name === 'category');
    if (catField && catField.type === 'singleSelect') {
      const existingOptions = (catField.options?.choices || []).map((c) => c.name);
      const needed = [
        'Division Access', 'Referrals', 'Patients', 'Clinical', 'Authorization',
        'Tasks', 'Documents', 'Notes', 'Conflicts', 'Scheduling', 'Reports',
        'Directory', 'Administration',
      ];
      const missing = needed.filter((n) => !existingOptions.includes(n));
      if (missing.length) {
        const allChoices = [
          ...catField.options.choices,
          ...missing.map((name) => ({ name })),
        ];
        const url = `https://api.airtable.com/v0/meta/bases/${BASE_ID}/tables/${permTable.id}/fields/${catField.id}`;
        const res = await fetch(url, {
          method: 'PATCH',
          headers: HEADERS,
          body: JSON.stringify({ options: { choices: allChoices } }),
        });
        if (res.ok) {
          console.log(`  ✓ Added ${missing.length} category options: ${missing.join(', ')}`);
        } else {
          const body = await res.text();
          console.log(`  ⚠ Could not update category options: ${body}`);
          console.log('  Falling back to text field values (category will be plain text)...');
        }
        await sleep(300);
      } else {
        console.log('  ✓ All category options already present');
      }
    }
  }

  // 2. Seed Permissions catalog
  console.log('\nStep 2: Seeding Permissions catalog...\n');

  const now = new Date().toISOString();
  const permRecords = PERMISSION_CATALOG.map((p, i) => ({
    id: `perm_${String(i + 1).padStart(3, '0')}`,
    key: p.key,
    label: p.label,
    category: p.category,
    description: p.description,
    sort_order: p.sort,
    created_at: now,
  }));
  const permCount = await createRecordsBatch('Permissions', permRecords);
  console.log(`  ✓ ${permCount} permission records created\n`);

  // 3. Seed PermissionPresets
  console.log('Step 3: Seeding PermissionPresets...\n');

  const presetRecords = DEFAULT_PRESETS.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    permissions: JSON.stringify(p.permissions),
    is_system: p.is_system,
    created_at: now,
    updated_at: now,
  }));
  const presetCount = await createRecordsBatch('PermissionPresets', presetRecords);
  console.log(`  ✓ ${presetCount} preset records created\n`);

  // 4. Seed UserPermissions for existing users
  console.log('Step 4: Creating UserPermissions for existing users...\n');

  const users = await fetchAllRecords('Users');
  console.log(`  Found ${users.length} users`);

  const roles = await fetchAllRecords('Roles');
  const roleMap = {};
  for (const r of roles) {
    if (r.fields.id) roleMap[r.fields.id] = r.fields.name || '';
  }
  console.log(`  Found ${roles.length} roles: ${Object.entries(roleMap).map(([id, name]) => `${id}=${name}`).join(', ')}`);

  const presetMap = {};
  for (const p of DEFAULT_PRESETS) presetMap[p.id] = p.permissions;

  const userPermRecords = users.map((u) => {
    const f = u.fields;
    const roleName = roleMap[f.role_id] || '';
    const presetId = roleToPreset(roleName, f.scope);
    const perms = presetMap[presetId] || ALL_KEYS;
    return {
      id: `up_${f.id || u.id}`,
      user_id: f.id || '',
      permissions: JSON.stringify(perms),
      last_preset_id: presetId,
      updated_at: now,
      updated_by: 'system_seed',
    };
  });

  if (userPermRecords.length) {
    const upCount = await createRecordsBatch('UserPermissions', userPermRecords);
    console.log(`  ✓ ${upCount} user permission records created\n`);
  } else {
    console.log('  No users found — skipping.\n');
  }

  // Summary
  console.log('━'.repeat(50));
  console.log('  Seeding complete!');
  console.log(`  ${permCount} permissions  |  ${presetCount} presets  |  ${userPermRecords.length} users`);
  console.log('━'.repeat(50));
  console.log('\nNext steps:');
  console.log('  1. Verify tables in Airtable dashboard');
  console.log('  2. Deploy the updated app code');
  console.log('  3. Admins can then customize permissions via the Permissions modal\n');
}

main().catch((err) => {
  console.error('\n❌ Seeder failed:', err.message);
  process.exit(1);
});
