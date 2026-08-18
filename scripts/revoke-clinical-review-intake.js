#!/usr/bin/env node
/**
 * Remove Clinical RN review access from every Intake Specialist (rol_003).
 *
 * Strips:
 *   clinical.rn_review
 *   clinical.rn_unlock
 *   snapshot.edit_clinical_review
 *   module.clinical
 *
 * Leaves triage / F2F keys (intake still collects those).
 *
 * Usage (from careStream/):
 *   node scripts/revoke-clinical-review-intake.js           # dry-run
 *   node scripts/revoke-clinical-review-intake.js --apply   # write
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
const ROLE_ID = 'rol_003'; // Intake Specialist
const REVOKE = new Set([
  'clinical.rn_review',
  'clinical.rn_unlock',
  'snapshot.edit_clinical_review',
  'module.clinical',
]);

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
  console.log(`Revoking: ${[...REVOKE].join(', ')}`);

  const users = await query(
    `SELECT u.id, u.first_name, u.last_name, u.status
     FROM users u
     WHERE u.role_id = :rid
     ORDER BY u.last_name, u.first_name`,
    [{ name: 'rid', value: { stringValue: ROLE_ID } }],
  );
  console.log(`Intake Specialists: ${users.length}`);

  let updated = 0;
  let clean = 0;
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
      console.log(`  = ${u.first_name} ${u.last_name}: no user_permissions row (fail-open; clinical.rn_review is deny-by-default)`);
      skipped += 1;
      continue;
    }

    const keys = parsePerms(existing.permissions);
    const hit = keys.filter((k) => REVOKE.has(k));
    if (!hit.length) {
      console.log(`  = ${u.first_name} ${u.last_name}: already clean`);
      clean += 1;
      continue;
    }

    const next = keys.filter((k) => !REVOKE.has(k));
    if (!APPLY) {
      console.log(`  → ${u.first_name} ${u.last_name}: would remove ${hit.join(', ')} (${keys.length} → ${next.length})`);
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
    console.log(`  ✓ ${u.first_name} ${u.last_name}: removed ${hit.join(', ')}`);
    updated += 1;
  }

  console.log(`Done. updated/would-update=${updated} already-clean=${clean} no-row=${skipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
