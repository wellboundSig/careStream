#!/usr/bin/env node
/**
 * 2026-08-25 permission restructure (Aurora, RDS Data API).
 *
 * Rules enacted:
 *  1. Clinical Review (view + edit) → ONLY Clinical RN role, COC Nurse role,
 *     and Shayna. Everyone else loses clinical.rn_review, module.clinical,
 *     snapshot.edit_clinical_review, clinical.rn_unlock.
 *  2. Admin pages (User Mgmt, Permissions, Conflict Categories, Departments,
 *     Developer Tools) → ONLY Rafi Barides, Victoria DeMetz, Raquel Lipschitz.
 *  3. Campaigns + Marketers directory pages → ONLY Rafi, Victoria, Raquel,
 *     Adam Yanofsky (CEO), and all marketers.
 *  4. Pipeline board (page.pipeline, deny-by-default) → ONLY Rafi + Adam.
 *  5. Direct-to-NTUC (referral.ntuc_direct, deny-by-default) → ONLY Adam.
 *     Everyone else routes through Admin Confirmation.
 *  6. Marketers: lose Leads/Intake/Staffing/Clinical/Authorization/Admin/
 *     Inbound modules; keep Conflict/NTUC/Discarded (module.conflict) +
 *     dashboard lead entry + reports; lose all file-upload permissions.
 *     ("Account managers" ARE marketers — the Field role is NOT restricted;
 *     see enact-2026-08-26-field-fix-and-patients-edit.js which reverted an
 *     earlier over-restriction of Field users.)
 *  7. module.conflict granted to all staff who previously reached Conflict/
 *     NTUC/Discarded via module.clinical / module.admin / module.intake, so
 *     nothing is lost when the new UI (which gates those queues on
 *     module.conflict as an alternative) is deployed.
 *  8. Legacy org-wide directory.view/create/edit keys are replaced with the
 *     granular per-directory keys (excluding campaigns/marketers unless
 *     allowed) so rule 3 is enforceable.
 *
 * Users WITHOUT a user_permissions row currently get every key by migration
 * fallback — this script materialises an explicit row for them (full catalog
 * minus deny-by-default minus the removals above) so restrictions actually
 * bind, in the old UI as well as the new one.
 *
 * Usage (from careStream/):
 *   node scripts/enact-2026-08-25-permission-restructure.js           # dry-run
 *   node scripts/enact-2026-08-25-permission-restructure.js --apply   # write
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';
import { PERMISSION_KEYS as K, DENY_BY_DEFAULT_PERMISSIONS } from '../src/data/permissionKeys.js';

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
const UPDATED_BY = 'script:enact-2026-08-25-permission-restructure';

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

// ── Rule configuration ───────────────────────────────────────────────────────

const ALL_KEYS = Object.values(K);

const NAMED = {
  rafi:     ['rafi', 'barides'],
  victoria: ['victoria', 'demetz'],
  raquel:   ['raquel', 'lipschitz'],
  adam:     ['adam', 'yanofsky'],
  shayna:   ['shayna', 'palace'],
};

const ROLE_MARKETER = 'Marketer';
// NOTE: "account managers" are marketers (user clarification 2026-08-26) —
// the Field role keeps standard staff access.
const NURSE_ROLES = new Set(['Clinical RN', 'COC Nurse']);

const ADMIN_PAGE_KEYS = [
  K.ADMIN_USER_MANAGEMENT,
  K.ADMIN_PERMISSIONS,
  K.CONFLICT_MANAGE_CATEGORIES,
  K.ADMIN_DEPARTMENTS,
  K.DEVELOPER_TOOLS,
];

const CLINICAL_REVIEW_KEYS = [
  K.CLINICAL_RN_REVIEW,
  K.MODULE_CLINICAL,
  K.SNAPSHOT_EDIT_CLINICAL_REVIEW,
  K.CLINICAL_RN_UNLOCK,
];

const CAMPAIGN_MARKETER_DIR_KEYS = [
  K.DIRECTORY_CAMPAIGNS_VIEW, K.DIRECTORY_CAMPAIGNS_CREATE, K.DIRECTORY_CAMPAIGNS_EDIT,
  K.DIRECTORY_MARKETERS_VIEW, K.DIRECTORY_MARKETERS_CREATE, K.DIRECTORY_MARKETERS_EDIT,
];

const LEGACY_DIR = { view: K.DIRECTORY_VIEW, create: K.DIRECTORY_CREATE, edit: K.DIRECTORY_EDIT };
// Directories that remain broadly available; legacy keys expand into these.
const OPEN_DIRS = {
  view:   [K.DIRECTORY_FACILITIES_VIEW, K.DIRECTORY_PHYSICIANS_VIEW, K.DIRECTORY_REFERRAL_SOURCES_VIEW, K.DIRECTORY_CLINICIANS_VIEW],
  create: [K.DIRECTORY_FACILITIES_CREATE, K.DIRECTORY_PHYSICIANS_CREATE, K.DIRECTORY_REFERRAL_SOURCES_CREATE, K.DIRECTORY_CLINICIANS_CREATE],
  edit:   [K.DIRECTORY_FACILITIES_EDIT, K.DIRECTORY_PHYSICIANS_EDIT, K.DIRECTORY_REFERRAL_SOURCES_EDIT, K.DIRECTORY_CLINICIANS_EDIT],
};
const RESTRICTED_DIRS = {
  view:   [K.DIRECTORY_CAMPAIGNS_VIEW, K.DIRECTORY_MARKETERS_VIEW],
  create: [K.DIRECTORY_CAMPAIGNS_CREATE, K.DIRECTORY_MARKETERS_CREATE],
  edit:   [K.DIRECTORY_CAMPAIGNS_EDIT, K.DIRECTORY_MARKETERS_EDIT],
};

const MODULE_KEYS_STRIPPED_FROM_FIELD_STAFF = [
  K.MODULE_INTAKE,
  K.MODULE_CLINICAL,
  K.MODULE_AUTHORIZATION,
  K.MODULE_SCHEDULING,
  K.MODULE_ADMIN,
  K.MODULE_INBOUND,
  K.LEADS_PROMOTE_TO_INTAKE,
];

const MARKETER_FILE_KEYS = [
  K.FILE_UPLOAD,
  K.FILE_UPLOAD_F2F,
  K.SNAPSHOT_EDIT_FILES,
  K.OPWDD_FILE_UPLOAD,
];

// New permission catalog rows (permissions table) so the admin UI can manage them.
const CATALOG_INSERTS = [
  {
    id: 'perm_module_conflict', key: K.MODULE_CONFLICT,
    label: 'Conflict / NTUC / Discarded modules', category: 'Modules', sort: 61.5,
    description: 'Access the Conflict, NTUC, and Discarded Leads modules without intake/clinical/admin module access.',
  },
  {
    id: 'perm_page_pipeline', key: K.PAGE_PIPELINE,
    label: 'Pipeline board', category: 'Pages', sort: 62.5,
    description: 'View the Pipeline board. Deny-by-default — granted individually.',
  },
  {
    id: 'perm_referral_ntuc_direct', key: K.REFERRAL_NTUC_DIRECT,
    label: 'Send directly to NTUC (bypass Admin Confirmation)', category: 'Referrals', sort: 18,
    description: 'Skip Admin Confirmation and move a referral directly to NTUC. Deny-by-default.',
  },
];

function parsePerms(raw) {
  if (raw == null) return null;
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

function baseEffectiveSet(rowKeys) {
  if (rowKeys) return new Set(rowKeys);
  const set = new Set(ALL_KEYS);
  for (const k of DENY_BY_DEFAULT_PERMISSIONS) set.delete(k);
  return set;
}

/** Compute the target permission set for one user. */
function computeTarget({ rowKeys, roleName, named }) {
  const set = baseEffectiveSet(rowKeys);
  const isNurse = NURSE_ROLES.has(roleName) || named.shayna;
  const isMarketer = roleName === ROLE_MARKETER;
  const isAdminTrio = named.rafi || named.victoria || named.raquel;
  const isCampaignAllowed = isAdminTrio || named.adam || isMarketer;

  // Snapshot of module reach BEFORE stripping, for rule 7.
  const hadConflictReach = set.has(K.MODULE_CLINICAL) || set.has(K.MODULE_ADMIN) || set.has(K.MODULE_INTAKE);

  // 8. Legacy directory keys → granular equivalents, then drop legacy.
  for (const level of ['view', 'create', 'edit']) {
    if (set.has(LEGACY_DIR[level])) {
      for (const k of OPEN_DIRS[level]) set.add(k);
      if (isCampaignAllowed) for (const k of RESTRICTED_DIRS[level]) set.add(k);
      set.delete(LEGACY_DIR[level]);
    }
  }

  // 1. Clinical review lockdown.
  if (isNurse) {
    set.add(K.CLINICAL_RN_REVIEW);
    set.add(K.MODULE_CLINICAL);
  } else {
    for (const k of CLINICAL_REVIEW_KEYS) set.delete(k);
  }

  // 2. Admin pages.
  if (isAdminTrio) {
    for (const k of ADMIN_PAGE_KEYS) set.add(k);
  } else {
    for (const k of ADMIN_PAGE_KEYS) set.delete(k);
  }

  // 3. Campaigns + Marketers directory pages.
  if (isCampaignAllowed) {
    set.add(K.DIRECTORY_CAMPAIGNS_VIEW);
    set.add(K.DIRECTORY_MARKETERS_VIEW);
  } else {
    for (const k of CAMPAIGN_MARKETER_DIR_KEYS) set.delete(k);
  }

  // 4. Pipeline board.
  if (named.rafi || named.adam) set.add(K.PAGE_PIPELINE);
  else set.delete(K.PAGE_PIPELINE);

  // 5. Direct-to-NTUC.
  if (named.adam) set.add(K.REFERRAL_NTUC_DIRECT);
  else set.delete(K.REFERRAL_NTUC_DIRECT);

  // 6. Marketers (incl. account managers) → Conflict/NTUC/Discarded + lead entry only.
  if (isMarketer) {
    for (const k of MODULE_KEYS_STRIPPED_FROM_FIELD_STAFF) set.delete(k);
    set.add(K.MODULE_CONFLICT);
    set.add(K.LEADS_CREATE);
    set.add(K.REFERRAL_CREATE);
    set.add(K.REPORT_VIEW);
    set.add(K.REPORT_EXPORT);
    for (const k of MARKETER_FILE_KEYS) set.delete(k);
  } else if (hadConflictReach) {
    // 7. Preserve Conflict/NTUC/Discarded access for existing operational staff.
    set.add(K.MODULE_CONFLICT);
  }

  return set;
}

function fmtDiff(before, after) {
  const added = [...after].filter((k) => !before.has(k)).sort();
  const removed = [...before].filter((k) => !after.has(k)).sort();
  return { added, removed };
}

async function main() {
  console.log(APPLY ? 'APPLY mode — will write Aurora' : 'DRY RUN — pass --apply to write');
  console.log(`Database: ${database}\n`);

  const users = await query(`
    SELECT u.id, u.first_name, u.last_name, u.status, r.name AS role_name
    FROM users u LEFT JOIN roles r ON r.id = u.role_id
    ORDER BY u.first_name, u.last_name`);
  const permRows = await query(`
    SELECT rec_id, id, user_id, permissions::text AS permissions FROM user_permissions`);
  const rowByUser = Object.fromEntries(permRows.map((p) => [p.user_id, p]));

  // Resolve named users; hard-fail if any are missing/ambiguous.
  const namedIds = {};
  for (const [alias, [fn, ln]] of Object.entries(NAMED)) {
    const hits = users.filter((u) =>
      (u.first_name || '').trim().toLowerCase() === fn
      && (u.last_name || '').trim().toLowerCase() === ln);
    if (hits.length !== 1) {
      console.error(`Expected exactly 1 user for "${fn} ${ln}", found ${hits.length}. Aborting.`);
      process.exit(1);
    }
    namedIds[alias] = hits[0].id;
    console.log(`  ✓ ${alias}: ${hits[0].first_name} ${hits[0].last_name} (${hits[0].id}, ${hits[0].role_name})`);
  }
  console.log('');

  // Catalog rows for the new keys.
  for (const entry of CATALOG_INSERTS) {
    const existing = await query(
      'SELECT rec_id FROM permissions WHERE key = :k LIMIT 1',
      [{ name: 'k', value: { stringValue: entry.key } }],
    );
    if (existing.length) {
      console.log(`  = catalog: ${entry.key} already present`);
      continue;
    }
    if (!APPLY) {
      console.log(`  → catalog: would insert ${entry.key}`);
      continue;
    }
    const now = new Date().toISOString();
    await exec(
      `INSERT INTO permissions (id, key, label, category, sort_order, description, created_at, updated_at)
       VALUES (:id, :k, :label, :cat, :sort, :descr, CAST(:now AS timestamptz), CAST(:now AS timestamptz))`,
      [
        { name: 'id', value: { stringValue: entry.id } },
        { name: 'k', value: { stringValue: entry.key } },
        { name: 'label', value: { stringValue: entry.label } },
        { name: 'cat', value: { stringValue: entry.category } },
        { name: 'sort', value: { doubleValue: entry.sort } },
        { name: 'descr', value: { stringValue: entry.description } },
        { name: 'now', value: { stringValue: now } },
      ],
    );
    console.log(`  + catalog: inserted ${entry.key}`);
  }
  console.log('');

  let updates = 0;
  let inserts = 0;
  let unchanged = 0;

  for (const u of users) {
    const row = rowByUser[u.id];
    const rowKeys = parsePerms(row?.permissions);
    const named = Object.fromEntries(
      Object.keys(NAMED).map((alias) => [alias, namedIds[alias] === u.id]),
    );
    const before = baseEffectiveSet(rowKeys);
    const target = computeTarget({ rowKeys, roleName: u.role_name, named });

    const { added, removed } = fmtDiff(before, target);
    const label = `${(u.first_name || '').trim()} ${(u.last_name || '').trim()} (${u.id}, ${u.role_name}${u.status !== 'Active' ? `, ${u.status}` : ''})`;

    const rowIsUpToDate = row && rowKeys
      && rowKeys.length === target.size && rowKeys.every((k) => target.has(k));
    if (rowIsUpToDate) {
      unchanged += 1;
      continue;
    }
    if (!row && added.length === 0 && removed.length === 0) {
      // No-row user whose effective set is unchanged — still materialise a row
      // so future catalog additions don't silently re-grant everything, EXCEPT
      // we leave truly untouched users alone to keep this change minimal.
      unchanged += 1;
      continue;
    }

    const targetArr = [...target].sort();
    console.log(`${row ? 'UPDATE' : 'INSERT'} ${label}`);
    if (added.length) console.log(`   + ${added.join(', ')}`);
    if (removed.length) console.log(`   - ${removed.join(', ')}`);

    if (!APPLY) { row ? updates++ : inserts++; continue; }

    const now = new Date().toISOString();
    if (row) {
      await exec(
        `UPDATE user_permissions
         SET permissions = CAST(:perms AS jsonb),
             updated_at = :now,
             updated_by = :by
         WHERE rec_id = :rid`,
        [
          { name: 'perms', value: { stringValue: JSON.stringify(targetArr) } },
          { name: 'now', value: { stringValue: now } },
          { name: 'by', value: { stringValue: UPDATED_BY } },
          { name: 'rid', value: { stringValue: row.rec_id } },
        ],
      );
      updates += 1;
    } else {
      const recId = `rec${randomBytes(9).toString('hex')}`;
      await exec(
        `INSERT INTO user_permissions (rec_id, id, user_id, permissions, updated_at, updated_by, created_at)
         VALUES (:rid, :id, :uid, CAST(:perms AS jsonb), :now, :by, CAST(:now AS timestamptz))`,
        [
          { name: 'rid', value: { stringValue: recId } },
          { name: 'id', value: { stringValue: `up_${u.id}` } },
          { name: 'uid', value: { stringValue: u.id } },
          { name: 'perms', value: { stringValue: JSON.stringify(targetArr) } },
          { name: 'now', value: { stringValue: now } },
          { name: 'by', value: { stringValue: UPDATED_BY } },
        ],
      );
      inserts += 1;
    }
  }

  console.log(`\n${APPLY ? 'Applied' : 'Would apply'}: ${updates} updates, ${inserts} inserts, ${unchanged} unchanged.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
