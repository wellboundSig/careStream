#!/usr/bin/env node
/**
 * Cleanup referral_sources.name to people-only, First Last, no methods/companies.
 *
 * Rules:
 *  1. Name must be a person (not a company/org row)
 *  2. No method channels (fax, email, website, call-in, readmit, …)
 *  3. At least two name parts (first + last); no single-token names
 *  4. Title Case each part
 *  5. Letters and spaces only (hyphens/apostrophes/punctuation stripped or split)
 *
 * Invalid rows: DELETE if no referrals reference them; else deactivate (is_active=FALSE).
 *
 * Usage:
 *   node scripts/cleanup-referral-source-names.js           # dry-run
 *   node scripts/cleanup-referral-source-names.js --confirm
 */

import { RDSDataClient, ExecuteStatementCommand } from '@aws-sdk/client-rds-data';

const CONFIRM = process.argv.includes('--confirm');
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

const METHOD_RE = /^(fax|email|e-?mail|website|web|web lead|call[- ]?in|word of mouth|call-in \/ word of mouth|submission|wellbound email submission|readmit|re[- ]?admit|roc|via|manhattan dd council event|bronx dd council event|brooklyn dd council)$/i;

const NON_PERSON_NAME_RE = /\b(general|llc|inc|services|alliance|design|homecare|home care|hospital|school|pediatrics|event|council|submission|readmit|website|fax|email|care design|advance care|tri-?county|hamaspik|boulevard|anchor hc|wellbound|opwdd|front door|group home|human care|summit|nyhc|jemcare|sinergia|parent to parent|called)\b/i;

/** Normalize a candidate person name. Returns null if invalid. */
function normalizePersonName(raw) {
  let s = String(raw || '').trim();
  if (!s) return null;

  // Split hyphenated tokens into separate words (Thomas-mumby → Thomas Mumby)
  s = s.replace(/[-–—_/]+/g, ' ');
  // Drop apostrophes / other punctuation
  s = s.replace(/['’`.,;:()[\]{}|+&@#$!?\\]+/g, '');
  s = s.replace(/\s+/g, ' ').trim();

  if (!s) return null;
  if (METHOD_RE.test(s)) return null;
  if (NON_PERSON_NAME_RE.test(s)) return null;

  // Must be letters + spaces only now
  if (!/^[A-Za-z]+(?: [A-Za-z]+)+$/.test(s)) {
    // Reject if any non-letter remains or only one word
    const parts = s.split(' ').filter(Boolean);
    if (parts.length < 2) return null;
    if (parts.some((p) => !/^[A-Za-z]+$/.test(p))) return null;
  }

  const parts = s.split(' ').filter(Boolean);
  if (parts.length < 2) return null;

  // Title Case each part (Davidgray stays one word if already joined)
  const titled = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ');

  // Reject if name equals a pure method after normalize
  if (METHOD_RE.test(titled)) return null;
  if (NON_PERSON_NAME_RE.test(titled)) return null;

  return titled;
}

function classify(row) {
  const raw = row.name || '';
  const normalized = normalizePersonName(raw);

  // Explicit company/channel rows even if somehow two words
  const entityish = /—|general$/i.test(raw)
    || /^(website|fax|wellbound|manhattan|bronx|brooklyn|call-in|tri-county care)/i.test(raw.trim());

  if (entityish || !normalized) {
    return { action: 'remove', reason: entityish ? 'company/method/channel' : reasonFor(raw), normalized: null };
  }

  if (normalized !== raw.trim()) {
    return { action: 'rename', reason: 'normalize casing/chars', normalized };
  }
  return { action: 'keep', reason: 'ok', normalized };
}

function reasonFor(raw) {
  const s = String(raw || '').trim();
  if (!s) return 'empty';
  if (METHOD_RE.test(s)) return 'method/channel';
  if (NON_PERSON_NAME_RE.test(s)) return 'company/non-person words';
  const parts = s.replace(/[-–—_/]+/g, ' ').replace(/[^A-Za-z ]+/g, '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return 'single-word / incomplete name';
  if (/[^A-Za-z\s'-]/.test(s)) return 'special characters';
  return 'invalid person name';
}

async function main() {
  const res = await exec(`
    SELECT r.rec_id, r.id, r.name, r.type, COALESCE(r.source_entity,''), COALESCE(r.is_active,''),
           (SELECT COUNT(*)::int FROM referrals ref WHERE ref.referral_source_id = r.id) AS ref_count
    FROM referral_sources r
    ORDER BY r.name
  `);

  const rows = (res.records || []).map((r) => ({
    rec_id: r[0]?.stringValue,
    id: (r[1]?.stringValue || '').replace(/\n/g, '').trim(),
    name: r[2]?.stringValue || '',
    type: r[3]?.stringValue || '',
    entity: r[4]?.stringValue || '',
    active: r[5]?.stringValue || '',
    ref_count: r[6]?.longValue ?? 0,
  }));

  const plan = { rename: [], removeDelete: [], removeDeactivate: [], keep: [] };

  for (const row of rows) {
    const c = classify(row);
    if (c.action === 'keep') plan.keep.push({ ...row, ...c });
    else if (c.action === 'rename') plan.rename.push({ ...row, ...c });
    else if (row.ref_count > 0) plan.removeDeactivate.push({ ...row, ...c });
    else plan.removeDelete.push({ ...row, ...c });
  }

  console.log('── Cleanup plan ──');
  console.log(`Total: ${rows.length}`);
  console.log(`Keep: ${plan.keep.length}`);
  console.log(`Rename: ${plan.rename.length}`);
  console.log(`Delete (unused): ${plan.removeDelete.length}`);
  console.log(`Deactivate (in use): ${plan.removeDeactivate.length}`);

  console.log('\nRenames:');
  for (const r of plan.rename) {
    console.log(`  "${r.name}" → "${r.normalized}"  (${r.entity || '—'})`);
  }
  console.log('\nDeletes:');
  for (const r of plan.removeDelete) {
    console.log(`  "${r.name}"  [${r.reason}]  entity=${r.entity || '—'}`);
  }
  console.log('\nDeactivate (referenced):');
  for (const r of plan.removeDeactivate) {
    console.log(`  "${r.name}"  refs=${r.ref_count}  [${r.reason}]`);
  }

  if (!CONFIRM) {
    console.log('\nDry-run only. Re-run with --confirm to apply.');
    return;
  }

  let renamed = 0;
  let deleted = 0;
  let deactivated = 0;

  for (const r of plan.rename) {
    await exec(
      `UPDATE referral_sources
       SET name = :name, updated_at = NOW()
       WHERE rec_id = :rec_id`,
      [
        { name: 'name', value: { stringValue: r.normalized } },
        { name: 'rec_id', value: { stringValue: r.rec_id } },
      ],
    );
    renamed += 1;
  }

  for (const r of plan.removeDelete) {
    await exec(
      `DELETE FROM referral_sources WHERE rec_id = :rec_id`,
      [{ name: 'rec_id', value: { stringValue: r.rec_id } }],
    );
    deleted += 1;
  }

  for (const r of plan.removeDeactivate) {
    await exec(
      `UPDATE referral_sources
       SET is_active = 'FALSE', updated_at = NOW()
       WHERE rec_id = :rec_id`,
      [{ name: 'rec_id', value: { stringValue: r.rec_id } }],
    );
    deactivated += 1;
  }

  const after = await exec(`SELECT COUNT(*)::int FROM referral_sources WHERE UPPER(COALESCE(is_active,'')) IN ('TRUE','') OR is_active IS NULL`);
  const activeCount = after.records?.[0]?.[0]?.longValue;
  console.log(`\nDone — renamed ${renamed}, deleted ${deleted}, deactivated ${deactivated}`);
  console.log(`Active-ish rows remaining: ${activeCount}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
