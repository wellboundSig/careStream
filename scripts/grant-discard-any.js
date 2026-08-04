#!/usr/bin/env node
/**
 * Grant `referral.discard_any` to named users on Aurora (RDS Data API).
 *
 * Usage (from careStream/):
 *   node scripts/grant-discard-any.js           # dry-run
 *   node scripts/grant-discard-any.js --apply   # write
 *
 * Requires WB_CLUSTER_ARN + WB_SECRET_ARN (or AWS lookup).
 * Optional: WB_DATABASE (default wellbound).
 *
 * Targets: Raquel Lipschits, Rafi Barides
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
const PERM = 'referral.discard_any';
const TARGETS = [
  ['raquel', 'lipschits'],
  ['rafi', 'barides'],
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

  const found = [];
  for (const [fn, ln] of TARGETS) {
    const hits = await query(
      `SELECT rec_id, id, first_name, last_name, status
       FROM users
       WHERE lower(trim(both from coalesce(first_name,''))) = :fn
         AND lower(trim(both from coalesce(last_name,''))) LIKE :ln`,
      [
        { name: 'fn', value: { stringValue: fn } },
        // tolerate Lipschits / Lipschitz spelling
        { name: 'ln', value: { stringValue: `${ln.slice(0, 5)}%` } },
      ],
    );
    const match = hits.filter((u) => {
      const last = String(u.last_name || '').toLowerCase();
      return last === ln || last.startsWith('lipsch') || last.startsWith('lipsh');
    });
    if (!match.length) {
      console.warn(`  ✗ Not found: ${fn} ${ln}`);
      // broader search for debugging
      const loose = await query(
        `SELECT id, first_name, last_name, status FROM users
         WHERE lower(first_name) LIKE :q OR lower(last_name) LIKE :q
         LIMIT 8`,
        [{ name: 'q', value: { stringValue: `%${fn}%` } }],
      );
      if (loose.length) {
        console.warn('    similar:', loose.map((u) => `${u.first_name} ${u.last_name}`).join(', '));
      }
      continue;
    }
    const pick = match.find((u) => (u.status || 'Active') === 'Active') || match[0];
    found.push(pick);
    console.log(`  ✓ ${pick.first_name} ${pick.last_name} (${pick.id})`);
  }

  if (!found.length) {
    console.error('No target users found. Aborting.');
    process.exit(1);
  }

  const catalog = await query(
    `SELECT rec_id, id, key FROM permissions WHERE key = :k LIMIT 1`,
    [{ name: 'k', value: { stringValue: PERM } }],
  );
  if (!catalog.length) {
    if (APPLY) {
      const now = new Date().toISOString();
      await exec(
        `INSERT INTO permissions (id, key, label, category, sort_order, description, created_at, updated_at)
         VALUES (
           'perm_referral_discard_any',
           :k,
           'Discard from any stage',
           'Referrals',
           15.5,
           'Send a referral or lead to Discarded Leads from any pipeline stage. Deny-by-default.',
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

    if (keys.includes(PERM)) {
      console.log(`  = ${u.first_name} ${u.last_name}: already has ${PERM}`);
      continue;
    }

    const next = [...keys, PERM];
    if (!APPLY) {
      console.log(`  → ${u.first_name} ${u.last_name}: would add ${PERM} (${keys.length} → ${next.length} keys)`);
      continue;
    }

    const now = new Date().toISOString();
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
        + `Skipping create-with-only-this-key. Add via User Management UI.`,
      );
    }
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
