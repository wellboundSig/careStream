#!/usr/bin/env node
/**
 * Grant batch eligibility (and Optum Auto, required to run live checks)
 * to Rafi Barides and Mordy Slomovics only.
 *
 * Usage (from careStream/):
 *   node scripts/grant-batch-eligibility.js           # dry-run
 *   node scripts/grant-batch-eligibility.js --apply   # write
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
const PERMS = [
  {
    key: 'clinical.eligibility_batch',
    id: 'perm_clinical_eligibility_batch',
    label: 'Batch eligibility spreadsheet',
    category: 'Eligibility & Authorization',
    sort: 30.6,
    description: 'Upload a CSV/Excel roster and run Optum (and later Waystar / eSolutions) checks in bulk. Deny-by-default.',
  },
  {
    key: 'clinical.eligibility_optum_auto',
    id: 'perm_clinical_eligibility_optum_auto',
    label: 'Optum Auto Check (beta)',
    category: 'Eligibility & Authorization',
    sort: 30.5,
    description: 'Run real-time Optum 270/271 eligibility Auto Check. Deny-by-default until Optum enrollment is validated.',
  },
];
const TARGETS = [
  ['rafi', 'barides'],
  ['mordy', 'slomovics'],
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

async function main() {
  console.log(APPLY ? 'APPLY mode — will write Aurora' : 'DRY RUN — pass --apply to write');
  console.log(`Database: ${database}`);

  const found = [];
  for (const [fn, ln] of TARGETS) {
    const hits = await query(
      `SELECT rec_id, id, first_name, last_name, status
       FROM users
       WHERE lower(trim(both from coalesce(first_name,''))) = :fn
         AND lower(trim(both from coalesce(last_name,''))) = :ln`,
      [
        { name: 'fn', value: { stringValue: fn } },
        { name: 'ln', value: { stringValue: ln } },
      ],
    );
    if (!hits.length) {
      console.warn(`  ✗ Not found: ${fn} ${ln}`);
      continue;
    }
    const pick = hits.find((u) => (u.status || 'Active') === 'Active') || hits[0];
    found.push(pick);
    console.log(`  ✓ ${pick.first_name} ${pick.last_name} (${pick.id})`);
  }

  if (found.length !== TARGETS.length) {
    console.error('Did not resolve every target user. Aborting.');
    process.exit(1);
  }

  const now = new Date().toISOString();
  for (const perm of PERMS) {
    const catalog = await query(
      `SELECT rec_id, id, key FROM permissions WHERE key = :k LIMIT 1`,
      [{ name: 'k', value: { stringValue: perm.key } }],
    );
    if (catalog.length) {
      console.log(`  = catalog already has ${perm.key}`);
      continue;
    }
    if (!APPLY) {
      console.log(`  (would insert catalog ${perm.key})`);
      continue;
    }
    await exec(
      `INSERT INTO permissions (id, key, label, category, sort_order, description, created_at, updated_at)
       VALUES (
         :id, :k, :label, :cat, :sort, :desc,
         CAST(:now AS timestamptz), CAST(:now AS timestamptz)
       )`,
      [
        { name: 'id', value: { stringValue: perm.id } },
        { name: 'k', value: { stringValue: perm.key } },
        { name: 'label', value: { stringValue: perm.label } },
        { name: 'cat', value: { stringValue: perm.category } },
        { name: 'sort', value: { doubleValue: perm.sort } },
        { name: 'desc', value: { stringValue: perm.description } },
        { name: 'now', value: { stringValue: now } },
      ],
    );
    console.log(`  + Inserted catalog ${perm.key}`);
  }

  const keysToAdd = PERMS.map((p) => p.key);
  for (const u of found) {
    const rows = await query(
      `SELECT rec_id, id, user_id, permissions::text AS permissions
       FROM user_permissions
       WHERE user_id = :uid
       LIMIT 1`,
      [{ name: 'uid', value: { stringValue: u.id } }],
    );
    const existing = rows[0];
    const keys = parsePerms(existing?.permissions);
    const next = [...keys];
    for (const k of keysToAdd) {
      if (!next.includes(k)) next.push(k);
    }

    if (existing && next.length === keys.length) {
      console.log(`  = ${u.first_name} ${u.last_name}: already has both keys`);
      continue;
    }

    if (!APPLY) {
      console.log(`  → ${u.first_name} ${u.last_name}: would add ${keysToAdd.filter((k) => !keys.includes(k)).join(', ')} (${keys.length} → ${next.length} keys)${existing ? '' : ' [no row yet]'}`);
      continue;
    }

    if (existing) {
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
      console.log(`  ✓ ${u.first_name} ${u.last_name}: updated user_permissions`);
    } else {
      console.warn(
        `  ⚠ ${u.first_name} ${u.last_name}: no user_permissions row. `
        + `Skipping create-with-only-these-keys (would wipe other grants). `
        + `Add via User Management UI.`,
      );
    }
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
