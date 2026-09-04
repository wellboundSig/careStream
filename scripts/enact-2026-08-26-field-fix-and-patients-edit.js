#!/usr/bin/env node
/**
 * 2026-08-26 corrections (Aurora, RDS Data API).
 *
 *  1. FIELD ROLE FIX — "account managers" are marketers (user clarification);
 *     the Field role should NOT have been swept into the marketer/account-
 *     manager module restriction on 2026-08-25. Restore the stripped module
 *     keys for Field-role users:
 *       module.intake, module.authorization, module.scheduling, module.admin,
 *       module.inbound, leads.promote_to_intake
 *     module.clinical is NOT restored — the clinical-review lockdown
 *     (nurses + Shayna only) still applies to Field users like everyone else.
 *
 *  2. PATIENTS DIRECTORY EDIT KEY — insert the `page.patients_edit` catalog
 *     row (deny-by-default). Granted to no one initially: the Patients
 *     directory is view-only for everyone, toggleable per user from the
 *     Permissions page.
 *
 * Usage (from careStream/):
 *   node scripts/enact-2026-08-26-field-fix-and-patients-edit.js           # dry-run
 *   node scripts/enact-2026-08-26-field-fix-and-patients-edit.js --apply   # write
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';
import { PERMISSION_KEYS as K } from '../src/data/permissionKeys.js';

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
const UPDATED_BY = 'script:enact-2026-08-26-field-fix';

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

function cell(c) {
  if (!c || c.isNull) return null;
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

// module.clinical intentionally excluded — clinical lockdown stands.
const FIELD_RESTORE_KEYS = [
  K.MODULE_INTAKE,
  K.MODULE_AUTHORIZATION,
  K.MODULE_SCHEDULING,
  K.MODULE_ADMIN,
  K.MODULE_INBOUND,
  K.LEADS_PROMOTE_TO_INTAKE,
];

const CATALOG_INSERT = {
  id: 'perm_page_patients_edit', key: K.PAGE_PATIENTS_EDIT,
  label: 'Edit from Patients directory', category: 'Pages', sort: 62.6,
  description: 'Open patients editable from the Patients directory. Deny-by-default — directory is view-only for everyone else.',
};

async function main() {
  console.log(APPLY ? 'APPLY mode — will write Aurora' : 'DRY RUN — pass --apply to write');
  console.log(`Database: ${database}\n`);

  // ── 1. Restore module keys for Field-role users ────────────────────────────
  const fieldUsers = await query(`
    SELECT u.id, u.first_name, u.last_name, u.status,
           up.rec_id AS perm_rec_id, up.permissions::text AS permissions
    FROM users u
    JOIN roles r ON r.id = u.role_id
    LEFT JOIN user_permissions up ON up.user_id = u.id
    WHERE r.name = 'Field'
    ORDER BY u.first_name`);

  console.log(`Field-role users: ${fieldUsers.length}`);
  let updates = 0;
  for (const u of fieldUsers) {
    const label = `${(u.first_name || '').trim()} ${(u.last_name || '').trim()} (${u.id}${u.status !== 'Active' ? `, ${u.status}` : ''})`;
    if (!u.perm_rec_id) {
      console.log(`  = ${label}: no user_permissions row — nothing to restore`);
      continue;
    }
    let keys;
    try { keys = JSON.parse(u.permissions); } catch { keys = null; }
    if (!Array.isArray(keys)) {
      console.log(`  ! ${label}: unparseable permissions — skipping`);
      continue;
    }
    const set = new Set(keys);
    const missing = FIELD_RESTORE_KEYS.filter((k) => !set.has(k));
    if (!missing.length) {
      console.log(`  = ${label}: already has all module keys`);
      continue;
    }
    for (const k of missing) set.add(k);
    console.log(`  + ${label}: restoring ${missing.join(', ')}`);
    if (APPLY) {
      await exec(
        `UPDATE user_permissions
         SET permissions = CAST(:perms AS jsonb), updated_at = :now, updated_by = :by
         WHERE rec_id = :rid`,
        [
          { name: 'perms', value: { stringValue: JSON.stringify([...set].sort()) } },
          { name: 'now', value: { stringValue: new Date().toISOString() } },
          { name: 'by', value: { stringValue: UPDATED_BY } },
          { name: 'rid', value: { stringValue: u.perm_rec_id } },
        ],
      );
    }
    updates += 1;
  }

  // ── 2. Catalog row for page.patients_edit ──────────────────────────────────
  console.log('');
  const existing = await query(
    'SELECT rec_id FROM permissions WHERE key = :k LIMIT 1',
    [{ name: 'k', value: { stringValue: CATALOG_INSERT.key } }],
  );
  if (existing.length) {
    console.log(`  = catalog: ${CATALOG_INSERT.key} already present`);
  } else if (!APPLY) {
    console.log(`  → catalog: would insert ${CATALOG_INSERT.key}`);
  } else {
    const now = new Date().toISOString();
    await exec(
      `INSERT INTO permissions (id, key, label, category, sort_order, description, created_at, updated_at)
       VALUES (:id, :k, :label, :cat, :sort, :descr, CAST(:now AS timestamptz), CAST(:now AS timestamptz))`,
      [
        { name: 'id', value: { stringValue: CATALOG_INSERT.id } },
        { name: 'k', value: { stringValue: CATALOG_INSERT.key } },
        { name: 'label', value: { stringValue: CATALOG_INSERT.label } },
        { name: 'cat', value: { stringValue: CATALOG_INSERT.category } },
        { name: 'sort', value: { doubleValue: CATALOG_INSERT.sort } },
        { name: 'descr', value: { stringValue: CATALOG_INSERT.description } },
        { name: 'now', value: { stringValue: now } },
      ],
    );
    console.log(`  + catalog: inserted ${CATALOG_INSERT.key}`);
  }

  console.log(`\n${APPLY ? 'Applied' : 'Would apply'}: ${updates} user updates.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
