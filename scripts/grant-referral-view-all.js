#!/usr/bin/env node
/**
 * Ensure `referral.view_all` on Aurora for everyone EXCEPT named marketers
 * who must only see their own marketer_id / self-entered leads.
 *
 * Usage:
 *   node scripts/grant-referral-view-all.js           # dry-run
 *   node scripts/grant-referral-view-all.js --apply   # write
 *
 * Requires WB_CLUSTER_ARN + WB_SECRET_ARN (loads careStream/.env).
 *
 * Restricted (permission REMOVED):
 *   Janay Fernand, Noelia Reyes
 *   (Directory name is Reyes — historically referred to as Noelia Martinez.)
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
    } catch { /* missing */ }
  }
} catch { /* ignore */ }

const APPLY = process.argv.includes('--apply');
const PERM = 'referral.view_all';
/** Marketers who must NOT see the full caseload. */
const RESTRICTED = [
  ['janay', 'fernand'],
  ['noelia', 'reyes'],
];

const resourceArn = process.env.WB_CLUSTER_ARN;
const secretArn = process.env.WB_SECRET_ARN;
const database = process.env.WB_DATABASE || 'wellbound';
if (!resourceArn || !secretArn) {
  console.error('Set WB_CLUSTER_ARN and WB_SECRET_ARN');
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
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function main() {
  console.log(APPLY ? 'APPLY mode' : 'DRY RUN — pass --apply to write');
  console.log(`Database: ${database}`);

  // Resolve restricted user ids
  const restrictedIds = new Set();
  for (const [fn, ln] of RESTRICTED) {
    const hits = await query(
      `SELECT id, first_name, last_name FROM users
       WHERE lower(trim(both from coalesce(first_name,''))) = :fn
         AND lower(trim(both from coalesce(last_name,''))) = :ln`,
      [
        { name: 'fn', value: { stringValue: fn } },
        { name: 'ln', value: { stringValue: ln } },
      ],
    );
    if (!hits.length) {
      console.warn(`  ✗ Restricted user not found: ${fn} ${ln}`);
      continue;
    }
    for (const h of hits) {
      restrictedIds.add(h.id);
      console.log(`  🔒 Restrict: ${h.first_name} ${h.last_name} (${h.id})`);
    }
  }

  // Catalog row
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
           'perm_referral_view_all',
           :k,
           'View all cases',
           'Referrals',
           13,
           'See every referral in Patients and module queues. Without this, marketers only see their own marketer cases or self-entered leads.',
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
    console.log('  = catalog already has key');
  }

  const rows = await query(
    `SELECT rec_id, user_id, permissions::text AS permissions FROM user_permissions`,
  );

  let granted = 0;
  let revoked = 0;
  let unchanged = 0;

  for (const row of rows) {
    const keys = parsePerms(row.permissions);
    const isRestricted = restrictedIds.has(row.user_id);
    let next = keys;
    let action = null;

    if (isRestricted) {
      if (keys.includes(PERM)) {
        next = keys.filter((k) => k !== PERM);
        action = 'revoke';
      }
    } else if (!keys.includes(PERM)) {
      next = [...keys, PERM];
      action = 'grant';
    }

    if (!action) {
      unchanged += 1;
      continue;
    }

    if (!APPLY) {
      console.log(`  → ${action} ${row.user_id} (${keys.length} → ${next.length})`);
      if (action === 'grant') granted += 1;
      else revoked += 1;
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
        { name: 'rid', value: { stringValue: row.rec_id } },
      ],
    );
    if (action === 'grant') granted += 1;
    else revoked += 1;
  }

  console.log(`Done. grant=${granted} revoke=${revoked} unchanged=${unchanged}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
