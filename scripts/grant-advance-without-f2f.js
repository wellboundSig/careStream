#!/usr/bin/env node
/**
 * Grant `intake.advance_without_f2f` to every Active Intake Specialist (rol_003).
 *
 * Usage (from careStream/):
 *   node scripts/grant-advance-without-f2f.js           # dry-run
 *   node scripts/grant-advance-without-f2f.js --apply   # write
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
const PERM = 'intake.advance_without_f2f';
const ROLE_ID = 'rol_003'; // Intake Specialist

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

  const users = await query(
    `SELECT u.rec_id, u.id, u.first_name, u.last_name, u.status
     FROM users u
     WHERE u.role_id = :rid
       AND coalesce(trim(u.status), 'Active') = 'Active'
     ORDER BY u.last_name, u.first_name`,
    [{ name: 'rid', value: { stringValue: ROLE_ID } }],
  );
  console.log(`Active Intake Specialists: ${users.length}`);

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
           'perm_intake_advance_without_f2f',
           :k,
           'Advance to EMR without F2F / clinical',
           'Leads',
           12,
           'Push Intake → EMR Onboarding before F2F and clinical; both completed after SOC.',
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
      // No permissions row ⇒ usePermissions grants all non-deny-by-default keys
      // already (this key is not deny-by-default). Don't create a sparse row.
      console.log(`  = ${u.first_name} ${u.last_name}: no user_permissions row (already has button via fail-open)`);
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
      console.log(`  → ${u.first_name} ${u.last_name}: would add ${PERM} (${keys.length} → ${next.length})`);
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
