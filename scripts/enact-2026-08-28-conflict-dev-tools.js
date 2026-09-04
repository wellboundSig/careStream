#!/usr/bin/env node
/**
 * Restrict Conflict Categories + Developer Tools to named lists.
 *
 *   admin.conflict_categories →
 *     Rafi Barides, Raquel Lipschits, Victoria Demetz,
 *     Shayna Blauner Palace, Omwattie Motee, Mordy Slomovics, David Krasner
 *
 *   developer.tools →
 *     Rafi Barides, Raquel Lipschits, Omwattie Motee
 *
 * Usage (from careStream/):
 *   node scripts/enact-2026-08-28-conflict-dev-tools.js           # dry-run
 *   node scripts/enact-2026-08-28-conflict-dev-tools.js --apply   # write
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';
import { PERMISSION_KEYS as K } from '../src/data/permissionKeys.js';

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
const UPDATED_BY = 'script:enact-2026-08-28-conflict-dev-tools';

const PEOPLE = {
  rafi:     { label: 'Rafi Barides', first: 'rafi', lasts: ['barides'] },
  raquel:   { label: 'Raquel Lipschits', first: 'raquel', lasts: ['lipschits', 'lipschitz', 'lipshitz'] },
  victoria: { label: 'Victoria Demetz', first: 'victoria', lasts: ['demetz'] },
  shayna:   { label: 'Shayna Blauner Palace', first: 'shayna', lasts: ['palace', 'blauner'] },
  omwattie: { label: 'Omwattie Motee', first: 'omwattie', lasts: ['motee'] },
  mordy:    { label: 'Mordy Slomovics', first: 'mordy', lasts: ['slomovics'] },
  david:    { label: 'David Krasner', first: 'david', lasts: ['krasner'] },
};

const GRANTS = [
  {
    key: K.CONFLICT_MANAGE_CATEGORIES,
    allow: ['rafi', 'raquel', 'victoria', 'shayna', 'omwattie', 'mordy', 'david'],
  },
  {
    key: K.DEVELOPER_TOOLS,
    allow: ['rafi', 'raquel', 'omwattie'],
  },
];

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

function parsePerms(raw) {
  if (raw == null) return [];
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function matchesTarget(user, target) {
  const fn = String(user.first_name || '').trim().toLowerCase();
  const ln = String(user.last_name || '').trim().toLowerCase();
  if (fn !== target.first) return false;
  return target.lasts.some((l) => ln === l || ln.includes(l));
}

function pickUser(hits) {
  if (!hits.length) return null;
  return hits.find((u) => (u.status || 'Active') === 'Active') || hits[0];
}

async function main() {
  console.log(APPLY ? 'APPLY mode — will write Aurora' : 'DRY RUN — pass --apply to write');
  console.log(`Database: ${database}\n`);

  const users = await query(`
    SELECT id, first_name, last_name, status
    FROM users
    ORDER BY first_name, last_name`);
  const permRows = await query(`
    SELECT rec_id, id, user_id, permissions::text AS permissions
    FROM user_permissions`);
  const rowByUser = Object.fromEntries(permRows.map((p) => [p.user_id, p]));

  const namedIds = {};
  for (const [alias, target] of Object.entries(PEOPLE)) {
    const hits = users.filter((u) => matchesTarget(u, target));
    const pick = pickUser(hits);
    if (!pick) {
      const similar = users.filter((u) => {
        const blob = `${u.first_name || ''} ${u.last_name || ''}`.toLowerCase();
        return blob.includes(target.first) || target.lasts.some((l) => blob.includes(l));
      });
      console.error(`  ✗ Not found: ${target.label}`);
      if (similar.length) {
        console.error(`    similar: ${similar.map((u) => `${u.first_name} ${u.last_name} (${u.id})`).join(', ')}`);
      }
      process.exit(1);
    }
    namedIds[alias] = pick.id;
    console.log(`  ✓ ${alias}: ${pick.first_name} ${pick.last_name} (${pick.id})`);
  }
  console.log('');

  const allowedByKey = {};
  for (const g of GRANTS) {
    allowedByKey[g.key] = new Set(g.allow.map((alias) => namedIds[alias]));
    console.log(`  ${g.key}: ${g.allow.map((a) => PEOPLE[a].label).join(', ')}`);
  }
  console.log('');

  const allKeys = GRANTS.map((g) => g.key);
  let changed = 0;
  let unchanged = 0;
  const missingRow = [];

  for (const u of users) {
    const row = rowByUser[u.id];
    const name = `${u.first_name} ${u.last_name}`;
    if (!row) {
      const needsGrant = allKeys.some((k) => allowedByKey[k].has(u.id));
      if (needsGrant) missingRow.push(`${name} (${u.id})`);
      continue;
    }

    const keys = parsePerms(row.permissions);
    let next = keys.filter((k) => !allKeys.includes(k));
    for (const k of allKeys) {
      if (allowedByKey[k].has(u.id)) next.push(k);
    }

    const same = allKeys.every((k) => keys.includes(k) === next.includes(k));
    if (same) {
      unchanged += 1;
      continue;
    }

    const added = allKeys.filter((k) => next.includes(k) && !keys.includes(k));
    const removed = allKeys.filter((k) => keys.includes(k) && !next.includes(k));
    const desc = [
      added.length ? `+${added.join(',')}` : '',
      removed.length ? `-${removed.join(',')}` : '',
    ].filter(Boolean).join(' ');

    if (!APPLY) {
      console.log(`  → ${name}: would ${desc} (${keys.length} → ${next.length})`);
      changed += 1;
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
    console.log(`  ✓ ${name}: ${desc}`);
    changed += 1;
  }

  if (missingRow.length) {
    console.error('\nNamed users have no user_permissions row — cannot grant without wiping other access:');
    for (const line of missingRow) console.error(`  ⚠ ${line}`);
    process.exit(1);
  }

  console.log(`\n${APPLY ? 'Wrote' : 'Would write'}: ${changed} changed, ${unchanged} unchanged.`);
  console.log(`Updated-by tag: ${UPDATED_BY}`);
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
