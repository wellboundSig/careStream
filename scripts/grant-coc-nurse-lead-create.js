#!/usr/bin/env node
/**
 * Grant COC nurses the keys needed to open + submit the New Lead form:
 *   leads.create, referral.create,
 *   directory.referral_sources.view, directory.marketers.view,
 *   module.intake
 *
 * Also updates the COC Nurse system preset so new assignments pick this up.
 *
 * Targets: Active users with role COC Nurse (rol_014).
 *
 * Usage (from careStream/):
 *   node scripts/grant-coc-nurse-lead-create.js           # dry-run
 *   node scripts/grant-coc-nurse-lead-create.js --apply   # write
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';
import { PERMISSION_KEYS as K, DEFAULT_PRESETS } from '../src/data/permissionKeys.js';

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
const COC_ROLE_ID = 'rol_014';
const GRANT_KEYS = [
  K.LEADS_CREATE,
  K.REFERRAL_CREATE,
  K.DIRECTORY_REFERRAL_SOURCES_VIEW,
  K.DIRECTORY_MARKETERS_VIEW,
  K.MODULE_INTAKE,
];
const PRESET = DEFAULT_PRESETS.find((p) => p.id === 'preset_coc_nurse');

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
  console.log(`Grant: ${GRANT_KEYS.join(', ')}\n`);

  if (!PRESET) {
    console.error('preset_coc_nurse missing from DEFAULT_PRESETS');
    process.exit(1);
  }

  const presetRows = await query(
    `SELECT rec_id, permissions::text AS permissions FROM permission_presets WHERE id = 'preset_coc_nurse' LIMIT 1`,
  );
  if (!presetRows.length) {
    console.error('permission_presets has no preset_coc_nurse row');
    process.exit(1);
  }
  const presetKeys = parsePerms(presetRows[0].permissions);
  const presetMissing = [...new Set([...PRESET.permissions, ...GRANT_KEYS])].filter((k) => !presetKeys.includes(k));
  if (presetMissing.length) {
    console.log(`preset_coc_nurse missing ${presetMissing.length} key(s): ${presetMissing.join(', ')}`);
    const nextPreset = [...presetKeys];
    for (const k of presetMissing) nextPreset.push(k);
    if (APPLY) {
      const now = new Date().toISOString();
      await exec(
        `UPDATE permission_presets
         SET permissions = CAST(:perms AS jsonb),
             updated_at = CAST(:now AS timestamptz)
         WHERE rec_id = :rid`,
        [
          { name: 'perms', value: { stringValue: JSON.stringify(nextPreset) } },
          { name: 'now', value: { stringValue: now } },
          { name: 'rid', value: { stringValue: presetRows[0].rec_id } },
        ],
      );
      console.log('  ✓ preset_coc_nurse merged\n');
    } else {
      console.log('  (would merge those keys onto the live preset)\n');
    }
  } else {
    console.log('preset_coc_nurse already has the lead-form keys\n');
  }

  const users = await query(
    `SELECT u.id, u.first_name, u.last_name, u.status,
            up.rec_id AS perm_rec_id, up.permissions::text AS permissions
     FROM users u
     LEFT JOIN user_permissions up ON up.user_id = u.id
     WHERE u.role_id = :role
       AND coalesce(trim(u.status), 'Active') = 'Active'
     ORDER BY u.first_name, u.last_name`,
    [{ name: 'role', value: { stringValue: COC_ROLE_ID } }],
  );

  console.log(`Active COC Nurse users: ${users.length}`);
  let updated = 0;
  let already = 0;
  let skipped = 0;
  for (const u of users) {
    const label = `${(u.first_name || '').trim()} ${(u.last_name || '').trim()} (${u.id})`;
    if (!u.perm_rec_id) {
      console.log(`  = ${label}: no user_permissions row (fail-open already has lead create)`);
      skipped += 1;
      continue;
    }
    const keys = parsePerms(u.permissions);
    const missing = GRANT_KEYS.filter((k) => !keys.includes(k));
    if (!missing.length) {
      console.log(`  = ${label}: already has all ${GRANT_KEYS.length} keys`);
      already += 1;
      continue;
    }
    if (!APPLY) {
      console.log(`  → ${label}: would add ${missing.join(', ')}`);
      updated += 1;
      continue;
    }
    const next = [...keys];
    for (const k of missing) next.push(k);
    const now = new Date().toISOString();
    await exec(
      `UPDATE user_permissions
       SET permissions = CAST(:perms AS jsonb),
           updated_at = CAST(:now AS timestamptz)
       WHERE rec_id = :rid`,
      [
        { name: 'perms', value: { stringValue: JSON.stringify(next) } },
        { name: 'now', value: { stringValue: now } },
        { name: 'rid', value: { stringValue: u.perm_rec_id } },
      ],
    );
    console.log(`  ✓ ${label}: added ${missing.join(', ')}`);
    updated += 1;
  }

  console.log(`\n${APPLY ? 'Applied' : 'Would apply'}: ${updated} updated, ${already} already ok, ${skipped} skipped`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
