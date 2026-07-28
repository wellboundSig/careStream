#!/usr/bin/env node
/**
 * Grant SOC Completed Pending Log access to every Active Marketer (rol_006):
 *   - module.scheduling              (open SOC Completed)
 *   - scheduling.soc_pending_log     (Pending Log view toggle)
 *   - referral.flag_urgent_care      (flag + set urgent type)
 *
 * Usage (from careStream/):
 *   node scripts/grant-soc-pending-log-marketers.js           # dry-run
 *   node scripts/grant-soc-pending-log-marketers.js --apply   # write
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  for (const name of ['.env.local', '.env']) {
    try {
      for (const line of readFileSync(resolve(__dirname, '..', name), 'utf8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const eq = t.indexOf('=');
        if (eq < 0) continue;
        const k = t.slice(0, eq).trim();
        const v = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
        if (!process.env[k]) process.env[k] = v;
      }
    } catch { /* missing file */ }
  }
} catch { /* ignore */ }

const APPLY = process.argv.includes('--apply');
const ROLE_ID = 'rol_006'; // Marketer
const PERMS = [
  {
    key: 'module.scheduling',
    id: 'perm_module_scheduling',
    label: 'Open Scheduling module pages',
    category: 'Module Pages',
    sort: 6,
    description: 'Access Staffing, Pre-SOC, SOC Scheduled, SOC Completed module pages',
  },
  {
    key: 'scheduling.soc_pending_log',
    id: 'perm_scheduling_soc_pending_log',
    label: 'SOC Completed — Pending Log view',
    category: 'Scheduling & SOC',
    sort: 84,
    description: 'Access the Pending Log alternate queue on SOC Completed',
  },
  {
    key: 'referral.flag_urgent_care',
    id: 'perm_referral_flag_urgent_care',
    label: 'Flag urgent care / pre-assessment',
    category: 'Referrals',
    sort: 19,
    description: 'Mark a patient as requiring urgent pre-SOC care',
  },
];

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

function parsePerms(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function ensureCatalog() {
  for (const p of PERMS) {
    const rows = await query(
      `SELECT rec_id FROM permissions WHERE key = :k LIMIT 1`,
      [{ name: 'k', value: { stringValue: p.key } }],
    );
    if (rows.length) continue;
    if (!APPLY) {
      console.log(`  (would insert permissions catalog: ${p.key})`);
      continue;
    }
    const now = new Date().toISOString();
    await exec(
      `INSERT INTO permissions (id, key, label, category, sort_order, description, created_at, updated_at)
       VALUES (
         :id, :k, :label, :cat, :sort, :desc,
         CAST(:now AS timestamptz), CAST(:now AS timestamptz)
       )`,
      [
        { name: 'id', value: { stringValue: p.id } },
        { name: 'k', value: { stringValue: p.key } },
        { name: 'label', value: { stringValue: p.label } },
        { name: 'cat', value: { stringValue: p.category } },
        { name: 'sort', value: { longValue: p.sort } },
        { name: 'desc', value: { stringValue: p.description } },
        { name: 'now', value: { stringValue: now } },
      ],
    );
    console.log(`  + Inserted permissions catalog row: ${p.key}`);
  }
}

async function main() {
  console.log(APPLY ? 'APPLY mode — will write Aurora' : 'DRY RUN — pass --apply to write');
  console.log(`Database: ${database}`);
  console.log(`Keys: ${PERMS.map((p) => p.key).join(', ')}`);

  await ensureCatalog();

  const users = await query(
    `SELECT u.rec_id, u.id, u.first_name, u.last_name, u.status
     FROM users u
     WHERE u.role_id = :rid
       AND coalesce(trim(u.status), 'Active') = 'Active'
     ORDER BY u.last_name, u.first_name`,
    [{ name: 'rid', value: { stringValue: ROLE_ID } }],
  );
  console.log(`Active Marketers: ${users.length}`);

  let updated = 0;
  let already = 0;
  let skipped = 0;

  for (const u of users) {
    const rows = await query(
      `SELECT rec_id, permissions::text AS permissions
       FROM user_permissions
       WHERE user_id = :uid
       LIMIT 1`,
      [{ name: 'uid', value: { stringValue: u.id } }],
    );
    const existing = rows[0];
    if (!existing) {
      console.log(`  = ${u.first_name} ${u.last_name}: no user_permissions row (fail-open already has non-deny keys)`);
      skipped += 1;
      continue;
    }

    const keys = parsePerms(existing.permissions);
    const missing = PERMS.map((p) => p.key).filter((k) => !keys.includes(k));
    if (!missing.length) {
      console.log(`  = ${u.first_name} ${u.last_name}: already has all keys`);
      already += 1;
      continue;
    }

    const next = [...keys, ...missing];
    if (!APPLY) {
      console.log(`  → ${u.first_name} ${u.last_name}: would add ${missing.join(', ')} (${keys.length} → ${next.length})`);
      updated += 1;
      continue;
    }

    const now = new Date().toISOString();
    await exec(
      `UPDATE user_permissions
       SET permissions = CAST(:perms AS jsonb),
           updated_at = CAST(:now AS timestamptz)
       WHERE rec_id = :rid`,
      [
        { name: 'perms', value: { stringValue: JSON.stringify(next) } },
        { name: 'now', value: { stringValue: now } },
        { name: 'rid', value: { stringValue: existing.rec_id } },
      ],
    );
    console.log(`  ✓ ${u.first_name} ${u.last_name}: granted ${missing.join(', ')}`);
    updated += 1;
  }

  console.log(`Done. granted/would-grant=${updated} already=${already} no-row-skip=${skipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
