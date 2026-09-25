#!/usr/bin/env node
/**
 * Grant `referral.edit_language` to EVERY user (edit preferred language from
 * the Referral tab — on by default for all staff).
 *
 * What it does:
 *   1. Inserts the permissions catalog row if missing.
 *   2. Appends the key to every permission_presets row's permissions jsonb
 *      (so future preset applications include it).
 *   3. Appends the key to every existing user_permissions row.
 *      Users with NO row already receive it via the fail-open default
 *      (the key is not deny-by-default).
 *
 * Usage (from careStream/):
 *   node scripts/grant-edit-language.js           # dry-run
 *   node scripts/grant-edit-language.js --apply   # write
 *
 * Requires WB_CLUSTER_ARN + WB_SECRET_ARN (loads careStream/.env if present).
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';

const __dirname = dirname(fileURLToPath(import.meta.url));
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

const APPLY = process.argv.includes('--apply');
const PERM = 'referral.edit_language';

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
  console.log(`Permission: ${PERM}`);

  // 1. Catalog row
  const catalog = await query(
    'SELECT rec_id, id, key FROM permissions WHERE key = :k LIMIT 1',
    [{ name: 'k', value: { stringValue: PERM } }],
  );
  if (!catalog.length) {
    if (APPLY) {
      const now = new Date().toISOString();
      await exec(
        `INSERT INTO permissions (id, key, label, category, sort_order, description, created_at, updated_at)
         VALUES (
           'perm_referral_edit_language',
           :k,
           'Edit preferred language',
           'Referrals',
           14.55,
           'Set or change the patient preferred language from the Referral tab. Granted to everyone by default.',
           CAST(:now AS timestamptz),
           CAST(:now AS timestamptz)
         )`,
        [
          { name: 'k', value: { stringValue: PERM } },
          { name: 'now', value: { stringValue: now } },
        ],
      );
      console.log('  + Inserted permissions catalog row');
    } else {
      console.log('  (would insert permissions catalog row)');
    }
  } else {
    console.log('  = permissions catalog already has key');
  }

  // 2. Presets
  const presets = await query('SELECT rec_id, id, name, permissions::text AS permissions FROM permission_presets');
  for (const p of presets) {
    const keys = parsePerms(p.permissions);
    if (keys.includes(PERM)) {
      console.log(`  = preset ${p.id} (${p.name}): already has key`);
      continue;
    }
    if (!APPLY) {
      console.log(`  → preset ${p.id} (${p.name}): would add`);
      continue;
    }
    await exec(
      'UPDATE permission_presets SET permissions = CAST(:perms AS jsonb) WHERE rec_id = :rid',
      [
        { name: 'perms', value: { stringValue: JSON.stringify([...keys, PERM]) } },
        { name: 'rid', value: { stringValue: p.rec_id } },
      ],
    );
    console.log(`  ✓ preset ${p.id} (${p.name}): added`);
  }

  // 3. Every existing user_permissions row
  const rows = await query('SELECT rec_id, user_id, permissions::text AS permissions FROM user_permissions');
  let already = 0;
  let planned = 0;
  for (const r of rows) {
    const keys = parsePerms(r.permissions);
    if (keys.includes(PERM)) { already += 1; continue; }
    planned += 1;
    if (!APPLY) continue;
    const now = new Date().toISOString();
    await exec(
      `UPDATE user_permissions
       SET permissions = CAST(:perms AS jsonb), updated_at = CAST(:now AS timestamptz)
       WHERE rec_id = :rid`,
      [
        { name: 'perms', value: { stringValue: JSON.stringify([...keys, PERM]) } },
        { name: 'now', value: { stringValue: now } },
        { name: 'rid', value: { stringValue: r.rec_id } },
      ],
    );
  }
  console.log(`\nuser_permissions rows: ${rows.length} total, ${already} already had it, ${planned} ${APPLY ? 'updated' : 'would be updated'}.`);
  console.log('Users without a permissions row get the key automatically (fail-open, not deny-by-default).');
}

main().catch((err) => { console.error(err); process.exit(1); });
