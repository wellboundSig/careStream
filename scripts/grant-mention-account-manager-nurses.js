#!/usr/bin/env node
/**
 * Grant `note.mention_account_manager` to Active nurses:
 *   Clinical RN (rol_005), COC Nurse (rol_014), Field (rol_013).
 *
 * Usage (from careStream/):
 *   node scripts/grant-mention-account-manager-nurses.js           # dry-run
 *   node scripts/grant-mention-account-manager-nurses.js --apply   # write
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
const PERM = 'note.mention_account_manager';
const ROLE_IDS = ['rol_005', 'rol_014', 'rol_013']; // Clinical RN, COC Nurse, Field

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
  console.log(`Key: ${PERM}`);
  console.log(`Roles: ${ROLE_IDS.join(', ')}`);

  const catalog = await query(
    `SELECT rec_id FROM permissions WHERE key = :k LIMIT 1`,
    [{ name: 'k', value: { stringValue: PERM } }],
  );
  if (!catalog.length) {
    if (APPLY) {
      const now = new Date().toISOString();
      await exec(
        `INSERT INTO permissions (id, key, label, category, sort_order, description, created_at, updated_at)
         VALUES (
           'perm_note_mention_account_manager',
           :k,
           'Mention Account manager info',
           'Notes & Files',
           113,
           'In notes, @mention Account manager info to append to the SOC Completed Pending Log column',
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
  }

  const users = await query(
    `SELECT u.rec_id, u.id, u.first_name, u.last_name, u.role_id, u.status
     FROM users u
     WHERE u.role_id IN (${ROLE_IDS.map((_, i) => `:r${i}`).join(', ')})
       AND coalesce(trim(u.status), 'Active') = 'Active'
     ORDER BY u.role_id, u.last_name, u.first_name`,
    ROLE_IDS.map((rid, i) => ({ name: `r${i}`, value: { stringValue: rid } })),
  );
  console.log(`Active nurses: ${users.length}`);

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
      console.log(`  = ${u.first_name} ${u.last_name} (${u.role_id}): no user_permissions row (fail-open)`);
      skipped += 1;
      continue;
    }

    const keys = parsePerms(existing.permissions);
    if (keys.includes(PERM)) {
      console.log(`  = ${u.first_name} ${u.last_name}: already has ${PERM}`);
      already += 1;
      continue;
    }

    const next = [...keys, PERM];
    if (!APPLY) {
      console.log(`  → ${u.first_name} ${u.last_name}: would add ${PERM}`);
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
    console.log(`  ✓ ${u.first_name} ${u.last_name}: granted ${PERM}`);
    updated += 1;
  }

  console.log(`Done. granted/would-grant=${updated} already=${already} no-row-skip=${skipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
